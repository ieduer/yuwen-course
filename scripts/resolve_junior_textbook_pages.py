#!/usr/bin/env python3
"""Junior (grades 7-9) textbook lessons -> current-edition PDF pages held by sun.bdfz.net.

yw holds no copy of these textbooks.  The page images, the PDFs and the catalog
all stay on sun.bdfz.net; this script only works out, once, which of sun's
pages belong to which contents entry, and writes page numbers and the
contents-page wording (titles, authors) - never page text.

Inputs (all read from sun, nothing else):
  * sun's public catalog API for the six editions named in BOOKS
    (`/api/library/editions/<id>` and `/api/library/editions/<id>/pages`);
  * the held PDFs themselves (`/files/pdf/...`), read for their own text layer
    and verified by SHA-256 against the catalog.

    python scripts/resolve_junior_textbook_pages.py --fetch --work <dir>          download inputs
    python scripts/resolve_junior_textbook_pages.py --work <dir>                  write the data file
    python scripts/resolve_junior_textbook_pages.py --work <dir> --check          compare only

<dir> is scratch space outside the repository (PDFs about 130 MB); delete it
afterwards.  Needs PyMuPDF.

Proof standard, per contents entry:
  1. the entry is a row of the PDF's own contents pages;
  2. its printed page number is a *verified* printed label of exactly one PDF
     page in sun's page map, and the entry's title is on that page's text layer.
     A unit heading whose page carries no printed number is proven by being the
     only unlabelled page before the unit's first entry that has the heading as
     a line of its own;
  3. the entry ends on the page before the next entry's first page, or on that
     page itself when the next entry does not open its page (body text above
     its title);  the last entry ends on the last page with a verified number.
Anything else stops the script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "site" / "data" / "junior-textbook-pages.v1.json"
SUN = "https://sun.bdfz.net"
SCHEMA = "yw-textbook-pages-v1"
WIDTHS = {"thumb": 240, "full": 960, "large": 1440}
MAX_RANGE = 30
BODY_LINE = 12
BODY_LINES_ABOVE = 3

# One row per book: yw book id, display label, sun edition id.  The edition id
# ends with the first 12 hex digits of the PDF's SHA-256.
BOOKS = [
    ("g7-shang", 7, "上", "cn-8b9c7052-add4-4744-ab04-69d6c180d5d9-83735d49f455"),
    ("g7-xia", 7, "下", "cn-6b3ec445-9f7b-430c-a246-fc1903ca38b2-302ffb9346de"),
    ("g8-shang", 8, "上", "cn-4f64356a-8df7-4579-9400-e32c9a7f6718-818068db3c20"),
    ("g8-xia", 8, "下", "cn-8f907d12-14b5-44ba-b042-0ffbc46e085b-b03a898b410b"),
    ("g9-shang", 9, "上", "cn-a8b13ab7-7eef-4dc7-a3c7-8009ba65ce11-2771da91d637"),
    ("g9-xia", 9, "下", "cn-a45516ee-78ed-46f0-b88b-671174f2a2fe-22ca8f2e5c82"),
]
GRADE_LABEL = {7: "七年級", 8: "八年級", 9: "九年級"}

UNIT = re.compile(r"^第[一二三四五六七八九十]+单元$")
SECTIONS = {
    "课外古诗词诵读": "poems", "专题学习活动": "activity", "整本书阅读": "wholebook",
    "名著导读": "wholebook", "综合性学习": "activity", "活动·探究": "explore",
    "写作": "writing", "阅读": "reading", "口语交际": "oral",
}
TASK = re.compile(r"^任务[一二三四五六七八九十]+$")
NUM = re.compile(r"^(\d{1,2})(\*?)$")
PAGE = re.compile(r"^\d{1,3}$")


def fail(message: str) -> None:
    raise SystemExit(f"resolve_junior_textbook_pages: {message}")


def get_json(url: str):
    request = urllib.request.Request(url, headers={"accept": "application/json", "user-agent": "yw-junior-resolver"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fetch(work: Path) -> None:
    work.mkdir(parents=True, exist_ok=True)
    for _, _, _, edition_id in BOOKS:
        detail = get_json(f"{SUN}/api/library/editions/{edition_id}")
        (work / f"edition-{edition_id}.json").write_text(json.dumps(detail, ensure_ascii=False, sort_keys=True), "utf-8")
        pages = detail["edition"]["pages"]
        rows = []
        for first in range(1, pages + 1, 200):
            part = get_json(f"{SUN}/api/library/editions/{edition_id}/pages?from={first}&to={min(pages, first + 199)}")
            rows.extend(part["rows"])
        (work / f"pages-{edition_id}.json").write_text(json.dumps({"edition_id": edition_id, "rows": rows}, ensure_ascii=False, sort_keys=True), "utf-8")
        sha = detail["edition"]["pdf"]["sha256"]
        target = work / f"{sha}.pdf"
        if not target.exists() or sha256_file(target) != sha:
            request = urllib.request.Request(SUN + detail["edition"]["file"]["url"], headers={"user-agent": "yw-junior-resolver"})
            with urllib.request.urlopen(request, timeout=300) as response, target.open("wb") as out:
                while chunk := response.read(1 << 20):
                    out.write(chunk)
            if sha256_file(target) != sha:
                fail(f"downloaded PDF for {edition_id} does not match the catalog SHA-256")


# ---------------------------------------------------------------- text layer

def norm(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = re.sub(r"[·•・‧∙]", "·", text)
    return re.sub(r"[\s，,。：:；;！!？?、“”\"'‘’（）()《》〈〉—\-*]", "", text)


def page_lines(page):
    """Visual lines (y-centre, text) of one page, top to bottom, left to right."""
    rows = []
    for word in sorted(page.get_text("words"), key=lambda w: ((w[1] + w[3]) / 2, w[0])):
        if not word[4].strip():
            continue
        centre = (word[1] + word[3]) / 2
        if rows and abs(rows[-1][0] - centre) < 4:
            rows[-1][1].append(word)
        else:
            rows.append([centre, [word]])
    return [(centre, [w[4].strip() for w in sorted(words, key=lambda w: w[0])]) for centre, words in rows]


# ------------------------------------------------------------ contents pages

def split_title_author(tokens):
    joined = " ".join(tokens)
    title, slash, author = joined.partition("/")
    title = re.sub(r"\s+", " ", title).strip()
    title = re.sub(r"(?<=[^\s》])\s+(?=[^\s《])", "", title).replace(",", "，")
    author = re.sub(r"\s+", " ", author).strip() or None
    return title, author, bool(slash)


class Contents:
    def __init__(self):
        self.items = []
        self.section = None
        self.section_label = None

    def last(self):
        return self.items[-1] if self.items else None

    def row(self, tokens, origin):
        if not tokens:
            return
        if UNIT.match(tokens[0]):
            unit = {"kind": "unit", "title": tokens[0], "printed": None}
            rest = tokens[1:]
            self.items.append(unit)
            self.section = None
            while rest and rest[0] in SECTIONS:
                label = rest.pop(0)
                self.section = SECTIONS[label]
            if rest and len(rest) == 1 and PAGE.match(rest[0]):
                unit["printed"] = int(rest[0])
                return
            if rest:
                before = len(self.items)
                self.row(rest, origin)
                if len(self.items) > before:
                    self.items[-1]["_unitRow"] = True
            return
        if tokens[0] in SECTIONS or TASK.match(tokens[0]):
            label = tokens.pop(0)
            if TASK.match(label):
                page = int(tokens.pop()) if tokens and PAGE.match(tokens[-1]) else None
                title, _, _ = split_title_author(tokens)
                self.items.append({"kind": "task", "label": label, "title": title, "printed": page})
                self.section = "explore"
                return
            self.section = SECTIONS[label]
            self.section_label = label
            if label == "课外古诗词诵读":
                page = int(tokens.pop()) if tokens and PAGE.match(tokens[-1]) else None
                self.items.append({"kind": "poems", "title": label, "printed": page, "parts": []})
                if tokens:
                    self.row(tokens, origin)
                return
            if not tokens:
                return
        page = int(tokens.pop()) if tokens and PAGE.match(tokens[-1]) and len(tokens) > 1 else None
        if len(tokens) == 1 and PAGE.match(tokens[0]):
            return
        number = NUM.match(tokens[0])
        if number:
            title, author, _ = split_title_author(tokens[1:])
            self.items.append({"kind": "lesson", "number": int(number.group(1)), "selfRead": number.group(2) == "*",
                               "title": title, "author": author, "printed": page, "parts": []})
            return
        title, author, slash = split_title_author(tokens)
        last = self.last()
        if title == "阅读综合实践":
            self.items.append({"kind": "practice", "title": title, "printed": page})
            return
        if last is not None and last["kind"] == "lesson" and last["printed"] is None:
            # a lesson whose contents entry wraps onto the next row
            if title.startswith("——") or last.get("subtitle"):
                last["subtitle"] = (last.get("subtitle") or "") + title
            elif not slash and last["author"]:
                last["author"] = last["author"] + " " + " ".join(tokens)
            else:
                last["title"] += title
            if slash and author:
                last["author"] = (last["author"] + " " if last["author"] else "") + author
            if page is not None:
                last["printed"] = page
            return
        if page is None:
            if last is not None and last["kind"] in ("lesson", "poems"):
                last["parts"].append({"title": title, "author": author})
                return
            fail(f"contents row {origin} belongs to no entry: {tokens}")
        kind = self.section if self.section in ("writing", "activity", "wholebook", "oral") else None
        if kind is None:
            fail(f"contents row {origin} has no known section: {tokens}")
        self.items.append({"kind": kind, "section": self.section_label, "title": title, "author": author, "printed": page})

    def finish(self):
        out = []
        for index, item in enumerate(self.items):
            if item.pop("_unitRow", False) and item["kind"] == "lesson":
                following = next((x for x in self.items[index + 1:] if x["kind"] == "lesson"), None)
                if following and following["number"] == item["number"]:
                    # Hidden text left on the unit row repeats the first lesson; its number is the unit's page.
                    unit = next(x for x in reversed(out) if x["kind"] == "unit")
                    unit["printed"] = item["printed"]
                    continue
            out.append(item)
        return out


def read_contents(doc):
    pages = []
    for index in range(1, min(14, doc.page_count)):
        text = doc[index].get_text()
        if re.search(r"目\s*录", text) and (re.search(r"第.单元", text) or pages):
            pages.append(index)
        elif pages:
            break
    if not pages:
        fail("no contents pages found")
    contents = Contents()
    for index in pages:
        for _, tokens in page_lines(doc[index]):
            joined = "".join(tokens)
            if (re.fullmatch(r"目录[IVX]*|[IVX]+目录", joined) or joined.startswith("仅供")
                    or joined.startswith("注：") or joined.startswith("课文原则上")):
                continue
            contents.row(list(tokens), f"pdf{index + 1}")
    return contents.finish()


# ----------------------------------------------------------- page resolution

def title_lines(doc, pdf_page):
    return [(centre, norm("".join(tokens))) for centre, tokens in page_lines(doc[pdf_page - 1])]


def probe(item):
    if item["kind"] == "task":
        return norm(item["label"])
    if item["kind"] == "wholebook":
        match = re.match(r"《[^》]+》", item["title"])
        return norm(match.group(0) if match else item["title"])
    # a trailing parenthesis (节选, 其五, the first line of a ci) may sit on its own line
    return norm(re.sub(r"（[^）]*）$", "", item["title"]))


def find_title(doc, pdf_page, item):
    """y-centre of the line that carries the entry's title on this page, or None."""
    want = probe(item)
    if not want:
        return None
    for centre, line in title_lines(doc, pdf_page):
        bare = re.sub(r"^\d{1,2}", "", line)
        bare = re.sub(r"[a-z①-⑳]", "", bare)  # footnote markers sit inside or after a title
        if bare == want or bare.startswith(want) or (len(bare) >= 4 and want.startswith(bare)):
            return centre
    return None


