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

## Tests

```bash
node tests/test_word_banks.js
node tests/test_app_regressions.js
node tests/test_sprint_mode.js
python3 -m unittest tests/test_launcher.py
```

Source and image attribution details are recorded in [`SOURCES.md`](SOURCES.md).

## Kevin's learning record

The latest portable learning record is kept in [`learning-records/`](learning-records/). Download it and use **从记录文件恢复** in the website settings to continue from the saved progress on another computer.
