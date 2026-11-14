#!/usr/bin/env python3
"""Text of the junior (grades 7-9) textbook entries for yw.bdfz.net/junior.

Reads the text layer of the same sun.bdfz.net PDFs whose page images /junior
already shows (data/junior-textbook-pages.v1.json binds every entry to its PDF
pages), so text, page images and PDF are one edition and one file.

The PDFs carry their own text, so nothing is OCR'd or retyped.  A few boxes set
in fonts without a usable Unicode map (some tables on 七上 writing pages, one
page each in 八下 and 九下) cannot be read from the text layer; those regions
are not guessed but shown as that region of sun's page image ("textImage").
xue.bdfz.net's earlier extraction (learn booktext v8) was compared page by
page: it has the same text where the files match, stores punctuation under
NFKC (，→,) and also lacks those boxes, so it is a cross-check, not a source.

    python scripts/build_junior_reading.py --pdfs <dir with <sha256>.pdf> [--only id,..] [--check]

Writes site/data/junior-reading/<entry id>.json and site/data/junior-reading/index.json.
Text is kept verbatim (simplified characters, the book's own punctuation); the
only removals are the publisher watermark, running heads, page numbers and the
emphasis-dot glyphs, which become emphasis marks on the characters above them.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import sys
import unicodedata
from pathlib import Path

import fitz  # PyMuPDF

ROOT = Path(__file__).resolve().parents[1]
PAGES_JSON = ROOT / "site" / "data" / "junior-textbook-pages.v1.json"
OUT_DIR = ROOT / "site" / "data" / "junior-reading"
SCHEMA = "yw-junior-reading-v1"
EXTRACTOR = "yw-junior-extract-v1"
WATERMARK = "仅供个人学习使用，未经授权不得另做他用"
SECTION_TITLES = {"思考探究积累", "思考探究", "积累拓展", "读读写写", "阅读提示", "读一读写一写", "补白"}
PREP_TITLES = {"预习"}
LIST_MARK = re.compile(r"^(?:◎|●|○|◆|■|□|△|▲|☆|★|※|[一二三四五六七八九十]{1,3}[、 　]|[（(][一二三四五六七八九十0-9]{1,3}[)）]|[0-9]{1,2}[.．、]|[①-⑳])")
GOOD_CHAR = re.compile(
    r"[一-鿿㐀-䶿\U00020000-\U0002ffff豈-﫿　-〿＀-￯"
    r"‐-⁯①-⓿─-◿☀-⛿ -~ -ɏɐ-˿"
    r"̀-ͯⅠ-ⅿ←-⋿㈀-㋿︰-﹏⺀-⿟㇀-㇯·]"
)
HANG_MARK = re.compile(r"^(?:◎|●|○|◆|■|□|△|▲|☆|★|※|[一二三四五六七八九十]{1,3}|[（(][一二三四五六七八九十0-9]{1,3}[)）]|[0-9]{1,2}[.．、]?|[①-⑳])")
CJK = re.compile(r"[㐀-鿿豈-﫿\U00020000-\U0002ffff　-〿＀-￯“”‘’—…·]")


def family(font: str) -> str:
    f = font.upper()
    if f.startswith("ROPESEQUENCE"):
        return "marker"
    if f.startswith("KENTEN"):
        return "dot"
    if "ZHUNYS" in f or "XBS" in f or "DBS" in f or "ZYS" in f or "ZYJ" in f or "CY" in f[:5]:
        return "title"
    if "HT" in f[:6] or "LTH" in f or "DH" in f[:6]:
        return "hei"
    if "KT" in f[:6]:
        return "kai"
    if "FS" in f[:6]:
        return "fs"
    if "SS" in f[:6] or "SONG" in f or "SIMSUN" in f:
        return "song"
    return "latin"


def broken(span) -> bool:
    if span["font"].endswith("-GBK-EUC-H"):
        return True
    text = "".join(c for c in span["text"] if not c.isspace() and c not in "\x07\x08​﻿\x01")
    return bool(text) and sum(1 for c in text if not GOOD_CHAR.match(c)) / len(text) > 0.3


TENS = {"!": 10, "@": 20, "#": 30, "$": 40, "%": 50}
MARKER_PUNCT = {",": "，", ";": "；", ".": "。", ":": "："}


def marker_tokens(chars):
    """Characters of a note-number glyph run -> (number, x0, x1, "m") or literal punctuation.

    The textbook's number font writes ①..㉖ as a..z and, in body text, ⑩ and up as
    a shifted digit pair: !0..!9 = 10..19, @0.. = 20.., #0.. = 30.."""
    out, i = [], 0
    while i < len(chars):
        c = chars[i]["c"]
        b = chars[i]["bbox"]
        if c in TENS and i + 1 < len(chars) and chars[i + 1]["c"].isdigit():
            out.append((TENS[c] + int(chars[i + 1]["c"]), b[0], chars[i + 1]["bbox"][2], "m"))
            i += 2
            continue
        if "a" <= c <= "z":
            out.append((ord(c) - 96, b[0], b[2], "m"))
        elif c in MARKER_PUNCT:
            out.append((MARKER_PUNCT[c], b[0], b[2], "t"))
        i += 1
    return out


UNRESOLVED = []

