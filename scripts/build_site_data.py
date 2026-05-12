#!/usr/bin/env python3
"""Build static lesson data for the yuwen-course Pages site."""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import unicodedata
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any


CATEGORY_BOOK = {
    17: "高中_语文_普通高中教科书_语文必修_上册",
    18: "高中_语文_普通高中教科书_语文必修_下册",
    11: "高中_语文_普通高中教科书_语文选择性必修_上册",
    12: "高中_语文_普通高中教科书_语文选择性必修_中册",
    13: "高中_语文_普通高中教科书_语文选择性必修_下册",
}

BLOCK_ORDER = {
    "bixiu-shang": 1,
    "bixiu-xia": 2,
    "xuanbi-shang": 3,
    "xuanbi-zhong": 4,
    "xuanbi-xia": 5,
}

TRAD_TO_SIMP = str.maketrans({
    "語": "语",
    "選": "选",
    "擇": "择",
    "論": "论",
    "記": "记",
    "復": "复",
    "萬": "万",
    "勝": "胜",
    "彆": "别",
    "別": "别",
    "國": "国",
    "歷": "历",
    "紀": "纪",
    "實": "实",
    "檢": "检",
    "驗": "验",
    "證": "证",
    "為": "为",
    "學": "学",
    "習": "习",
    "務": "务",
    "單": "单",
    "叢": "丛",
    "鵑": "鹃",
    "詩": "诗",
    "經": "经",
    "莊": "庄",
    "禮": "礼",
    "韋": "韦",
    "臺": "台",
})


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))


def clean_title(title: str, block_title: str = "") -> str:
    value = unicodedata.normalize("NFKC", title or "").strip()
    value = re.sub(r"^高中[語语]文\s*[-－]\s*", "", value)
    value = re.sub(r"^(必修上|必修下|選必上|选必上|選必中|选必中|選必下|选必下)\s*[-－]?\s*", "", value)
    if block_title:
        value = re.sub(rf"^{re.escape(block_title)}\s*[-－]?\s*", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").translate(TRAD_TO_SIMP).lower()
    value = value.replace("選必", "选必").replace("选择性必修", "选必")
    value = re.sub(r"高中语文|普通高中教科书|语文|人教版|部编版", "", value)
    value = re.sub(r"[（(].*?[）)]", "", value)
    value = re.sub(r"[/／].*$", "", value)
    value = re.sub(r"^第?[一二三四五六七八九十]+单元", "单元", value)
    value = re.sub(r"^[*＊\s]*(\d+|[一二三四五六七八九十]+)[、.．\s-]*", "", value)
    value = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value)
    return value


def title_candidates(value: str) -> list[str]:
    clean = normalized(value)
    parts = [clean]
    raw = unicodedata.normalize("NFKC", value or "").translate(TRAD_TO_SIMP)
    for piece in re.split(r"[—\-:：,，、/／《》“”\"'（）()\s]+", raw):
        item = normalized(piece)
        if len(item) >= 2:
            parts.append(item)
    return list(dict.fromkeys(parts))


def longest_common(a: str, b: str) -> int:
    matcher = SequenceMatcher(None, a, b)
    return max((block.size for block in matcher.get_matching_blocks()), default=0)


def topic_is_noise(topic: dict[str, Any]) -> bool:
    title = topic.get("title", "")
    return title.startswith("About the ") or title.lower().startswith("about the ")


def match_toc(topic_title: str, book: dict[str, Any] | None) -> dict[str, Any] | None:
    if not book:
        return None
    toc = book.get("toc") or []
    if not toc:
        return None
    candidates = title_candidates(topic_title)
    best: tuple[float, dict[str, Any]] | None = None
    for index, item in enumerate(toc):
        label = item.get("label") or ""
        toc_candidates = title_candidates(label)
        score = 0.0
        for left in candidates:
            for right in toc_candidates:
                if not left or not right:
                    continue
                ratio = SequenceMatcher(None, left, right).ratio()
                common = longest_common(left, right)
                coverage = common / max(1, min(len(left), len(right)))
                contains = 1.0 if left in right or right in left else 0.0
                score = max(score, ratio, coverage * 0.92, contains)
        if "单元" in normalized(topic_title) and "单元" in normalized(label):
            score += 0.08
        if best is None or score > best[0]:
            best = (score, {**item, "_toc_index": index, "_score": round(score, 3)})
    if not best or best[0] < 0.46:
        return None
    return best[1]


