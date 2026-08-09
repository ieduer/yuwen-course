#!/usr/bin/env python3
"""Build static lesson data for the yuwen-course Pages site."""

from __future__ import annotations

import argparse
import html
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

TITLE_OVERRIDES = {
    1692: "2 立在地球边上放号 红烛 峨日朵雪峰之侧 致云雀",
}

REMOVED_TOPIC_IDS = {2177, 9140, 10653}

MANUAL_TOC_PRINTED = {
    "高中_语文_普通高中教科书_语文必修_上册": [
        ("第一单元", 1, 1),
        ("1沁园春·长沙/毛泽东", 2, 2),
        ("2立在地球边上放号/郭沫若", 4, 2),
        ("红烛/闻一多", 4, 2),
        ("峨日朵雪峰之侧/昌耀", 6, 2),
        ("致云雀/雪莱", 7, 2),
        ("3百合花/茹志鹃", 12, 2),
        ("哦，香雪/铁凝", 19, 2),
        ("第一单元学习任务", 29, 2),
        ("第二单元", 31, 1),
        ("4喜看稻菽千重浪/沈英甲", 32, 2),
        ("心有一团火，温暖众人心/林为民", 38, 2),
        ("探界者钟扬/叶雨婷", 43, 2),
        ("5以工匠精神雕琢时代品质/李斌", 51, 2),
        ("6芣苢/《诗经·周南》", 53, 2),
        ("插秧歌/杨万里", 53, 2),
        ("第二单元学习任务", 55, 2),
        ("第三单元", 57, 1),
        ("7短歌行/曹操", 58, 2),
        ("归园田居其一/陶渊明", 59, 2),
        ("8梦游天姥吟留别/李白", 60, 2),
        ("登高/杜甫", 61, 2),
        ("琵琶行并序/白居易", 62, 2),
        ("9念奴娇·赤壁怀古/苏轼", 65, 2),
        ("永遇乐·京口北固亭怀古/辛弃疾", 66, 2),
        ("声声慢/李清照", 67, 2),
        ("第三单元学习任务", 69, 2),
        ("第四单元 家乡文化生活", 71, 1),
        ("第五单元 整本书阅读", 79, 1),
        ("乡土中国", 80, 2),
        ("第六单元", 83, 1),
        ("10劝学/《荀子》", 84, 2),
        ("师说/韩愈", 85, 2),
        ("11反对党八股/毛泽东", 88, 2),
        ("12拿来主义/鲁迅", 94, 2),
        ("13读书：目的和前提/黑塞", 97, 2),
        ("上图书馆/王佐良", 100, 2),
        ("第六单元学习任务", 103, 2),
        ("第七单元", 105, 1),
        ("14故都的秋/郁达夫", 106, 2),
        ("荷塘月色/朱自清", 109, 2),
        ("15我与地坛/史铁生", 112, 2),
        ("16赤壁赋/苏轼", 118, 2),
        ("登泰山记/姚鼐", 120, 2),
        ("第七单元学习任务", 123, 2),
        ("第八单元 词语积累与词语解释", 126, 1),
        ("古诗词诵读", 140, 1),
        ("静女", 140, 2),
        ("涉江采芙蓉", 141, 2),
        ("虞美人", 142, 2),
        ("鹊桥仙", 143, 2),
    ],
    "高中_语文_普通高中教科书_语文必修_下册": [
        ("第一单元", 1, 1),
        ("1子路、曾皙、冉有、公西华侍坐/《论语》", 2, 2),
        ("齐桓晋文之事/《孟子》", 4, 2),
        ("庖丁解牛/《庄子》", 8, 2),
        ("2烛之武退秦师/《左传》", 10, 2),
        ("3鸿门宴/司马迁", 13, 2),
        ("第一单元学习任务", 18, 2),
        ("第二单元", 21, 1),
        ("4窦娥冤/关汉卿", 22, 2),
        ("5雷雨/曹禺", 26, 2),
        ("6哈姆莱特/莎士比亚", 37, 2),
        ("第二单元学习任务", 43, 2),
        ("第三单元", 45, 1),
        ("7青蒿素：人类征服疾病的一小步/屠呦呦", 46, 2),
        ("一名物理学家的教育历程/加来道雄", 50, 2),
        ("8中国建筑的特征/梁思成", 55, 2),
        ("9说木叶/林庚", 61, 2),
        ("第三单元学习任务", 67, 2),
        ("第四单元 信息时代的语文生活", 69, 1),
        ("第五单元", 79, 1),
        ("10在《人民报》创刊纪念会上的演说/马克思", 80, 2),
        ("在马克思墓前的讲话/恩格斯", 82, 2),
        ("11谏逐客书/李斯", 85, 2),
        ("与妻书/林觉民", 87, 2),
        ("第五单元学习任务", 91, 2),
        ("第六单元", 93, 1),
        ("12祝福/鲁迅", 94, 2),
        ("13林教头风雪山神庙/施耐庵", 107, 2),
        ("装在套子里的人/契诃夫", 113, 2),
        ("14促织/蒲松龄", 119, 2),
        ("变形记/卡夫卡", 123, 2),
        ("第六单元学习任务", 135, 2),
        ("第七单元 整本书阅读", 137, 1),
        ("红楼梦", 138, 2),
        ("第八单元", 143, 1),
        ("15谏太宗十思疏/魏征", 144, 2),
        ("答司马谏议书/王安石", 146, 2),
        ("16阿房宫赋/杜牧", 148, 2),
        ("六国论/苏洵", 150, 2),
        ("第八单元学习任务", 152, 2),
        ("古诗词诵读", 155, 1),
        ("登岳阳楼/杜甫", 155, 2),
        ("桂枝香·金陵怀古/王安石", 156, 2),
        ("念奴娇·过洞庭/张孝祥", 157, 2),
        ("游园/汤显祖", 158, 2),
    ],
    "高中_语文_普通高中教科书_语文选择性必修_上册": [
        ("第一单元", 1, 1),
        ("1中国人民站起来了/毛泽东", 2, 2),
        ("2长征胜利万岁/杨成武", 6, 2),
        ("大战中的插曲/聂荣臻", 11, 2),
        ("3别了，不列颠尼亚/周婷杨兴", 16, 2),
        ("县委书记的榜样——焦裕禄/穆青 冯健 周原", 18, 2),
        ("4在民族复兴的历史丰碑上——2020中国抗疫记/钟华论", 29, 2),
        ("第一单元研习任务", 41, 2),
        ("第二单元", 43, 1),
        ("5《论语》十二章", 44, 2),
        ("大学之道/《礼记》", 45, 2),
        ("人皆有不忍人之心/《孟子》", 46, 2),
        ("6《老子》四章", 48, 2),
        ("五石之瓠/《庄子》", 49, 2),
        ("7兼爱/《墨子》", 51, 2),
        ("第二单元研习任务", 53, 2),
        ("第三单元", 55, 1),
        ("8大卫·科波菲尔/狄更斯", 56, 2),
        ("9复活/列夫·托尔斯泰", 67, 2),
        ("10老人与海/海明威", 73, 2),
        ("11百年孤独/加西亚·马尔克斯", 84, 2),
        ("第三单元研习任务", 91, 2),
        ("第四单元 逻辑的力量", 93, 1),
        ("无衣/《诗经·秦风》", 102, 2),
        ("春江花月夜/张若虚", 103, 2),
        ("将进酒/李白", 105, 2),
        ("江城子·乙卯正月二十日夜记梦/苏轼", 106, 2),
    ],
    "高中_语文_普通高中教科书_语文选择性必修_中册": [
        ("第一单元", 1, 1),
        ("1社会历史的决定性基础/恩格斯", 2, 2),
        ("2改造我们的学习/毛泽东", 7, 2),
        ("人的正确思想是从哪里来的/毛泽东", 13, 2),
        ("3实践是检验真理的唯一标准/《光明日报》特约评论员", 15, 2),
        ("4修辞立其诚/张岱年", 23, 2),
        ("怜悯是人的天性/卢梭", 25, 2),
        ("5人应当坚持正义/柏拉图", 30, 2),
        ("第一单元研习任务", 35, 2),
        ("第二单元", 37, 1),
        ("6记念刘和珍君/鲁迅", 38, 2),
        ("为了忘却的记念/鲁迅", 43, 2),
        ("7包身工/夏衍", 52, 2),
        ("8荷花淀/孙犁", 61, 2),
        ("小二黑结婚/赵树理", 66, 2),
        ("党费/王愿坚", 71, 2),
        ("第二单元研习任务", 80, 2),
        ("第三单元", 81, 1),
        ("9屈原列传/司马迁", 82, 2),
        ("10苏武传/班固", 87, 2),
        ("11过秦论/贾谊", 93, 2),
        ("五代史伶官传序/欧阳修", 96, 2),
        ("第三单元研习任务", 99, 2),
        ("第四单元", 101, 1),
        ("12玩偶之家/易卜生", 102, 2),
        ("13迷娘/歌德", 117, 2),
        ("致大海/普希金", 118, 2),
        ("自己之歌/惠特曼", 122, 2),
        ("树和天空/特朗斯特罗姆", 123, 2),
        ("第四单元研习任务", 124, 2),
        ("古诗词诵读", 126, 1),
        ("燕歌行并序/高适", 126, 2),
        ("李凭箜篌引/李贺", 128, 2),
        ("锦瑟/李商隐", 129, 2),
        ("书愤/陆游", 130, 2),
    ],
    "高中_语文_普通高中教科书_语文选择性必修_下册": [
        ("第一单元", 1, 1),
        ("1氓/《诗经·卫风》", 2, 2),
        ("离骚/屈原", 3, 2),
        ("2孔雀东南飞并序", 7, 2),
        ("3蜀道难/李白", 14, 2),
        ("蜀相/杜甫", 16, 2),
        ("4望海潮/柳永", 17, 2),
        ("扬州慢/姜夔", 18, 2),
        ("第一单元研习任务", 20, 2),
        ("第二单元", 21, 1),
        ("5阿Q正传/鲁迅", 22, 2),
        ("边城/沈从文", 29, 2),
        ("6大堰河——我的保姆/艾青", 41, 2),
        ("再别康桥/徐志摩", 45, 2),
        ("7一个消逝了的山村/冯至", 47, 2),
        ("风景谈/茅盾", 49, 2),
        ("秦腔/贾平凹", 50, 2),
        ("听听那冷雨/余光中", 52, 2),
        ("8茶馆/老舍", 55, 2),
        ("第二单元研习任务", 67, 2),
        ("第三单元", 69, 1),
        ("9陈情表/李密", 70, 2),
        ("项脊轩志/归有光", 72, 2),
        ("10兰亭集序/王羲之", 75, 2),
        ("归去来兮辞并序/陶渊明", 77, 2),
        ("11种树郭橐驼传/柳宗元", 81, 2),
        ("12石钟山记/苏轼", 83, 2),
        ("第三单元研习任务", 85, 2),
        ("第四单元", 87, 1),
        ("13自然选择的证明/达尔文", 88, 2),
        ("宇宙的边疆/卡尔·萨根", 94, 2),
        ("14天文学上的旷世之争/关增建", 101, 2),
        ("第四单元研习任务", 109, 2),
        ("古诗词诵读", 111, 1),
        ("拟行路难/鲍照", 111, 2),
        ("客至/杜甫", 112, 2),
        ("登快阁/黄庭坚", 113, 2),
        ("临安春雨初霁/陆游", 114, 2),
    ],
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
    "聽": "听",
    "進": "进",
    "氣": "气",
    "題": "题",
    "與": "与",
    "說": "说",
})