def heading_line(line, heading):
    """A unit page line: the heading alone, or followed by its section name (活动·探究)."""
    return line == heading or (line.startswith(heading) and line[len(heading):] in ("活动·探究", "活动探究"))


def opens_page(doc, pdf_page, item):
    if item["kind"] == "unit":
        return True  # a unit page is a page of its own; its introduction prints above the heading
    centre = find_title(doc, pdf_page, item)
    if centre is None:
        return True
    body = 0
    for other_centre, tokens in page_lines(doc[pdf_page - 1]):
        if other_centre >= centre - 2:
            break
        text = "".join(tokens)
        if text.startswith("仅供") or re.fullmatch(r"\d{1,3}", text):
            continue
        if len(norm(text)) >= BODY_LINE:
            body += 1
    # A lead-in headline (引题) or a margin note may print above a title; the previous
    # entry's text running onto this page means several body lines above it.
    return body < BODY_LINES_ABOVE


def resolve_book(book_id, grade, term, edition_id, work: Path):
    import fitz  # PyMuPDF

    detail = json.loads((work / f"edition-{edition_id}.json").read_text("utf-8"))
    edition = detail["edition"]
    sha = edition["pdf"]["sha256"]
    if not (edition["status"] == "active" and edition["platform_current"] is True and edition["preview_default"] is True
            and edition["newer_edition_id"] is None and edition["stage"] == "初中" and edition["subject"] == "语文"):
        fail(f"{edition_id} is not sun's active current junior Chinese edition")
    if not edition_id.endswith("-" + sha[:12]) or edition["pdf"]["pages"] != edition["pages"]:
        fail(f"{edition_id} identity is inconsistent")
    pdf_path = work / f"{sha}.pdf"
    if sha256_file(pdf_path) != sha:
        fail(f"{pdf_path.name} does not match the catalog SHA-256")
    rows = json.loads((work / f"pages-{edition_id}.json").read_text("utf-8"))["rows"]
    if [row["pdf_page"] for row in rows] != list(range(1, edition["pages"] + 1)):
        fail(f"page map of {edition_id} is incomplete")
    printed_to_pdf, pdf_to_printed = {}, {}
    for row in rows:
        if row.get("printed_verified") is True:
            label = str(row["printed_label"])
            if label in printed_to_pdf:
                fail(f"printed label {label} appears twice in {edition_id}")
            printed_to_pdf[label] = row["pdf_page"]
            pdf_to_printed[row["pdf_page"]] = label
    last_numbered = max(pdf_to_printed)

    doc = fitz.open(pdf_path)
    if doc.page_count != edition["pages"]:
        fail(f"{pdf_path.name} page count differs from the catalog")
    sizes = {(round(page.rect.width, 1), round(page.rect.height, 1)) for page in doc}
    if len(sizes) != 1:
        fail(f"{pdf_path.name} pages are not one size: {sorted(sizes)}")
    page_points = list(sizes.pop())
    items = read_contents(doc)

    # starting pages
    for index, item in enumerate(items):
        if item["printed"] is not None:
            start = printed_to_pdf.get(str(item["printed"]))
            if start is not None and (item["kind"] == "unit" or find_title(doc, start, item) is not None):
                item["start"] = start
                item["basis"] = "contents-printed-page"
                continue
        if item["kind"] != "unit":
            fail(f"{book_id}: cannot prove the first page of {item['title']} (printed {item['printed']})")
        item["start"] = None
    for index, item in enumerate(items):
        if item["start"] is not None:
            continue
        following = next(x["start"] for x in items[index + 1:] if x.get("start"))
        preceding = max([x["start"] for x in items[:index] if x.get("start")] or [0])
        heading = norm(item["title"])
        candidates = [p for p in range(preceding + 1, following)
                      if p not in pdf_to_printed and any(heading_line(line, heading) for _, line in title_lines(doc, p))]
        if len(candidates) != 1:
            fail(f"{book_id}: unit page of {item['title']} not proven ({candidates})")
        item["start"] = candidates[0]
        item["basis"] = "unit-heading-unnumbered-page"
    for index, item in enumerate(items):
        if item["kind"] == "unit" and item["printed"] is not None and item["basis"] == "contents-printed-page":
            if not any(heading_line(line, norm(item["title"])) for _, line in title_lines(doc, item["start"])):
                fail(f"{book_id}: {item['title']} heading is not on PDF page {item['start']}")

    # ranges
    starts = [item["start"] for item in items]
    if starts != sorted(starts):
        fail(f"{book_id}: contents entries are out of page order")
    for index, item in enumerate(items):
        if index + 1 < len(items):
            nxt = items[index + 1]
            end = nxt["start"] if nxt["start"] == item["start"] or not opens_page(doc, nxt["start"], nxt) else nxt["start"] - 1
        else:
            end = last_numbered
        if end < item["start"] or end - item["start"] + 1 > MAX_RANGE:
            fail(f"{book_id}: implausible range for {item['title']}: {item['start']}-{end}")
        item["end"] = end
        for part in item.get("parts", []):
            part["pdf"] = next((p for p in range(item["start"], end + 1)
                                if find_title(doc, p, {"kind": "lesson", "title": part["title"]}) is not None), None)

    book = {
        "label": f"{GRADE_LABEL[grade]}{term}冊",
        "grade": grade,
        "term": term,
        "title": edition["title"],
        "editionLabel": edition["edition_label"],
        "publisher": edition["publisher"],
        "editionId": edition_id,
        "pdfSha256": sha,
        "pdfSha12": sha[:12],
        "pdfPages": edition["pages"],
        "pagePoints": page_points,
        "pdfDownload": edition["file"]["download_url"],
    }
    lessons, order, unit = {}, [], None
    for index, item in enumerate(items, start=1):
        lesson_id = f"junior-{book_id}-{index:02d}"
        if item["kind"] == "unit":
            unit = item["title"]
        entry = {
            "book": book_id,
            "status": "mapped",
            "kind": item["kind"],
            "unit": unit,
            "title": item["title"],
            "pages": [
                {"pdf": p, **({"printed": pdf_to_printed[p]} if p in pdf_to_printed else {})}
                for p in range(item["start"], item["end"] + 1)
            ],
            "basis": item["basis"],
        }
        for key in ("number", "selfRead", "author", "subtitle", "label", "section"):
            if item.get(key) not in (None, False):
                entry[key] = item[key]
        if item.get("parts"):
            entry["parts"] = [{k: v for k, v in part.items() if v is not None} for part in item["parts"]]
        lessons[lesson_id] = entry
        order.append(lesson_id)
    return book, lessons, order, detail["release_id"], edition["processing"]["page_map_version"]


