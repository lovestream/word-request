#!/usr/bin/env python3
"""Build complete offline KET/PET banks from Cambridge's August 2025 lists.

The official PDFs are the membership source. ECDICT is used only to enrich
those entries with offline phonetics and bilingual definitions.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import pdfplumber


SOURCES = {
    "ket": {
        "title": "A2 Key and A2 Key for Schools Vocabulary List",
        "edition": "August 2025",
        "url": "https://www.cambridgeenglish.org/images/506886-a2-key-2020-vocabulary-list.pdf",
        "pages": [4, 23],
        "cefr": "A2",
    },
    "pet": {
        "title": "B1 Preliminary and Preliminary for Schools Vocabulary List",
        "edition": "August 2025",
        "url": "https://www.cambridgeenglish.org/Images/506887-b1-preliminary-vocabulary-list.pdf",
        "pages": [4, 40],
        "cefr": "B1",
    },
}

POS_WORDS = {
    "abbrev", "ad", "adj", "adv", "av", "conj", "det", "exclam", "mv",
    "n", "number", "phr", "pl", "prep", "pron", "sing", "unc", "v",
}

PALETTES = [
    ("#7DD3FC", "#A7F3D0"), ("#FDE68A", "#FDBA74"),
    ("#F9A8D4", "#C4B5FD"), ("#86EFAC", "#67E8F9"),
    ("#FCA5A5", "#FDE68A"), ("#93C5FD", "#DDD6FE"),
    ("#5EEAD4", "#BAE6FD"), ("#FDBA74", "#FBCFE8"),
]

EMOJI_GROUPS = [
    ("🐾", "animal animals pet pets creature dog cat puppy rabbit horse cow sheep pig mouse mice zoo zebra lion tiger elephant monkey bear"),
    ("🐦", "bird birds duck eagle chicken wing feather fly flying"),
    ("🐟", "fish fishing sea ocean dolphin whale shark swim swimming"),
    ("🍎", "apple banana orange lemon strawberry fruit fruits pear grape mango watermelon"),
    ("🍽️", "food meal breakfast lunch dinner snack restaurant cafe cook cooking kitchen delicious hungry eat eating sandwich pizza cake bread rice soup meat cheese egg"),
    ("🥤", "drink drinking water milk juice coffee tea thirsty bottle cup glass"),
    ("👕", "clothes clothing shirt t-shirt trousers jeans dress skirt coat jacket shoe shoes boot hat cap wear wearing fashion"),
    ("🏠", "home house apartment room bedroom bathroom living-room furniture sofa chair table bed garden door window wall floor"),
    ("🏫", "school classroom teacher student pupil lesson homework exam examination test study studying learn learning education college university"),
    ("📚", "book books library read reading story magazine newspaper dictionary page article text"),
    ("✏️", "write writing written pen pencil paper notebook spelling answer question"),
    ("💻", "computer laptop tablet internet online website web email app software digital technology upload download keyboard screen"),
    ("📱", "phone telephone mobile call calling message text smartphone"),
    ("🚲", "bicycle bike cycling cycle motorbike motorcycle ride riding"),
    ("🚗", "car taxi drive driving driver road traffic parking petrol"),
    ("🚌", "bus coach transport travel travelling journey trip tour tourist ticket station stop"),
    ("🚂", "train railway railroad platform underground subway"),
    ("✈️", "aeroplane airplane airport flight fly abroad airline"),
    ("🚢", "boat ship ferry sail sailing port"),
    ("🌦️", "weather rain rainy cloud cloudy snow snowy storm wind windy sun sunny temperature"),
    ("🌿", "nature plant plants tree flower grass forest countryside environment earth green"),
    ("🏔️", "mountain hill rock climb climbing valley"),
    ("🏖️", "beach sand island coast seaside holiday vacation"),
    ("🌍", "world country countries continent africa asia europe america australia international language nationality"),
    ("🏙️", "city town village street building centre center place area map capital"),
    ("⏰", "time clock hour minute second early late morning afternoon evening night today tomorrow yesterday week month year date calendar"),
    ("👨‍👩‍👧", "family parent parents mother mum mom father dad brother sister uncle aunt cousin grandmother grandfather child children baby"),
    ("👥", "people person man woman boy girl friend friendly neighbour guest group team somebody someone anyone everybody"),
    ("🩺", "health healthy doctor nurse hospital medicine medical ill illness sick pain hurt accident exercise"),
    ("⚽", "sport sports football basketball tennis volleyball golf hockey match game player play competition win winner score"),
    ("🎵", "music song sing singing singer guitar piano concert band radio sound listen listening"),
    ("🎨", "art artist paint painting picture photo photograph camera film movie cinema theatre theater draw drawing"),
    ("💼", "work job office business company manager worker career meeting project"),
    ("💰", "money cash coin price cost pay payment buy sell shop shopping store bank pound dollar euro"),
    ("💬", "speak speaking say tell talk talking conversation communicate communication ask reply discuss explain"),
    ("😊", "happy happiness smile laugh enjoy fun funny pleased glad excited amazing"),
    ("😟", "sad unhappy worried worry afraid fear angry upset bored boring difficult problem"),
    ("❤️", "love like favourite favorite prefer kind care helpful"),
    ("🏆", "success successful achieve achievement goal prize award best excellent improve progress"),
    ("🔢", "number numbers first second third fourth hundred thousand count maths math mathematics"),
    ("🎨", "colour color red blue green yellow black white brown grey gray pink purple"),
    ("🧭", "north south east west left right above below under over between across behind beside near far direction"),
]

ZH_EMOJI = [
    ("🐾", "动物 宠物 狗 猫 兔 马 牛 羊 猪 老虎 狮子 大象"),
    ("🍽️", "食物 餐 早餐 午餐 晚餐 吃 美味 厨房 饭店"),
    ("🏠", "家 房间 房屋 公寓 家具"),
    ("🏫", "学校 学生 老师 课程 考试 教育"),
    ("🚗", "汽车 驾驶 道路 交通"), ("✈️", "飞机 机场 航班"),
    ("🌦️", "天气 雨 云 雪 风 阳光"), ("🌿", "自然 环境 植物 树 花"),
    ("🩺", "健康 医生 医院 药 疾病"), ("💰", "钱 价格 费用 购买 商店 银行"),
    ("⚽", "运动 比赛 足球 篮球 网球"), ("💬", "说 交流 讨论 回答 问题"),
]

ROOT_TRANSLATIONS = {
    "without": "没有；无", "full of": "充满……的", "not": "不；否定",
    "again": "再次", "back": "向后；返回", "before": "在前；之前",
    "after": "在后；之后", "two": "二；双", "one": "一；单",
    "many": "多", "small": "小", "large": "大", "write": "写",
    "see": "看", "hear": "听", "speak": "说", "life": "生命",
    "man, human": "人；人类", "earth": "土地；地球", "water": "水",
    "with, together with": "一起；共同", "against": "反对；相对",
}


# A handful of lines in the official B1 PDF are visually correct but its text
# layer overlaps a headword with the preceding example or splits two headwords
# across one line. Keep these source-backed repairs explicit and reviewable.
KNOWN_PDF_REPAIRS: dict[str, list[dict[str, Any]]] = {
    "ket": [],
    "pet": [
        {"headword": "border", "pos": ["n"], "page": 7},
        {"headword": "common", "pos": ["adj"], "page": 9, "column": 2,
         "examples": ["a common surname", "have something in common"]},
        {"headword": "communicate", "pos": ["v"], "page": 9, "column": 2},
        {"headword": "digital camera", "pos": ["n"], "page": 11, "column": 2},
        {"headword": "dinosaur", "pos": ["n"], "page": 11, "column": 2},
        {"headword": "diploma", "pos": ["n"], "page": 11, "column": 2},
        {"headword": "directly", "pos": ["adv"], "page": 11, "column": 2},
        {"headword": "driver's licence", "pos": ["n"], "page": 12, "column": 2,
         "aliases": ["driver's license"]},
        {"headword": "engaged", "pos": ["adj"], "page": 13,
         "examples": ["to be engaged to someone", "The phone was engaged."]},
        {"headword": "fantastic", "pos": ["adj"], "page": 14},
        {"headword": "farm", "pos": ["n"], "page": 14},
        {"headword": "generation", "pos": ["n"], "page": 15, "column": 2},
        {"headword": "get back", "pos": ["phr v"], "page": 15, "column": 2,
         "examples": ["When did you get back from New York?"]},
        {"headword": "get on", "pos": ["phr v"], "page": 15, "column": 2,
         "examples": ["Get your coat on and then we can leave.", "How are you getting on now?"]},
        {"headword": "give way", "pos": ["phr v"], "page": 16,
         "examples": ["You must give way to traffic at a roundabout."]},
        {"headword": "goal", "pos": ["n"], "page": 16},
        {"headword": "gold", "pos": ["adj & n"], "page": 16},
        {"headword": "grab", "pos": ["v"], "page": 16, "column": 2,
         "examples": ["He grabbed my bag and ran away."]},
        {"headword": "grade", "pos": ["n"], "page": 16, "column": 2},
        {"headword": "truck", "pos": ["n"], "page": 36, "column": 2, "aliases": ["lorry"]},
    ],
}

EXPECTED_SOURCE_COUNTS = {"ket": 1811, "pet": 3225}
EXPECTED_CARD_COUNTS = {"ket": 1802, "pet": 3222}


def compact_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def is_pos(value: str) -> bool:
    tokens = re.findall(r"[A-Za-z]+", value.lower())
    return bool(tokens) and all(token in POS_WORDS for token in tokens)


def parse_entry_line(line: str) -> tuple[str, str] | None:
    for match in re.finditer(r"\(([^()]*)\)", line):
        candidate = compact_space(match.group(1).split(" - ", 1)[0])
        if not is_pos(candidate):
            continue
        headword = compact_space(line[: match.start()])
        if candidate.casefold() == "ad":
            candidate = "adv"
        return (headword, candidate) if headword else None
    return None


def parse_cambridge_pdf(path: Path, level: str) -> tuple[list[dict[str, Any]], list[str]]:
    start_page, end_page = SOURCES[level]["pages"]
    parsed: list[dict[str, Any]] = []
    anomalies: list[str] = []
    current: dict[str, Any] | None = None
    current_example: int | None = None
    current_example_indent: int | None = None
    pending_headword: tuple[str, int, int] | None = None

    with pdfplumber.open(path) as pdf:
        for page_number in range(start_page, end_page + 1):
            page = pdf.pages[page_number - 1]
            columns = [
                (35, 45, page.width / 2, 780),
                (page.width / 2, 45, page.width - 35, 780),
            ]
            for column_number, bbox in enumerate(columns, 1):
                text = page.crop(bbox).extract_text(layout=True, x_tolerance=2, y_tolerance=3) or ""
                for raw in text.splitlines():
                    if not raw.strip():
                        continue
                    indent = len(raw) - len(raw.lstrip(" "))
                    line = compact_space(raw.replace("–", "-").replace("’", "'"))
                    if line.startswith("©") or re.match(r"^(?:\d+\s+)?of \d+\b", line):
                        continue
                    if re.fullmatch(r"[A-Z]", line):
                        current_example = None
                        current_example_indent = None
                        pending_headword = None
                        continue
                    if "•" in line:
                        example = compact_space(line.split("•", 1)[1])
                        if current and example:
                            current["examples"].append(example)
                            current_example = len(current["examples"]) - 1
                            current_example_indent = indent
                        continue
                    # Wrapped example text is indented farther than its bullet. A
                    # new headword can share the bullet's indentation, so using
                    # >= here swallowed whole runs of valid entries (notably the
                    # PET call/calm/camp sequence on page 8).
                    if current is not None and current_example is not None and current_example_indent is not None and indent > current_example_indent:
                        current["examples"][current_example] = compact_space(
                            current["examples"][current_example] + " " + line
                        )
                        continue
                    if pending_headword and re.match(r"^\([^()]+\)", line):
                        combined = f"{pending_headword[0]} {line}"
                        entry = parse_entry_line(combined)
                        if entry:
                            headword, pos = entry
                            current = {
                                "headword": headword, "pos": [pos], "examples": [],
                                "source_refs": [{"page": pending_headword[1], "column": pending_headword[2]}],
                                "section": "alphabetical",
                            }
                            parsed.append(current)
                            current_example = None
                            current_example_indent = None
                            pending_headword = None
                            continue
                    entry = parse_entry_line(line)
                    if entry:
                        headword, pos = entry
                        current = {
                            "headword": headword,
                            "pos": [pos],
                            "examples": [],
                            "source_refs": [{"page": page_number, "column": column_number}],
                            "section": "alphabetical",
                        }
                        parsed.append(current)
                        current_example = None
                        current_example_indent = None
                        pending_headword = None
                        continue
                    if line.lower() in {"go shopping", "film star"}:
                        current = {
                            "headword": line, "pos": ["phr v" if line.lower() == "go shopping" else "n"], "examples": [],
                            "source_refs": [{"page": page_number, "column": column_number}],
                            "section": "alphabetical",
                        }
                        parsed.append(current)
                        current_example = None
                        current_example_indent = None
                        pending_headword = None
                        continue
                    if re.search(r"[A-Za-z]", line) and not line.endswith((".", ":")):
                        pending_headword = (line, page_number, column_number)
                    anomalies.append(f"p{page_number} c{column_number}: {line}")

    merged: dict[str, dict[str, Any]] = {}
    for entry in parsed:
        key = compact_space(entry["headword"]).casefold()
        if key not in merged:
            merged[key] = entry
            continue
        existing = merged[key]
        existing["pos"] = list(dict.fromkeys(existing["pos"] + entry["pos"]))
        existing["examples"] = list(dict.fromkeys(existing["examples"] + entry["examples"]))
        existing["source_refs"].extend(entry["source_refs"])

    entries = list(merged.values())

    # `license)` is the orphaned second line of "driver's licence ...
    # driver's license)" and is not an actual headword. Page 11's orphaned
    # `camera (n)` belongs to "digital camera", not the earlier standalone
    # camera entry.
    if level == "pet":
        entries = [item for item in entries if item["headword"].casefold() != "license)"]
        for item in entries:
            if item["headword"].casefold() == "camera":
                item["source_refs"] = [
                    ref for ref in item["source_refs"]
                    if not (ref["page"] == 11 and ref["column"] == 2)
                ]

    by_key = {compact_space(item["headword"]).casefold(): item for item in entries}
    for repair in KNOWN_PDF_REPAIRS[level]:
        key = compact_space(repair["headword"]).casefold()
        item = by_key.get(key)
        if item is None:
            item = {
                "headword": repair["headword"], "pos": [], "examples": [],
                "source_refs": [], "section": "alphabetical",
            }
            entries.append(item)
            by_key[key] = item
        item["pos"] = list(dict.fromkeys(item["pos"] + repair.get("pos", [])))
        item["examples"] = list(dict.fromkeys(item["examples"] + repair.get("examples", [])))
        source_ref = {"page": repair["page"], "column": repair.get("column", 1)}
        if source_ref not in item["source_refs"]:
            item["source_refs"].append(source_ref)
        if repair.get("aliases"):
            item["aliases"] = list(dict.fromkeys(item.get("aliases", []) + repair["aliases"]))

    if level == "pet":
        # When a repaired headword was glued to the preceding bullet, the old
        # parser also left the headword marker and subsequent examples on the
        # previous entry. Strip the marker, then move known examples to their
        # repaired owner instead of showing misleading cards.
        repaired_examples = {
            compact_space(example).casefold(): compact_space(repair["headword"]).casefold()
            for repair in KNOWN_PDF_REPAIRS[level]
            for example in repair.get("examples", [])
        }
        marker_patterns = [
            re.compile(
                rf"\s+{re.escape(repair['headword'])}\s*"
                r"\((?:abbrev|ad|adj|adv|av|conj|det|exclam|mv|n|number|phr|pl|prep|pron|sing|unc|v)[^)]*\)\s*$",
                re.I,
            )
            for repair in sorted(KNOWN_PDF_REPAIRS[level], key=lambda item: -len(item["headword"]))
        ]
        for item in entries:
            owner = compact_space(item["headword"]).casefold()
            cleaned_examples: list[str] = []
            for example in item["examples"]:
                cleaned = compact_space(example)
                for pattern in marker_patterns:
                    cleaned = compact_space(pattern.sub("", cleaned))
                intended_owner = repaired_examples.get(cleaned.casefold())
                if intended_owner and intended_owner != owner:
                    continue
                if cleaned and cleaned not in cleaned_examples:
                    cleaned_examples.append(cleaned)
            item["examples"] = cleaned_examples

    entries.sort(key=lambda item: item["headword"].casefold())
    return entries, anomalies


ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"]
TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
ORDINALS = [
    "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
    "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth",
    "eighteenth", "nineteenth", "twentieth", "twenty-first", "twenty-second", "twenty-third",
    "twenty-fourth", "twenty-fifth", "twenty-sixth", "twenty-seventh", "twenty-eighth",
    "twenty-ninth", "thirtieth", "thirty-first",
]
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
SEASONS = ["spring", "summer", "autumn", "winter"]
CONTINENTS = ["Africa", "Antarctica", "Asia", "Australia", "Europe", "North America", "South America"]
COUNTRY_FORMS = [
    "Brazil", "Brazilian", "Canada", "Canadian", "China", "Chinese", "France", "French",
    "Ireland", "Irish", "India", "Indian", "Italy", "Italian", "Spain", "Spanish",
    "Britain", "British", "England", "English", "Scotland", "Scottish", "Wales", "Welsh",
]


def add_appendix_entries(entries: list[dict[str, Any]], level: str) -> list[str]:
    words = ONES + TEENS + TENS + ["hundred", "thousand"] + ORDINALS + DAYS + MONTHS + SEASONS + CONTINENTS + COUNTRY_FORMS
    existing = {compact_space(item["headword"]).casefold() for item in entries}
    added: list[str] = []
    for word in words:
        if word.casefold() in existing:
            continue
        pos = "number" if word.casefold() in {item.casefold() for item in ONES + TEENS + TENS + ["hundred", "thousand"] + ORDINALS} else "n"
        entries.append({
            "headword": word, "pos": [pos], "examples": [],
            "source_refs": [{"page": 24 if level == "ket" else 41, "column": 1}],
            "section": "appendix-1",
        })
        existing.add(word.casefold())
        added.append(word)
    entries.sort(key=lambda item: item["headword"].casefold())
    return added


FORM_OVERRIDES = {
    # Slash notation with shared words or Cambridge grammar placeholders.
    "a/an": ["a", "an"],
    "all right/alright": ["all right", "alright"],
    "at / @": ["at", "@"],
    "centimetre/centimeter (cm)": ["centimetre", "centimeter", "cm"],
    "deal with (sth/sb)": ["deal with"],
    "depend (on/upon)": ["depend on", "depend upon"],
    "driving/driver's licence": ["driving licence", "driver's licence"],
    "focus (sth) on/upon sth/sb": ["focus on", "focus upon"],
    "give somebody a call/ring": ["give somebody a call", "give somebody a ring"],
    "go (with/together)": ["go with", "go together"],
    "impressed (by/with)": ["impressed by", "impressed with"],
    "made of/from/out of": ["made of", "made from", "made out of"],
    "poor thing/you": ["poor thing", "poor you"],
    "step forward/back(wards)/out": ["step forward", "step back", "step backwards", "step out"],
    "step over/in/on/out of (sth)": ["step over", "step in", "step on", "step out of"],

    # Parentheses in the source are labels, optional complements or aliases;
    # none should become characters Kevin is asked to spell.
    "ad (advertisement)": ["ad", "advertisement"],
    "among (amongst)": ["among", "amongst"],
    "as well (as)": ["as well", "as well as"],
    "background (experience)": ["background"],
    "certainly (not)": ["certainly", "certainly not"],
    "centimetre (cm)": ["centimetre", "centimeter", "cm"],
    "cv (curriculum vitae)": ["CV", "Curriculum Vitae"],
    "design (drawing)": ["design"],
    "design (planning)": ["design"],
    "design (process)": ["design"],
    "disc jockey (dj)": ["disc jockey", "DJ"],
    "dj (disc jockey)": ["DJ", "disc jockey"],
    "familiar (with)": ["familiar", "familiar with"],
    "folder (computer)": ["folder"],
    "follow (social media)": ["follow"],
    "get along (with)": ["get along", "get along with"],
    "get on (with)": ["get on with", "get on"],
    "identity card (id)": ["identity card", "ID"],
    "instead (of)": ["instead", "instead of"],
    "it (information technology)": ["IT", "Information Technology"],
    "kilogramme (kg)": ["kilogramme", "kilogram", "kg"],
    "kilometre (km)": ["kilometre", "kilometer", "km"],
    "laboratory (lab)": ["laboratory", "lab"],
    "laptop (computer)": ["laptop", "laptop computer"],
    "lead (to)": ["lead", "lead to"],
    "link (technology)": ["link"],
    "listen (to)": ["listen", "listen to"],
    "make sure (that)": ["make sure", "make sure that"],
    "millimetre (mm)": ["millimetre", "millimeter", "mm"],
    "mobile (phone)": ["mobile phone", "mobile"],
    "natural (not artificial)": ["natural"],
    "of course (not)": ["of course", "of course not"],
    "pc (personal computer)": ["PC", "personal computer"],
    "perform (entertain)": ["perform"],
    "performance (entertainment)": ["performance"],
    "pound (£)": ["pound", "£"],
    "properly (as in working properly)": ["properly"],
    "railway (station)": ["railway", "railway station"],
    "relax (become happy)": ["relax"],
    "rely (on)": ["rely", "rely on"],
    "share (digitally)": ["share"],
    "smart (clever)": ["smart"],
    "smart (stylish)": ["smart"],
    "take part (in)": ["take part", "take part in"],
    "television (tv)": ["television", "TV"],
    "tip (advice)": ["tip"],
    "train (transitive and intransitive)": ["train"],
    "training (transitive and intransitive)": ["training"],
    "tune (music)": ["tune"],
    "will ('ll)": ["will", "'ll"],
    "wrap (up)": ["wrap", "wrap up"],
}


# ECDICT is intentionally broad, so short function words and abbreviations can
# otherwise select an unrelated homograph (for example "at" as a Lao coin or
# "US" as the country). These high-frequency Cambridge senses are explicit.
MEANING_OVERRIDES: dict[str, dict[str, str]] = {
    "a/an": {"en": "used before a singular noun to mean one or any", "zh": "一（个）；任何一个", "ipa": "/ə; eɪ/"},
    "an": {"en": "used before a singular noun beginning with a vowel sound", "zh": "一（个，用于元音音素前）", "ipa": "/ən; æn/"},
    "at": {"en": "used to show a place, time, direction or target", "zh": "在；于；向；对", "ipa": "/æt/"},
    "at / @": {"en": "at; also the @ symbol used in email addresses", "zh": "在；位于；电子邮件地址中的 @ 符号", "ipa": "/æt/"},
    "as": {"en": "in the role of; while; because; in the same way", "zh": "作为；当……时；因为；像……一样", "ipa": "/æz; əz/"},
    "or": {"en": "used to connect alternatives or possibilities", "zh": "或者；还是；否则", "ipa": "/ɔː; ər/"},
    "who": {"en": "used to ask or say which person", "zh": "谁；……的人", "ipa": "/huː/"},
    "may": {"en": "used to express possibility or permission; also the fifth month", "zh": "可能；可以；五月", "ipa": "/meɪ/"},
    "must": {"en": "used to say something is necessary or certainly true", "zh": "必须；一定", "ipa": "/mʌst/"},
    "will": {"en": "used for the future, willingness or intention", "zh": "将；会；愿意", "ipa": "/wɪl/"},
    "will ('ll)": {"en": "used for the future, willingness or intention", "zh": "将；会；愿意", "ipa": "/wɪl/"},
    "can": {"en": "to be able or allowed to; also a metal container", "zh": "能；可以；罐头或金属罐", "ipa": "/kæn; kən/"},
    "a.m.": {"en": "after midnight and before noon", "zh": "上午；午前", "ipa": "/ˌeɪ ˈem/"},
    "p.m.": {"en": "after noon and before midnight", "zh": "下午；午后", "ipa": "/ˌpiː ˈem/"},
    "mr": {"en": "a title used before a man's name", "zh": "先生", "ipa": "/ˈmɪstə(r)/"},
    "mrs": {"en": "a title used before a married woman's name", "zh": "夫人；太太", "ipa": "/ˈmɪsɪz/"},
    "ms": {"en": "a title used before a woman's name", "zh": "女士", "ipa": "/mɪz/"},
    "dr": {"en": "a title for a doctor", "zh": "医生；博士（称谓）", "ipa": "/ˈdɒktə(r)/"},
    "dr / doctor": {"en": "a person trained to treat illness; the title Dr", "zh": "医生；博士；Dr 称谓", "ipa": "/ˈdɒktə(r)/"},
    "doctor / dr": {"en": "a person trained to treat illness; the title Dr", "zh": "医生；博士；Dr 称谓", "ipa": "/ˈdɒktə(r)/"},
    "ok": {"en": "all right; acceptable; used to agree", "zh": "好；可以；没问题", "ipa": "/ˌəʊˈkeɪ/"},
    "ok/okay": {"en": "all right; acceptable; used to agree", "zh": "好；可以；没问题", "ipa": "/ˌəʊˈkeɪ/"},
    "ok / o.k. / okay": {"en": "all right; acceptable; used to agree", "zh": "好；可以；没问题", "ipa": "/ˌəʊˈkeɪ/"},
    "us": {"en": "the object form of we", "zh": "我们（we 的宾格）", "ipa": "/ʌs; əs/"},
    "it": {"en": "used to refer to a thing, animal, situation or idea", "zh": "它；这件事；这种情况", "ipa": "/ɪt/"},
    "it (information technology)": {"en": "information technology: computers and digital systems", "zh": "信息技术", "ipa": "/ˌaɪ ˈtiː/"},
}


def variants_for(headword: str, aliases: Iterable[str] = ()) -> list[str]:
    text = compact_space(headword.replace("’", "'"))
    override = FORM_OVERRIDES.get(text.casefold())
    if override is not None:
        forms = list(override)
    else:
        forms = [text]

        # Attached parentheses express optional spelling letters: blond(e),
        # photo(graph), yog(h)urt, program(me), traffic light(s), etc.
        match = re.search(r"(?<=[A-Za-z])\(([A-Za-z]+)\)", text)
        if match:
            forms = [
                compact_space(text[: match.start()] + text[match.end() :]),
                compact_space(text[: match.start()] + match.group(1) + text[match.end() :]),
            ]
        elif re.search(r"\([^()]+\)", text):
            # Unknown parenthetical text is a source sense/usage label. Preserve
            # it in officialHeadword but never make it part of the spelling.
            forms = [compact_space(re.sub(r"\s*\([^()]+\)", "", text))]
        elif " / " in text:
            forms = [compact_space(part) for part in re.split(r"\s+/\s+", text)]
        elif "/" in text and text.casefold() not in {"and/or", "his/her"}:
            forms = [compact_space(part) for part in text.split("/")]

    forms.extend(compact_space(alias.replace("’", "'")) for alias in aliases)
    result: list[str] = []
    seen: set[str] = set()
    for form in forms:
        form = compact_space(re.sub(r"\b(?:sth|sb)(?:/(?:sth|sb))*\b", "", form, flags=re.I))
        form = compact_space(form.strip(" )"))
        key = form.casefold()
        if form and key not in seen:
            result.append(form)
            seen.add(key)
    return result or [text]


def strip_key(value: str) -> str:
    return "".join(char for char in value.casefold() if char.isalnum())


def split_field(value: str) -> list[str]:
    return [compact_space(line) for line in re.split(r"\\n|\n", value or "") if compact_space(line)]


def load_ecdict(path: Path, entries_by_level: dict[str, list[dict[str, Any]]]) -> tuple[dict[str, dict[str, str]], dict[str, dict[str, str]]]:
    targets: set[str] = set()
    for entries in entries_by_level.values():
        for entry in entries:
            for form in variants_for(entry["headword"], entry.get("aliases", [])):
                targets.add(form.casefold())
                targets.update(re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", form.casefold()))
    stripped_targets = {strip_key(item) for item in targets if item}
    exact: dict[str, dict[str, str]] = {}
    stripped: dict[str, dict[str, str]] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            key = compact_space(row.get("word", "")).casefold()
            stripped_key = strip_key(key)
            if key not in targets and stripped_key not in stripped_targets:
                continue
            score = sum(bool(row.get(field)) for field in ("phonetic", "definition", "translation"))
            current = exact.get(key)
            if current is None or score > int(current.get("_score", "0")):
                row["_score"] = str(score)
                exact[key] = row
            current_strip = stripped.get(stripped_key)
            if current_strip is None or score > int(current_strip.get("_score", "0")):
                row["_score"] = str(score)
                stripped[stripped_key] = row
    return exact, stripped


def find_record(forms: Iterable[str], exact: dict[str, dict[str, str]], stripped: dict[str, dict[str, str]]) -> dict[str, str] | None:
    for form in forms:
        if form.casefold() in exact:
            return exact[form.casefold()]
    for form in forms:
        if strip_key(form) in stripped:
            return stripped[strip_key(form)]
    return None


def normalize_phonetic(value: str) -> str:
    text = compact_space(value)
    if not text:
        return ""
    replacements = [
        ("i:", "iː"), ("u:", "uː"), ("ɔ:", "ɔː"), ("ɑ:", "ɑː"), ("ә:", "əː"),
        ("әu", "əʊ"), ("ei", "eɪ"), ("ai", "aɪ"), ("au", "aʊ"), ("ɔi", "ɔɪ"),
        ("ә", "ə"), ("^", "ʌ"), ("'", "ˈ"), (":", "ː"),
    ]
    for old, new in replacements:
        text = text.replace(old, new)
    return f"/{text.strip('/')}/"


def wanted_pos(pos_values: list[str]) -> set[str]:
    joined = " ".join(pos_values).lower()
    wanted: set[str] = set()
    if "adj" in joined:
        wanted.update({"a", "s"})
    if "adv" in joined:
        wanted.update({"ad", "r"})
    if re.search(r"\bn\b", joined):
        wanted.add("n")
    if re.search(r"\bv\b", joined) or "phr v" in joined:
        wanted.add("v")
    if "prep" in joined:
        wanted.add("prep")
    if "conj" in joined:
        wanted.add("conj")
    if "pron" in joined:
        wanted.add("pron")
    return wanted


def pick_lines(value: str, pos_values: list[str], maximum: int = 2) -> list[str]:
    lines = [line for line in split_field(value) if not line.startswith("[")]
    desired = wanted_pos(pos_values)

    def prefix(line: str) -> str:
        match = re.match(r"^([a-z]+)\.\s*", line, re.I)
        return match.group(1).lower() if match else ""

    matching = [line for line in lines if prefix(line) in desired]
    selected = matching or lines
    cleaned: list[str] = []
    for line in selected:
        line = re.sub(r"^[a-z]+\.\s*", "", line, flags=re.I)
        if line and line not in cleaned:
            cleaned.append(line)
        if len(cleaned) >= maximum:
            break
    return cleaned


def short_translation(record: dict[str, str] | None, pos: list[str]) -> str:
    if not record:
        return ""
    lines = pick_lines(record.get("translation", ""), pos, 1)
    return lines[0][:180] if lines else ""


def short_definition(record: dict[str, str] | None, pos: list[str]) -> str:
    if not record:
        return ""
    lines = pick_lines(record.get("definition", ""), pos, 2)
    return "; ".join(lines)[:260]


def first_component_meaning(token: str, exact: dict[str, dict[str, str]], stripped: dict[str, dict[str, str]]) -> str:
    record = find_record([token], exact, stripped)
    text = short_translation(record, [])
    return re.split(r"[,;，；]", text)[0][:45] if text else "短语组成"


def fallback_emoji(word: str, zh: str, definition: str, pos: list[str]) -> str:
    haystack = f" {word.casefold()} {definition.casefold()} "
    tokens = set(re.findall(r"[a-z]+", haystack))
    for emoji, keywords in EMOJI_GROUPS:
        if tokens.intersection(keywords.split()):
            return emoji
    for emoji, keywords in ZH_EMOJI:
        if any(keyword in zh for keyword in keywords.split()):
            return emoji
    joined = " ".join(pos).lower()
    if "number" in joined:
        return "🔢"
    if "prep" in joined:
        return "🧭"
    if "conj" in joined:
        return "🔗"
    if "pron" in joined or "det" in joined:
        return "👤"
    if "v" in joined:
        return "🏃"
    if "adj" in joined:
        return "✨"
    if "adv" in joined:
        return "💫"
    return "🧩"


def root_reverse_map(path: Path) -> dict[str, list[dict[str, Any]]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    reverse: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for key, info in raw.items():
        if not isinstance(info, dict):
            continue
        root = re.sub(r"\d+$", "", str(info.get("root") or key)).strip()
        segment = root.strip("-").casefold()
        if not segment or len(segment) < 2:
            continue
        item = {"segment": segment, "root": root, **info}
        for example in info.get("example", []):
            example_key = re.sub(r"\d+$", "", str(example)).casefold()
            reverse[example_key].append(item)
    return reverse


def segment_word(word: str) -> list[str]:
    if len(word) <= 5:
        return [word]
    suffixes = ["isation", "ization", "ation", "tion", "sion", "ment", "ness", "able", "ible", "less", "ful", "ing", "edly", "ly", "ed", "er", "est"]
    for suffix in suffixes:
        if word.casefold().endswith(suffix) and len(word) - len(suffix) >= 3:
            return [word[: -len(suffix)], word[-len(suffix) :]]
    midpoint = len(word) // 2
    boundaries = [index for index in range(2, len(word) - 1) if word[index - 1].lower() in "aeiouy" and word[index].lower() not in "aeiouy"]
    split = min(boundaries, key=lambda index: abs(index - midpoint)) if boundaries else midpoint
    return [word[:split], word[split:]]


def build_breakdown(
    word: str,
    roots: dict[str, list[dict[str, Any]]],
    exact: dict[str, dict[str, str]],
    stripped: dict[str, dict[str, str]],
) -> dict[str, Any]:
    if " " in word:
        tokens = re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", word)
        return {
            "type": "syllable", "label": "短语分块（非词源拆解）",
            "parts": [
                {
                    "text": token,
                    "meaning": first_component_meaning(token, exact, stripped),
                    "say": normalize_phonetic((find_record([token], exact, stripped) or {}).get("phonetic", "")) or token,
                }
                for token in tokens
            ] or [{"text": word, "meaning": "完整短语", "say": word}],
        }

    lower = word.casefold()
    candidates = []
    for info in roots.get(lower, []):
        segment = info["segment"]
        root = info.get("root", "")
        if str(root).startswith("-") and lower.endswith(segment):
            position = len(lower) - len(segment)
        elif str(root).endswith("-") and lower.startswith(segment):
            position = 0
        else:
            position = lower.find(segment)
        if position >= 0:
            candidates.append((position, position + len(segment), info))
    selected = []
    occupied: set[int] = set()
    for start, end, info in sorted(candidates, key=lambda item: (-(item[1] - item[0]), item[0])):
        if any(index in occupied for index in range(start, end)):
            continue
        selected.append((start, end, info))
        occupied.update(range(start, end))
        if len(selected) >= 3:
            break
    selected.sort(key=lambda item: item[0])

    if selected:
        parts = []
        cursor = 0
        for start, end, info in selected:
            if start > cursor:
                gap = word[cursor:start]
                parts.append({"text": gap, "meaning": "词干 / 拼写主体", "say": gap})
            meaning = compact_space(str(info.get("meaning", "词根或词缀")))
            translated = ROOT_TRANSLATIONS.get(meaning.casefold(), meaning)
            segment = word[start:end]
            parts.append({"text": segment, "meaning": translated[:80], "say": segment})
            cursor = end
        if cursor < len(word):
            gap = word[cursor:]
            parts.append({"text": gap, "meaning": "词干 / 拼写主体", "say": gap})
        return {"type": "root", "label": "词根 / 词缀提示", "parts": parts}

    chunks = segment_word(word)
    return {
        "type": "syllable", "label": "拼写分块（非词源拆解）",
        "parts": [{"text": chunk, "meaning": f"拼写块 {index + 1}", "say": chunk} for index, chunk in enumerate(chunks)],
    }


def make_id(level: str, headword: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", headword.casefold()).strip("-") or "item"
    digest = hashlib.sha1(headword.casefold().encode("utf-8")).hexdigest()[:7]
    return f"{level}-official-{slug[:48]}-{digest}"


def enrich_entry(
    entry: dict[str, Any],
    level: str,
    exact: dict[str, dict[str, str]],
    stripped: dict[str, dict[str, str]],
    roots: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    forms = variants_for(entry["headword"], entry.get("aliases", []))
    canonical = forms[0]
    record = find_record(forms, exact, stripped)
    definition = short_definition(record, entry["pos"])
    translation = short_translation(record, entry["pos"])
    if not translation and " " in canonical:
        pieces = [first_component_meaning(token, exact, stripped) for token in re.findall(r"[A-Za-z]+", canonical)]
        translation = " + ".join(piece for piece in pieces if piece and piece != "短语组成")[:180]
    meaning_override = MEANING_OVERRIDES.get(compact_space(entry["headword"]).casefold())
    if meaning_override:
        definition = meaning_override["en"]
        translation = meaning_override["zh"]
    missing_definition = not bool(definition)
    missing_translation = not bool(translation)
    definition = definition or f"An official Cambridge {SOURCES[level]['cefr']} vocabulary word or phrase."
    translation = translation or f"Cambridge {SOURCES[level]['cefr']} 官方词表词条（释义待补充）"

    phonetic = meaning_override.get("ipa", "") if meaning_override else normalize_phonetic((record or {}).get("phonetic", ""))
    if not phonetic and " " in canonical:
        component_phonetics = []
        for token in re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", canonical):
            token_record = find_record([token], exact, stripped)
            raw = (token_record or {}).get("phonetic", "")
            if raw:
                component_phonetics.append(normalize_phonetic(raw).strip("/"))
        if component_phonetics:
            phonetic = f"/{' '.join(component_phonetics)}/"

    digest = int(hashlib.sha1(canonical.casefold().encode("utf-8")).hexdigest()[:8], 16)
    color1, color2 = PALETTES[digest % len(PALETTES)]
    emoji = fallback_emoji(canonical, translation, definition, entry["pos"])
    example = entry["examples"][0] if entry["examples"] else ""
    source_pages = sorted({ref["page"] for ref in entry["source_refs"]})
    breakdown = build_breakdown(canonical, roots, exact, stripped)

    if " " in canonical:
        tip = f"把短语分成 {len(breakdown['parts'])} 块，按顺序边读边拼。"
    elif breakdown["type"] == "root":
        tip = "先认词根或词缀，再把剩余词干像积木一样拼回去。"
    else:
        tip = "按拼写块慢读一遍，再合起来写完整。"

    return {
        "id": make_id(level, entry["headword"]),
        "word": canonical,
        "acceptedAnswers": forms[1:],
        "officialHeadword": entry["headword"],
        "official": True,
        "officialSource": f"Cambridge {SOURCES[level]['cefr']} Vocabulary List, August 2025",
        "sourcePages": source_pages,
        "pos": entry["pos"],
        "ipa": phonetic or "/—/",
        "en": definition,
        "zh": translation,
        "example": example,
        "exampleZh": "",
        "tip": tip,
        "visual": {
            "emoji": emoji,
            "scene": f"A memory picture for {canonical}: {definition}",
            "color1": color1,
            "color2": color2,
        },
        "breakdown": breakdown,
        "dataQuality": {
            "missingEnglishDefinition": missing_definition,
            "missingChineseTranslation": missing_translation,
            "missingPhonetic": not bool(phonetic),
        },
    }


def merge_same_spelling_cards(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Merge source sense labels that produce the exact same spelling task."""

    merged: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for item in items:
        key = compact_space(item["word"])
        if key not in merged:
            item["officialHeadwords"] = [item["officialHeadword"]]
            merged[key] = item
            order.append(key)
            continue
        target = merged[key]
        target["officialHeadwords"] = list(dict.fromkeys(
            target.get("officialHeadwords", [target["officialHeadword"]]) + [item["officialHeadword"]]
        ))
        target["acceptedAnswers"] = list(dict.fromkeys(
            target.get("acceptedAnswers", []) + item.get("acceptedAnswers", [])
        ))
        target["pos"] = list(dict.fromkeys(target.get("pos", []) + item.get("pos", [])))
        target["sourcePages"] = sorted(set(target.get("sourcePages", []) + item.get("sourcePages", [])))
        if not target.get("example") and item.get("example"):
            target["example"] = item["example"]
        for flag in ("missingEnglishDefinition", "missingChineseTranslation", "missingPhonetic"):
            target["dataQuality"][flag] = bool(
                target["dataQuality"].get(flag) and item["dataQuality"].get(flag)
            )
        if target["ipa"] == "/—/" and item["ipa"] != "/—/":
            target["ipa"] = item["ipa"]
        if target["dataQuality"]["missingEnglishDefinition"] is False and item["dataQuality"]["missingEnglishDefinition"] is False:
            if target["en"].startswith("An official Cambridge") and not item["en"].startswith("An official Cambridge"):
                target["en"] = item["en"]
        if target["dataQuality"]["missingChineseTranslation"] is False and item["dataQuality"]["missingChineseTranslation"] is False:
            if "释义待补充" in target["zh"] and "释义待补充" not in item["zh"]:
                target["zh"] = item["zh"]
    return [merged[key] for key in order]