AI_CAPTION_RE = re.compile(r"\[?[^。！？.!?]{0,520}\(Captioned by AI\)\]?", re.IGNORECASE)
AI_DESCRIPTION_PREFIX_RE = re.compile(r"\bhere is a single sentence description of(?:\s+the)?\s*:?", re.IGNORECASE)
AI_IMAGE_DESCRIPTION_RE = re.compile(
    r"(?:^|\s)"
    r"(?:here is a single sentence description of the\s*:?\s*)?"
    r"(?:(?:this|the)\s+(?:image|photo|picture|screenshot|page|displays|shows)|"
    r"this\s+is\s+a\s+(?:page|photo|picture|screenshot|webpage)|"
    r"an?\s+(?:image|photo|picture|screenshot|webpage|open\s+book|page)|"
    r"a\s+page\s+from|the\s+shows)"
    r"[^。！？.!?]{0,320}[。！？.!?]?",
    re.IGNORECASE,
)
MEDIA_META_RE = re.compile(r"(?:\b(?:undefined|image)?\s*)?\d{2,5}\s*[x×]\s*\d{2,5}\s+[\d.]+\s*(?:kb|mb|gb|b)\b", re.IGNORECASE)
FILE_HASH_RE = re.compile(r"\b[a-f0-9]{24,}\b", re.IGNORECASE)
MEDIA_ANCHOR_RE = re.compile(r"image\d{2,5}[x×]\d{2,5}upload[a-z0-9]+", re.IGNORECASE)
BBCODE_COLOR_RE = re.compile(r"\[/?color(?:=[^\]]+)?\]", re.IGNORECASE)
BBCODE_ALIGNMENT_RE = re.compile(r"\[/?(?:right|center|left)\]", re.IGNORECASE)
RAW_ANNOTATION_LABEL_RE = re.compile(r"\[\d+:\d+\]")
UNIT_RE = re.compile(r"第\s*([一二三四五六七八九十\d]+)\s*单元")
UNIT_TASK_RE = re.compile(r"(学习任务|研习任务)")


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