def load_fts_pages(db_path: Path | None) -> dict[str, list[dict[str, Any]]]:
    if not db_path or not db_path.exists():
        return {}
    wanted = sorted(set(CATEGORY_BOOK.values()))
    placeholders = ",".join("?" for _ in wanted)
    query = (
        "select book_key, section, text from chunks "
        f"where book_key in ({placeholders}) and text is not null "
        "order by book_key, section"
    )
    pages: dict[str, list[dict[str, Any]]] = {key: [] for key in wanted}
    with sqlite3.connect(str(db_path)) as conn:
        for book_key, section, text in conn.execute(query, wanted):
            pages.setdefault(book_key, []).append({
                "section": int(section),
                "text": text or "",
                "norm": normalized(text or ""),
            })
    return pages


def match_fts_page(topic_title: str, book_key: str | None, fts_pages: dict[str, list[dict[str, Any]]]) -> dict[str, Any] | None:
    if not book_key:
        return None
    pages = fts_pages.get(book_key) or []
    if not pages:
        return None
    candidates = [item for item in title_candidates(topic_title) if len(item) >= 2]
    if not candidates:
        return None
    # Very short numeric/unit-only titles are too ambiguous for full-text fallback.
    if all(re.fullmatch(r"\d+|单元|后记", item) for item in candidates):
        return None

    best: tuple[float, dict[str, Any]] | None = None
    for page in pages:
        text = page["norm"]
        if not text:
            continue
        score = 0.0
        for candidate in candidates:
            if candidate in text:
                score = max(score, 0.86 + min(0.08, len(candidate) / 100))
                continue
            common = longest_common(candidate, text)
            coverage = common / max(1, len(candidate))
            if common >= 3:
                score = max(score, coverage * 0.82)
        if best is None or score > best[0]:
            best = (score, page)
    if not best or best[0] < 0.66:
        return None
    return {
        "page": int(best[1]["section"]),
        "printedPage": None,
        "label": topic_title,
        "_toc_index": 0,
        "_score": round(best[0], 3),
        "_source": "fts",
    }


def page_range(book: dict[str, Any], toc_item: dict[str, Any] | None) -> list[int]:
    if not toc_item:
        return []
    if toc_item.get("_source") == "fts":
        pages = int(book.get("pages") or 0)
        start = int(toc_item.get("page") or 0)
        end = max(start, min(pages - 1, start + 4))
        return list(range(start, end + 1))
    toc = book.get("toc") or []
    pages = int(book.get("pages") or 0)
    start = int(toc_item.get("page") or 0)
    index = int(toc_item.get("_toc_index") or 0)
    next_pages = [int(item.get("page") or 0) for item in toc[index + 1 :] if int(item.get("page") or 0) > start]
    end = (next_pages[0] - 1) if next_pages else min(pages - 1, start + 10)
    end = max(start, min(end, pages - 1))
    if end - start > 24:
        end = start + 24
    return list(range(start, end + 1))


def classify_links(posts: list[dict[str, Any]]) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for post in posts:
        for link in post.get("links", []):
            href = (link.get("href") or "").lower()
            text = (link.get("text") or "").lower()
            if any(token in href for token in ("youtube", "bilibili", "youtu.be")):
                counts["video"] += 1
            elif any(token in href for token in ("pdf", "doc", "ppt", "drive.google", "feishu", "notion")):
                counts["document"] += 1
            elif href.startswith("http"):
                counts["external"] += 1
            if "files.rdfzer.com" in href or "/uploads/" in href:
                counts["attachment"] += 1
            if "高考" in text or "真题" in text:
                counts["exam"] += 1
    return dict(counts)