class Row:
    __slots__ = ("x0", "y0", "x1", "y1", "size", "fam", "color", "chars", "kind", "page", "full", "left", "right")

    def __init__(self, page):
        self.page = page
        self.chars = []  # (char, x0, x1, kind) kind: t text, m marker number, e emphasised text
        self.x0 = self.y0 = 1e9
        self.x1 = self.y1 = -1e9
        self.size = 0.0
        self.fam = ""
        self.color = 0
        self.kind = "body"
        self.full = False
        self.left = None
        self.right = None

    def add(self, bbox):
        self.x0 = min(self.x0, bbox[0]); self.y0 = min(self.y0, bbox[1])
        self.x1 = max(self.x1, bbox[2]); self.y1 = max(self.y1, bbox[3])

    @property
    def text(self):
        return "".join(c for c, *_ in self.chars if isinstance(c, str))

    @property
    def plain(self):
        return "".join(c for c, x0, x1, k in self.chars if k != "m")

    @property
    def height(self):
        return self.y1 - self.y0


def page_rows(page, pno):
    """Rows of one PDF page: same-baseline spans of one style, split at wide gaps."""
    raw = page.get_text("rawdict")
    width = page.rect.width
    markers, dots, images, rows = [], [], [], []
    for block in raw["blocks"]:
        if block["type"] == 1:
            images.append(fitz.Rect(block["bbox"]))
            continue
        for line in block["lines"]:
            if line["dir"][0] < 0.9:  # vertical or rotated text (decorations)
                continue
            row = None
            for span in line["spans"]:
                text = "".join(ch["c"] for ch in span["chars"])
                if not text.strip():
                    continue
                if span.get("alpha", 255) < 200 or (span["font"].startswith("SimSun") and span["size"] > 16):
                    continue
                fam = family(span["font"])
                if fam == "dot":
                    dots.append(span)
                    continue
                if fam == "marker":
                    if row is None:
                        markers.append(span)  # attached below to the row it belongs to
                    else:
                        row.chars.extend(t for t in marker_tokens(span["chars"]) if t[3] == "m" or span["size"] < 8)
                    continue
                if row is None:
                    row = Row(pno)
                    rows.append(row)
                row.add(span["bbox"])
                if span["size"] >= row.size:
                    row.size, row.fam, row.color = span["size"], fam, span["color"]
                bad = broken(dict(span, text=text))
                for ch in span["chars"]:
                    row.chars.append((ch["c"], ch["bbox"][0], ch["bbox"][2], "x" if bad else "t"))
            if row is None:
                continue
            # markers seen in this line before its first text span
            first_x = min(c[1] for c in row.chars)
            for span in line["spans"]:
                if family(span["font"]) == "marker" and span["bbox"][2] <= first_x + 1 and span in markers:
                    markers.remove(span)
                    row.chars.extend(t for t in marker_tokens(span["chars"]) if t[3] == "m" or span["size"] < 8)
            row.chars.sort(key=lambda c: c[1])
    # one visual line can be several PDF lines (a raised marker splits it): merge same-baseline neighbours
    rows.sort(key=lambda r: (round(r.y1), r.x0))
    merged = []
    for row in sorted(rows, key=lambda r: r.x0):
        host = None
        for m in merged:
            gap = row.x0 - m.x1
            same_face = m.fam == row.fam or "marker" in (m.fam, row.fam) or {m.fam, row.fam} <= {"song", "latin"} or {m.fam, row.fam} <= {"kai", "latin"} or {m.fam, row.fam} <= {"fs", "latin"}
            if abs(m.y1 - row.y1) < 0.3 * max(m.size, row.size) and m.page == row.page and -2 <= gap \
                    and (abs(m.size - row.size) <= 0.6 and (gap < 2.6 * row.size if same_face else gap < 0.5 * row.size) or gap < 0.3 * row.size):
                host = m
                break
        if host is None:
            merged.append(row)
        else:
            host.chars.extend(row.chars)
            host.add((row.x0, row.y0, row.x1, row.y1))
            if row.size > host.size:
                host.size, host.fam, host.color = row.size, row.fam, row.color
    rows = merged
    for row in rows:
        row.chars.sort(key=lambda c: c[1])
    # rows whose font has no usable Unicode map are shown as the page image of that region
    broken_rows = [r for r in rows if any(k == "x" for *_, k in r.chars)]
    rows = [r for r in rows if r not in broken_rows]
    # note markers: attach each to the row it sits on (top-aligned superscript or the start of a note line)
    for marker in markers:
        mx0, my0, mx1, my1 = marker["bbox"]
        letters = [t for t in marker_tokens(marker["chars"]) if t[3] == "m"]
        if letters:
            mx1 = max(t[2] for t in letters)
        best = None
        for row in rows:
            if row.page != pno:
                continue
            if marker["size"] >= 8:
                # a note's own number set apart before its text on the same line
                overlap = min(row.y1, my1) - max(row.y0, my0)
                if overlap > 0.5 * min(row.height, my1 - my0) and mx1 <= row.x0 + 3 and row.x0 - mx1 < 30:
                    key = (0, row.x0 - mx1)
                    if best is None or key < best[0]:
                        best = (key, row)
                continue
            if my0 >= row.y0 - 4 and my0 <= row.y1 - 1 and mx0 >= row.x0 - 16 and mx0 <= row.x1 + 12:
                d = 0 if row.x0 - 16 <= mx0 <= row.x1 + 2 else 1
                key = (d, abs(my0 - row.y0))
                if best is None or key < best[0]:
                    best = (key, row)
        tokens = marker_tokens(marker["chars"])
        if marker["size"] >= 8:
            tokens = [t for t in tokens if t[3] == "m"]
        for token in tokens:
            if best is None:
                row = Row(pno); row.add(marker["bbox"]); row.size = marker["size"]; row.fam = "marker"; rows.append(row)
            else:
                row = best[1]
            row.chars.append(token)
            if row.fam != "marker":
                row.x0 = min(row.x0, token[1]); row.x1 = max(row.x1, token[2])
            row.chars.sort(key=lambda c: c[1])
    # emphasis dots sit under the characters they mark
    for dot in dots:
        for ch in dot["chars"]:
            cx = (ch["bbox"][0] + ch["bbox"][2]) / 2
            cy = ch["bbox"][1]
            for row in rows:
                if row.page == pno and row.y1 - 6 <= cy <= row.y1 + 4 and row.x0 - 2 <= cx <= row.x1 + 2:
                    best_i, best_d = None, 1e9
                    for i, (c, x0, x1, k) in enumerate(row.chars):
                        if k == "m" or not isinstance(c, str) or not re.match(r"[\u3400-\u9fff\w]", c):
                            continue
                        d = abs((x0 + x1) / 2 - cx)
                        if d < best_d:
                            best_i, best_d = i, d
                    if best_i is not None and best_d < row.size * 0.8:
                        c, x0, x1, k = row.chars[best_i]
                        row.chars[best_i] = (c, x0, x1, "e")
                    break
    rows = [r for r in rows if r.text.strip() or any(k == "m" for *_, k in r.chars)]
    regions = []
    for r in sorted(broken_rows, key=lambda r: r.y0):
        rect = fitz.Rect(r.x0 - 4, r.y0 - 4, r.x1 + 4, r.y1 + 4)
        if regions and rect.y0 - regions[-1].y1 < 24:
            regions[-1] |= rect
        else:
            regions.append(rect)
    return rows, images, width, page.rect.height, regions


