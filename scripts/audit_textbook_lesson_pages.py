#!/usr/bin/env python3
"""Audit every displayed lesson's textbook pages against the held PDFs' own text layer.

Offline. Needs PyMuPDF, a directory holding the current-edition PDFs named
<sha256>.pdf, and the local copy of the SUN catalog release the page data was
resolved from (for the verified printed-page labels).

    python scripts/audit_textbook_lesson_pages.py --pdf-dir <dir> --catalog <release dir> --out <audit.json>
    python scripts/audit_textbook_lesson_pages.py --pdf-dir <dir> --catalog <release dir> --verify-overrides

The proof standard ("clean"):
  1. the lesson is one entry of the PDF's own contents pages;
  2. the printed page number the contents give for it is a verified printed
     label of exactly one PDF page, and the entry's title is a line of that page
     (the lesson's first page);
  3. a yw lesson is the whole numbered lesson: contents entries that follow its
     own entry, belong to no other yw lesson and start inside the pages its
     exact rows already show are its later texts; the first entry after them is
     the boundary and is proven the same way; the lesson ends on the page before
     it - or on that page itself when the boundary title does not open the page;
  4. a page the exact rows show may be dropped only when another yw lesson owns
     it (the lesson whose contents entry covers that page), and that lesson is
     named.
Nothing else counts as proof.  Section headings (古诗词诵读) are never re-ranged.
A lesson is "absent from the current edition" only when it is no contents entry
and its title is a line of no page of the PDF.  The output holds page numbers, titles and
booleans only, never page text.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site" / "data"
OVERRIDES = ROOT / "scripts" / "textbook_page_overrides.v1.json"
BASIS = "current-edition-text-layer"
MAX_RANGE = 30
MARKER = re.compile(r"[a-z0-9①-⑳]{1,2}")   # a title line may carry its footnote marker
BODY_LINE = 12            # a line this long above a title means the page was already in use
UNIT_NUMERALS = "一二三四五六七八九十"


def normalise(value: str) -> str:
    text = unicodedata.normalize("NFKC", value)
    text = re.sub(r"[·•・‧∙]", "·", text)
    return re.sub(r"\s+", "", text)


def strip_title(value: str) -> str:
    """Title without lesson number, optional-text asterisk, author or parenthetical."""
    raw = unicodedata.normalize("NFKC", value or "").split("/")[0]
    raw = re.sub(r"^\s*\d+\s*[.、]?\s*", "", raw)
    raw = re.sub(r"^\s*\*\s*", "", raw)
    return normalise(raw)


def bare(title: str) -> str:
    """Comparison key: no parenthetical, no quotation marks."""
    return re.sub(r"[“”‘’\"']", "", re.sub(r"\(.*?\)", "", title))


class Book:
    def __init__(self, pdf_dir: Path, sha256: str, page_map: dict):
        import pymupdf  # noqa: PLC0415

        path = pdf_dir / f"{sha256}.pdf"
        self.sha_ok = hashlib.sha256(path.read_bytes()).hexdigest() == sha256 == page_map["pdf_sha256"]
        self.version = pymupdf.__version__
        document = pymupdf.open(path)
        self.pages = []
        for page in document:
            lines = []
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    text = normalise("".join(span["text"] for span in line["spans"]))
                    if text:
                        lines.append((text, line["bbox"][1], line["bbox"][3]))
            self.pages.append(lines)
        self.printed = {}
        for row in page_map["pages"]:
            if row.get("printed_verified") is True and row.get("printed_label") is not None:
                self.printed.setdefault(str(row["printed_label"]), []).append(row["pdf_page"])
        self.entries = self._contents()

    def title_line(self, pdf_page: int, title: str):
        """(y0, opens_page) of the topmost line that is the title on this page, else None."""
        lines = self.pages[pdf_page - 1]
        wanted = {title, bare(title)} - {""}
        main = {variant.split("——")[0] for variant in wanted if "——" in variant and len(variant.split("——")[0]) >= 6}
        best = None
        for index, (text, y0, _y1) in enumerate(lines):
            hit = text in main
            for variant in wanted:
                if text == variant or bare(text) == variant:
                    hit = True
                elif text.startswith(variant) and MARKER.fullmatch(text[len(variant):]):
                    hit = True
                elif index + 1 < len(lines) and len(variant) >= 6 and text + lines[index + 1][0] == variant:
                    hit = True
            if hit and (best is None or y0 < best):
                best = y0
        if best is None:
            return None
        above = [other for other, _oy0, oy1 in lines if oy1 <= best and len(other) >= BODY_LINE]
        return best, not above

    def _contents(self) -> list[dict]:
        """Entries of the PDF's own contents pages, in order, each with its proven first page."""
        raw = []
        started = False
        for page_number in range(1, min(len(self.pages), 12) + 1):
            texts = [text for text, _y0, _y1 in self.pages[page_number - 1]]
            if not started:
                if "目录" not in texts:
                    continue
                started = True
            pending = ""
            page_raw = []
            for text in texts:
                if text == "目录" or text.startswith(("注:", "仅供个人", "语文必修", "语文选择性必修")):
                    pending = ""
                    continue
                if re.fullmatch(r"\d{1,3}", text):
                    if pending:
                        page_raw.append((pending, text))
                    pending = ""
                    continue
                # A unit or section heading set on one line with its page number.
                inline = re.fullmatch(rf"((?:第[{UNIT_NUMERALS}]单元|古诗词诵读)\D*?)(\d{{1,3}})", text)
                if inline and not pending:
                    page_raw.append((inline.group(1), inline.group(2)))
                    continue
                # A unit heading on its own line, then the unit's name with the page number.
                named = re.fullmatch(r"(\D+?)(\d{1,3})", text)
                if named and re.fullmatch(rf"第[{UNIT_NUMERALS}]单元", pending):
                    page_raw.append((pending + named.group(1), named.group(2)))
                    pending = ""
                    continue
                pending += text
            # A contents page lists many entries; the first page that does not ends the contents.
            if len(page_raw) < 5:
                break
            raw.extend(page_raw)
        entries = []
        for label, printed in raw:
            title = strip_title(label)
            # The printed number must be a verified label; when two pages carry it
            # (front matter and body), only a single page with the title line counts.
            pages = [page for page in self.printed.get(printed, []) if self.title_line(page, title) is not None]
            first = pages[0] if len(pages) == 1 else None
            located = self.title_line(first, title) if first else None
            entries.append({
                "title": title,
                "printed": printed,
                "pdf": first,
                "proven": located is not None,
                "opensPage": bool(located and located[1]),
                "y0": located[0] if located else None,
            })
        # The afterword closes the last item but is not always a contents entry.
        proven = [entry["pdf"] for entry in entries if entry["proven"]]
        if proven and all(entry["title"] != "后记" for entry in entries):
            for page_number in range(max(proven) + 1, len(self.pages) + 1):
                located = self.title_line(page_number, "后记")
                if located and located[1]:
                    entries.append({
                        "title": "后记", "printed": None, "pdf": page_number,
                        "proven": True, "opensPage": True, "y0": located[0],
                    })
                    break
        return entries