def clean_media_text(value: str) -> str:
    text = unicodedata.normalize("NFKC", value or "")
    text = html.unescape(text)
    text = BBCODE_COLOR_RE.sub("", text)
    text = BBCODE_ALIGNMENT_RE.sub("", text)
    text = RAW_ANNOTATION_LABEL_RE.sub("", text)
    text = AI_CAPTION_RE.sub("", text)
    text = AI_IMAGE_DESCRIPTION_RE.sub(" ", text)
    text = AI_DESCRIPTION_PREFIX_RE.sub(" ", text)
    text = MEDIA_META_RE.sub("", text)
    text = FILE_HASH_RE.sub("", text)
    text = MEDIA_ANCHOR_RE.sub("image-upload", text)
    text = re.sub(r"\b(?:undefined|image)\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def is_media_noise(value: str) -> bool:
    text = clean_media_text(value)
    return not text or bool(re.fullmatch(r"[\W_]+", text))


def sanitize_cooked_html(value: str) -> str:
    html_text = str(value or "")
    html_text = BBCODE_COLOR_RE.sub("", html_text)
    html_text = BBCODE_ALIGNMENT_RE.sub("", html_text)
    html_text = RAW_ANNOTATION_LABEL_RE.sub("", html_text)
    html_text = re.sub(r'<div class="meta">.*?</div>', "", html_text, flags=re.DOTALL)
    html_text = AI_CAPTION_RE.sub("", html_text)
    html_text = AI_IMAGE_DESCRIPTION_RE.sub(" ", html_text)
    html_text = AI_DESCRIPTION_PREFIX_RE.sub(" ", html_text)
    html_text = MEDIA_ANCHOR_RE.sub("image-upload", html_text)

    def clean_attr(match: re.Match[str]) -> str:
        attr = match.group(1)
        raw = html.unescape(match.group(2))
        cleaned = clean_media_text(raw)
        return f' {attr}="{html.escape(cleaned, quote=True)}"' if cleaned else f' {attr}=""'

    html_text = re.sub(r'\s(alt|title)="([^"]*)"', clean_attr, html_text)

    def clean_filename(match: re.Match[str]) -> str:
        raw = html.unescape(match.group(1))
        cleaned = clean_media_text(raw)
        return f'<span class="filename">{html.escape(cleaned)}</span>' if cleaned else '<span class="filename"></span>'

    html_text = re.sub(r'<span class="filename">([^<]*)</span>', clean_filename, html_text)
    return html_text


def repair_known_footnotes(post: dict[str, Any]) -> dict[str, Any]:
    cooked = post.get("cooked", "")
    if post.get("id") == 10464:
        if "〔岨〕" in cooked and "footnote-10464-12" in cooked:
            return post
        if "碧溪岨" not in cooked or "闪不知[^12]" not in cooked:
            return post

        cooked = cooked.replace(
            "闪不知[^12]",
            '闪不知<sup class="footnote-ref"><a href="#footnote-10464-12" id="footnote-ref-10464-12">[12]</a></sup>',
        )
        cooked = cooked.replace(
            '<li id="footnote-10464-9" class="footnote-item"><p>[color=red]〔吕洞宾〕号纯阳子，相传为唐代京兆人，是传说中的“八仙”之一。歇后语有“狗咬吕洞宾——不识好人心”。[/color] <a href="#footnote-ref-10464-9" class="footnote-backref">↩︎</a></p>',
            '<li id="footnote-10464-9" class="footnote-item"><p>[color=red]〔岨（jū）〕读jū。[/color] <a href="#footnote-ref-10464-9" class="footnote-backref">↩︎</a></p>\n'
            '</li>\n'
            '<li id="footnote-10464-10" class="footnote-item"><p>[color=red]〔吕洞宾〕号纯阳子，相传为唐代京兆人，是传说中的“八仙”之一。歇后语有“狗咬吕洞宾——不识好人心”。[/color] <a href="#footnote-ref-10464-10" class="footnote-backref">↩︎</a></p>',
        )
        cooked = cooked.replace(
            '<li id="footnote-10464-10" class="footnote-item"><p>[color=red]〔镇筸（gān）〕地名，曾是湖南凤凰县的治所。[/color] <a href="#footnote-ref-10464-10" class="footnote-backref">↩︎</a></p>',
            '<li id="footnote-10464-11" class="footnote-item"><p>[color=red]〔镇筸（gān）〕地名，曾是湖南凤凰县的治所。[/color] <a href="#footnote-ref-10464-11" class="footnote-backref">↩︎</a></p>',
        )
        cooked = cooked.replace(
            '<li id="footnote-10464-11" class="footnote-item"><p>[color=red]〔闪不知〕突然。[/color] <a href="#footnote-ref-10464-11" class="footnote-backref">↩︎</a></p>',
            '<li id="footnote-10464-12" class="footnote-item"><p>[color=red]〔闪不知〕突然。[/color] <a href="#footnote-ref-10464-12" class="footnote-backref">↩︎</a></p>',
        )
    elif post.get("id") == 11160:
        if "[^2]" not in cooked and "[^3]" not in cooked:
            return post

        cooked = cooked.replace(
            "[^2]",
            '<sup class="footnote-ref"><a href="#footnote-11160-2" id="footnote-ref-11160-2">[2]</a></sup>',
        )
        cooked = cooked.replace(
            "[^3]",
            '<sup class="footnote-ref"><a href="#footnote-11160-3" id="footnote-ref-11160-3">[3]</a></sup>',
        )
        cooked = cooked.replace(
            "</ol>",
            '<li id="footnote-11160-2" class="footnote-item"><p>[color=red]古今意义一致；但“坐”的方式或姿势，则古今意义不同。[/color] <a href="#footnote-ref-11160-2" class="footnote-backref">↩︎</a></p>\n'
            '</li>\n'
            '<li id="footnote-11160-3" class="footnote-item"><p>[color=red]〔王褒（生卒年不详）〕字子渊，蜀郡资中（今四川资阳）人，西汉辞赋家。[/color] <a href="#footnote-ref-11160-3" class="footnote-backref">↩︎</a></p>\n'
            '</li>\n'
            '</ol>',
        )
    post["cooked"] = cooked
    return post


def sanitize_post(post: dict[str, Any]) -> dict[str, Any]:
    post = dict(post)
    post = repair_known_footnotes(post)
    post["plain_text"] = clean_media_text(post.get("plain_text", ""))
    post["cooked"] = sanitize_cooked_html(post.get("cooked", ""))
    images = []
    for image in post.get("images", []):
        item = dict(image)
        item["alt"] = clean_media_text(item.get("alt", ""))
        images.append(item)
    post["images"] = images
    links = []
    for link in post.get("links", []):
        item = dict(link)
        if str(item.get("href", "")).startswith("#"):
            item["href"] = MEDIA_ANCHOR_RE.sub("image-upload", item.get("href", ""))
        item["text"] = clean_media_text(item.get("text", ""))
        item["title"] = clean_media_text(item.get("title", ""))
        links.append(item)
    post["links"] = links
    attachments = []
    for attachment in post.get("attachments", []):
        item = dict(attachment)
        item["text"] = clean_media_text(item.get("text", ""))
        item["title"] = clean_media_text(item.get("title", ""))
        attachments.append(item)
    post["attachments"] = attachments
    return post


def assert_user_facing_projection(value: Any, path: str = "lesson") -> None:
    if isinstance(value, str):
        if BBCODE_COLOR_RE.search(value) or RAW_ANNOTATION_LABEL_RE.search(value):
            raise ValueError(f"user-facing projection residue at {path}")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            assert_user_facing_projection(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            assert_user_facing_projection(item, f"{path}.{key}")


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
    raw_title = re.split(r"[/／]", raw, maxsplit=1)[0]
    for piece in re.split(r"[—\-:：,，、《》“”\"'（）()\s]+", raw_title):
        item = normalized(piece)
        if len(item) >= 2:
            parts.append(item)
    return list(dict.fromkeys(parts))


def chinese_number(value: str) -> int | None:
    value = unicodedata.normalize("NFKC", value or "").strip()
    if value.isdigit():
        return int(value)
    digits = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
    if value == "十":
        return 10
    if value.startswith("十"):
        return 10 + digits.get(value[1:], 0)
    if value.endswith("十"):
        return digits.get(value[:-1], 0) * 10
    if "十" in value:
        left, right = value.split("十", 1)
        return digits.get(left, 1) * 10 + digits.get(right, 0)
    return digits.get(value)


def unit_number(value: str) -> int | None:
    raw = unicodedata.normalize("NFKC", value or "").translate(TRAD_TO_SIMP)
    match = UNIT_RE.search(raw)
    if not match:
        return None
    return chinese_number(match.group(1))


def unit_task_kind(value: str) -> str | None:
    raw = unicodedata.normalize("NFKC", value or "").translate(TRAD_TO_SIMP)
    match = UNIT_TASK_RE.search(raw)
    return match.group(1) if match else None


def infer_page_offset(book: dict[str, Any]) -> int:
    offsets = [
        int(item["page"]) - int(item["printedPage"])
        for item in book.get("toc") or []
        if item.get("page") is not None and item.get("printedPage") is not None
    ]
    if not offsets:
        return 0
    offsets.sort()
    return offsets[len(offsets) // 2]


def manual_toc(book_key: str, book: dict[str, Any]) -> list[dict[str, Any]]:
    offset = infer_page_offset(book)
    result = []
    for index, (label, printed_page, level) in enumerate(MANUAL_TOC_PRINTED.get(book_key, [])):
        page = int(printed_page) + offset
        result.append({
            "label": label,
            "page": page,
            "printedPage": int(printed_page),
            "level": level,
            "_manual_index": index,
            "_source": "manual-toc",
        })
    return result


def effective_toc(book_key: str, book: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for source, items in (("manual-toc", manual_toc(book_key, book)), ("catalog", book.get("toc") or [])):
        for index, item in enumerate(items):
            label = item.get("label") or ""
            page = int(item.get("page") or 0)
            if not label or page <= 0:
                continue
            key = (normalized(label), page)
            if key in seen:
                continue
            seen.add(key)
            result.append({
                **item,
                "_toc_index": len(result),
                "_source": item.get("_source") or source,
                "_manual_index": item.get("_manual_index", index),
            })
    return sorted(result, key=lambda item: (int(item.get("page") or 0), int(item.get("_manual_index") or 0), item.get("label") or ""))


def longest_common(a: str, b: str) -> int:
    matcher = SequenceMatcher(None, a, b)
    return max((block.size for block in matcher.get_matching_blocks()), default=0)


def topic_is_noise(topic: dict[str, Any]) -> bool:
    title = topic.get("title", "")
    return title.startswith("About the ") or title.lower().startswith("about the ")


def match_toc(topic_title: str, toc: list[dict[str, Any]], min_page: int | None = None) -> dict[str, Any] | None:
    if not toc:
        return None
    candidates = title_candidates(topic_title)
    topic_norm = normalized(topic_title)
    topic_unit = unit_number(topic_title)
    topic_task = unit_task_kind(topic_title)
    best: tuple[float, dict[str, Any]] | None = None
    for index, item in enumerate(toc):
        page = int(item.get("page") or 0)
        if min_page and page and page + 2 < min_page and re.fullmatch(r"(单元学习任务|单元研习任务)", topic_norm):
            continue
        label = item.get("label") or ""
        label_norm = normalized(label)
        label_unit = unit_number(label)
        label_task = unit_task_kind(label)
        if topic_unit is not None and label_unit is not None and topic_unit != label_unit:
            continue
        if topic_task and label_task and topic_task != label_task:
            continue
        if topic_unit is not None and "单元" in topic_norm and "单元" in label_norm and label_unit != topic_unit:
            continue
        toc_candidates = title_candidates(label)
        score = 0.0
        if topic_unit is not None and not topic_task and label_unit == topic_unit and topic_norm in {"单元", "单元说明"} and label_norm == "单元":
            score = 1.0
        for left in candidates:
            for right in toc_candidates:
                if not left or not right:
                    continue
                ratio = SequenceMatcher(None, left, right).ratio()
                common = longest_common(left, right)
                coverage = common / max(1, min(len(left), len(right)))
                contains = 1.0 if left in right or right in left else 0.0
                if left == right:
                    score = max(score, 1.0)
                elif contains and min(len(left), len(right)) >= 3:
                    score = max(score, 0.9)
                elif common >= 3:
                    score = max(score, ratio, coverage * 0.88)
        if "单元" in topic_norm and "单元" in label_norm:
            if topic_unit is not None and label_unit == topic_unit:
                score += 0.08
            elif topic_unit is None and topic_task and label_task == topic_task:
                score += 0.05
        if item.get("_source") == "manual-toc":
            score += 0.03
        if best is None or score > best[0]:
            best = (score, {**item, "_toc_index": index, "_score": round(score, 3)})
    if not best or best[0] < 0.72:
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
    with sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro&immutable=1", uri=True) as conn:
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
    if not best or best[0] < 0.8:
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
            if is_internal_resource(link):
                continue
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
            if "/images/emoji/" in src or (
                int(image.get("width") or 0) <= 32
                and int(image.get("height") or 0) <= 32
            ):
                continue
            seen.add(src)
            result.append({
                "src": src,
                "alt": clean_media_text(image.get("alt") or ""),
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
            if not href or href in seen or is_internal_resource(link):
                continue
            seen.add(href)
            text = clean_media_text(link.get("text") or "") or href
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


def is_internal_resource(link: dict[str, Any]) -> bool:
    href = (link.get("href") or "").strip()
    text = (link.get("text") or "").strip()
    classes = set((link.get("classes") or "").split())
    if not href:
        return True
    if href.startswith("#"):
        return True
    if link.get("has_image") or "lightbox" in classes:
        return True
    if "anchor" in classes:
        return True
    if re.fullmatch(r"#?(p|footnote|footnote-ref)-[\w-]+", text):
        return True
    return False


def excerpt_from_posts(posts: list[dict[str, Any]], limit: int = 420) -> str:
    text = " ".join(post.get("plain_text", "") for post in posts[:3])
    text = clean_media_text(text)
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
    toc_by_book = {
        book_id: effective_toc(book_id, book)
        for book_id, book in books_by_id.items()
        if book_id in CATEGORY_BOOK.values()
    }
    fts_pages = load_fts_pages(args.fts_db)

    lessons_dir = args.out / "lessons"
    lessons_dir.mkdir(parents=True, exist_ok=True)

    blocks: dict[str, dict[str, Any]] = {}
    records: list[dict[str, Any]] = []
    last_page_by_block: dict[str, int] = {}

    for category in export.get("categories", []):
        block = {
            "id": category["slug"],
            "title": category["title"],
            "categoryId": category["id"],
            "order": BLOCK_ORDER.get(category["slug"], category.get("order", 99)),
            "lessons": []
        }
        blocks[category["slug"]] = block

    for topic in sorted(export.get("topics", []), key=lambda item: (BLOCK_ORDER.get(item.get("category_slug"), 99), int(item.get("id") or 0))):
        if int(topic.get("id") or 0) in REMOVED_TOPIC_IDS:
            continue
        if topic_is_noise(topic):
            continue
        category_id = int(topic["category_id"])
        block_slug = topic["category_slug"]
        block = blocks[block_slug]
        book_key = CATEGORY_BOOK.get(category_id)
        book = books_by_id.get(book_key)
        posts = [sanitize_post(post) for post in topic.get("posts", [])]
        display_title = TITLE_OVERRIDES.get(int(topic["id"]), clean_title(topic["title"], block["title"]))
        toc = toc_by_book.get(book_key or "", [])
        toc_item = match_toc(display_title, toc, min_page=last_page_by_block.get(block_slug))
        if not toc_item and len(normalized(display_title)) <= 2:
            topic_text = " ".join(post.get("plain_text", "") for post in posts[:1])[:900]
            toc_item = match_toc(f"{display_title} {topic_text}", toc, min_page=last_page_by_block.get(block_slug))
        if toc_item and int(toc_item.get("page") or 0) > 0:
            last_page_by_block[block_slug] = max(last_page_by_block.get(block_slug, 0), int(toc_item["page"]))
        image_base = book.get("imageBase") if book else None

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
            "startPage": int(toc_item.get("page")) if toc_item and toc_item.get("page") else None,
            "pages": [],
            "pageImages": [],
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
            "learningTasks": [],
            "posts": posts,
        }
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
            "textbookPageCount": 0,
            "textbookPageImageCount": 0,
            "textbookStartPage": textbook["startPage"],
            "textbookBookTitle": textbook["bookTitle"],
            "tocLabel": textbook["tocLabel"],
            "tocScore": textbook["tocScore"],
            "excerpt": excerpt,
            "dataUrl": f"data/lessons/{lesson_id}.json",
        }
        records.append({"block": block, "lesson": lesson, "meta": meta, "book": book})

    for block in blocks.values():
        block_records = [record for record in records if record["lesson"]["blockId"] == block["id"]]
        block_records.sort(key=lambda record: (
            0 if record["lesson"]["textbook"].get("startPage") else 1,
            int(record["lesson"]["textbook"].get("startPage") or 10**6),
            int(record["lesson"]["topicId"]),
        ))
        mapped_starts = [
            int(record["lesson"]["textbook"]["startPage"])
            for record in block_records
            if record["lesson"]["textbook"].get("startPage")
        ]
        for record in block_records:
            lesson = record["lesson"]
            meta = record["meta"]
            book = record["book"]
            textbook = lesson["textbook"]
            start_page = textbook.get("startPage")
            pages: list[int] = []
            if book and start_page:
                book_pages = int(book.get("pages") or 0)
                next_start = next((page for page in mapped_starts if page > start_page), None)
                end_page = (next_start - 1) if next_start else min(book_pages - 1, int(start_page) + 10)
                end_page = max(int(start_page), min(int(end_page), book_pages - 1))
                pages = list(range(int(start_page), end_page + 1))
            textbook["pages"] = pages
            textbook["pageImages"] = [
                {
                    "page": page,
                    "src": f"{textbook['imageBase']}/p{page}.webp",
                    "label": f"p{page}",
                    "matched": True,
                }
                for page in pages
                if textbook.get("imageBase")
            ]
            context_pages: list[int] = []
            if book and start_page:
                book_pages = int(book.get("pages") or 0)
                context_start = max(1, int(start_page) - 20)
                context_end = min(book_pages - 1, (pages[-1] if pages else int(start_page)) + 20)
                context_pages = list(range(context_start, max(context_start, context_end) + 1))
            textbook["contextPages"] = context_pages
            textbook["contextPageImages"] = [
                {
                    "page": page,
                    "src": f"{textbook['imageBase']}/p{page}.webp",
                    "label": f"p{page}",
                    "matched": page in set(pages),
                }
                for page in context_pages
                if textbook.get("imageBase")
            ]
            meta["textbookPageCount"] = len(pages)
            meta["textbookPageImageCount"] = len(textbook["pageImages"])
            meta["textbookStartPage"] = pages[0] if pages else None
            block["lessons"].append(meta)
            assert_user_facing_projection(lesson, lesson["id"])
            write_json(lessons_dir / f"{lesson['id']}.json", lesson)

    manifest_lessons = [
        record["meta"]
        for block in sorted(blocks.values(), key=lambda item: item["order"])
        for record in sorted(
            [item for item in records if item["lesson"]["blockId"] == block["id"]],
            key=lambda record: (
                0 if record["lesson"]["textbook"].get("startPage") else 1,
                int(record["lesson"]["textbook"].get("startPage") or 10**6),
                int(record["lesson"]["topicId"]),
            ),
        )
    ]

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
    assert_user_facing_projection(manifest, "manifest")
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