def classify(rows, width, height):
    for row in rows:
        text = row.plain.strip()
        if row.y0 > height - 52 and row.size <= 11:
            row.kind = "footer"
        elif row.size >= 17 and row.color not in (2301728, 0) and row.y1 < 100 and len(text.replace(" ", "")) <= 6:
            row.kind = "tab"
        elif row.fam == "marker":
            row.kind = "marker"
        elif row.size < 10.2 and row.fam == "kai":
            row.kind = "caption"
        elif row.size < 10.2 and row.fam in ("song", "fs", "latin", "hei"):
            row.kind = "small"
        else:
            row.kind = "body"


def graphic_regions(page, rows, width, height):
    """Tables and charts: ruled grids, or clusters of numeric axis labels.  Their rows leave
    the text flow and the region is shown as sun's page image, with its text as the alt text."""
    segs = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.width > 0.85 * width or r.height > 0.85 * height:
            continue
        for it in d["items"]:
            if it[0] == "l":
                p1, p2 = it[1], it[2]
                rr = fitz.Rect(min(p1.x, p2.x), min(p1.y, p2.y), max(p1.x, p2.x), max(p1.y, p2.y))
                if abs(p1.y - p2.y) < 1 and rr.width > 20:
                    segs.append((rr, "h"))
                elif abs(p1.x - p2.x) < 1 and rr.height > 8:
                    segs.append((rr, "v"))
            elif it[0] == "re":
                rr = it[1]
                if rr.height < 2 and rr.width > 20:
                    segs.append((rr, "h"))
                elif rr.width < 2 and rr.height > 8:
                    segs.append((rr, "v"))
    clusters = [{"rect": fitz.Rect(rr), "segs": [(rr, k)]} for rr, k in segs]
    changed = True
    while changed:
        changed = False
        out = []
        for c in clusters:
            grown = fitz.Rect(c["rect"].x0 - 14, c["rect"].y0 - 14, c["rect"].x1 + 14, c["rect"].y1 + 14)
            for o in out:
                if o["rect"].intersects(grown):
                    o["rect"] |= c["rect"]; o["segs"] += c["segs"]
                    changed = True
                    break
            else:
                out.append(c)
        clusters = out
    regions = []
    for c in clusters:
        box = c["rect"]
        if box.width < 60 or box.height < 30:
            continue
        inner_h = sum(1 for rr, k in c["segs"] if k == "h" and box.y0 + 8 < rr.y0 < box.y1 - 8)
        inner_v = sum(1 for rr, k in c["segs"] if k == "v" and box.x0 + 8 < rr.x0 < box.x1 - 8)
        inside = [r for r in rows if r.kind in ("body", "small", "caption") and box.contains(fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))]
        if not inside:
            continue
        if inner_h >= 1 and inner_v >= 1 or inner_h >= 4:
            regions.append(fitz.Rect(box.x0 - 4, box.y0 - 4, box.x1 + 4, box.y1 + 4))
    numeric = [r for r in rows if r.kind in ("body", "small") and (re.fullmatch(r"[\d.%％\s:：/-]{1,12}", r.plain.strip() or "x") or len(re.sub(r"\s", "", r.plain)) <= 2)]
    if len(numeric) >= 5:
        numeric.sort(key=lambda r: r.y0)
        span = fitz.Rect(numeric[0].x0, numeric[0].y0, numeric[0].x1, numeric[0].y1)
        for r in numeric[1:]:
            span |= fitz.Rect(r.x0, r.y0, r.x1, r.y1)
        if span.height < 0.6 * height:
            grown = fitz.Rect(span.x0 - 30, span.y0 - 20, span.x1 + 30, span.y1 + 20)
            for d in page.get_drawings():
                r = d["rect"]
                if r.width < 0.85 * width and r.height < 0.85 * height and r.intersects(grown):
                    span |= r
            regions.append(fitz.Rect(span.x0 - 6, span.y0 - 6, span.x1 + 6, span.y1 + 6))
    merged = []
    for r in regions:
        for m in merged:
            if m.intersects(r):
                m |= r
                break
        else:
            merged.append(fitz.Rect(r))
    out = []
    for m in merged:
        inside = sorted([r for r in rows if r.kind in ("body", "small", "caption") and m.contains(fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))], key=lambda r: (round(r.y0 / 4), r.x0))
        for r in inside:
            r.kind = "graphic"
        out.append((m, " ".join(re.sub(r"\s+", " ", r.plain).strip() for r in inside if r.plain.strip())))
    return out