def unit_task_ordinal(candidate: str):
    match = re.fullmatch(rf"第([{UNIT_NUMERALS}])单元(单元)?(学习任务|研习任务)\d*", candidate)
    return (f"第{match.group(1)}单元", f"单元{match.group(3)}") if match else None


def match_entry(book: Book, lesson: dict):
    """Index of the one contents entry this lesson is, else None."""
    candidates = []
    for value in (lesson.get("title"), lesson.get("tocLabel")):
        if value:
            candidates.append(strip_title(value))
            candidates.append(re.sub(r"\d+$", "", strip_title(value)))
    for candidate in candidates:
        task = unit_task_ordinal(candidate)
        if task:
            # The task entry that follows this unit's own heading, before the next unit.
            units = [index for index, entry in enumerate(book.entries) if entry["title"] == task[0]]
            if len(units) != 1:
                return None
            for index in range(units[0] + 1, len(book.entries)):
                if re.match(rf"第[{UNIT_NUMERALS}]单元", book.entries[index]["title"]):
                    return None
                if book.entries[index]["title"] == task[1]:
                    return index
            return None
    for exact in (True, False):
        for candidate in candidates:
            if not candidate:
                continue
            indexes = [
                index for index, entry in enumerate(book.entries)
                if (
                    entry["title"] == candidate if exact
                    # also without parenthetical/quotes, or without the entry's "——" subtitle
                    else bare(candidate) and bare(candidate) in (bare(entry["title"]), bare(entry["title"].split("——")[0]))
                )
            ]
            if len(indexes) == 1:
                return indexes[0]
    return None