def validate_generated_banks(
    source_entries: dict[str, list[dict[str, Any]]],
    banks: dict[str, list[dict[str, Any]]],
) -> None:
    source_counts = {level: len(items) for level, items in source_entries.items()}
    card_counts = {level: len(items) for level, items in banks.items()}
    if source_counts != EXPECTED_SOURCE_COUNTS:
        raise ValueError(f"Unexpected repaired source counts: {source_counts}")
    if card_counts != EXPECTED_CARD_COUNTS:
        raise ValueError(f"Unexpected unique spelling-card counts: {card_counts}")

    pet_heads = {item["headword"].casefold() for item in source_entries["pet"]}
    required_repairs = {item["headword"].casefold() for item in KNOWN_PDF_REPAIRS["pet"]}
    missing = sorted(required_repairs - pet_heads)
    if missing or "license)" in pet_heads:
        raise ValueError(f"PET repair invariant failed; missing={missing}")

    ids: set[str] = set()
    for level, items in banks.items():
        spellings: set[str] = set()
        for item in items:
            if item["id"] in ids:
                raise ValueError(f"Duplicate generated id: {item['id']}")
            ids.add(item["id"])
            if item["word"] in spellings:
                raise ValueError(f"Duplicate {level} spelling card: {item['word']}")
            spellings.add(item["word"])
            forms = [item["word"], *item.get("acceptedAnswers", [])]
            if any(re.search(r"[()]|\b(?:sth|sb)\b", form, re.I) for form in forms):
                raise ValueError(f"Unclean spelling form for {item['officialHeadword']}: {forms}")
            if not all(item.get(field) for field in ("word", "en", "zh", "visual", "breakdown")):
                raise ValueError(f"Missing required card field: {item['officialHeadword']}")