def note_chains(rows):
    """Footnotes: 9pt rows that open with a marker, plus their continuation rows."""
    small = [r for r in rows if r.kind == "small"]
    if not small:
        return {}
    starts = [r for r in small if r.chars and r.chars[0][3] == "m"]
    if not starts:
        return {}
    cols = sorted({round(r.x0) for r in starts})
    columns = []
    for x in cols:
        if not columns or x - columns[-1][-1] > 60:
            columns.append([x])
        else:
            columns[-1].append(x)
    lefts = [min(c) for c in columns]

    def column_of(r):
        idx = 0
        for i, x in enumerate(lefts):
            if r.x0 >= x - 20:
                idx = i
        return idx

    notes, current = {}, None
    by_col = {}
    for r in small:
        by_col.setdefault(column_of(r), []).append(r)
    for col in sorted(by_col):
        col_rows = sorted(by_col[col], key=lambda r: r.y0)
        last = None
        for i, r in enumerate(col_rows):
            opens = r.chars and r.chars[0][3] == "m"
            if opens:
                current = {"number": r.chars[0][0], "rows": [r]}
                notes.setdefault(current["number"], []).append(current)
                r.kind = "note"
            elif current is not None and (last is not None and r.y0 - last.y1 < r.size * 1.4 or last is None and i == 0):
                current["rows"].append(r)
                r.kind = "note"
            else:
                current = None if last is not None else current
                continue
            last = r
    return notes


def run_list(chars, page, size=12, y=0):
    """chars -> runs: plain text, emphasised text and note references (page, number)."""
    runs = []
    last_x1 = None
    for c, x0, x1, k in chars:
        if k == "m":
            runs.append({"n": [page, c, round(y)]})
            last_x1 = None
            continue
        kind = "e" if k == "e" else "t"
        if last_x1 is not None and x0 - last_x1 > 0.7 * size and not c.isspace():
            if runs and "t" in runs[-1] and len(runs[-1]) == 1:
                runs[-1]["t"] += " "
            else:
                runs.append({"t": " "})
        last_x1 = x1
        if runs and kind in runs[-1] and len(runs[-1]) == 1:
            runs[-1][kind] += c
        else:
            runs.append({kind: c})
    return runs


def tidy_runs(runs, collapse_cjk_spaces=False):
    out = []
    for run in runs:
        if "n" in run:
            out.append(run)
            continue
        kind = "e" if "e" in run else "t"
        text = run[kind].replace("　", " ").replace(" ", " ").replace(" ", " ").replace("\t", " ")
        text = re.sub(r"[\x00-\x08\x0b-\x1f​﻿]", "", text)
        text = re.sub(r" {2,}", " ", text)
        if collapse_cjk_spaces:
            text = re.sub(r"(?<=[㐀-鿿]) (?=[㐀-鿿])", "", text)
        if out and "n" in out[-1] and text.startswith(" ") and len(text) > 1 and CJK.match(text[1]):
            text = text.lstrip(" ")
        if not text:
            continue
        if out and kind in out[-1] and len(out[-1]) == 1:
            out[-1][kind] += text
        else:
            out.append({kind: text})
    # trim
    while out and "n" not in out[0] and not next(iter(out[0].values())).strip():
        out.pop(0)
    while out and "n" not in out[-1] and not next(iter(out[-1].values())).strip():
        out.pop()
    if out and "n" not in out[0]:
        k = next(iter(out[0])); out[0][k] = out[0][k].lstrip()
    if out and "n" not in out[-1]:
        k = next(iter(out[-1])); out[-1][k] = out[-1][k].rstrip()
    return out


def join_rows(rows, page_of):
    runs = []
    for i, r in enumerate(rows):
        chunk = run_list(r.chars, page_of(r), r.size or 12, (r.y0 + r.y1) / 2)
        if runs and chunk:
            prev_text = next((v for run in reversed(runs) for k, v in run.items() if k != "n"), "")
            first = next((v for run in chunk for k, v in run.items() if k != "n"), "")
            if prev_text and first and prev_text[-1].isascii() and prev_text[-1].isalnum() and first[0].isascii() and first[0].isalnum():
                runs.append({"t": " "})
        runs.extend(chunk)
    return runs


def plain_of(runs):
    return "".join(v for run in runs for k, v in run.items() if k != "n")