SECTION_HEADINGS = {"古诗词诵读"}
ABSENT = ROOT / "scripts" / "textbook_absent_lessons.v1.json"


def entry_owners(book: Book, lessons: list[dict]) -> dict[int, str | None]:
    """Contents entry index -> the one yw lesson that is that entry (None when two claim it)."""
    owners: dict[int, str | None] = {}
    for lesson in lessons:
        index = match_entry(book, lesson)
        if index is not None:
            owners[index] = None if index in owners else lesson["id"]
    return owners


def page_owner(book: Book, owners: dict[int, str | None], pdf_page: int) -> str | None:
    """The yw lesson whose contents entry covers this page, when that is unambiguous."""
    proven = [index for index, entry in enumerate(book.entries) if entry["proven"]]
    at = [index for index in proven if book.entries[index]["pdf"] <= pdf_page]
    if not at:
        return None
    start = at[-1]
    following = [index for index in proven if index > start]
    stop = following[0] if following else len(book.entries)
    found = set()
    index = start
    while index >= 0 and index not in owners:      # a later text belongs to the lesson before it
        index -= 1
    if index < 0 or owners[index] is None:
        return None
    found.add(owners[index])
    for other in range(start + 1, stop):           # unproven entries in between could own the page
        if other in owners:
            found.add(owners[other])
    return found.pop() if len(found) == 1 and None not in found else None


def proposal(book: Book, index: int, exact: list[int], owners: dict[int, str | None], lesson_id: str):
    entry = book.entries[index]
    if not entry["proven"] or owners.get(index) != lesson_id:
        return None
    exact_last = exact[-1] if exact else -1
    later_texts = []
    cursor = index + 1
    while (
        cursor < len(book.entries) and cursor not in owners
        and book.entries[cursor]["title"] != "后记"      # the afterword is never a later text
        and book.entries[cursor]["proven"] and book.entries[cursor]["pdf"] <= exact_last
    ):
        later_texts.append(book.entries[cursor]["title"])
        cursor += 1
    if cursor >= len(book.entries):
        return None
    boundary = book.entries[cursor]
    if not boundary["proven"] or boundary["pdf"] < entry["pdf"]:
        return None
    if boundary["pdf"] == entry["pdf"]:
        if not boundary["y0"] > entry["y0"]:
            return None
        last = entry["pdf"]
    else:
        last = boundary["pdf"] - 1 if boundary["opensPage"] else boundary["pdf"]
    if last - entry["pdf"] + 1 > MAX_RANGE:
        return None
    removed = []
    for page in exact:
        if page < entry["pdf"] or page > last:
            owner = page_owner(book, owners, page)
            removed.append({"pdf": page, "ownerLesson": owner if owner != lesson_id else None})
    return {
        "firstPdf": entry["pdf"],
        "lastPdf": last,
        "titleLine": entry["title"],
        "titlePrinted": entry["printed"],
        "laterTextsOfThisLesson": later_texts,
        "nextTitleLine": boundary["title"],
        "nextTitlePdf": boundary["pdf"],
        "nextTitlePrinted": boundary["printed"],
        "nextTitleOpensItsPage": boundary["opensPage"],
        "removedPages": removed,
    }


def load(catalog: Path):
    sidecar = json.loads((SITE / "textbook-pages.v1.json").read_text(encoding="utf-8"))
    manifest = json.loads((SITE / "manifest.json").read_text(encoding="utf-8"))
    release = json.loads((catalog / "catalog.json").read_text(encoding="utf-8"))["release_id"]
    if release != sidecar["catalogRelease"]:
        raise SystemExit("catalog copy is not the release the page data was resolved from")
    return sidecar, manifest


