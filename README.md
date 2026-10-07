# Kevin Word Quest

An offline-first English vocabulary adventure built for Kevin. It includes:

- 2000 Core English Words with book pictures, definitions, examples, audio, and workbook exercises
- Cambridge Movers, KET, and PET word banks
- Cloze and full-spelling practice with retry-until-correct mastery loops
- Ebbinghaus-style scheduled reviews
- Portable learning-record export and restore for moving progress between Macs
- A local background launcher using only Python's standard library

## Run locally

Requires Python 3. Double-click `start_word_quest.py`, or run:

```bash
python3 start_word_quest.py
```

The launcher starts the website in the background and opens it in the default browser. To inspect or stop it:

```bash
python3 start_word_quest.py --status
python3 start_word_quest.py --stop
```

## Static hosting

The app is static and can be published directly with GitHub Pages or Cloudflare Pages. Use the repository root as the site directory; no build command is required.

## AI word packs

Open **My Words → AI 批量生成与导入** to copy the ready-to-use prompt, download the JSON template, and import a parent-checked `.wordpack.json` file. The format embeds compressed WebP/PNG/JPEG pictures inside one portable JSON file, so no image folder or server upload is required. Each pack is limited to 20 cards, 24KB per image, and 1.5MB total.

The canonical prompt and blank template live in [`templates/AI_WORD_PACK_PROMPT.md`](templates/AI_WORD_PACK_PROMPT.md) and [`templates/kevin-word-pack-template.wordpack.json`](templates/kevin-word-pack-template.wordpack.json).

## Tests

```bash
node tests/test_word_banks.js
node tests/test_app_regressions.js
node tests/test_sprint_mode.js
node tests/test_learning_record_tools.js
python3 -m unittest tests/test_launcher.py
npm run test:responsive
```

Source and image attribution details are recorded in [`SOURCES.md`](SOURCES.md).

## Learning-record privacy

Portable `*.wordquest.json` files contain personal learning history and must stay outside this public source repository. Keep them in a private or encrypted backup location. To continue on another computer, copy the newest record directly to that device and use **从记录文件恢复** in the website settings.

Development and migration tests use anonymized fixtures only. See [`docs/learning-data-safety.md`](docs/learning-data-safety.md).
