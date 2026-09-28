#!/usr/bin/env python3
"""Build the 2000 Core English Words course from the four local scan PDFs.

The books use a stable six-page unit layout:
  words A, exercise A, words B, exercise B, reading 1, reading 2.

This script intentionally keeps the course English-only.  It extracts the
book's own word photos and exercise pages, while macOS Vision supplies the
English headword, definition, example, and pronunciation text.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from PIL import Image, ImageOps
    from pypdf import PdfReader
except ModuleNotFoundError:
    Image = ImageOps = PdfReader = None


ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = ROOT.parent.parent
WORK = ROOT / "tmp" / "core2000"
OCR_INPUT = WORK / "ocr-input"
OCR_JSON = WORK / "vision-ocr.json"
IMAGE_ROOT = ROOT / "assets" / "core2000-images"
EXERCISE_ROOT = ROOT / "assets" / "core2000-exercises"
READING_ROOT = ROOT / "assets" / "core2000-reading"
DATA_OUTPUT = ROOT / "data" / "core2000.json"
JS_OUTPUT = ROOT / "assets" / "core2000.js"
SWIFT_SCRIPT = ROOT / "scripts" / "vision_ocr.swift"
SDK = "/Library/Developer/CommandLineTools/SDKs/MacOSX15.4.sdk"


@dataclass(frozen=True)
class Book:
    number: int
    pdf: Path
    first_word_page: int  # one-based PDF page
    color: str


BOOKS = (
    Book(1, DOWNLOADS / "2000-words-001.pdf", 8, "#00a9cf"),
    Book(2, DOWNLOADS / "2000-words-002.pdf", 7, "#ef7f35"),
    Book(3, DOWNLOADS / "2000 words-003.pdf", 7, "#79a943"),
    Book(4, DOWNLOADS / "2000 words-004.pdf", 7, "#8c68ad"),
)

POS_RE = re.compile(r"^(n|v|adj|adv|prep|conj|pron|det|excl|num)\.\s*", re.I)
HEAD_RE = re.compile(r"^(.+?)\s*[\[\(\{]([^\]\)\}]*)[\]\)\}]", re.I)
WORD_RE = re.compile(r"^[a-z][a-z' -]*$", re.I)

CORE_SOURCE_CORRECTIONS = {
    (2, 2, "b", 6): {
        "definition": "A tire is a rubber ring filled with air that goes around a wheel.",
        "ipa": "/taɪr/",
    },
    (3, 16, "b", 5): {
        "word": "tail",
        "ipa": "/teɪl/",
        "definition": "A tail is a part at the back of an animal's body that can move.",
        "example": "Our dog wags his tail when he's happy.",
    },
}
IPA_OVERRIDES = {
    "girlfriend": "/ˈɡɝːlfrend/",
    "website": "/ˈwebsaɪt/",
}
LEGACY_ID_ALIASES = {
    "core2000-b3-u16-b-05-fail": "core2000-b3-u16-b-05-tail",
}


def load_dictionary() -> dict[str, dict[str, str]]:
    path = ROOT / "tmp" / "dictionaries" / "ecdict.csv"
    if not path.exists():
        return {}
    import csv
    with path.open(encoding="utf-8", errors="ignore") as handle:
        return {(row.get("word") or "").strip().lower(): row for row in csv.DictReader(handle)}


DICTIONARY = load_dictionary()
KNOWN_WORDS = set(DICTIONARY)


def page_numbers(book: Book, unit: int, half: str) -> dict[str, int]:
    # Books 1 and 3 have omitted scan leaves in the supplied PDFs.  Their
    # printed page numbers continue normally, but physical PDF indexes jump.
    if book.number == 1 and unit >= 11:
        unit_start = 66 + (unit - 11) * 6
    elif book.number == 3 and unit == 7:
        unit_start = 41
    elif book.number == 3 and unit >= 8:
        unit_start = 45 + (unit - 8) * 6
    else:
        unit_start = book.first_word_page + (unit - 1) * 6
    base = unit_start + (0 if half == "a" else 2)
    return {
        "words": base,
        "exercise": base + 1,
        "reading1": unit_start + 4,
        "reading2": unit_start + 5,
    }


def embedded_page_image(reader: PdfReader, one_based_page: int) -> Image.Image:
    page = reader.pages[one_based_page - 1]
    images = list(page.images)
    if not images:
        raise RuntimeError(f"PDF page {one_based_page} contains no embedded image")
    # Each scan page contains one full-page JPEG.  Taking the largest image is
    # defensive in case a later edition adds a tiny auxiliary object.
    candidates = [item.image.convert("RGB") for item in images]
    return max(candidates, key=lambda image: image.width * image.height)


def resize_width(image: Image.Image, width: int) -> Image.Image:
    if image.width <= width:
        return image.copy()
    height = round(image.height * width / image.width)
    return image.resize((width, height), Image.Resampling.LANCZOS)


def save_webp(image: Image.Image, path: Path, width: int | None = None, quality: int = 86) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    output = resize_width(image, width) if width else image
    output.save(path, "WEBP", quality=quality, method=6)


def word_photo_crop(page: Image.Image, row: int) -> Image.Image:
    # Coordinates follow the fixed workbook template and include a tiny margin
    # around the rounded photograph without capturing adjacent English text.
    x1 = round(page.width * 0.061)
    x2 = round(page.width * 0.201)
    y1 = round(page.height * (0.142 + row * 0.08155))
    y2 = round(page.height * (0.212 + row * 0.08155))
    crop = page.crop((x1, y1, x2, min(page.height, y2)))
    return ImageOps.exif_transpose(crop)


def prepare_assets() -> list[dict]:
    OCR_INPUT.mkdir(parents=True, exist_ok=True)
    manifest: list[dict] = []
    for book in BOOKS:
        if not book.pdf.exists():
            raise FileNotFoundError(book.pdf)
        reader = PdfReader(str(book.pdf))
        for unit in range(1, 17):
            for half in ("a", "b"):
                pages = page_numbers(book, unit, half)
                word_page = embedded_page_image(reader, pages["words"])
                ocr_path = OCR_INPUT / f"b{book.number}-u{unit:02d}-{half}.jpg"
                resize_width(word_page, 1100).save(ocr_path, "JPEG", quality=92, optimize=True)

                batch_slug = f"b{book.number}/u{unit:02d}-{half}"
                for row in range(10):
                    photo_path = IMAGE_ROOT / batch_slug / f"{row + 1:02d}.webp"
                    save_webp(word_photo_crop(word_page, row), photo_path, width=440, quality=88)

                exercise_page = embedded_page_image(reader, pages["exercise"])
                exercise_path = EXERCISE_ROOT / f"b{book.number}" / f"u{unit:02d}-{half}.webp"
                save_webp(exercise_page, exercise_path, width=1500, quality=86)

                reading_paths = []
                # Reading Practice belongs to the whole 20-word unit, so only
                # attach it to Set B where both word sets have been completed.
                if half == "b" and not (book.number == 3 and unit == 7):
                    for index, key in enumerate(("reading1", "reading2"), start=1):
                        reading_page = embedded_page_image(reader, pages[key])
                        reading_path = READING_ROOT / f"b{book.number}" / f"u{unit:02d}-{index}.webp"
                        save_webp(reading_page, reading_path, width=1500, quality=85)
                        reading_paths.append(str(reading_path.relative_to(ROOT)))

                manifest.append({
                    "book": book.number,
                    "bookColor": book.color,
                    "unit": unit,
                    "half": half,
                    "wordPdfPage": pages["words"],
                    "exercisePdfPage": pages["exercise"],
                    "ocrPath": str(ocr_path),
                    "exerciseImage": str(exercise_path.relative_to(ROOT)),
                    "readingImages": reading_paths,
                })
    (WORK / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def run_ocr(manifest: list[dict]) -> None:
    paths = [item["ocrPath"] for item in manifest]
    command = ["swift", "-sdk", SDK, str(SWIFT_SCRIPT), *paths]
    print(f"Running Vision OCR on {len(paths)} word pages…", file=sys.stderr)
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    OCR_JSON.write_text(result.stdout, encoding="utf-8")


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    return text.replace("|", "I")


def normalize_headword(text: str) -> tuple[str, str]:
    text = clean_text(text).translate(str.maketrans({
        "а": "a", "А": "A", "с": "c", "С": "C", "е": "e", "Е": "E",
        "і": "i", "І": "I", "к": "k", "К": "K", "м": "m", "М": "M",
        "о": "o", "О": "O", "р": "p", "Р": "P", "т": "t", "Т": "T",
        "х": "x", "Х": "X", "у": "y", "У": "Y", "и": "u", "И": "U",
        "в": "b", "В": "B", "н": "h", "Н": "H",
    }))
    match = HEAD_RE.search(text)
    if match:
        word = match.group(1).strip(" .,-").lower()
        ipa = match.group(2).strip()
    else:
        # A few low-contrast brackets may be dropped by OCR.  The headword is
        # still the first lowercase token before inflection information.
        word = re.split(r"\s{2,}|\s[-–]\s", text, maxsplit=1)[0].strip(" .,-").lower()
        word = word.split()[0] if not WORD_RE.fullmatch(word) else word
        ipa = ""
    word = re.sub(r"[^a-z' -]", "", word).strip()
    ipa = re.sub(r"\s+", " ", ipa).strip()
    return word, ipa


def row_boxes(page: dict, row: int) -> list[dict]:
    expected_header_y = 0.829 - row * 0.08165
    upper = expected_header_y + 0.035
    lower = expected_header_y - 0.075
    return sorted(
        [
            box for box in page["boxes"]
            if 0.16 <= box["x"] <= 0.78 and lower <= box["y"] <= upper
        ],
        key=lambda box: (-box["y"], box["x"]),
    )


def parse_row(page: dict, row: int) -> dict:
    text_column = sorted(
        [box for box in page["boxes"] if 0.16 <= box["x"] < 0.78 and 0.045 < box["y"] < 0.87],
        key=lambda box: (-box["y"], box["x"]),
    )
    definition_boxes = [box for box in text_column if POS_RE.match(clean_text(box["text"]))]
    if len(definition_boxes) != 10:
        raise RuntimeError(f"Expected 10 definitions, found {len(definition_boxes)} in {page['path']}")
    definition_box = definition_boxes[row]

    # The headword is the line immediately above its part-of-speech line.  This
    # is more reliable than fixed row coordinates because some scans have a
    # slightly taller leading or a pronunciation split into a separate box.
    header_candidates = [
        box for box in text_column
        if definition_box["y"] + 0.002 < box["y"] < definition_box["y"] + 0.052
        and not POS_RE.match(clean_text(box["text"]))
    ]
    header_candidates.sort(key=lambda box: abs(box["x"] - 0.22) * 5 + abs((box["y"] - definition_box["y"]) - 0.018))
    header = header_candidates[0] if header_candidates else None
    word, ipa = normalize_headword(header["text"]) if header else ("", "")

    start_index = text_column.index(definition_box)
    content_lines = [clean_text(box["text"]) for box in text_column[start_index:]]
    raw_definition = content_lines.pop(0)
    pos_match = POS_RE.match(raw_definition)
    pos = pos_match.group(1).lower() + "."
    definition = raw_definition[pos_match.end():].strip()
    while content_lines and not re.search(r"[.!?][\"']?$", definition):
        definition += " " + content_lines.pop(0)
    example_parts: list[str] = []
    while content_lines:
        # Stop before the next row if a rare punctuation recognition failure
        # left the current example open-ended.
        if POS_RE.match(content_lines[0]):
            break
        example_parts.append(content_lines.pop(0))
        if re.search(r"[.!?][\"']?$", example_parts[-1]):
            break
    example = " ".join(example_parts)

    if not word or (KNOWN_WORDS and word not in KNOWN_WORDS) or len(word.split()) > 4:
        inference_patterns = (
            r"^A ([a-z][a-z'-]*) is\b",
            r"^An ([a-z][a-z'-]*) is\b",
            r"^The ([a-z][a-z'-]*) is\b",
            r"^To ([a-z][a-z'-]*) is\b",
            r"^When someone is ([a-z][a-z'-]*)\b",
            r"^If something is ([a-z][a-z'-]*)\b",
            r"^([A-Z][a-z'-]*) means\b",
            r"^([A-Z][a-z'-]*) is\b",
            r"^([A-Z][a-z'-]*) describes\b",
        )
        for pattern in inference_patterns:
            inferred = re.search(pattern, definition)
            if inferred and (not KNOWN_WORDS or inferred.group(1).lower() in KNOWN_WORDS):
                word = inferred.group(1).lower()
                break
    if not example:
        example = f"Use {word} in a sentence."
    dictionary_ipa = (DICTIONARY.get(word) or {}).get("phonetic", "").strip()
    if dictionary_ipa:
        ipa = f"/{dictionary_ipa}/"
    return {"word": word, "ipa": ipa, "pos": pos, "definition": definition, "example": example}


def parse_theme(page: dict, unit: int) -> str:
    candidates = [clean_text(box["text"]) for box in page["boxes"] if box["y"] > 0.87]
    for text in candidates:
        match = re.search(rf"(?:^|\s){unit:02d}\s+(.+)$", text, re.I)
        if match:
            return match.group(1).strip(" .")
    for text in candidates:
        match = re.search(r"\d{1,2}\s+(.+)$", text)
        if match:
            return match.group(1).strip(" .")
    return f"Unit {unit}"


def spelling_chunks(word: str) -> list[str]:
    if " " in word:
        return word.split()
    vowels = "aeiouy"
    chunks: list[str] = []
    start = 0
    for index in range(1, len(word) - 1):
        if word[index] not in vowels and word[index - 1] in vowels and word[index + 1] in vowels:
            chunks.append(word[start:index])
            start = index
    chunks.append(word[start:])
    return [chunk for chunk in chunks if chunk]


def apply_course_corrections(data: dict) -> dict:
    """Apply verified source fixes and presentation metadata after every build."""
    words = data.get("words", [])
    for word in words:
        old_id = word.get("id")
        if old_id == "core2000-b2-u02-b-06-tire":
            word["en"] = CORE_SOURCE_CORRECTIONS[(2, 2, "b", 6)]["definition"]
            word["ipa"] = CORE_SOURCE_CORRECTIONS[(2, 2, "b", 6)]["ipa"]
        elif old_id == "core2000-b3-u16-b-05-fail":
            fix = CORE_SOURCE_CORRECTIONS[(3, 16, "b", 5)]
            word.update({
                "id": LEGACY_ID_ALIASES[old_id],
                "word": fix["word"],
                "ipa": fix["ipa"],
                "en": fix["definition"],
                "example": fix["example"],
                "legacyIds": [old_id],
            })
            word.setdefault("visual", {})["alt"] = "Book illustration for tail"
            word["tip"] = "Look at the book picture, say “tail,” and read the example aloud."
        if word.get("word") in IPA_OVERRIDES:
            word["ipa"] = IPA_OVERRIDES[word["word"]]
        chunks = spelling_chunks(word.get("word", ""))
        word["breakdown"] = {
            "type": "spelling chunks",
            "label": "SPELLING CHUNKS",
            "parts": [{"text": chunk} for chunk in chunks],
        }

    for batch in data.get("batches", []):
        batch["wordIds"] = [LEGACY_ID_ALIASES.get(word_id, word_id) for word_id in batch.get("wordIds", [])]
    data["idAliases"] = dict(LEGACY_ID_ALIASES)
    return data


def build_data(manifest: list[dict]) -> dict:
    pages = json.loads(OCR_JSON.read_text(encoding="utf-8"))
    page_by_path = {str(Path(page["path"]).resolve()): page for page in pages}
    words: list[dict] = []
    batches: list[dict] = []
    seen_ids: set[str] = set()

    for batch_index, item in enumerate(manifest, start=1):
        page = page_by_path.get(str(Path(item["ocrPath"]).resolve()))
        if not page:
            raise RuntimeError(f"Missing OCR result for {item['ocrPath']}")
        theme = parse_theme(page, item["unit"])
        word_ids = []
        for row in range(10):
            parsed = parse_row(page, row)
            parsed.update(CORE_SOURCE_CORRECTIONS.get((item["book"], item["unit"], item["half"], row + 1), {}))
            if parsed["word"] in IPA_OVERRIDES:
                parsed["ipa"] = IPA_OVERRIDES[parsed["word"]]
            slug = re.sub(r"[^a-z0-9]+", "-", parsed["word"]).strip("-")
            word_id = f"core2000-b{item['book']}-u{item['unit']:02d}-{item['half']}-{row + 1:02d}-{slug}"
            if word_id in seen_ids:
                raise RuntimeError(f"Duplicate generated id: {word_id}")
            seen_ids.add(word_id)
            word_ids.append(word_id)
            chunks = spelling_chunks(parsed["word"])
            words.append({
                "id": word_id,
                "word": parsed["word"],
                "acceptedAnswers": [],
                "en": parsed["definition"],
                "zh": "",
                "ipa": parsed["ipa"],
                "pos": parsed["pos"],
                "visual": {
                    "image": f"assets/core2000-images/b{item['book']}/u{item['unit']:02d}-{item['half']}/{row + 1:02d}.webp",
                    "source": f"2000 Core English Words {item['book']}, Unit {item['unit']}",
                    "sourceUrl": "",
                    "alt": f"Book illustration for {parsed['word']}",
                    "color1": item["bookColor"],
                    "color2": "#fff6c7",
                    "emoji": "📘",
                },
                "breakdown": {
                    "type": "spelling chunks",
                    "label": "SPELLING CHUNKS",
                    "parts": [{"text": chunk} for chunk in chunks],
                },
                "tip": f"Look at the book picture, say “{parsed['word']},” and read the example aloud.",
                "example": parsed["example"],
                "exampleZh": "",
                "englishOnly": True,
                "sourceBook": item["book"],
                "sourceUnit": item["unit"],
                "sourceHalf": item["half"],
                "sourceOrder": row + 1,
                "sourcePdfPage": item["wordPdfPage"],
                "sequence": len(words) + 1,
            })

        batch_id = f"core2000-b{item['book']}-u{item['unit']:02d}-{item['half']}"
        batches.append({
            "id": batch_id,
            "sequence": batch_index,
            "book": item["book"],
            "bookColor": item["bookColor"],
            "unit": item["unit"],
            "half": item["half"],
            "setLabel": "Set A" if item["half"] == "a" else "Set B",
            "theme": theme,
            "wordIds": word_ids,
            "exercise": {
                "id": f"{batch_id}-exercise",
                "image": item["exerciseImage"],
                "sourcePdfPage": item["exercisePdfPage"],
                "answerSlots": 10,
            },
            "readingImages": item["readingImages"],
        })

    if len(words) != 1280 or len(batches) != 128:
        raise RuntimeError(f"Expected 1280 words / 128 batches, got {len(words)} / {len(batches)}")
    return apply_course_corrections({
        "title": "2000 Core English Words",
        "edition": "Four-book course",
        "language": "en",
        "words": words,
        "batches": batches,
        "books": [
            {"number": book.number, "title": f"Book {book.number}", "color": book.color, "batchStart": (book.number - 1) * 32 + 1, "batchEnd": book.number * 32}
            for book in BOOKS
        ],
    })


def write_outputs(data: dict) -> None:
    DATA_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    compact = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    JS_OUTPUT.write_text(
        "(() => {\n"
        "  window.WORD_BANKS = window.WORD_BANKS || {};\n"
        f"  const course = {compact};\n"
        "  window.WORD_BANKS.core2000 = course.words;\n"
        "  window.CORE2000_COURSE = course;\n"
        "})();\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--skip-ocr", action="store_true")
    parser.add_argument("--rewrite-existing", action="store_true", help="apply verified fixes to the checked-in JSON and regenerate JavaScript")
    args = parser.parse_args()

    if args.rewrite_existing:
        data = json.loads(DATA_OUTPUT.read_text(encoding="utf-8"))
        write_outputs(apply_course_corrections(data))
        print(f"Rewrote {len(data.get('words', []))} Core 2000 cards with verified corrections")
        return
    if Image is None or PdfReader is None:
        raise SystemExit("Full PDF rebuild requires Pillow and pypdf; --rewrite-existing does not.")

    manifest_path = WORK / "manifest.json"
    if args.skip_ocr and manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = prepare_assets()
    if args.prepare_only:
        print(f"Prepared {len(manifest)} course batches in {WORK}")
        return
    if not args.skip_ocr:
        run_ocr(manifest)
    if not OCR_JSON.exists():
        raise FileNotFoundError(f"Run OCR first: {OCR_JSON}")
    data = build_data(manifest)
    write_outputs(data)
    print(f"Built {len(data['words'])} words and {len(data['batches'])} exercises")


if __name__ == "__main__":
    main()