def books_for(sidecar: dict, pdf_dir: Path, catalog: Path) -> dict[str, Book]:
    out = {}
    for block, info in sidecar["books"].items():
        page_map = json.loads((catalog / "page-maps" / f"{info['editionId']}.json").read_text(encoding="utf-8"))
        out[block] = Book(pdf_dir, info["pdfSha256"], page_map)
    return out


def title_candidates(lesson: dict) -> list[str]:
    out = []
    for value in (lesson.get("title"), lesson.get("tocLabel")):
        if value:
            for candidate in (strip_title(value), re.sub(r"\d+$", "", strip_title(value))):
                if candidate and candidate not in out:
                    out.append(candidate)
    return out


def absence(book: Book, lesson: dict) -> dict:
    """Evidence that a lesson is not in this PDF: no contents entry, title on no page."""
    pages = sorted({
        page for page in range(1, len(book.pages) + 1)
        for candidate in title_candidates(lesson) if book.title_line(page, candidate) is not None
    })
    return {"contentsEntry": match_entry(book, lesson) is not None, "titleLinePages": pages}


def audit(pdf_dir: Path, catalog: Path) -> dict:
    sidecar, manifest = load(catalog)
    books = books_for(sidecar, pdf_dir, catalog)
    overridden = {
        item["lessonId"] for item in json.loads(OVERRIDES.read_text(encoding="utf-8")).get("overrides", [])
    }
    absent_listed = {
        item["lessonId"] for item in json.loads(ABSENT.read_text(encoding="utf-8")).get("lessons", [])
    } if ABSENT.exists() else set()
    by_block: dict[str, list[dict]] = {}
    for lesson in manifest["lessons"]:
        by_block.setdefault(lesson["blockId"], []).append(lesson)
    owners = {block: entry_owners(book, by_block.get(block, [])) for block, book in books.items()}
    rows = []
    for lesson in manifest["lessons"]:
        entry = sidecar["lessons"].get(lesson["id"])
        if not entry:
            continue
        book = books[entry["book"]]
        exact = entry.get("exactRowPages", [page["pdf"] for page in entry["pages"]])
        displayed = [page["pdf"] for page in entry["pages"]]
        index = match_entry(book, lesson)
        contents = book.entries[index] if index is not None else None
        title = contents["title"] if contents else strip_title(lesson.get("tocLabel") or lesson.get("title") or "")
        on_first = bool(book.title_line(exact[0], title) is not None) if exact else None
        proposed = proposal(book, index, exact, owners[entry["book"]], lesson["id"]) if index is not None and book.sha_ok else None
        wanted = list(range(proposed["firstPdf"], proposed["lastPdf"] + 1)) if proposed else None
        uncited = bool(proposed and any(item["ownerLesson"] is None for item in proposed["removedPages"]))
        section = title in SECTION_HEADINGS
        clean = bool(proposed) and not uncited and not section
        missing = absence(book, lesson) if index is None else None
        reason = ""
        if index is None and not missing["titleLinePages"]:
            verdict = "not-a-contents-entry; title on no page of the PDF"
            action = "absent"
        elif not exact:
            verdict = "no-exact-row-page"
            action = "override" if clean else "none"
            reason = verdict
        elif clean and wanted != exact:
            parts = []
            if not on_first:
                parts.append("title-not-on-first-page")
            if wanted[-1] > exact[-1] and on_first:
                parts.append("last page(s) of the lesson not shown")
            if on_first and any(page not in exact for page in wanted if page < exact[-1]):
                parts.append("a page inside the lesson is skipped")
            if on_first and proposed["removedPages"]:
                parts.append("pages owned by another lesson are shown")
            reason = "; ".join(parts) or "range differs"
            verdict = ("title-on-first-page; " if on_first else "") + reason
            action = "override"
        elif on_first:
            if proposed and wanted != exact:
                verdict = "title-on-first-page; range differs but " + ("it is a section heading" if section else "a page to drop has no owning lesson")
                action = "kept-exact-rows"
            else:
                verdict, action = "title-on-first-page", "none"
        else:
            verdict, action = "title-not-on-first-page", "needs-human-check"
        rows.append({
            "lesson": lesson["id"],
            "book": entry["book"],
            "title": title,
            "contentsEntry": bool(contents),
            "exactRowPages": exact,
            "displayedPages": displayed,
            "titleFoundOnFirstExactRowPage": on_first,
            "proposedRange": [proposed["firstPdf"], proposed["lastPdf"]] if proposed else None,
            "proof": ({"basis": BASIS, "pdfSha256Verified": True, "extractor": f"pymupdf {book.version} page text", **proposed} if proposed else None),
            "absence": missing,
            "verdict": verdict,
            "reason": reason,
            "action": action,
            "overrideApplied": lesson["id"] in overridden,
            "listedAbsent": lesson["id"] in absent_listed,
        })
    count = lambda key, value: sum(1 for row in rows if row[key] == value)  # noqa: E731
    return {
        "schema": "yw-lesson-page-audit-v3",
        "catalogRelease": sidecar["catalogRelease"],
        "standard": "contents entry -> verified printed page -> title line on that page; later texts of the same lesson absorbed; boundary entry proven the same way; a dropped page must be owned by a named yw lesson",
        "contents": {
            block: {"entries": len(book.entries), "proven": sum(1 for entry in book.entries if entry["proven"])}
            for block, book in books.items()
        },
        "summary": {
            "displayedLessons": len(rows),
            "titleOnFirstExactRowPage": count("titleFoundOnFirstExactRowPage", True),
            "titleNotOnFirstExactRowPage": count("titleFoundOnFirstExactRowPage", False),
            "noExactRowPage": count("titleFoundOnFirstExactRowPage", None),
            "cleanOverride": count("action", "override"),
            "absentFromCurrentEdition": count("action", "absent"),
            "needsHumanCheck": count("action", "needs-human-check"),
            "keptExactRows": count("action", "kept-exact-rows"),
            "overridesApplied": count("overrideApplied", True),
            "listedAbsent": count("listedAbsent", True),
        },
        "lessons": rows,
    }