def collect_images(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    result: list[dict[str, Any]] = []
    for post in posts:
        for image in post.get("images", []):
            src = image.get("src")
            if not src or src in seen:
                continue
            seen.add(src)
            result.append({
                "src": src,
                "alt": image.get("alt") or "",
                "width": image.get("width"),
                "height": image.get("height"),
                "postNumber": post.get("post_number"),
            })
    return result


def collect_resources(posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    resources: list[dict[str, Any]] = []
    for post in posts:
        for link in post.get("links", []):
            href = link.get("href")
            if not href or href in seen:
                continue
            seen.add(href)
            text = link.get("text") or href
            kind = "link"
            low = href.lower()
            if "youtube" in low or "bilibili" in low or "youtu.be" in low:
                kind = "video"
            elif any(ext in low for ext in (".pdf", ".doc", ".docx", ".ppt", ".pptx")):
                kind = "document"
            elif "files.rdfzer.com" in low or "/uploads/" in low:
                kind = "upload"
            resources.append({
                "href": href,
                "text": text[:160],
                "kind": kind,
                "postNumber": post.get("post_number"),
            })
    return resources


def excerpt_from_posts(posts: list[dict[str, Any]], limit: int = 420) -> str:
    text = " ".join(post.get("plain_text", "") for post in posts[:3])
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def build_annotations(lesson: dict[str, Any]) -> list[dict[str, str]]:
    annotations = []
    if lesson.get("textbook", {}).get("pages"):
        annotations.append({
            "title": "教材圖頁",
            "body": f"已對應教材圖片 p{lesson['textbook']['pages'][0]} 起，可在圖頁欄對照原書版面、頁碼和課文位置。"
        })
    resources = lesson.get("resources", [])
    if resources:
        annotations.append({
            "title": "延伸資源",
            "body": f"本課從論壇回覆抽取 {len(resources)} 條連結/附件，按所在樓層保留，便於追溯。"
        })
    images = lesson.get("forumImages", [])
    if images:
        annotations.append({
            "title": "論壇圖片",
            "body": f"本課含 {len(images)} 張 R2/Discourse 圖片，已按原貼樓層關聯到課文。"
        })
    annotations.append({
        "title": "學習路線",
        "body": "先讀主樓，旁看教材圖頁，再用回覆資源補證據；最後把自己的問題丟給 AI 或討論區。"
    })
    return annotations


def build_tasks(title: str) -> list[dict[str, str]]:
    return [
        {
            "id": "restate",
            "title": "三分鐘復述",
            "prompt": f"不看原文，用三分鐘說清《{title}》的核心問題、人物/論點與一句最關鍵的證據。"
        },
        {
            "id": "evidence",
            "title": "證據標註",
            "prompt": "從主樓或教材圖頁中選兩處原文，分別標出：字面意思、語氣/修辭、可被考查的點。"
        },
        {
            "id": "transfer",
            "title": "遷移追問",
            "prompt": "結合回覆中的一條學習資源，設計一道可討論的問題，要求回答者必須回到文本取證。"
        }
    ]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--export", required=True, type=Path)
    parser.add_argument("--catalog", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--fts-db", type=Path)
    args = parser.parse_args()

    export = read_json(args.export)
    catalog = read_json(args.catalog)
    books_by_id = {book.get("id"): book for book in catalog.get("books", [])}
    fts_pages = load_fts_pages(args.fts_db)

    lessons_dir = args.out / "lessons"
    lessons_dir.mkdir(parents=True, exist_ok=True)

    blocks: dict[str, dict[str, Any]] = {}
    manifest_lessons: list[dict[str, Any]] = []

    for category in export.get("categories", []):
        block = {
            "id": category["slug"],
            "title": category["title"],
            "categoryId": category["id"],
            "order": BLOCK_ORDER.get(category["slug"], category.get("order", 99)),
            "lessons": []
        }
        blocks[category["slug"]] = block

    for topic in export.get("topics", []):
        if topic_is_noise(topic):
            continue
        category_id = int(topic["category_id"])
        block_slug = topic["category_slug"]
        block = blocks[block_slug]
        book = books_by_id.get(CATEGORY_BOOK.get(category_id))
        display_title = clean_title(topic["title"], block["title"])
        toc_item = match_toc(display_title, book)
        if not toc_item:
            toc_item = match_fts_page(display_title, CATEGORY_BOOK.get(category_id), fts_pages)
        pages = page_range(book, toc_item) if book else []
        image_base = book.get("imageBase") if book else None

        posts = topic.get("posts", [])
        resources = collect_resources(posts)
        forum_images = collect_images(posts)
        excerpt = excerpt_from_posts(posts)
        lesson_id = f"lesson-{topic['id']}"
        textbook = {
            "bookId": book.get("id") if book else None,
            "bookTitle": book.get("displayTitle") if book else None,
            "imageBase": image_base,
            "tocLabel": toc_item.get("label") if toc_item else None,
            "tocScore": toc_item.get("_score") if toc_item else None,
            "startPage": pages[0] if pages else None,
            "pages": pages,
            "pageImages": [
                {
                    "page": page,
                    "src": f"{image_base}/p{page}.webp",
                    "label": f"p{page}"
                }
                for page in pages
            ]
        }

        lesson = {
            "id": lesson_id,
            "topicId": topic["id"],
            "title": display_title,
            "sourceTitle": topic["title"],
            "blockId": block_slug,
            "blockTitle": block["title"],
            "forumUrl": topic["forum_url"],
            "createdAt": topic.get("created_at"),
            "updatedAt": topic.get("updated_at"),
            "postCount": len(posts),
            "excerpt": excerpt,
            "textbook": textbook,
            "forumImages": forum_images,
            "resources": resources,
            "resourceCounts": classify_links(posts),
            "annotations": [],
            "learningTasks": build_tasks(display_title),
            "posts": posts,
        }
        lesson["annotations"] = build_annotations(lesson)
        write_json(lessons_dir / f"{lesson_id}.json", lesson)

        meta = {
            "id": lesson_id,
            "topicId": topic["id"],
            "title": display_title,
            "sourceTitle": topic["title"],
            "blockId": block_slug,
            "blockTitle": block["title"],
            "forumUrl": topic["forum_url"],
            "postCount": len(posts),
            "imageCount": len(forum_images),
            "resourceCount": len(resources),
            "textbookPageCount": len(pages),
            "textbookStartPage": pages[0] if pages else None,
            "textbookBookTitle": textbook["bookTitle"],
            "tocLabel": textbook["tocLabel"],
            "tocScore": textbook["tocScore"],
            "excerpt": excerpt,
            "dataUrl": f"data/lessons/{lesson_id}.json",
        }
        block["lessons"].append(meta)
        manifest_lessons.append(meta)

    for block in blocks.values():
        block["lessons"].sort(key=lambda item: item["topicId"])

    manifest = {
        "generatedAt": export.get("exported_at"),
        "source": {
            "forum": export.get("forum_base"),
            "categories": [17, 18, 11, 12, 13],
            "textbookCatalog": "jc-textbook-reader/site/data/catalog.json"
        },
        "domain": "https://yw.bdfz.net/",
        "blocks": sorted(blocks.values(), key=lambda item: item["order"]),
        "lessons": sorted(manifest_lessons, key=lambda item: (BLOCK_ORDER.get(item["blockId"], 99), item["topicId"])),
        "totals": {
            "blocks": len(blocks),
            "lessons": len(manifest_lessons),
            "posts": sum(item["postCount"] for item in manifest_lessons),
            "forumImages": sum(item["imageCount"] for item in manifest_lessons),
            "resources": sum(item["resourceCount"] for item in manifest_lessons),
            "textbookPageRefs": sum(item["textbookPageCount"] for item in manifest_lessons),
            "mappedLessons": sum(1 for item in manifest_lessons if item["textbookPageCount"]),
        }
    }
    write_json(args.out / "manifest.json", manifest)

    summary = manifest["totals"]
    rate = summary["mappedLessons"] / max(1, summary["lessons"])
    print(
        "built {lessons} lessons, {posts} posts, {forumImages} forum images, "
        "{resources} resources, {mappedLessons}/{lessons} mapped ({rate:.1%})".format(
            **summary, rate=rate
        )
    )


if __name__ == "__main__":
    main()
