#!/usr/bin/env python3
"""Build the image-backed Movers bank from the user-provided 2025 PDF.

The first 40 pages contain one embedded image for every numbered word row.
Pages 41–48 contain a phrase appendix without images; those phrases are kept
in the audit JSON but are not mixed into the image-learning bank.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

import pdfplumber
from pypdf import PdfReader

try:
    from .build_cambridge_wordlists import (
        PALETTES,
        build_breakdown,
        compact_space,
        fallback_emoji,
        find_record,
        load_ecdict,
        normalize_phonetic,
        root_reverse_map,
        variants_for,
    )
except ImportError:
    from build_cambridge_wordlists import (  # type: ignore[no-redef]
        PALETTES,
        build_breakdown,
        compact_space,
        fallback_emoji,
        find_record,
        load_ecdict,
        normalize_phonetic,
        root_reverse_map,
        variants_for,
    )


EXPECTED_WORD_COUNT = 247
EXPECTED_IMAGE_COUNT = 247
EXPECTED_PHRASE_COUNT = 80
EXPECTED_CARD_COUNT = EXPECTED_WORD_COUNT + EXPECTED_PHRASE_COUNT
SOURCE_TITLE = "Movers Word List 2025"
WORD_PAGE_RANGE = range(1, 41)
PHRASE_PAGE_RANGE = range(41, 49)

# The PDF's visible text is correct in these places, but its text layer has
# lost a space. Keep the repairs narrow and explicit so imports stay auditable.
TEXT_LAYER_REPAIRS = {
    "yourselfthere": "yourself there",
    "yourselfafter": "yourself after",
    "ofwire": "of wire",
    "oflarge": "of large",
    "ofsound": "of sound",
    "ofclouds": "of clouds",
    "ofwater": "of water",
    "ofice": "of ice",
    "oflight": "of light",
    "ofwind": "of wind",
    "ofland": "of land",
    "ofthe": "of the",
    "ifyou": "if you",
    "ofyour": "of your",
    "whosejob": "whose job",
    "ofhotness": "of hotness",
    "ofmoving": "of moving",
    "ofcatching": "of catching",
    "ofmusicians": "of musicians",
    "ofboots": "of boots",
    "tojump": "to jump",
    "ofsome": "of some",
    "ofone": "of one",
    "ofpaper": "of paper",
    "roadin": "road in",
    "ofsalt": "of salt",
    "andyou": "and you",
    "ofmeat": "of meat",
    "ofbread": "of bread",
    "offood": "of food",
    "ajuicy": "a juicy",
    "tojoin": "to join",
    "ofclothing": "of clothing",
    "ofoutdoor": "of outdoor",
    "ofhard": "of hard",
    "ofcloth": "of cloth",
    "ofwool": "of wool",
    "ofjewellery": "of jewellery",
    "ofclothes": "of clothes",
    "yourselffrom": "yourself from",
    "ofnoise": "of noise",
    "thejungle": "the jungle",
}

PHRASE_SPELLING_REPAIRS = {
    "shop assisstant/shop keeper": "shop assistant/shop keeper",
}

PHRASE_FORM_OVERRIDES = {
    5: ["shop assistant", "shop keeper", "shopkeeper"],
    42: ["have breakfast", "have lunch"],
    57: ["put on"],
    58: ["take off"],
    80: ["sail for"],
}

TOKEN_IPA_OVERRIDES = {
    "books": "/bʊks/",
    "don't": "/dəʊnt/",
    "friends": "/frendz/",
    "it's": "/ɪts/",
    "let's": "/lets/",
    "website": "/ˈwebsaɪt/",
}

PHRASE_ENGLISH_GLOSSES = {
    1: "inside an animal's cage",
    2: "at a farm that belongs to him",
    3: "amusing books that tell stories with pictures",
    4: "beside or very close to something",
    5: "a person who helps customers in a shop",
    6: "used to ask the price of something",
    7: "before or ahead of someone or something",
    8: "give money in exchange for something",
    9: "take a dog outside for exercise",
    10: "move along while wearing roller skates",
    11: "present at a social celebration",
    12: "more than enough or a large amount",
    13: "enjoying yourself",
    14: "producing a great deal of sound",
    15: "getting to know people and becoming friends",
    16: "cover a gift with decorative paper",
    17: "remove the paper from a gift",
    18: "hope silently for something special",
    19: "on both the upper and lower floors",
    20: "talk informally with friends",
    21: "become fit and well",
    22: "feel pain in your head",
    23: "have liquid coming from your nose",
    24: "feel pain in your stomach",
    25: "check how hot or cold someone is",
    26: "swallow or use medicine to get better",
    27: "feel as if you or the room are spinning",
    28: "used to say that you are unwell",
    29: "used to ask about someone's health or feelings",
    30: "feel pain inside your ear",
    31: "a suggestion to visit or swim at the pool",
    32: "move to a higher floor",
    33: "a map showing streets and places in a city",
    34: "use an elevator to move between floors",
    35: "the location details of a hotel",
    36: "sit down",
    37: "telephone the hotel service that brings things to your room",
    38: "telephone the reception desk at a hotel",
    39: "located on the first floor",
    40: "bring the towel when you leave",
    41: "travel somewhere for a short time",
    42: "eat the morning or midday meal",
    43: "move from one side of a bridge to the other",
    44: "moving on foot through a tropical forest",
    45: "move on ice skates or roller skates",
    46: "stay until a bus arrives",
    47: "a game in which players search for hidden things",
    48: "go upward to the top of a mountain",
    49: "cooperate to complete the same task",
    50: "get away from the city",
    51: "happening during Sunday",
    52: "in a place where sunlight reaches you",
    53: "during the spring season",
    54: "during the hours of darkness",
    55: "at twelve o'clock in the daytime",
    56: "during Saturday and Sunday",
    57: "dress yourself in clothes",
    58: "remove clothes that you are wearing",
    59: "a day with bright sunshine",
    60: "make a person-shaped figure from snow",
    61: "at a train or bus station",
    62: "continue directly ahead without turning",
    63: "learn or read in a library",
    64: "an open public area in the centre of a town",
    65: "arranged in a round shape",
    66: "hold and move with a baby in your arms",
    67: "throw rubbish on the ground",
    68: "a supermarket serving the nearby area",
    69: "beyond the central part of the city",
    70: "a big building containing many shops",
    71: "try to catch fish",
    72: "hit a ball with your foot",
    73: "record moving pictures with a camera or phone",
    74: "compose and send an electronic message",
    75: "send someone a short phone message",
    76: "suddenly begin laughing loudly",
    77: "shown or available on a website",
    78: "jump over or leave something out",
    79: "wear special clothes to look like someone or something",
    80: "travel by boat towards a destination",
}

# ECDICT has no direct entry for these source forms. These are explicit
# British-English display phonetics; browser speech still pronounces the full
# spelling independently.
IPA_OVERRIDES = {
    "grown-up": "/ˌɡrəʊnˈʌp/",
    "stairs": "/steəz/",
    "roller skates": "/ˈrəʊlə skeɪts/",
    "ice skates": "/aɪs skeɪts/",
    "table tennis": "/ˈteɪbəl ˌtenɪs/",
    "website": "/ˈwebsaɪt/",
    "milkshake": "/ˈmɪlkʃeɪk/",
    "noodles": "/ˈnuːdəlz/",
    "go shopping": "/ɡəʊ ˈʃɒpɪŋ/",
    "shoes": "/ʃuːz/",
    "gloves": "/ɡlʌvz/",
    "trainers": "/ˈtreɪnəz/",
}


def clean_text(value: Any) -> str:
    """Collapse layout whitespace and repair known PDF text-layer joins."""

    text = compact_space(str(value or "").replace("’", "'"))
    for old, new in TEXT_LAYER_REPAIRS.items():
        text = re.sub(rf"\b{re.escape(old)}\b", new, text, flags=re.IGNORECASE)
    text = re.sub(r"(?<=[,;:])(?=[A-Za-z])", " ", text)
    return text


def clean_chinese(value: Any) -> str:
    text = compact_space(str(value or ""))
    text = re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", text)
    return text


def split_pos_and_chinese(value: Any) -> tuple[list[str], str]:
    raw = clean_chinese(value)
    match = re.match(r"^(adj|adv|n|v)(?:\s+phrase)?\.\s*", raw, re.IGNORECASE)
    if not match:
        return [], raw
    token = match.group(1).lower()
    pos = ["phr v"] if token == "v" and "phrase" in match.group(0).lower() else [token]
    return pos, raw[match.end() :].strip()


def numeric_rows(page: pdfplumber.page.Page) -> list[list[Any]]:
    rows: list[list[Any]] = []
    for table in page.extract_tables() or []:
        for row in table or []:
            if row and row[0] and str(row[0]).strip().isdigit():
                rows.append(row)
    return rows


def row_meanings(row: list[Any]) -> tuple[str, str]:
    # Most rows are [number, image, word, English, Chinese]. Page 27 has an
    # extra empty column, so select the final two non-empty cells after word.
    meanings = [clean_text(cell) for cell in row[3:] if clean_text(cell)]
    if len(meanings) < 2:
        raise ValueError(f"Could not locate both meanings in row: {row!r}")
    return meanings[-2], clean_chinese(meanings[-1])


def parse_source(pdf_path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, int]]]:
    reader = PdfReader(str(pdf_path))
    words: list[dict[str, Any]] = []
    phrases: list[dict[str, Any]] = []
    page_stats: list[dict[str, int]] = []

    with pdfplumber.open(str(pdf_path)) as pdf:
        if len(pdf.pages) < max(PHRASE_PAGE_RANGE):
            raise ValueError(f"Expected at least 48 pages, found {len(pdf.pages)}")

        current_day: int | None = None
        for page_number in WORD_PAGE_RANGE:
            page = pdf.pages[page_number - 1]
            rows = numeric_rows(page)
            images = list(reader.pages[page_number - 1].images)
            if len(rows) != len(images):
                raise ValueError(
                    f"Page {page_number}: {len(rows)} word rows but {len(images)} images"
                )
            title_text = page.extract_text() or ""
            day_match = re.search(r"Movers\s+Word\s+List\s*-\s*Day\s*(\d+)", title_text, re.I)
            if day_match:
                current_day = int(day_match.group(1))
            if current_day is None:
                raise ValueError(f"Page {page_number}: missing initial Movers day heading")
            day = current_day

            for row_index, (row, image_file) in enumerate(zip(rows, images), start=1):
                source_number = int(str(row[0]).strip())
                headword = clean_text(row[2])
                english, chinese_with_pos = row_meanings(row)
                pos, chinese = split_pos_and_chinese(chinese_with_pos)
                words.append(
                    {
                        "sourceNumber": source_number,
                        "sourcePage": page_number,
                        "sourceRow": row_index,
                        "day": day,
                        "headword": headword,
                        "english": english,
                        "chinese": chinese,
                        "pos": pos,
                        "_image": image_file.image,
                        "_imageName": image_file.name,
                    }
                )
            page_stats.append(
                {"page": page_number, "rows": len(rows), "images": len(images)}
            )

        for page_number in PHRASE_PAGE_RANGE:
            page = pdf.pages[page_number - 1]
            rows = numeric_rows(page)
            image_count = len(reader.pages[page_number - 1].images)
            if image_count:
                raise ValueError(f"Phrase page {page_number} unexpectedly contains images")
            for row in rows:
                source_phrase = clean_text(row[1])
                normalized_phrase = PHRASE_SPELLING_REPAIRS.get(
                    source_phrase.casefold(), source_phrase
                )
                phrases.append(
                    {
                        "sourceNumber": int(str(row[0]).strip()),
                        "sourcePage": page_number,
                        "sourcePhrase": source_phrase,
                        "phrase": normalized_phrase,
                        "zh": clean_chinese(row[-1]),
                    }
                )
            page_stats.append(
                {"page": page_number, "rows": len(rows), "images": image_count}
            )

    return words, phrases, page_stats


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-") or "word"


def save_source_images(words: list[dict[str, Any]], image_dir: Path) -> None:
    image_dir.mkdir(parents=True, exist_ok=True)
    expected_names: set[str] = set()
    for entry in words:
        filename = f"{entry['sourceNumber']:03d}-{slugify(entry['headword'])}.webp"
        expected_names.add(filename)
        output = image_dir / filename
        image = entry.pop("_image")
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA")
        image.save(output, "WEBP", quality=90, method=6)
        entry["imageFilename"] = filename
    for stale in image_dir.glob("*.webp"):
        if stale.name not in expected_names:
            stale.unlink()


def make_id(entry: dict[str, Any]) -> str:
    return (
        f"movers-2025-{entry['sourceNumber']:03d}-"
        f"{slugify(entry['headword'])[:54]}"
    )


def phrase_forms(entry: dict[str, Any]) -> list[str]:
    override = PHRASE_FORM_OVERRIDES.get(entry["sourceNumber"])
    if override:
        return override
    return variants_for(entry["phrase"])


def phrase_phonetic(
    canonical: str,
    forms: list[str],
    exact: dict[str, dict[str, str]],
    stripped: dict[str, dict[str, str]],
) -> str:
    record = find_record(forms, exact, stripped)
    direct = normalize_phonetic((record or {}).get("phonetic", ""))
    if direct:
        return direct
    parts: list[str] = []
    for token in re.findall(r"[A-Za-z]+(?:'[A-Za-z]+)?", canonical):
        phonetic = TOKEN_IPA_OVERRIDES.get(token.casefold())
        if not phonetic:
            token_record = find_record([token], exact, stripped)
            phonetic = normalize_phonetic((token_record or {}).get("phonetic", ""))
        if not phonetic:
            return ""
        parts.append(phonetic.strip("/"))
    return f"/{' '.join(parts)}/" if parts else ""


def load_phrase_image_manifest(
    path: Path, project_root: Path
) -> dict[int, dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    items = payload.get("items", [])
    if len(items) != EXPECTED_PHRASE_COUNT:
        raise ValueError(
            f"Expected {EXPECTED_PHRASE_COUNT} phrase-image attributions, found {len(items)}"
        )
    by_number = {int(item["sourceNumber"]): item for item in items}
    if sorted(by_number) != list(range(1, EXPECTED_PHRASE_COUNT + 1)):
        raise ValueError("Phrase-image manifest must cover source numbers 1–80")
    image_paths = [str(item["image"]) for item in items]
    if len(image_paths) != len(set(image_paths)):
        raise ValueError("Phrase-image manifest contains duplicate local paths")
    for item in items:
        if not all(
            str(item.get(key, "")).strip()
            for key in ("image", "creator", "license", "sourceUrl", "fileTitle")
        ):
            raise ValueError(f"Incomplete phrase-image attribution: {item}")
        if not (project_root / item["image"]).is_file():
            raise FileNotFoundError(project_root / item["image"])
    return by_number


def build_cards(
    words: list[dict[str, Any]],
    phrases: list[dict[str, Any]],
    phrase_images: dict[int, dict[str, Any]],
    ecdict_path: Path,
    wordroots_path: Path,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    lookup_entries = {
        "movers": [
            {"headword": item["headword"], "aliases": []}
            for item in words
        ]
        + [
            {
                "headword": phrase_forms(item)[0],
                "aliases": phrase_forms(item)[1:],
            }
            for item in phrases
        ],
    }
    exact, stripped = load_ecdict(ecdict_path, lookup_entries)
    roots = root_reverse_map(wordroots_path)
    cards: list[dict[str, Any]] = []

    for entry in words:
        forms = variants_for(entry["headword"])
        canonical = forms[0]
        record = find_record(forms, exact, stripped)
        phonetic = IPA_OVERRIDES.get(
            canonical.casefold(),
            normalize_phonetic((record or {}).get("phonetic", "")),
        )
        breakdown = build_breakdown(canonical, roots, exact, stripped)
        digest = int(
            hashlib.sha1(f"movers:{entry['sourceNumber']}".encode()).hexdigest()[:8],
            16,
        )
        color1, color2 = PALETTES[digest % len(PALETTES)]
        emoji = fallback_emoji(
            canonical, entry["chinese"], entry["english"], entry["pos"]
        )
        if " " in canonical:
            tip = f"先按 {len(breakdown['parts'])} 个词块读，再连起来拼写。"
        elif breakdown["type"] == "root":
            tip = "先认词根或词缀，再把剩余词干像积木一样拼回去。"
        else:
            tip = "盯住原图说出意思，再按拼写块慢读一遍。"

        cards.append(
            {
                "id": make_id(entry),
                "word": canonical,
                "acceptedAnswers": forms[1:],
                "sourceHeadword": entry["headword"],
                "sourceDocument": SOURCE_TITLE,
                "sourcePage": entry["sourcePage"],
                "sourceNumber": entry["sourceNumber"],
                "sourceDay": entry["day"],
                "pos": entry["pos"],
                "ipa": phonetic or "/—/",
                "en": entry["english"],
                "zh": entry["chinese"],
                "example": "",
                "exampleZh": "",
                "tip": tip,
                "visual": {
                    "emoji": emoji,
                    "scene": f"{entry['chinese']}：来自上传词表的原图",
                    "color1": color1,
                    "color2": color2,
                    "image": f"assets/movers-images/{entry['imageFilename']}",
                    "source": f"{SOURCE_TITLE} · 第 {entry['sourcePage']} 页",
                },
                "breakdown": breakdown,
                "dataQuality": {
                    "missingEnglishDefinition": False,
                    "missingChineseTranslation": False,
                    "missingPhonetic": not bool(phonetic),
                },
            }
        )
    phrase_cards: list[dict[str, Any]] = []
    for entry in phrases:
        forms = phrase_forms(entry)
        canonical = forms[0]
        phonetic = phrase_phonetic(canonical, forms, exact, stripped)
        breakdown = build_breakdown(canonical, roots, exact, stripped)
        image_source = phrase_images[entry["sourceNumber"]]
        digest = int(
            hashlib.sha1(
                f"movers-phrase:{entry['sourceNumber']}".encode()
            ).hexdigest()[:8],
            16,
        )
        color1, color2 = PALETTES[digest % len(PALETTES)]
        emoji = fallback_emoji(
            canonical,
            entry["zh"],
            PHRASE_ENGLISH_GLOSSES[entry["sourceNumber"]],
            ["phr"],
        )
        phrase_cards.append(
            {
                "id": (
                    f"movers-2025-phrase-{entry['sourceNumber']:03d}-"
                    f"{slugify(canonical)[:48]}"
                ),
                "word": canonical,
                "acceptedAnswers": forms[1:],
                "cardType": "phrase",
                "sourceHeadword": entry["sourcePhrase"],
                "sourceDocument": SOURCE_TITLE,
                "sourcePage": entry["sourcePage"],
                "sourceNumber": entry["sourceNumber"],
                "sourcePart": entry["sourcePage"] - 40,
                "pos": ["phr"],
                "ipa": phonetic or "/—/",
                "en": PHRASE_ENGLISH_GLOSSES[entry["sourceNumber"]],
                "zh": entry["zh"],
                "example": "",
                "exampleZh": "",
                "tip": (
                    f"先看图说出整句，再按 {len(breakdown['parts'])} 个词块"
                    "从左到右拼出来。"
                ),
                "visual": {
                    "emoji": emoji,
                    "scene": f"{entry['zh']}：Movers 短语配图",
                    "color1": color1,
                    "color2": color2,
                    "image": image_source["image"],
                    "source": (
                        f"Wikimedia Commons · {image_source['license']}"
                    ),
                    "sourceKind": "wikimedia-commons",
                    "sourceUrl": image_source["sourceUrl"],
                    "creator": image_source["creator"],
                    "license": image_source["license"],
                    "licenseUrl": image_source.get("licenseUrl", ""),
                    "fileTitle": image_source["fileTitle"],
                },
                "breakdown": breakdown,
                "dataQuality": {
                    "missingEnglishDefinition": False,
                    "missingChineseTranslation": False,
                    "missingPhonetic": not bool(phonetic),
                },
            }
        )
    return cards, phrase_cards


def validate(
    words: list[dict[str, Any]],
    phrases: list[dict[str, Any]],
    word_cards: list[dict[str, Any]],
    phrase_cards: list[dict[str, Any]],
    image_dir: Path,
    project_root: Path,
) -> None:
    if len(words) != EXPECTED_WORD_COUNT or len(word_cards) != EXPECTED_WORD_COUNT:
        raise ValueError(f"Expected {EXPECTED_WORD_COUNT} words and word cards")
    if len(phrases) != EXPECTED_PHRASE_COUNT or len(phrase_cards) != EXPECTED_PHRASE_COUNT:
        raise ValueError(f"Expected {EXPECTED_PHRASE_COUNT} phrases")
    cards = [*word_cards, *phrase_cards]
    if len(cards) != EXPECTED_CARD_COUNT:
        raise ValueError(f"Expected {EXPECTED_CARD_COUNT} total Movers cards")
    if sorted(PHRASE_ENGLISH_GLOSSES) != list(range(1, 81)):
        raise ValueError("English phrase glosses must cover source numbers 1–80")

    source_numbers = [item["sourceNumber"] for item in words]
    if len(set(source_numbers)) != EXPECTED_WORD_COUNT:
        raise ValueError("Duplicate Movers source number")
    missing_numbers = sorted(set(range(1, 249)) - set(source_numbers))
    if missing_numbers != [49]:
        raise ValueError(f"Unexpected Movers source-number gaps: {missing_numbers}")
    if [item["sourceNumber"] for item in phrases] != list(range(1, 81)):
        raise ValueError("Phrase appendix numbers are not exactly 1–80")

    ids = [item["id"] for item in cards]
    images = [item["visual"]["image"] for item in cards]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate Movers card id")
    if len(images) != len(set(images)):
        raise ValueError("Duplicate Movers image path")
    if len(list(image_dir.glob("*.webp"))) != EXPECTED_IMAGE_COUNT:
        raise ValueError(f"Expected {EXPECTED_IMAGE_COUNT} generated WebP images")

    for card in cards:
        if not all(card.get(field) for field in ("word", "en", "zh", "visual", "breakdown")):
            raise ValueError(f"Missing required field in card {card['id']}")
        local_image = project_root / card["visual"]["image"]
        if not local_image.is_file():
            raise ValueError(f"Missing generated image for {card['id']}")
        if not re.fullmatch(r"[a-z0-9:_-]{1,220}", card["id"], re.I):
            raise ValueError(f"Unsafe card id: {card['id']}")
    missing_ipa = [card["id"] for card in cards if card["ipa"] == "/—/"]
    if missing_ipa:
        raise ValueError(f"Missing Movers display phonetics: {missing_ipa}")


def write_javascript(path: Path, cards: list[dict[str, Any]], metadata: dict[str, Any]) -> None:
    payload = json.dumps(cards, ensure_ascii=False, separators=(",", ":"))
    meta = json.dumps(metadata, ensure_ascii=False, separators=(",", ":"))
    script = f"""(() => {{
  "use strict";
  window.WORD_BANKS = window.WORD_BANKS || {{}};
  window.WORD_BANKS.movers = {payload};
  window.MOVERS_LIST_META = {meta};
}})();
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(script, encoding="utf-8")