OVERRIDE_KEYS = (
    "firstPdf", "lastPdf", "titleLine", "titlePrinted", "laterTextsOfThisLesson",
    "nextTitleLine", "nextTitlePdf", "nextTitleOpensItsPage", "removedPages",
)


def proposed_overrides(report: dict, sidecar: dict) -> list[dict]:
    out = []
    for row in report["lessons"]:
        if row["action"] != "override":
            continue
        proof = row["proof"]
        out.append({
            "lessonId": row["lesson"],
            "book": row["book"],
            "pdfSha256": sidecar["books"][row["book"]]["pdfSha256"],
            "basis": BASIS,
            "reason": row["reason"],
            **{key: proof[key] for key in OVERRIDE_KEYS},
        })
    return sorted(out, key=lambda item: item["lessonId"])


def verify_overrides(pdf_dir: Path, catalog: Path) -> int:
    report = audit(pdf_dir, catalog)
    sidecar, _ = load(catalog)
    fresh = {item["lessonId"]: item for item in proposed_overrides(report, sidecar)}
    data = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    failures = 0
    for item in data["overrides"]:
        again = fresh.get(item["lessonId"])
        checks = {
            "stillACleanProposal": again is not None,
            "sameBookAndPdf": bool(again) and all(item[key] == again[key] for key in ("book", "pdfSha256", "basis")),
            "rangeAndEvidenceEqualFreshProof": bool(again) and all(item[key] == again[key] for key in OVERRIDE_KEYS),
            "everyDroppedPageNamesItsOwner": all(entry.get("ownerLesson") for entry in item["removedPages"]),
        }
        ok = all(checks.values())
        failures += 0 if ok else 1
        print(json.dumps({"lessonId": item["lessonId"], "pdfPages": [item["firstPdf"], item["lastPdf"]], "checks": checks, "ok": ok}, ensure_ascii=False))
    extra = sorted(set(fresh) - {item["lessonId"] for item in data["overrides"]})
    print(json.dumps({"overrides": len(data["overrides"]), "failed": failures, "cleanProposalsNotInFile": extra}))
    return 1 if failures else 0


