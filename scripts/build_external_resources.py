#!/usr/bin/env python3
"""Fetch per-lesson external resource indexes for the yuwen-course site."""

from __future__ import annotations

import json
import re
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from html import unescape
from pathlib import Path
from typing import Any


OUT_DIR = Path("site/data")
YUQUE_NAMESPACE = "org-wiki-bdfz-oz9uor"
YUQUE_BOOKS = [
    {"blockId": "xuanbi-shang", "blockTitle": "選必上", "slug": "yrhg03", "icon": "📘"},
    {"blockId": "xuanbi-zhong", "blockTitle": "選必中", "slug": "ufrlw0", "icon": "📗"},
    {"blockId": "xuanbi-xia", "blockTitle": "選必下", "slug": "lidkyh", "icon": "📙"},
]
WY_BOOTSTRAP_URL = "https://wy.bdfz.net/api/bootstrap"


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


def fetch_text(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={
            "user-agent": "bdfz-yuwen-course-resource-builder/1.0",
            "accept": "text/html,application/json;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", "replace")


def fetch_json(url: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "user-agent": "bdfz-yuwen-course-resource-builder/1.0",
            "accept": "application/json",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8", "replace"))


def resolve_head(url: str) -> str:
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    request = urllib.request.Request(
        url,
        method="HEAD",
        headers={
            "user-agent": "bdfz-yuwen-course-resource-builder/1.0",
            "accept": "*/*",
        },
    )
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(request, timeout=6) as response:
            return response.headers.get("location") or response.url
    except urllib.error.HTTPError as error:
        if 300 <= error.code < 400:
            return error.headers.get("location") or url
        raise


def extract_app_data(html: str) -> dict[str, Any]:
    match = re.search(r'window\.appData\s*=\s*JSON\.parse\(decodeURIComponent\("(.+?)"\)\)', html, re.S)
    if not match:
        return {}
    return json.loads(urllib.parse.unquote(match.group(1)))


def normalize_title(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "").translate(TRAD_TO_SIMP).lower()
    value = value.replace("選必", "选必").replace("选择性必修", "选必")
    value = re.sub(r"[/／].*$", "", value)
    value = re.sub(r"[（(].*?[）)]", "", value)
    value = re.sub(r"^[*＊\s]*(\d+|[一二三四五六七八九十]+)[、.．\s-]*", "", value)
    value = re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value)
    value = re.sub(r"[a-z]$", "", value)
    return value


def public_doc_links(doc_url: str) -> list[dict[str, str]]:
    """Best-effort extraction for public Yuque pages.

    The current public HTML does not contain the Lake document body for every
    page. When it does expose plain links, keep only user-facing destinations
    and discard Yuque shell assets.
    """
    try:
        html = fetch_text(doc_url)
    except Exception:
        return []
    results: list[dict[str, str]] = []
    seen: set[str] = set()
    for href, text in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, re.S | re.I):
        url = unescape(href).strip()
        if not url or url.startswith("#"):
            continue
        if url.startswith("//"):
            url = f"https:{url}"
        if url.startswith("/"):
            url = urllib.parse.urljoin(doc_url, url)
        host = urllib.parse.urlparse(url).netloc.lower()
        if not host or any(token in host for token in ("alipayobjects.com", "alicdn.com", "yuque.com")):
            continue
        label = re.sub(r"<[^>]+>", "", text)
        label = re.sub(r"\s+", " ", unescape(label)).strip() or url
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        results.append({"href": url, "text": label[:160]})
    return results[:24]


