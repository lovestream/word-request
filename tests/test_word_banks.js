"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

global.window = {};
require("../assets/words.js");
require("../assets/cambridge-official.js");
require("../assets/movers-2025.js");
require("../assets/core2000.js");
require("../assets/core2000-answers.js");

assert.equal(window.WORD_BANKS.ket.length, 1802);
assert.equal(window.WORD_BANKS.pet.length, 3222);
assert.equal(window.WORD_BANKS.movers.length, 327);
assert.equal(window.WORD_BANKS.core2000.length, 1280);
assert.equal(window.CORE2000_COURSE.batches.length, 128);
assert.equal(window.CORE2000_COURSE.books.length, 4);
assert.deepEqual(window.WORD_LIST_META.counts, { ket: 1802, pet: 3222 });
assert.deepEqual(window.WORD_LIST_META.sourceEntryCounts, { ket: 1811, pet: 3225 });
assert.equal(window.MOVERS_LIST_META.wordCount, 247);
assert.equal(window.MOVERS_LIST_META.phraseCount, 80);
assert.equal(window.MOVERS_LIST_META.cardCount, 327);
assert.equal(window.MOVERS_LIST_META.imageCount, 327);
assert.equal(window.MOVERS_LIST_META.phraseAppendixCount, 80);

const requiredPet = [
  "border", "common", "communicate", "digital camera", "dinosaur",
  "diploma", "directly", "driver's licence", "engaged", "fantastic",
  "farm", "generation", "get back", "get on", "give way", "goal",
  "gold", "grab", "grade", "truck"
];
const petSourceHeads = new Set(window.WORD_BANKS.pet.flatMap((item) =>
  item.officialHeadwords || [item.officialHeadword]
).map((value) => value.toLowerCase()));
for (const headword of requiredPet) assert.ok(petSourceHeads.has(headword), headword);
assert.ok(!petSourceHeads.has("license)"));