def build(work: Path):
    books, lessons, order, releases, maps = {}, {}, {}, set(), set()
    for book_id, grade, term, edition_id in BOOKS:
        book, book_lessons, book_order, release, page_map = resolve_book(book_id, grade, term, edition_id, work)
        books[book_id] = book
        lessons.update(book_lessons)
        order[book_id] = book_order
        releases.add(release)
        maps.add(page_map)
    if len(releases) != 1 or len(maps) != 1:
        fail(f"inputs span several sun catalog releases {sorted(releases)} / page maps {sorted(maps)}")
    kinds = {}
    for entry in lessons.values():
        kinds[entry["kind"]] = kinds.get(entry["kind"], 0) + 1
    return {
        "schema": SCHEMA,
        "track": "junior",
        "scoring": "none",
        "catalogContract": "sun-catalog-v1",
        "catalogRelease": releases.pop(),
        "pageMapVersion": maps.pop(),
        "resolution": "each entry of the PDF's own contents pages, at the PDF page whose verified printed label is the "
                      "entry's page number and whose text layer carries its title; unnumbered unit pages by their "
                      "heading line; ends at the next entry. Titles and page numbers only, never page text.",
        "imageHost": "sun.bdfz.net",
        "widths": WIDTHS,
        "counts": {"books": len(books), "entries": len(lessons), "kinds": dict(sorted(kinds.items())),
                   "pages": sum(len(entry["pages"]) for entry in lessons.values())},
        "books": books,
        "order": [book_id for book_id, *_ in BOOKS],
        "catalog": order,
        "lessons": lessons,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--work", required=True, type=Path, help="scratch directory outside the repository")
    parser.add_argument("--fetch", action="store_true", help="download sun's catalog rows and held PDFs into --work")
    parser.add_argument("--check", action="store_true", help="fail when the committed data differs")
    args = parser.parse_args(argv)
    work = args.work.resolve()
    if ROOT in work.parents or work == ROOT:
        fail("--work must be outside the repository")
    if args.fetch:
        fetch(work)
        return 0
    text = json.dumps(build(work), ensure_ascii=False, indent=1) + "\n"
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text("utf-8") != text:
            fail(f"{OUTPUT.relative_to(ROOT)} is stale against sun")
        print("junior textbook pages: up to date")
        return 0
    OUTPUT.write_text(text, "utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