def build_class_resources() -> dict[str, Any]:
    books: list[dict[str, Any]] = []
    items: list[dict[str, Any]] = []
    for source in YUQUE_BOOKS:
        book_url = f"https://bdfz.yuque.com/{YUQUE_NAMESPACE}/{source['slug']}?#"
        app_data = extract_app_data(fetch_text(book_url))
        book = app_data.get("book") or {}
        toc = book.get("toc") or []
        books.append({
            **source,
            "name": book.get("name") or source["blockTitle"],
            "url": book_url,
            "count": len(toc),
        })
        for order, node in enumerate(toc):
            title = node.get("title") or node.get("label") or ""
            slug = node.get("url") or ""
            if not title or not slug:
                continue
            doc_url = f"https://bdfz.yuque.com/{YUQUE_NAMESPACE}/{slug}"
            is_unit = bool(re.search(r"单元|單元|研习任务|研習任務|目录|目錄", title))
            is_exam = "高考" in title or "命题" in title or "命題" in title
            item = {
                "id": f"{source['blockId']}:{slug}",
                "blockId": source["blockId"],
                "blockTitle": source["blockTitle"],
                "bookSlug": source["slug"],
                "bookTitle": book.get("name") or source["blockTitle"],
                "title": title,
                "key": normalize_title(title),
                "url": doc_url,
                "sourceUrl": book_url,
                "level": int(node.get("level") or 0),
                "order": order,
                "uuid": node.get("uuid") or "",
                "parentUuid": node.get("parent_uuid") or "",
                "childUuid": node.get("child_uuid") or "",
                "docId": node.get("doc_id") or node.get("id"),
                "kind": "exam" if is_exam else "unit" if is_unit else "lesson",
                "links": [],
            }
            items.append(item)
            time.sleep(0.05)
    return {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "https://class.bdfz.net/",
        "books": books,
        "items": items,
    }


def build_wy_articles() -> dict[str, Any]:
    data = fetch_json(WY_BOOTSTRAP_URL)
    articles = data.get("articles") or []
    slim = []
    for article in articles:
        slim.append({
            "article_id": article.get("article_id"),
            "book_key": article.get("book_key"),
            "book_title": article.get("book_title"),
            "title": article.get("title"),
            "manifest_title": article.get("manifest_title"),
            "author": article.get("author"),
            "page_start": article.get("page_start"),
            "page_end": article.get("page_end"),
            "challenge_count": article.get("challenge_count"),
            "content_count": article.get("content_count"),
            "function_count": article.get("function_count"),
            "note_count": article.get("note_count"),
        })
    return {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": WY_BOOTSTRAP_URL,
        "articles": slim,
    }


def build_resource_redirects() -> dict[str, Any]:
    mapping: dict[str, str] = {}
    lessons_dir = OUT_DIR / "lessons"
    if not lessons_dir.exists():
        return {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "redirects": mapping}
    urls: set[str] = set()
    for path in lessons_dir.glob("*.json"):
        lesson = json.loads(path.read_text(encoding="utf-8"))
        for item in lesson.get("resources") or []:
            href = item.get("href") or ""
            if "uploads/short-url/" not in href:
                continue
            if href.startswith("//"):
                href = f"https:{href}"
            elif href.startswith("/"):
                href = f"https://forum.rdfzer.com{href}"
            if "forum.rdfzer.com/uploads/short-url/" in href:
                urls.add(href)
    def resolve_one(url: str) -> tuple[str, str]:
        try:
            return url, resolve_head(url)
        except Exception:
            return url, ""

    with ThreadPoolExecutor(max_workers=12) as executor:
        futures = [executor.submit(resolve_one, url) for url in sorted(urls)]
        for future in as_completed(futures):
            url, resolved = future.result()
            if resolved and resolved != url:
                mapping[url] = resolved
    return {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "forum.rdfzer.com short-url redirects resolved from local access",
        "redirects": mapping,
    }


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))


def main() -> None:
    write_json(OUT_DIR / "class_resources.json", build_class_resources())
    write_json(OUT_DIR / "wy_articles.json", build_wy_articles())
    write_json(OUT_DIR / "resource_redirects.json", build_resource_redirects())
    print("built class_resources.json, wy_articles.json and resource_redirects.json")


if __name__ == "__main__":
    main()