def layout_page(rows, images, width, height):
    """Group a page's body rows into paragraphs and attach side notes and figures."""
    body = [r for r in rows if r.kind == "body"]

    def margins(rows_):
        song = [r for r in rows_ if r.fam != "kai" and r.x1 - r.x0 > 0.3 * width]
        base = song if len(song) >= 3 else [r for r in rows_ if r.x1 - r.x0 > 0.45 * width]
        if not base:
            return None, None
        left = sorted(r.x0 for r in base)[max(0, len(base) // 10)]
        right = statistics.median(sorted(r.x1 for r in base)[-max(1, len(base) // 3):])
        return left, right

    L, R = margins(body)
    # side notes (旁批): narrow kai rows set apart beside the text column, right or left
    side = []
    if L is not None:
        for r in body:
            narrow_ = r.x1 - r.x0 < 0.5 * (R - L)
            if r.fam != "kai" or not narrow_:
                continue
            beside = lambda o: o is not r and o.fam != "kai" and abs((o.y0 + o.y1) / 2 - (r.y0 + r.y1) / 2) < 2.2 * r.size
            right_of_text = r.x0 > L + 0.55 * (R - L) and r.x0 > R - 10 and any(beside(o) and o.x1 < r.x0 - 8 for o in body)
            left_of_text = r.x1 < L + 5 and any(beside(o) and o.x0 > r.x1 + 8 for o in body)
            if right_of_text or left_of_text:
                r.kind = "side"
                side.append(r)
        if side:
            L, R = margins([r for r in body if r.kind == "body"])
    # figures: the page's images, merged, without backgrounds and boxes under text
    figs = []
    for rect in images:
        if rect.width < 30 or rect.height < 24 or rect.width * rect.height < 2500:
            continue
        if rect.width > 0.88 * width and rect.height > 0.75 * height:
            continue
        merged = False
        for f in figs:
            if f.intersects(rect) and abs(f & rect) > 0.5 * min(abs(f), abs(rect)):
                f |= rect
                merged = True
                break
        if not merged:
            figs.append(fitz.Rect(rect))
    kept = []
    for f in figs:
        inside = [r for r in rows if r.kind in ("body", "side", "caption") and fitz.Rect(r.x0, r.y0, r.x1, r.y1) in fitz.Rect(f.x0 - 2, f.y0 - 2, f.x1 + 2, f.y1 + 2)]
        if len(inside) >= 2:
            labels = [r for r in inside if len(re.sub(r"\s", "", r.plain)) <= 6]
            if len(labels) >= 0.6 * len(inside):
                for r in inside:  # a map or diagram: its labels belong to the picture
                    r.kind = "graphic"
                kept.append(f)
            continue
        kept.append(f)
    figs = kept
    captions = [r for r in rows if r.kind == "caption"]
    fig_items = []
    for f in figs:
        fig_items.append({"rect": f, "captions": []})
    for c in captions:
        best = None
        for item in fig_items:
            f = item["rect"]
            dy = 0 if f.y0 - 4 <= c.y0 <= f.y1 + 4 else min(abs(c.y0 - f.y1), abs(c.y1 - f.y0))
            dx = 0 if f.x0 - 30 <= (c.x0 + c.x1) / 2 <= f.x1 + 30 else 99
            d = dy + dx
            if d < 34 and (best is None or d < best[0]):
                best = (d, item)
        if best:
            best[1]["captions"].append(c)
            c.kind = "figcaption"
        else:
            c.kind = "body"  # a kai caption-sized line with no picture is text
            body.append(c) if c not in body else None
    body = sorted([r for r in rows if r.kind == "body"], key=lambda r: (r.y0, r.x0))
    return body, side, fig_items, L, R


def char_w(r):
    return r.size or 12


def text_boxes(page, width, height):
    """Framed or shaded panels (预习, 资料, knowledge boxes): their rows have the panel's own margins."""
    boxes = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.width < 120 or r.height < 24 or r.width > 0.9 * width or r.height > 0.9 * height:
            continue
        kinds = [it[0] for it in d["items"]]
        if "re" in kinds or d.get("fill") is not None or len(kinds) >= 4:
            boxes.append(fitz.Rect(r))
    return boxes


def paragraphs(body, figs, side, L, R, width, boxes=()):
    """Rows -> paragraphs by the justified-line rule."""
    inside = {}
    for r in body:
        centre = fitz.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
        holders = [b for b in boxes if fitz.Rect(b.x0 - 2, b.y0 - 2, b.x1 + 2, b.y1 + 2).contains(centre)]
        if holders:
            inside[id(r)] = min(holders, key=lambda b: abs(b))
    box_rows = {}
    for r in body:
        if id(r) in inside:
            box_rows.setdefault(id(inside[id(r)]), []).append(r)
    box_margin = {}
    for key, rows_ in box_rows.items():
        if len(rows_) >= 2:
            box_margin[key] = (min(r.x0 for r in rows_), max(r.x1 for r in rows_))
    if L is None:
        xs = [r.x0 for r in body]
        L = min(xs) if xs else 0
        R = max(r.x1 for r in body) if body else width

    def obstacle_right(r):
        edge = R
        for item in figs:
            f = item["rect"]
            if f.y1 > r.y0 + 2 and f.y0 < r.y1 - 2 and f.x0 > r.x0 + 20:
                edge = min(edge, f.x0 - 4)
        for s in side:
            if s.y1 > r.y0 - 30 and s.y0 < r.y1 + 30 and s.x0 > r.x0 + 20:
                edge = min(edge, s.x0 - 8)
        return edge

    def obstacle_left(r):
        edge = L
        for item in figs:
            f = item["rect"]
            if f.y1 > r.y0 + 2 and f.y0 < r.y1 - 2 and f.x1 < r.x0 + 4:
                edge = max(edge, f.x1 + 4)
        return edge

    paras = []
    for r in body:
        cw = char_w(r)
        left = obstacle_left(r)
        right = obstacle_right(r)
        margin = box_margin.get(id(inside[id(r)])) if id(r) in inside else None
        if margin:
            left, right = max(left, margin[0]), min(right, margin[1])
        full = r.x1 >= right - cw * 1.1
        style = (round(r.size * 2) / 2, r.fam, r.color)
        start = True
        if paras:
            p = paras[-1]
            prev = p["rows"][-1]
            pitch = r.y0 - prev.y1
            same_style = p["style"][0] == style[0] and (p["style"][1] == style[1] or {p["style"][1], style[1]} <= {"song", "latin"}) and p["style"][2] == style[2]
            attribution = r.plain.lstrip().startswith("——") or prev.plain.lstrip().startswith("——")
            if same_style and pitch < cw * 1.25 and prev.full and not attribution and not LIST_MARK.match(r.plain.lstrip()) and r.y0 > prev.y0 + 2:
                hanging = len(p["rows"]) == 1 and HANG_MARK.match(prev.plain.lstrip()) and cw * 0.8 < r.x0 - prev.x0 <= cw * 4.5
                if r.x0 <= prev.x0 + cw * 0.8 or hanging or (len(p["rows"]) > 1 and abs(r.x0 - p["rows"][1].x0) < cw * 0.6):
                    start = False
        r.full = full
        r.left = left
        r.right = right
        if start:
            paras.append({"rows": [r], "style": style})
        else:
            paras[-1]["rows"].append(r)
    return paras, L, R


def para_attrs(p, L, R):
    attrs = _para_attrs(p, L, R)
    if attrs.get("indent", 0) < -3:  # a misplaced margin, not a hanging indent
        attrs.pop("indent", None)
        attrs.pop("left", None)
    return attrs


def _para_attrs(p, L, R):
    rows = p["rows"]
    first = rows[0]
    cw = char_w(first)
    base = first.left if first.left is not None else L
    ind = (first.x0 - base) / cw
    attrs = {}
    if len(rows) > 1:
        cont = (rows[1].x0 - rows[1].left) / cw
        if cont > 0.6:
            attrs["left"] = round(cont * 2) / 2
        delta = ind - max(0.0, cont)
        if abs(delta) >= 0.6:
            attrs["indent"] = round(delta * 2) / 2
    else:
        centre = (first.x0 + first.x1) / 2
        mid = (base + first.right) / 2
        if ind > 2.6 and abs(centre - mid) < cw * 1.2 and first.x1 < first.right - cw * 1.5:
            attrs["align"] = "center"
        elif ind >= 0.6:
            if 1.4 <= ind <= 2.4:
                attrs["indent"] = round(ind * 2) / 2
            else:
                attrs["left"] = round(ind * 2) / 2
    return attrs


def style_name(p):
    size, fam, color = p["style"]
    name = {"kai": "kai", "fs": "fs", "hei": "hei", "title": "title"}.get(fam, "song")
    if color not in (2301728, 0):
        name += " tint"
    if size <= 10.6:
        name += " small"
    elif size >= 13:
        name += " large"
    return name


def build_entry(entry_id, entry, book, doc):
    blocks, notes_by_ref, imaged, page_notes = [], {}, [], {}
    page_numbers = [p["pdf"] for p in entry["pages"]]
    last_para = None
    for pno in page_numbers:
        page = doc[pno - 1]
        rows, images, width, height, regions = page_rows(page, pno)
        imaged += [{"page": pno, "box": [round(r.x0), round(r.y0), round(r.x1), round(r.y1)]} for r in regions]
        classify(rows, width, height)
        graphics = graphic_regions(page, rows, width, height)
        notes = note_chains(rows)
        for number, group in notes.items():
            for variant, note in enumerate(sorted(group, key=lambda n: (n["rows"][0].y0, n["rows"][0].x0))):
                nrows = note["rows"]
                chars = list(nrows[0].chars)
                if chars and chars[0][3] == "m":
                    chars = chars[1:]
                first = Row(pno); first.chars = chars
                runs = tidy_runs(join_rows([first] + nrows[1:], lambda r: pno))
                runs = [r for r in runs if "n" not in r]
                notes_by_ref[(pno, number, variant)] = runs
                page_notes.setdefault(pno, []).append((number, variant, min(r.y0 for r in nrows), max(r.y1 for r in nrows)))
        # rows that are small but no note: treat as body text
        for r in rows:
            if r.kind == "small":
                r.kind = "body"
            if r.kind == "marker":
                r.kind = "drop"
        body, side, figs, L, R = layout_page(rows, images, width, height)
        paras, L, R = paragraphs(body, figs, side, L, R, width, text_boxes(page, width, height))
        items = []
        for p in paras:
            first = p["rows"][0]
            heading_text = re.sub(r"\s+", "", first.plain)
            is_heading = len(p["rows"]) <= 2 and (first.fam == "title" or first.size >= 14.5 or (first.fam == "hei" and first.size >= 12.5)) and len(heading_text) <= 30
            short_line = len(p["rows"]) == 1 and len(re.sub(r"\s", "", first.plain)) <= 8 and first.fam in ("fs", "kai", "title", "hei")
            runs = tidy_runs(join_rows(p["rows"], lambda r: r.page), collapse_cjk_spaces=is_heading or short_line)
            if not runs:
                continue
            if is_heading:
                level = 1 if first.size >= 18 else 2 if first.size >= 13.5 and first.fam == "title" else 3
                item = {"type": "heading", "level": level, "runs": runs, "y": first.y0, "page": pno}
                if first.color not in (2301728, 0):
                    item["tint"] = True
            else:
                item = {"type": "para", "style": style_name(p), "runs": runs, "y": first.y0, "page": pno,
                        "start": first.x0 - (first.left if first.left is not None else (L or 0)), "_rows": p["rows"]}
                item.update(para_attrs(p, L or 0, R or width))
                single_ascii = plain_of(runs).strip()
                if not single_ascii:
                    continue
            items.append(item)
        for f in figs:
            rect = f["rect"]
            cap = tidy_runs(join_rows(sorted(f["captions"], key=lambda r: (r.y0, r.x0)), lambda r: pno), collapse_cjk_spaces=True)
            items.append({"type": "figure", "page": pno, "y": rect.y0,
                          "box": [round(rect.x0 / width, 4), round(rect.y0 / height, 4), round(rect.x1 / width, 4), round(rect.y1 / height, 4)],
                          "caption": [r for r in cap if "n" not in r]})
        for rect, alt in graphics:
            items.append({"type": "figure", "page": pno, "y": rect.y0, "textImage": True, "alt": alt[:2000],
                          "box": [round(max(0, rect.x0) / width, 4), round(max(0, rect.y0) / height, 4), round(min(width, rect.x1) / width, 4), round(min(height, rect.y1) / height, 4)],
                          "caption": []})
        for rect in regions:
            items.append({"type": "figure", "page": pno, "y": rect.y0, "textImage": True,
                          "box": [round(max(0, rect.x0) / width, 4), round(max(0, rect.y0) / height, 4), round(min(width, rect.x1) / width, 4), round(min(height, rect.y1) / height, 4)],
                          "caption": []})
        # side notes become one note per contiguous group, attached to the paragraph beside them
        groups = []
        for s in sorted(side, key=lambda r: r.y0):
            if groups and s.y0 - groups[-1][-1].y1 < s.size * 1.3:
                groups[-1].append(s)
            else:
                groups.append([s])
        items.sort(key=lambda it: it["y"])
        for g in groups:
            runs = tidy_runs(join_rows(g, lambda r: pno))
            text_items = [it for it in items if it["type"] == "para"]
            host = None
            for it in text_items:
                rows_ = it["_rows"]
                if rows_[0].y0 - 4 <= g[0].y0 <= rows_[-1].y1 + 4:
                    host = it
            if host is None:
                before = [it for it in text_items if it["_rows"][0].y0 <= g[0].y0]
                host = before[-1] if before else (text_items[0] if text_items else None)
            if host is None:
                items.append({"type": "para", "style": "kai side", "runs": runs, "y": g[0].y0, "page": pno})
            else:
                host.setdefault("side", []).append(runs)
        items.sort(key=lambda it: it["y"])
        # continuation of the previous page's last paragraph
        if items and last_para is not None:
            first_text = next((i for i, it in enumerate(items) if it["type"] in ("para", "heading")), None)
            if first_text is not None:
                it = items[first_text]
                prev_rows = last_para["_rows"]
                if it["type"] == "para" and it["style"] == last_para["style"] and prev_rows[-1].full \
                        and it["start"] < char_w(it["_rows"][0]) * 0.8 and not LIST_MARK.match(plain_of(it["runs"])):
                    last_para["runs"] = tidy_runs(last_para["runs"] + it["runs"])
                    last_para["_rows"] = prev_rows + it["_rows"]
                    if it.get("side"):
                        last_para.setdefault("side", []).extend(it["side"])
                    if "left" not in last_para and "left" in it:
                        pass
                    items.pop(first_text)
        blocks.extend(items)
        last_para = None
        for it in reversed(items):
            if it["type"] == "heading":
                break
            if it["type"] == "para" and "_rows" in it:
                last_para = it
                break
    # note numbering in reading order; notes without a reference are kept after the text
    def note_key(ref):
        page, number, y = ref
        found = [n for n in page_notes.get(page, []) if n[0] == number]
        if not found:
            return (page, number, 0)
        if len(found) == 1:
            return (page, number, found[0][1])
        beside = [n for n in found if n[2] - 40 <= y <= n[3] + 40]
        chosen = beside[0] if beside else max(found, key=lambda n: n[2])
        return (page, number, chosen[1])

    numbered, order = {}, []
    for b in blocks:
        for run in b.get("runs", []) + [r for s in b.get("side", []) for r in s]:
            if "n" in run:
                key = note_key(run["n"])
                if key in notes_by_ref and key not in numbered:
                    numbered[key] = f"n{len(order) + 1}"
                    order.append(key)
    for key in sorted(notes_by_ref):
        if key not in numbered:
            numbered[key] = f"n{len(order) + 1}"
            order.append(key)
    notes = [{"id": numbered[k], "label": str(i + 1), "page": k[0], "runs": notes_by_ref[k]} for i, k in enumerate(order)]
    unresolved = 0

    def resolve(runs):
        nonlocal unresolved
        out = []
        for run in runs:
            if "n" in run:
                key = note_key(run["n"])
                if key in numbered:
                    out.append({"n": numbered[key]})
                else:
                    unresolved += 1
                    UNRESOLVED.append([entry_id, *key])
            else:
                out.append(run)
        return tidy_runs(out)

    for i in range(1, len(blocks)):
        b, prev = blocks[i], blocks[i - 1]
        if b["type"] == "para" and prev["type"] == "heading" and b.get("runs") and "n" in b["runs"][0] \
                and b["page"] == prev["page"] and abs(b["y"] - prev["y"]) < 30:
            prev["runs"] = prev["runs"] + [b["runs"][0]]
            b["runs"] = b["runs"][1:]
    clean = []
    for b in blocks:
        b = {k: v for k, v in b.items() if not k.startswith("_") and k not in ("y", "start")}
        if "runs" in b:
            b["runs"] = resolve(b["runs"])
            if not b["runs"]:
                continue
        if "side" in b:
            b["side"] = [resolve(s) for s in b["side"]]
        clean.append(b)
    return clean, notes, imaged, unresolved


def sections(blocks, kind):
    """Split an entry into the box before the text (预习, or 阅读提示 where the book puts it first),
    the main text and the after-text sections the book itself titles."""
    prep, main, tail = [], [], []
    prep_title = None
    current = main
    body_started = False
    for b in blocks:
        if b["type"] == "heading":
            text = re.sub(r"[\s·・]+", "", plain_of(b["runs"]))
            if text in PREP_TITLES or (text == "阅读提示" and not body_started and not prep):
                current = prep
                prep_title = re.sub(r"\s+", "", plain_of(b["runs"]))
                continue
            if text in SECTION_TITLES and kind in ("lesson", "poems", "wholebook"):
                section = {"title": plain_of(b["runs"]).strip(), "blocks": []}
                tail.append(section)
                current = section["blocks"]
                continue
            if current is prep:
                current = main
        if current is prep and b["type"] == "para" and "tint" not in b.get("style", "") and "kai" not in b.get("style", ""):
            current = main
        if current is prep and b["type"] == "figure":
            main.append(b)
            continue
        if current is main and b["type"] == "para" and b.get("style", "").startswith("song"):
            body_started = True
        current.append(b)
    return prep, prep_title, main, tail


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdfs", required=True, type=Path)
    ap.add_argument("--only", help="comma-separated entry ids")
    ap.add_argument("--check", action="store_true", help="compare with the files in site/data/junior-reading instead of writing")
    args = ap.parse_args(argv)
    data = json.loads(PAGES_JSON.read_text())
    only = set(args.only.split(",")) if args.only else None
    index = {"schema": SCHEMA + "-index", "extractor": EXTRACTOR, "source": "sun.bdfz.net textbook PDFs (data/junior-textbook-pages.v1.json)", "entries": {}}
    outputs = {}
    report = {"imagedRegions": 0, "unresolvedMarkers": 0, "entries": 0, "chars": 0}
    for book_id in data["order"]:
        book = data["books"][book_id]
        pdf = args.pdfs / f"{book['pdfSha256']}.pdf"
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if digest != book["pdfSha256"]:
            raise SystemExit(f"{book_id}: PDF hash mismatch")
        doc = fitz.open(pdf)
        for entry_id in data["catalog"][book_id]:
            if only and entry_id not in only:
                continue
            entry = data["lessons"][entry_id]
            blocks, notes, imaged, unresolved = build_entry(entry_id, entry, book, doc)
            prep, prep_title, main_blocks, tail = sections(blocks, entry["kind"])
            text_chars = sum(len(plain_of(b.get("runs", []))) for b in blocks) + sum(len(plain_of(n["runs"])) for n in notes)
            doc_out = {
                "schema": SCHEMA, "extractor": EXTRACTOR, "id": entry_id, "book": book_id,
                "title": entry["title"], **({"author": entry["author"]} if entry.get("author") else {}),
                "kind": entry["kind"], "pages": [p["pdf"] for p in entry["pages"]],
                "source": {"editionId": book["editionId"], "pdfSha256": book["pdfSha256"], "textLayer": "pdf",
                           **({"imagedRegions": imaged} if imaged else {})},
                "prep": prep, **({"prepTitle": prep_title} if prep else {}), "blocks": main_blocks, "sections": tail, "notes": notes,
            }
            outputs[entry_id] = doc_out
            index["entries"][entry_id] = {"chars": text_chars, "notes": len(notes), "sections": [s["title"] for s in tail]}
            report["imagedRegions"] += len(imaged)
            report["unresolvedMarkers"] += unresolved
            report["entries"] += 1
            report["chars"] += text_chars
    if args.check:
        changed = [k for k, v in outputs.items() if (OUT_DIR / f"{k}.json").read_text() != json.dumps(v, ensure_ascii=False, separators=(",", ":")) + "\n"]
        print(json.dumps({"changed": changed, **report}, ensure_ascii=False))
        return 1 if changed else 0
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for k, v in outputs.items():
        (OUT_DIR / f"{k}.json").write_text(json.dumps(v, ensure_ascii=False, separators=(",", ":")) + "\n")
    if not only:
        index["digest"] = hashlib.sha256(json.dumps(index["entries"], sort_keys=True).encode()).hexdigest()
        (OUT_DIR / "index.json").write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")) + "\n")
    report["unresolved"] = UNRESOLVED[:40]
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
