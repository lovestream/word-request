# Vocabulary data sources

Kevin Word Quest uses the following sources for its expanded offline KET and
PET banks.

## User-provided Movers source

- *Movers Word List 2025.pdf*, supplied by the user on 2026-07-25.

Pages 1–40 contain 247 numbered word rows and exactly 247 embedded pictures.
Each picture is extracted, converted to WebP, and kept with its corresponding
source row in the local Movers category. The source numbering skips 49; that
gap is present in the PDF itself. Pages 41–48 contain an 80-item phrase
appendix without pictures. All 80 phrases are also presented as learning
cards, using individually reviewed, locally stored images from Wikimedia
Commons.

The Movers document decides membership, English explanations, Chinese
meanings, and the 247 word pictures. ECDICT is used only to enrich display
phonetics; a small explicit British-English override table covers source forms
absent from ECDICT.

The phrase-image selection is recorded in
`data/movers-phrase-image-selections.json`. Creator, file page, individual
license, source URL, local hash, and conversion note for every downloaded
image are recorded in `data/movers-phrase-image-attributions.json`. Each image
remains under the license shown for that item; the local copy is resized if
needed and converted to WebP without cropping. The study card displays the
creator and license with a link to its Commons file page.

Wikimedia Commons reuse guidance:
<https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia/en>

See `data/movers-import-report.md` for the page-by-page import checks,
license distribution, and source-file hash.

## Official membership sources

- Cambridge English, *A2 Key and A2 Key for Schools Vocabulary List*, August
  2025: <https://www.cambridgeenglish.org/images/506886-a2-key-2020-vocabulary-list.pdf>
- Cambridge English, *B1 Preliminary and Preliminary for Schools Vocabulary
  List*, August 2025:
  <https://www.cambridgeenglish.org/Images/506887-b1-preliminary-vocabulary-list.pdf>

The alphabetical sections and Appendix 1 are the membership sources. The PDF
text layers contain a few overlapping or wrapped lines; every known affected
headword is repaired explicitly, with its source page recorded in
`scripts/build_cambridge_wordlists.py`. Source sense labels that produce the
same spelling task are merged into one study card, while the original source
headwords remain recorded in the generated data.

Cambridge describes these lists as preparation guidance that is updated
regularly. They cover the vocabulary candidates should understand and use,
but are not an exhaustive list of every word that could appear in an exam.

## Offline enrichment source

- ECDICT by skywind3000: <https://github.com/skywind3000/ECDICT>

ECDICT supplies offline phonetics and English/Chinese dictionary enrichment;
it does not decide whether an item belongs to KET or PET. ECDICT is distributed
under the MIT License; see `licenses/ECDICT-LICENSE.txt`.

## Generated counts

- KET / A2 Key: 1,811 repaired source entries, presented as 1,802 unique
  spelling cards after same-spelling sense labels are merged.
- PET / B1 Preliminary: 3,225 repaired source entries, presented as 3,222
  unique spelling cards after same-spelling sense labels are merged.

Generated on 2026-07-14. See `data/import-report.md` for the parser and quality
report.