const all = Object.values(window.WORD_BANKS).flat();
assert.equal(new Set(all.map((item) => item.id)).size, all.length);
for (const item of all) {
  if (!item.quizClue) continue;
  const clue = item.quizClue.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const answerForms = [item.word, ...(item.acceptedAnswers || [])]
    .map((answer) => answer.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .filter(Boolean);
  assert.ok(
    answerForms.every((answer) => !(` ${clue} `).includes(` ${answer} `)),
    `quiz clue leaks an accepted spelling: ${item.id}`
  );
}
for (const item of [...window.WORD_BANKS.ket, ...window.WORD_BANKS.pet, ...window.WORD_BANKS.movers]) {
  const forms = [item.word, ...(item.acceptedAnswers || [])];
  assert.ok(forms.every((form) => !/[()]/.test(form)), item.officialHeadword);
  assert.ok(forms.every((form) => !/\b(?:sth|sb)\b/i.test(form)), item.officialHeadword);
  assert.ok(item.en && item.zh && item.visual && item.breakdown, item.officialHeadword);
}

const coreWords = window.WORD_BANKS.core2000;
const correctedTail = coreWords.find((item) => item.id === "core2000-b3-u16-b-05-tail");
assert.ok(correctedTail, "the verified tail card must replace the OCR fail card");
assert.equal(correctedTail.word, "tail");
assert.match(correctedTail.en, /^A tail is /);
assert.equal(correctedTail.ipa, "/teɪl/");
assert.equal(window.CORE2000_COURSE.idAliases["core2000-b3-u16-b-05-fail"], correctedTail.id);
assert.ok(!coreWords.some((item) => item.id === "core2000-b3-u16-b-05-fail"));
const correctedTire = coreWords.find((item) => item.id === "core2000-b2-u02-b-06-tire");
assert.match(correctedTire.en, /^A tire is /);
assert.equal(correctedTire.ipa, "/taɪr/");
assert.equal(coreWords.find((item) => item.word === "girlfriend").ipa, "/ˈɡɝːlfrend/");
assert.equal(coreWords.find((item) => item.word === "website").ipa, "/ˈwebsaɪt/");
for (const item of coreWords) {
  assert.equal(item.englishOnly, true);
  assert.equal(item.zh, "");
  assert.equal(item.exampleZh, "");
  assert.ok(item.word && item.en && item.example && item.visual?.image && item.breakdown?.parts?.length, item.id);
  assert.equal(item.breakdown.type, "spelling chunks", item.id);
  assert.equal(item.breakdown.label, "SPELLING CHUNKS", item.id);
  assert.ok(item.breakdown.parts.every((part) => part.text && !part.say && !part.meaning), item.id);
  assert.ok(fs.existsSync(path.join(__dirname, "..", item.visual.image)), item.visual.image);
}
for (const [index, batch] of window.CORE2000_COURSE.batches.entries()) {
  assert.equal(batch.sequence, index + 1);
  assert.equal(batch.wordIds.length, 10);
  assert.equal(new Set(batch.wordIds).size, 10);
  assert.ok(batch.wordIds.every((id) => coreWords.some((word) => word.id === id)));
  assert.ok(fs.existsSync(path.join(__dirname, "..", batch.exercise.image)), batch.exercise.image);
  const exerciseAnswers = window.CORE2000_EXERCISE_ANSWERS[batch.exercise.id];
  assert.ok(Array.isArray(exerciseAnswers), batch.exercise.id);
  assert.ok(exerciseAnswers.length >= 8 && exerciseAnswers.length <= 10, batch.exercise.id);
  assert.ok(exerciseAnswers.every((answer) => typeof answer === "string" && answer.trim()), batch.exercise.id);
}
assert.equal(Object.keys(window.CORE2000_EXERCISE_ANSWERS).length, 128);

const movers = window.WORD_BANKS.movers;
const moversWords = movers.filter((item) => item.cardType !== "phrase");
const moversPhrases = movers.filter((item) => item.cardType === "phrase");
assert.equal(moversWords.length, 247);
assert.equal(moversPhrases.length, 80);
assert.equal(new Set(moversWords.map((item) => item.sourceNumber)).size, 247);
assert.equal(new Set(moversPhrases.map((item) => item.sourceNumber)).size, 80);
assert.equal(new Set(movers.map((item) => item.visual.image)).size, 327);
assert.deepEqual(
  [...Array(8)].map((_, index) => moversWords.filter((item) => item.sourceDay === index + 1).length),
  [30, 30, 30, 30, 35, 31, 31, 30]
);
assert.deepEqual(
  [...Array(8)].map((_, index) => moversPhrases.filter((item) => item.sourcePart === index + 1).length),
  [10, 10, 10, 10, 10, 10, 10, 10]
);
assert.deepEqual(
  moversWords.map((item) => item.sourceNumber),
  [...Array(248)].map((_, index) => index + 1).filter((number) => number !== 49)
);
assert.deepEqual(
  [...Array(248)].map((_, index) => index + 1).filter((number) =>
    !moversWords.some((item) => item.sourceNumber === number)
  ),
  [49]
);
for (const item of movers) {
  assert.match(item.id, /^movers-2025-[a-z0-9-]+$/);
  assert.match(item.visual.image, /^assets\/movers(?:-phrase)?-images\/[a-z0-9-]+\.webp$/);
  assert.ok(
    fs.existsSync(path.join(__dirname, "..", item.visual.image)),
    item.visual.image
  );
  assert.notEqual(item.ipa, "/—/", item.word);
}
assert.deepEqual(
  moversPhrases.map((item) => item.sourceNumber),
  [...Array(80)].map((_, index) => index + 1)
);
for (const item of moversPhrases) {
  assert.equal(item.visual.sourceKind, "wikimedia-commons");
  assert.match(item.visual.sourceUrl, /^https:\/\/commons\.wikimedia\.org\//);
  assert.ok(item.visual.creator && item.visual.license && item.visual.fileTitle);
}
const moversAudit = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "movers-word-list-2025.json"), "utf8")
);
assert.equal(moversAudit.phrases.length, 80);
assert.equal(moversAudit.phraseCards.length, 80);
const phraseAttributions = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "movers-phrase-image-attributions.json"), "utf8")
).items;
assert.equal(phraseAttributions.length, 80);
assert.equal(new Set(phraseAttributions.map((item) => item.fileTitle.toLowerCase())).size, 80);
for (const item of phraseAttributions) {
  const imageBytes = fs.readFileSync(path.join(__dirname, "..", item.image));
  assert.equal(
    crypto.createHash("sha256").update(imageBytes).digest("hex"),
    item.webpSha256,
    item.image
  );
  assert.ok(item.creator && item.license && item.sourceUrl && item.modification);
}

const ketDriving = window.WORD_BANKS.ket.find((item) =>
  item.officialHeadword === "driving/driver's licence"
);
assert.equal(ketDriving.word, "driving licence");
assert.ok(ketDriving.acceptedAnswers.includes("driver's licence"));

const petAt = window.WORD_BANKS.pet.find((item) => item.word === "at");
assert.match(petAt.en, /place|time|direction|target/);

console.log("word-bank invariants: ok");