def verify_absent(pdf_dir: Path, catalog: Path) -> int:
    sidecar, manifest = load(catalog)
    books = books_for(sidecar, pdf_dir, catalog)
    lessons = {lesson["id"]: lesson for lesson in manifest["lessons"]}
    data = json.loads(ABSENT.read_text(encoding="utf-8"))
    failures = 0
    for item in data["lessons"]:
        lesson = lessons.get(item["lessonId"])
        book = books[item["book"]]
        found = absence(book, lesson) if lesson and lesson["blockId"] == item["book"] else None
        checks = {
            "pdfSha256": book.sha_ok and item["pdfSha256"] == sidecar["books"][item["book"]]["pdfSha256"],
            "notAContentsEntry": bool(found) and found["contentsEntry"] is False,
            "titleOnNoPage": bool(found) and found["titleLinePages"] == [],
        }
        ok = all(checks.values())
        failures += 0 if ok else 1
        print(json.dumps({"lessonId": item["lessonId"], "checks": checks, "ok": ok}, ensure_ascii=False))
    print(json.dumps({"absentLessons": len(data["lessons"]), "failed": failures}))
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-dir", required=True, type=Path)
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--write-overrides", metavar="YYYY-MM-DD", help="rewrite the override file from the clean proposals, dated")
    parser.add_argument("--write-absent", metavar="YYYY-MM-DD", help="rewrite the absent-lesson list from the audit, dated")
    parser.add_argument("--verify-overrides", action="store_true")
    parser.add_argument("--verify-absent", action="store_true")
    args = parser.parse_args()
    if args.verify_overrides:
        return verify_overrides(args.pdf_dir, args.catalog)
    if args.verify_absent:
        return verify_absent(args.pdf_dir, args.catalog)
    report = audit(args.pdf_dir, args.catalog)
    if args.out:
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if args.write_overrides:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.write_overrides):
            raise SystemExit("--write-overrides needs a date")
        sidecar, _ = load(args.catalog)
        import pymupdf  # noqa: PLC0415

        OVERRIDES.write_text(json.dumps({
            "schema": "yw-textbook-page-overrides-v2",
            "note": "Lesson-level page ranges in the current edition, applied by scripts/resolve_textbook_pages.mjs after exact page-map rows. Each is proven from the held PDF's own text layer by scripts/audit_textbook_lesson_pages.py: contents entry -> verified printed page -> title line on that page; later texts of the same lesson absorbed; the boundary entry proven the same way; a page dropped from the exact rows must name the yw lesson that owns it. Regenerate with --write-overrides; re-prove with --verify-overrides.",
            "catalogRelease": sidecar["catalogRelease"],
            "verifiedOn": args.write_overrides,
            "extractor": f"pymupdf {pymupdf.__version__} page text",
            "overrides": proposed_overrides(report, sidecar),
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    if args.write_absent:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", args.write_absent):
            raise SystemExit("--write-absent needs a date")
        sidecar, manifest = load(args.catalog)
        import pymupdf  # noqa: PLC0415

        lessons = {lesson["id"]: lesson for lesson in manifest["lessons"]}
        ABSENT.write_text(json.dumps({
            "schema": "yw-textbook-absent-lessons-v1",
            "note": "Lessons that are not in the current edition of their volume: no entry of the PDF's contents pages and their title is a line of no page. They show no textbook page. Proven by scripts/audit_textbook_lesson_pages.py (--write-absent / --verify-absent).",
            "catalogRelease": sidecar["catalogRelease"],
            "verifiedOn": args.write_absent,
            "extractor": f"pymupdf {pymupdf.__version__} page text",
            "lessons": [
                {
                    "lessonId": row["lesson"],
                    "book": row["book"],
                    "pdfSha256": sidecar["books"][row["book"]]["pdfSha256"],
                    "titlesChecked": title_candidates(lessons[row["lesson"]]),
                    "contentsEntry": False,
                    "titleLinePages": [],
                }
                for row in sorted(report["lessons"], key=lambda item: item["lesson"]) if row["action"] == "absent"
            ],
        }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"contents": report["contents"], **report["summary"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