def write_report(
    path: Path,
    pdf_path: Path,
    words: list[dict[str, Any]],
    phrases: list[dict[str, Any]],
    word_cards: list[dict[str, Any]],
    phrase_cards: list[dict[str, Any]],
    page_stats: list[dict[str, int]],
) -> None:
    digest = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    duplicates = sorted(
        (word, count)
        for word, count in Counter(item["headword"].casefold() for item in words).items()
        if count > 1
    )
    days = Counter(item["day"] for item in words)
    cards = [*word_cards, *phrase_cards]
    missing_ipa = sum(item["dataQuality"]["missingPhonetic"] for item in cards)
    licenses = Counter(item["visual"]["license"] for item in phrase_cards)
    lines = [
        "# Movers 2025 import report",
        "",
        f"- Source: user-provided `{pdf_path.name}`",
        f"- SHA-256: `{digest}`",
        f"- Image-backed word rows: **{len(words)}**",
        f"- Extracted PDF word images: **{len(word_cards)}**",
        f"- Phrase appendix rows added as learning cards: **{len(phrase_cards)}**",
        f"- Curated Wikimedia Commons phrase images: **{len(phrase_cards)}**",
        f"- Total Movers learning cards: **{len(cards)}**",
        f"- Missing phonetics after offline ECDICT lookup: **{missing_ipa}**",
        f"- Source numbering gap: **49** (also absent from the PDF)",
        "",
        "## Day distribution",
        "",
        *[f"- Day {day}: {days[day]} words" for day in sorted(days)],
        "",
        "## Duplicate source spellings retained",
        "",
        *[f"- `{word}`: {count} source rows with separate images/meanings" for word, count in duplicates],
        "",
        "## Phrase-image licenses",
        "",
        *[f"- {license_name}: {count}" for license_name, count in sorted(licenses.items())],
        "",
        "Every phrase image has its creator, file page, license, and local-file",
        "hash recorded in `data/movers-phrase-image-attributions.json`.",
        "",
        "## Page mapping check",
        "",
        "| PDF pages | Parsed rows | Embedded images |",
        "|---|---:|---:|",
        f"| 1–40 (word list) | {sum(item['rows'] for item in page_stats[:40])} | {sum(item['images'] for item in page_stats[:40])} |",
        f"| 41–48 (phrase appendix) | {sum(item['rows'] for item in page_stats[40:])} | {sum(item['images'] for item in page_stats[40:])} |",
        "",
        "Every word-list page passed an exact row-to-image count check. The PDF",
        "image order was visually spot-checked on pages 1, 4, 27, 34, and 40.",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--ecdict", type=Path, required=True)
    parser.add_argument("--wordroots", type=Path, required=True)
    parser.add_argument("--output-js", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--image-dir", type=Path, required=True)
    parser.add_argument("--phrase-image-manifest", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    for required in (
        args.pdf,
        args.ecdict,
        args.wordroots,
        args.phrase_image_manifest,
    ):
        if not required.is_file():
            raise FileNotFoundError(required)

    project_root = args.output_js.resolve().parent.parent
    words, phrases, page_stats = parse_source(args.pdf)
    save_source_images(words, args.image_dir)
    phrase_images = load_phrase_image_manifest(
        args.phrase_image_manifest, project_root
    )
    word_cards, phrase_cards = build_cards(
        words,
        phrases,
        phrase_images,
        args.ecdict,
        args.wordroots,
    )
    cards = [*word_cards, *phrase_cards]
    validate(
        words,
        phrases,
        word_cards,
        phrase_cards,
        args.image_dir,
        project_root,
    )
    source_hash = hashlib.sha256(args.pdf.read_bytes()).hexdigest()
    metadata = {
        "title": SOURCE_TITLE,
        "sourceFile": args.pdf.name,
        "sourceSha256": source_hash,
        "wordCount": len(word_cards),
        "phraseCount": len(phrase_cards),
        "cardCount": len(cards),
        "imageCount": len(cards),
        "phraseAppendixCount": len(phrases),
        "wordPages": [1, 40],
        "phrasePages": [41, 48],
        "sourceNumberGap": [49],
    }
    write_javascript(args.output_js, cards, metadata)
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(
        json.dumps(
            {
                "metadata": metadata,
                "words": word_cards,
                "phraseCards": phrase_cards,
                "phrases": phrases,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    write_report(
        args.report,
        args.pdf,
        words,
        phrases,
        word_cards,
        phrase_cards,
        page_stats,
    )
    print(
        f"Built {len(cards)} Movers cards: {len(word_cards)} PDF-image words "
        f"and {len(phrase_cards)} attributed phrase images."
    )


if __name__ == "__main__":
    main()