def write_javascript(path: Path, banks: dict[str, list[dict[str, Any]]], metadata: dict[str, Any]) -> None:
    payload = json.dumps(banks, ensure_ascii=False, separators=(",", ":"))
    meta = json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))
    script = f'''(() => {{
  "use strict";
  const officialBanks = {payload};
  const normalize = (value) => String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\\s+/g, " ");
  for (const [bankKey, officialEntries] of Object.entries(officialBanks)) {{
    const curated = Array.isArray(window.WORD_BANKS?.[bankKey]) ? window.WORD_BANKS[bankKey] : [];
    const curatedByForm = new Map();
    for (const item of curated) {{
      curatedByForm.set(normalize(item.word), item);
      for (const alias of item.acceptedAnswers || []) curatedByForm.set(normalize(alias), item);
    }}
    const merged = officialEntries.map((item) => {{
      const candidates = [item.word, ...(item.acceptedAnswers || [])].map(normalize);
      const rich = candidates.map((candidate) => curatedByForm.get(candidate)).find(Boolean);
      if (!rich) return item;
      return {{
        ...item,
        ...rich,
        official: true,
        officialHeadword: item.officialHeadword,
        officialSource: item.officialSource,
        sourcePages: item.sourcePages,
        pos: item.pos,
        acceptedAnswers: [...new Set([...(item.acceptedAnswers || []), ...(rich.acceptedAnswers || [])])],
        dataQuality: item.dataQuality
      }};
    }});
    window.WORD_BANKS[bankKey] = merged;
  }}
  window.WORD_LIST_META = {meta};
}})();
'''
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(script, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ket-pdf", type=Path, required=True)
    parser.add_argument("--pet-pdf", type=Path, required=True)
    parser.add_argument("--ecdict", type=Path, required=True)
    parser.add_argument("--wordroots", type=Path, required=True)
    parser.add_argument("--output-js", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    entries_by_level: dict[str, list[dict[str, Any]]] = {}
    anomalies_by_level: dict[str, list[str]] = {}
    appendix_added: dict[str, list[str]] = {}
    for level, pdf_path in (("ket", args.ket_pdf), ("pet", args.pet_pdf)):
        entries, anomalies = parse_cambridge_pdf(pdf_path, level)
        appendix_added[level] = add_appendix_entries(entries, level)
        entries_by_level[level] = entries
        anomalies_by_level[level] = anomalies

    exact, stripped = load_ecdict(args.ecdict, entries_by_level)
    roots = root_reverse_map(args.wordroots)
    source_banks = {
        level: [enrich_entry(entry, level, exact, stripped, roots) for entry in entries]
        for level, entries in entries_by_level.items()
    }
    banks = {
        level: merge_same_spelling_cards(items)
        for level, items in source_banks.items()
    }
    validate_generated_banks(entries_by_level, banks)

    metadata = {
        "generatedAt": "2026-07-14",
        "sources": SOURCES,
        "counts": {level: len(entries) for level, entries in banks.items()},
        "sourceEntryCounts": {level: len(entries) for level, entries in source_banks.items()},
        "appendixAdded": {level: len(items) for level, items in appendix_added.items()},
        "membershipSource": "Cambridge English official August 2025 vocabulary lists",
        "enrichmentSource": "ECDICT (MIT)",
    }
    write_javascript(args.output_js, banks, metadata)

    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps({"metadata": metadata, "entries": entries_by_level}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    lines = ["# Cambridge 2025 vocabulary import report", ""]
    for level in ("ket", "pet"):
        quality = Counter()
        phrase_count = 0
        for item in banks[level]:
            phrase_count += int(" " in item["word"])
            for key, missing in item["dataQuality"].items():
                quality[key] += int(missing)
        alphabet = Counter(item["word"][:1].upper() for item in banks[level] if item["word"])
        lines.extend([
            f"## {level.upper()}", "",
            f"- Official source entries after PDF repair and appendix expansion: {len(source_banks[level])}",
            f"- Unique spelling cards after merging same-spelling sense labels: {len(banks[level])}",
            f"- Multi-word phrases: {phrase_count}",
            f"- Appendix additions not already alphabetical: {len(appendix_added[level])}",
            f"- Missing phonetic: {quality['missingPhonetic']}",
            f"- Missing English definition: {quality['missingEnglishDefinition']}",
            f"- Missing Chinese translation: {quality['missingChineseTranslation']}",
            f"- A-Z distribution: {dict(sorted(alphabet.items()))}",
            f"- Source-backed PDF layout repairs applied: {len(KNOWN_PDF_REPAIRS[level])}",
            f"- Reviewed text-layer continuation fragments: {len(anomalies_by_level[level])}", "",
            "The continuation fragments below are PDF text-layer artifacts (variant endings, wrapped examples, or split POS labels); corresponding source items were reviewed and retained/repaired.", "",
            "### Reviewed fragment sample", "",
            *[f"- `{line}`" for line in anomalies_by_level[level][:40]], "",
        ])
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
