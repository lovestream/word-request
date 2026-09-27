#!/usr/bin/env python3
"""Download the curated Wikimedia Commons images for Movers phrases.

The selection file contains exact Commons file titles chosen after visual
review. This script resolves current attribution metadata through MediaWiki's
API, downloads a thumbnail, and converts it to an offline WebP without
cropping. It never chooses a search result on its own.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from PIL import Image


API_URL = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "KevinWordQuest/1.0 (local educational vocabulary app)"
ALLOWED_LICENSE_MARKERS = (
    "cc0",
    "cc by",
    "public domain",
    "pdm",
    "gfdl",
)
FORBIDDEN_LICENSE_MARKERS = (
    "noncommercial",
    "no derivatives",
    "no-derivatives",
    "cc by-nc",
    "cc by-nd",
)


def request_json(parameters: dict[str, str], timeout: float) -> dict[str, Any]:
    url = f"{API_URL}?{urlencode(parameters)}"
    request = Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(4):
        try:
            with urlopen(request, timeout=timeout) as response:
                if response.headers.get_content_type() != "application/json":
                    raise ValueError(
                        f"Unexpected Commons API content type: {response.headers}"
                    )
                return json.load(response)
        except HTTPError as error:
            if error.code not in {429, 502, 503, 504} or attempt == 3:
                raise
            time.sleep(min(8.0, 1.5 * (2**attempt)))
    raise RuntimeError("Unreachable Commons API retry state")


def clean_html(value: str) -> str:
    text = re.sub(r"<br\s*/?>", " · ", value or "", flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return " ".join(html.unescape(text).split())


def metadata_value(metadata: dict[str, Any], key: str) -> str:
    return clean_html(str(metadata.get(key, {}).get("value", "")))


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-") or "phrase"


def normalize_title(value: str) -> str:
    value = value.replace("_", " ").strip()
    if not value.casefold().startswith("file:"):
        value = f"File:{value}"
    return value.casefold()


def fetch_metadata(
    selections: list[dict[str, Any]], timeout: float
) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    batch_size = 10
    for start in range(0, len(selections), batch_size):
        batch = selections[start : start + batch_size]
        payload = request_json(
            {
                "action": "query",
                "titles": "|".join(str(item["fileTitle"]) for item in batch),
                "prop": "imageinfo",
                "iiprop": "url|extmetadata|mime|size|sha1|user",
                "iiurlwidth": "900",
                "iiextmetadatafilter": (
                    "Artist|Credit|LicenseShortName|UsageTerms|LicenseUrl"
                ),
                "format": "json",
                "formatversion": "2",
                "redirects": "1",
            },
            timeout,
        )
        for page in payload.get("query", {}).get("pages", []):
            if page.get("missing") is not None:
                raise ValueError(f"Commons file no longer exists: {page.get('title')}")
            info = (page.get("imageinfo") or [None])[0]
            if not info:
                raise ValueError(f"Commons file has no imageinfo: {page.get('title')}")
            result[normalize_title(page["title"])] = {"page": page, "info": info}
    return result


def download_bytes(url: str, timeout: float) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    data = b""
    for attempt in range(4):
        try:
            with urlopen(request, timeout=timeout) as response:
                content_type = response.headers.get_content_type()
                if not content_type.startswith("image/"):
                    raise ValueError(
                        f"Unexpected image content type {content_type}: {url}"
                    )
                data = response.read(15_000_001)
            break
        except HTTPError as error:
            if error.code not in {429, 502, 503, 504} or attempt == 3:
                raise
            time.sleep(min(8.0, 1.5 * (2**attempt)))
    if not data or len(data) > 15_000_000:
        raise ValueError(f"Image is empty or exceeds 15 MB: {url}")
    return data


def write_webp(data: bytes, destination: Path) -> tuple[int, int, str]:
    with Image.open(io.BytesIO(data)) as image:
        image.seek(0)
        image.thumbnail((900, 900), Image.Resampling.LANCZOS)
        if image.mode not in {"RGB", "RGBA"}:
            has_alpha = "A" in image.getbands() or "transparency" in image.info
            image = image.convert("RGBA" if has_alpha else "RGB")
        width, height = image.size
        image.save(destination, "WEBP", quality=90, method=6)
    return width, height, hashlib.sha256(destination.read_bytes()).hexdigest()


def build_manifest(
    selections: list[dict[str, Any]],
    resolved: dict[str, dict[str, Any]],
    output_dir: Path,
    timeout: float,
) -> list[dict[str, Any]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    expected_files: set[str] = set()
    manifest: list[dict[str, Any]] = []

    for selection in selections:
        source_number = int(selection["sourceNumber"])
        phrase = str(selection["phrase"])
        key = normalize_title(str(selection["fileTitle"]))
        if key not in resolved:
            raise ValueError(f"Commons API did not resolve {selection['fileTitle']}")
        page = resolved[key]["page"]
        info = resolved[key]["info"]
        metadata = info.get("extmetadata", {})
        license_name = (
            metadata_value(metadata, "LicenseShortName")
            or metadata_value(metadata, "UsageTerms")
        )
        normalized_license = license_name.casefold()
        if (
            not any(marker in normalized_license for marker in ALLOWED_LICENSE_MARKERS)
            or any(marker in normalized_license for marker in FORBIDDEN_LICENSE_MARKERS)
        ):
            raise ValueError(
                f"Unsupported or missing free license for {page['title']}: {license_name!r}"
            )
        thumbnail_url = info.get("thumburl") or info.get("url")
        if not thumbnail_url:
            raise ValueError(f"No downloadable URL for {page['title']}")

        filename = f"{source_number:03d}-{slugify(phrase)}.webp"
        expected_files.add(filename)
        destination = output_dir / filename
        downloaded = download_bytes(thumbnail_url, timeout)
        width, height, webp_sha256 = write_webp(downloaded, destination)
        time.sleep(0.08)
        creator = (
            metadata_value(metadata, "Artist")
            or metadata_value(metadata, "Credit")
            or str(info.get("user") or "Wikimedia Commons contributor")
        )[:300]
        license_url = metadata_value(metadata, "LicenseUrl")
        source_url = info.get("descriptionurl") or (
            "https://commons.wikimedia.org/wiki/"
            + str(page["title"]).replace(" ", "_")
        )
        manifest.append(
            {
                "sourceNumber": source_number,
                "phrase": phrase,
                "query": selection["query"],
                "fileTitle": page["title"],
                "image": f"assets/movers-phrase-images/{filename}",
                "creator": creator,
                "license": license_name,
                "licenseUrl": license_url,
                "sourceUrl": source_url,
                "originalUrl": info.get("url", ""),
                "thumbnailUrl": thumbnail_url,
                "width": width,
                "height": height,
                "downloadSha256": hashlib.sha256(downloaded).hexdigest(),
                "webpSha256": webp_sha256,
                "modification": "Resized if needed and converted to WebP; not cropped.",
            }
        )

    for stale in output_dir.glob("*.webp"):
        if stale.name not in expected_files:
            stale.unlink()
    return manifest


def validate_selections(selections: list[dict[str, Any]]) -> None:
    if len(selections) != 80:
        raise ValueError(f"Expected 80 curated selections, found {len(selections)}")
    numbers = [int(item["sourceNumber"]) for item in selections]
    if numbers != list(range(1, 81)):
        raise ValueError("Selections must contain ordered source numbers 1–80")
    titles = [normalize_title(str(item["fileTitle"])) for item in selections]
    if len(titles) != len(set(titles)):
        duplicates = sorted(title for title in set(titles) if titles.count(title) > 1)
        raise ValueError(f"Each phrase needs a distinct Commons file: {duplicates}")
    for item in selections:
        if not all(str(item.get(key, "")).strip() for key in ("phrase", "query", "fileTitle")):
            raise ValueError(f"Incomplete selection: {item}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selections", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args()

    payload = json.loads(args.selections.read_text(encoding="utf-8"))
    selections = payload["items"]
    validate_selections(selections)
    resolved = fetch_metadata(selections, args.timeout)
    manifest = build_manifest(selections, resolved, args.output_dir, args.timeout)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps(
            {
                "source": "Wikimedia Commons",
                "api": API_URL,
                "selectionPolicy": (
                    "Exact file titles selected after visual review; free-license "
                    "metadata resolved at download time."
                ),
                "items": manifest,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Downloaded and attributed {len(manifest)} Movers phrase images.")


if __name__ == "__main__":
    main()
