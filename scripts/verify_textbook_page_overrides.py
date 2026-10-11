#!/usr/bin/env python3
"""Prove each lesson-level page override from the held PDF's own text layer.

Offline. Needs PyMuPDF and a directory holding the PDFs named <sha256>.pdf.

    python scripts/verify_textbook_page_overrides.py --pdf-dir <dir>

For every override it requires:
  * the file's SHA-256 equals the override's pdfSha256;
  * the lesson title and author each stand alone on a line of the first page;
  * neither the title nor the next lesson's title stands alone on any page
    strictly inside the range (the range holds one lesson only);
  * the next lesson's title and author each stand alone on a line of the page
    right after the range.
It prints page numbers and booleans only, never page text.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OVERRIDES = ROOT / "scripts" / "textbook_page_overrides.v1.json"


def lines(document, pdf_page: int) -> set[str]:
    text = document[pdf_page - 1].get_text()
    return {"".join(line.split()) for line in text.splitlines() if line.strip()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-dir", required=True, type=Path)
    args = parser.parse_args()
    import pymupdf  # noqa: PLC0415

    data = json.loads(OVERRIDES.read_text(encoding="utf-8"))
    failures = 0
    for item in data["overrides"]:
        pdf = args.pdf_dir / f"{item['pdfSha256']}.pdf"
        digest = hashlib.sha256(pdf.read_bytes()).hexdigest()
        document = pymupdf.open(pdf)
        first, last, after = item["firstPdf"], item["lastPdf"], item["nextTitlePdf"]
        first_lines = lines(document, first)
        after_lines = lines(document, after)
        inside = [lines(document, page) for page in range(first + 1, last + 1)]
        checks = {
            "pdfSha256": digest == item["pdfSha256"],
            "titleOnFirstPage": item["titleLine"] in first_lines,
            "authorOnFirstPage": item["authorLine"] in first_lines,
            "noOtherTitleInside": all(
                item["titleLine"] not in page and item["nextTitleLine"] not in page for page in inside
            ),
            "nextTitleRightAfter": after == last + 1 and item["nextTitleLine"] in after_lines,
            "nextAuthorRightAfter": item["nextAuthorLine"] in after_lines,
            "nextTitleNotOnFirstPage": item["nextTitleLine"] not in first_lines,
        }
        ok = all(checks.values())
        failures += 0 if ok else 1
        print(json.dumps({
            "lessonId": item["lessonId"],
            "pdfPages": [first, last],
            "pymupdf": pymupdf.__version__,
            "checks": checks,
            "ok": ok,
        }, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
