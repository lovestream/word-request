"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const stubElement = {
  innerHTML: "",
  addEventListener() {},
  classList: {
    add() {},
    remove() {},
    toggle() {}
  }
};

const testWord = {
  id: "ket:test",
  word: "truck",
  acceptedAnswers: ["lorry"],
  semanticAlternatives: ["lorry"],
  spellingVariants: [],
  en: "a large road vehicle",
  zh: "卡车",
  visual: { emoji: "🚚" },
  breakdown: []
};

const coreWord = {
  id: "core2000:test",
  word: "memory",
  acceptedAnswers: [],
  en: "the ability to remember",
  zh: "",
  visual: { emoji: "🧠" },
  breakdown: { label: "SOUND CHUNKS", parts: [] },
  englishOnly: true
};

const coreTruck = {
  ...coreWord,
  id: "core2000:truck",
  word: "truck",
  en: "a large vehicle used to carry goods"
};

const temporaryPetWord = {
  ...coreWord,
  id: "pet:temporary-history",
  word: "journey",
  en: "an act of travelling from one place to another",
  englishOnly: false
};

const windowStub = {
  __WORD_QUEST_TEST_ONLY__: true,
  CORE2000_COURSE: {
    batches: [{
      id: "core2000-b1-u01-a",
      sequence: 1,
      wordIds: ["core2000:test", "core2000:truck"],
      exercise: { id: "core2000-b1-u01-a-exercise" }
    }],
    idAliases: { "core2000:old-memory": "core2000:test" }
  },
  CORE2000_EXERCISE_ANSWERS: {
    "core2000-b1-u01-a-exercise": ["a", "a", "d", "b", "c", "ease", "dentist", "finger", "body", "healthy"]
  },
  WORD_BANKS: {
    core2000: [coreWord, coreTruck],
    movers: [],
    ket: [testWord],
    junior: [],
    senior: [],
    cet4: [],
    cet6: [],
    ielts: [],
    toefl: []
    // Deliberately omit PET so app.js exports its test API, then exits before render.
  },
  addEventListener() {},
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
};

const context = {
  window: windowStub,
  document: {
    getElementById() {
      return stubElement;
    },
    addEventListener() {},
    querySelectorAll() {
      return [];
    },
    body: { dataset: {} }
  },
  console,
  Date,
  Intl,
  Math,
  Set,
  Map,
  URL,
  Blob,
  atob,
  structuredClone,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
};

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8"),
  context,
  { filename: "assets/app.js" }
);

const api = windowStub.WordQuestTest;
assert.ok(api, "app regression API should be available");
assert.equal(api.canonicalWordId("core2000:old-memory"), "core2000:test");
assert.equal(api.lexemeIdForWord(testWord), api.lexemeIdForWord(coreTruck), "the same spelling across banks must share one lexeme ID");
const aliasedProgress = api.sanitizeProgress({
  "core2000:old-memory": { status: "reviewing", learnedAt: 10, step: 1, scheduleToken: 2, dueAt: 20, correct: 3 }
});
assert.equal(aliasedProgress["core2000:test"].correct, 3, "a renamed card must keep its learning progress");
assert.equal("core2000:old-memory" in aliasedProgress, false);

assert.equal(api.studyDefinitionFor({ word: "blood", en: "Blood is the red liquid in your body." }), "Blood is the red liquid in your body.");
assert.equal(api.quizClueFor({ word: "blood", quizClue: "Blood is the red liquid in your body." }), "", "a clue containing the answer must be rejected");
assert.equal(api.quizClueFor({ word: "truck", acceptedAnswers: ["lorry"], quizClue: "A large road vehicle for carrying goods." }), "A large road vehicle for carrying goods.");
assert.equal(api.quizClueFor({ word: "truck", acceptedAnswers: ["lorry"], quizClue: "Another word for a lorry." }), "", "accepted answers must also stay out of quiz clues");
assert.equal(api.quizClueFor({ word: "website", quizClue: "Websites can contain many pages." }), "", "common inflections must not reveal the target");
assert.match(api.missingAssetLabel({ closest: (selector) => selector === ".core-workbook-page" }), /answer sheet still works/i);
assert.match(api.missingAssetLabel({ closest: () => false }), /English clue and audio/i);
assert.deepEqual(Array.from(api.semanticAlternativesFor(testWord)), ["lorry"]);
assert.deepEqual(Array.from(api.spellingAnswersFor(testWord)), ["truck"], "a synonym must not pass a target-word spelling test");
assert.deepEqual(Array.from(api.spellingAnswersFor({ word: "colour", spellingVariants: ["color"] })), ["colour", "color"]);
assert.equal(api.isPracticeLetter("é"), true, "accented English loanwords must remain typeable");
assert.equal(api.isPracticeLetter("-"), false);
const attemptEvent = api.createAttemptEvent({
  task: {
    mode: "full",
    source: "review",
    attempts: 1,
    assisted: false,
    usedAudio: false,
    hintIndices: [],
    attemptStartedAt: 1_000
  },
  word: coreWord,
  answerCorrect: true,
  answerShown: false,
  nearMiss: false,
  grade: "good",
  oldDueAt: 1_500,
  newDueAt: 9_000
}, 7, 2_500);
assert.equal(attemptEvent.cardId, coreWord.id);
assert.equal(attemptEvent.cueType, "image");
assert.equal(attemptEvent.firstAttempt, true);
assert.equal(attemptEvent.firstAttemptCorrect, true);
assert.equal(attemptEvent.durationMs, 1_500);
assert.equal(attemptEvent.grade, "good");
assert.equal(attemptEvent.sequence, 7);
assert.equal(api.sanitizeAttemptEvents([attemptEvent, attemptEvent]).length, 1, "attempt events deduplicate by eventId");
assert.equal(api.practiceCueType({ mode: "full", usedAudio: true }, testWord), "audio-dictation");
assert.equal(api.practiceCueType({ mode: "cloze" }, testWord), "partial-spelling");
assert.equal(api.practiceGradeForTask({ attempts: 1, hadLapse: false, assisted: false, nearMissUsed: false }, true), "good");
assert.equal(api.practiceGradeForTask({ attempts: 2, hadLapse: false, assisted: false, nearMissUsed: true }, true), "hard");
assert.equal(api.practiceGradeForTask({ attempts: 2, hadLapse: true, assisted: false, nearMissUsed: false }, true), "again");
assert.equal(api.practiceGradeForTask({ attempts: 1, hadLapse: false, assisted: true, nearMissUsed: false }, true), "again");

const appSource = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const practiceSource = appSource.slice(appSource.indexOf("function renderPractice()"), appSource.indexOf("function renderCoreExercise()"));
const coreExerciseSource = appSource.slice(appSource.indexOf("function renderCoreExercise()"), appSource.indexOf("function renderPracticeComplete()"));
const practiceCompleteSource = appSource.slice(appSource.indexOf("function renderPracticeComplete()"), appSource.indexOf("function relativeTime("));
const pkSource = appSource.slice(appSource.indexOf("function renderPkGame()"), appSource.indexOf("function submitPk()"));
const gradeSource = appSource.slice(appSource.indexOf("function gradePractice()"), appSource.indexOf("function advancePractice()"));
const submitPkSource = appSource.slice(appSource.indexOf("function submitPk()"), appSource.indexOf("function finishPk()"));
assert.doesNotMatch(practiceSource, /data-word=/, "pre-answer spelling DOM must not carry the complete answer");
assert.doesNotMatch(practiceSource, /word\.en/, "original study definitions must never render as pre-answer clues");
assert.doesNotMatch(pkSource, /word\.en/, "PK must not use an answer-bearing Core definition");
assert.doesNotMatch(gradeSource, /acceptedAnswers/, "semantic alternatives must not pass spelling practice");
assert.doesNotMatch(submitPkSource, /acceptedAnswers/, "semantic alternatives must not pass spelling PK");
assert.match(practiceSource, /aria-label="\$\{coreEnglish \? "Book picture clue" : "单词图片提示"\}"/);
assert.match(coreExerciseSource, /Skip this optional exercise and return to today's tasks\./, "a workbook page without answers must route back to today's plan");
assert.match(practiceCompleteSource, /Skip optional exercise · Back to today/);
assert.match(appSource, /TODAY'S SESSION IS PAUSED/, "a missing catalog must show an explicit paused-session message");
assert.match(appSource, /AI 批量生成与导入/, "My Words must expose the AI word-pack workflow");
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
assert.match(indexSource, /id="aiWordPackFile"[^>]+\.wordpack\.json/, "the AI word-pack file picker must accept the documented extension");
const wordPackTemplate = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "templates", "kevin-word-pack-template.wordpack.json"), "utf8"));
assert.equal(wordPackTemplate.format, "kevin-word-quest-ai-pack");
assert.equal(wordPackTemplate.version, 1);
assert.match(fs.readFileSync(path.join(__dirname, "..", "templates", "AI_WORD_PACK_PROMPT.md"), "utf8"), /不要在聊天正文中粘贴大段 Base64/);
const stylesSource = fs.readFileSync(path.join(__dirname, "..", "assets", "styles.css"), "utf8");
assert.match(stylesSource, /@media \(max-width: 820px\)[\s\S]*?\.btn-small\s*\{\s*min-height:\s*44px;/, "small mobile controls must keep a 44px touch target");
assert.match(stylesSource, /\.notebook-tabs button\s*\{[\s\S]*?min-height:\s*44px;/, "My Words tabs must keep a 44px touch target");
assert.match(stylesSource, /\.saved-word-source button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/, "reading-source removal must have a 44px hit area");

assert.deepEqual(
  Array.from(api.bankKeys),
  ["core2000", "movers", "ket", "pet"],
  "only the four complete vocabulary banks should remain available"
);
assert.equal("junior" in windowStub.WORD_BANKS, false, "discontinued demo banks should be removed from the runtime store");
assert.equal(api.isBankAvailable("core2000"), true);
assert.equal(api.isBankAvailable("pet"), false, "a missing PET script must only disable PET");
assert.equal(api.firstAvailableBank(), "core2000");
assert.equal(api.safeBank("pet"), "core2000", "an unavailable selected bank must fall back to the first available bank");
assert.equal(api.safeKnownBank("pet"), "pet", "historical bank labels must not depend on whether the bank script loaded today");
assert.equal(api.appVersion, "2026.10.07");
assert.deepEqual(JSON.parse(JSON.stringify(api.bankAvailability().pet)), { available: false, count: 0 });
assert.equal(api.coreExerciseAvailable({ coreExerciseId: "core2000-b1-u01-a-exercise" }), true);
const savedCoreAnswers = windowStub.CORE2000_EXERCISE_ANSWERS["core2000-b1-u01-a-exercise"];
delete windowStub.CORE2000_EXERCISE_ANSWERS["core2000-b1-u01-a-exercise"];
assert.equal(api.coreExerciseAvailable({ coreExerciseId: "core2000-b1-u01-a-exercise" }), false, "a missing answer key must only disable the optional workbook check");
windowStub.CORE2000_EXERCISE_ANSWERS["core2000-b1-u01-a-exercise"] = savedCoreAnswers;
assert.equal(api.shouldIgnoreGlobalEnter({ tagName: "INPUT" }), true);
assert.equal(api.shouldIgnoreGlobalEnter({ tagName: "BUTTON" }), true);
assert.equal(api.shouldIgnoreGlobalEnter({ tagName: "MAIN" }), false);

assert.equal(api.taskHasStarted({
  status: "queued",
  attempts: 0,
  assisted: false,
  hintIndices: [],
  draft: "t    "
}), true, "a partial spelling draft must protect the current plan");

const allLetters = new Set([0, 1, 2, 3, 4]);
assert.equal(api.canEnterPracticeAnswer("lorry", "truck", allLetters), true);
assert.equal(
  api.canEnterPracticeAnswer("lorry", "truck", allLetters, new Set([0])),
  false,
  "a hint-locked canonical letter must make an incompatible alias unavailable"
);
assert.equal(api.normalizeDailyGoal(0, 10), 1);
assert.equal(api.normalizeDailyGoal(10.5, 10), 11);
assert.equal(api.normalizeDailyGoal("", 20), 20);
assert.equal(api.coreExerciseAnswerMatches("A and D", "a,d"), true);
assert.equal(api.coreExerciseAnswerMatches("d, a", "a,d"), true);
assert.equal(api.coreExerciseAnswerMatches("lungs breathe", "lungs,breathe"), true);
assert.equal(api.coreExerciseAnswerMatches("lung breathe", "lungs,breathe"), false);
const selectedVoice = api.selectAmericanVoice([
  { name: "Daniel", lang: "en-GB", localService: true },
  { name: "US Standard", lang: "en-US", localService: true },
  { name: "Samantha Enhanced", lang: "en-US", localService: true }
]);
assert.equal(selectedVoice.name, "Samantha Enhanced", "a high-quality American voice should win");
assert.equal(api.selectAmericanVoice([{ name: "Daniel Premium", lang: "en-GB" }]).lang, "en-GB", "English remains a safe fallback when US voices are unavailable");
assert.equal(api.selectAmericanVoice([{ name: "Bad News", lang: "en-US" }]), null, "novelty voices must never be selected for study");
assert.equal(api.speechVoiceLabel([{ name: "Samantha Enhanced", lang: "en-US" }]), "US voice · en-US");
assert.equal(api.speechVoiceLabel([{ name: "Daniel Premium", lang: "en-GB" }]), "English fallback · en-GB");
assert.equal(api.speechVoiceLabel([]), "en-US voice requested");
const voiceLabelNode = { textContent: "unchanged" };
const updatedVoiceLabel = api.updateVoiceLabels([{ name: "Samantha Enhanced", lang: "en-US" }], {
  querySelectorAll(selector) {
    assert.equal(selector, '[data-role="voice-label"]');
    return [voiceLabelNode];
  }
});
assert.equal(updatedVoiceLabel, "US voice · en-US");
assert.equal(voiceLabelNode.textContent, "· US voice · en-US", "voice refresh must update only the visible label text");
assert.deepEqual(
  JSON.parse(JSON.stringify(api.buildStudySpeechSequence(
    "blood",
    "Blood is the red liquid in your body.",
    "The doctor checks the blood."
  ))),
  [
    { text: "blood", rate: 0.72, kind: "word" },
    { text: "Blood is the red liquid in your body.", rate: 0.74, kind: "definition" },
    { text: "The doctor checks the blood.", rate: 0.76, kind: "example" }
  ],
  "the main play button must read word, definition, and example in order"
);
const portableRecord = api.createPortableRecord({
  profile: { name: "Kevin" },
  settings: { bank: "core2000" },
  stats: { xp: 321 },
  progress: { "core2000:test": { status: "reviewing" } },
  today: { date: "2026-08-26" }
}, Date.UTC(2026, 7, 26, 8, 0, 0));
assert.equal(portableRecord.format, "kevin-word-quest-portable-record");
assert.equal(portableRecord.formatVersion, 2);
assert.equal(portableRecord.summary.activeBank, "core2000");
assert.equal(portableRecord.summary.learnedWords, 1);
assert.equal(portableRecord.summary.attemptEvents, 0);
const protectedSummary = api.portableStateSummary({
  savedAt: 100,
  updatedAt: 200,
  progress: { a: {} },
  orphanProgress: { missing: {} },
  stats: { xp: 50, coins: 25 },
  today: { date: "2026-08-26", tasks: [{ status: "queued" }, { status: "done" }] }
});
assert.deepEqual(JSON.parse(JSON.stringify(protectedSummary)), {
  savedAt: 200,
  words: 2,
  xp: 50,
  coins: 25,
  events: 0,
  pending: 1,
  todayDate: "2026-08-26"
});
assert.equal(api.importedRecordIsOlder(
  { updatedAt: 200, progress: {}, stats: {} },
  { updatedAt: 100, progress: {}, stats: {} }
), true);
assert.equal(api.importedRecordIsOlder(
  { updatedAt: 100, progress: {}, stats: {} },
  { updatedAt: 200, progress: {}, stats: {} }
), false);
assert.equal(api.stateFromPortableRecord(portableRecord), portableRecord.state);
assert.equal(api.stateFromPortableRecord({ schemaVersion: 1 }).schemaVersion, 1, "legacy JSON backups remain importable");
assert.equal(api.stateFromPortableRecord({
  format: "kevin-word-quest-portable-record",
  formatVersion: 1,
  state: { schemaVersion: 1 }
}).schemaVersion, 1, "portable V1 backups remain importable");
assert.throws(() => api.stateFromPortableRecord({
  format: "kevin-word-quest-portable-record",
  formatVersion: 999,
  state: {}
}), /不支持/);
assert.equal(api.taskCountsAsCleanInitial({ source: "new", status: "passed", cleanPass: true }), true);
assert.equal(api.taskCountsAsCleanInitial({ source: "new", status: "passed", cleanPass: false }), false);
assert.equal(api.taskCountsAsCleanInitial({ source: "new", status: "done", cleanPass: false }), false);

const retryTask = {
  status: "passed",
  attempts: 3,
  hadLapse: true,
  assisted: true,
  nearMissUsed: true,
  completedAt: 123,
  draft: "truck",
  hintIndices: [1],
  errorIndices: [2],
  feedback: { type: "correct" },
  cleanPass: true
};
api.resetTaskForMasteryRetry(retryTask);
assert.deepEqual(JSON.parse(JSON.stringify(retryTask)), {
  status: "queued",
  attempts: 0,
  hadLapse: false,
  assisted: false,
  usedAudio: false,
  nearMissUsed: false,
  attemptStartedAt: retryTask.attemptStartedAt,
  completedAt: null,
  draft: "",
  hintIndices: [],
  errorIndices: [],
  feedback: null,
  cleanPass: false
});

const migratedExercise = api.sanitizeCoreExercises({
  "core2000-b1-u01-a-exercise": {
    responses: ["a", "wrong"],
    completedAt: 123
  }
})["core2000-b1-u01-a-exercise"];
assert.equal(migratedExercise.completedAt, null, "old ungraded workbook pages must not remain falsely complete");
assert.equal(migratedExercise.correctIndices.length, 0);
assert.equal(migratedExercise.evidenceQuality, "legacy-summary");
assert.equal(migratedExercise.firstAttemptAt, null, "legacy final answers must not be fabricated into first-attempt evidence");
assert.deepEqual(Array.from(migratedExercise.firstAttemptResponses), []);

const checkedExercise = api.sanitizeCoreExercises({
  "core2000-b1-u01-a-exercise": {
    responses: ["a", "a", "d", "b", "c", "ease", "dentist", "finger", "body", "healthy"],
    correctIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    wrongIndices: [9],
    attempts: 2,
    completedAt: 123
  }
})["core2000-b1-u01-a-exercise"];
assert.equal(checkedExercise.completedAt, 123);
assert.equal(checkedExercise.rewardedAt, 123, "legacy completed workbook pages must migrate to a permanent rewarded marker");
assert.equal(checkedExercise.wrongIndices.length, 0);
assert.equal(checkedExercise.evidenceQuality, "legacy-summary", "old completed pages remain valid but do not gain invented event evidence");
const exerciseAnswers = windowStub.CORE2000_EXERCISE_ANSWERS["core2000-b1-u01-a-exercise"];
const exerciseHash = api.coreAnswerKeyHash(exerciseAnswers);
assert.equal(exerciseHash, api.coreAnswerKeyHash([...exerciseAnswers]), "the normalized answer key must have a stable version hash");
const evidenceExercise = api.sanitizeCoreExercises({
  "core2000-b1-u01-a-exercise": {
    responses: exerciseAnswers,
    correctIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    wrongIndices: [],
    attempts: 2,
    completedAt: 500,
    firstAttemptAt: 400,
    firstAttemptResponses: ["a", "wrong", "d", "b", "c", "ease", "dentist", "finger", "body", "healthy"],
    firstAttemptCorrectIndices: [0, 2, 3, 4, 5, 6, 7, 8, 9],
    firstAttemptWrongIndices: [1],
    submissions: [{ at: 400, responses: ["a", "wrong", "d", "b", "c", "ease", "dentist", "finger", "body", "healthy"], correctIndices: [0, 2, 3, 4, 5, 6, 7, 8, 9], wrongIndices: [1], answerKeyHash: exerciseHash }],
    firstAttemptAnswerKeyHash: exerciseHash,
    answerKeyHash: exerciseHash,
    evidenceQuality: "event-log"
  }
})["core2000-b1-u01-a-exercise"];
assert.equal(evidenceExercise.firstAttemptResponses[1], "wrong");
assert.deepEqual(Array.from(evidenceExercise.firstAttemptWrongIndices), [1]);
assert.equal(evidenceExercise.submissions.length, 1);
assert.equal(evidenceExercise.answerKeyHash, exerciseHash);
assert.equal(evidenceExercise.firstAttemptAnswerKeyHash, exerciseHash);
const legacyEventWithoutFirstHash = api.sanitizeCoreExercises({
  "core2000-b1-u01-a-exercise": {
    ...evidenceExercise,
    firstAttemptAnswerKeyHash: undefined
  }
})["core2000-b1-u01-a-exercise"];
assert.equal(legacyEventWithoutFirstHash.firstAttemptAnswerKeyHash, "", "older event logs must not borrow a later answer-key hash during migration");
assert.deepEqual(JSON.parse(JSON.stringify(api.coreExerciseEvidenceMetrics({ coreExercises: { "core2000-b1-u01-a-exercise": evidenceExercise } }))), {
  pages: 1,
  answerCount: 10,
  correctCount: 9,
  firstAttemptRate: 90,
  changedAnswerKeys: 0
});
const legacyFollowup = api.recordCoreExerciseSubmission(checkedExercise, {
  at: 600,
  responses: exerciseAnswers,
  correctIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  wrongIndices: [],
  answerKeyHash: exerciseHash,
  completed: true
});
assert.equal(legacyFollowup.attempts, 3);
assert.equal(legacyFollowup.firstAttemptAt, null, "a legacy record with attempts must never gain a fabricated first attempt later");
assert.equal(legacyFollowup.firstAttemptAnswerKeyHash, "");
assert.equal(legacyFollowup.evidenceQuality, "legacy-summary");
assert.equal(legacyFollowup.submissions.length, 1, "later real submissions may be retained without rewriting legacy history");
assert.equal(legacyFollowup.rewardedAt, 123, "a workbook reward marker must survive later submissions even after the score ledger is trimmed");
const genuineFirstAttempt = api.recordCoreExerciseSubmission({ attempts: 0 }, {
  at: 700,
  responses: exerciseAnswers,
  correctIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  wrongIndices: [],
  answerKeyHash: "first-version",
  completed: true
});
const laterAnswerVersion = api.recordCoreExerciseSubmission(genuineFirstAttempt, {
  at: 800,
  responses: exerciseAnswers,
  correctIndices: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  wrongIndices: [],
  answerKeyHash: "later-version",
  completed: true
});
assert.equal(laterAnswerVersion.firstAttemptAnswerKeyHash, "first-version", "later answer keys must not overwrite the first-attempt version");
assert.equal(laterAnswerVersion.answerKeyHash, "later-version");
const oldWorkbookAnswers = ["body"];
const newWorkbookAnswers = ["bodies"];
const oldWorkbookHash = api.coreAnswerKeyHash(oldWorkbookAnswers);
const newWorkbookHash = api.coreAnswerKeyHash(newWorkbookAnswers);
const oldCorrectWorkbook = api.recordCoreExerciseSubmission({ attempts: 0 }, {
  at: 900,
  responses: ["body"],
  correctIndices: [0],
  wrongIndices: [],
  answerKeyHash: oldWorkbookHash,
  completed: true
});
assert.deepEqual(
  Array.from(api.reusableCoreExerciseCorrectIndices(oldCorrectWorkbook, newWorkbookHash)),
  [],
  "an answer locked under an older answer key must be unlocked when the key changes"
);
const regradedOldAnswer = api.gradeCoreExerciseResponses(oldCorrectWorkbook, ["body"], newWorkbookAnswers);
assert.deepEqual(Array.from(regradedOldAnswer.correctIndices), []);
assert.deepEqual(Array.from(regradedOldAnswer.wrongIndices), [0], "the old answer must be checked against the new key instead of bypassing validation");
const failedRegradeRecord = api.recordCoreExerciseSubmission(oldCorrectWorkbook, {
  at: 1000,
  responses: ["body"],
  correctIndices: regradedOldAnswer.correctIndices,
  wrongIndices: regradedOldAnswer.wrongIndices,
  answerKeyHash: regradedOldAnswer.answerKeyHash,
  completed: false
});
assert.equal(failedRegradeRecord.completedAt, null);
assert.deepEqual(Array.from(failedRegradeRecord.firstAttemptResponses), ["body"]);
assert.equal(failedRegradeRecord.firstAttemptAnswerKeyHash, oldWorkbookHash);
const correctedRegrade = api.gradeCoreExerciseResponses(failedRegradeRecord, ["bodies"], newWorkbookAnswers);
const correctedWorkbookRecord = api.recordCoreExerciseSubmission(failedRegradeRecord, {
  at: 1100,
  responses: ["bodies"],
  correctIndices: correctedRegrade.correctIndices,
  wrongIndices: correctedRegrade.wrongIndices,
  answerKeyHash: correctedRegrade.answerKeyHash,
  completed: true
});
assert.deepEqual(Array.from(correctedWorkbookRecord.correctIndices), [0]);
assert.equal(correctedWorkbookRecord.answerKeyHash, newWorkbookHash);
assert.deepEqual(Array.from(correctedWorkbookRecord.firstAttemptResponses), ["body"], "regrading must not rewrite the historical first response");
assert.equal(correctedWorkbookRecord.firstAttemptAnswerKeyHash, oldWorkbookHash, "regrading must keep the historical first answer-key version");
assert.deepEqual(
  Array.from(api.filterDueIdsForBank(["ket:test", "core2000:test", "core2000:test"], "core2000")),
  ["core2000:test"],
  "CORE 2000 reviews must exclude due words from other banks and de-duplicate the queue"
);
assert.deepEqual(
  Array.from(api.filterDueIdsForBank(["core2000:test"], "core2000", ["core2000:test"])),
  [],
  "today's ten new words must not also appear in the due-review queue"
);

const normalizedProgress = api.sanitizeProgress({
  "ket:test": {
    status: "reviewing",
    learnedAt: 10,
    step: 3,
    scheduleToken: 2,
    dueAt: null
  }
});
assert.equal(normalizedProgress["ket:test"].status, "learning");
assert.equal(normalizedProgress["ket:test"].dueAt, null);

const masteredProgress = api.sanitizeProgress({
  "ket:test": {
    status: "mastered",
    learnedAt: 10,
    step: 1,
    dueAt: Date.now()
  }
});
assert.equal(masteredProgress["ket:test"].status, "mature");
assert.equal(masteredProgress["ket:test"].step, 6);
assert.ok(Number.isFinite(masteredProgress["ket:test"].dueAt));
assert.equal(api.isDue(masteredProgress["ket:test"], Date.now()), true, "old mastered cards must return to the review queue");
assert.equal(masteredProgress["ket:test"].scheduleVersion, 2);

const scheduleNow = new Date(2026, 8, 29, 8, 0, 0).getTime();
const longTermProgress = api.nextReviewSchedule({
  status: "reviewing",
  learnedAt: scheduleNow - 40 * 86_400_000,
  step: 5,
  scheduleToken: 3,
  lapses: 0,
  correct: 6,
  dueAt: scheduleNow
}, "correct", false, scheduleNow);
assert.equal(longTermProgress.status, "mature");
assert.equal(longTermProgress.step, 6);
assert.equal(longTermProgress.dueAt, new Date(2026, 10, 28, 8, 0, 0).getTime());
assert.equal(longTermProgress.scheduleVersion, 2);
assert.equal(longTermProgress.correct, 7);
assert.equal(api.isDue(longTermProgress, longTermProgress.dueAt), true, "mature cards must remain reviewable");

let cappedProgress = { ...longTermProgress, step: 9, dueAt: scheduleNow };
cappedProgress = api.nextReviewSchedule(cappedProgress, "correct", false, scheduleNow);
assert.equal(cappedProgress.step, 9);
assert.equal(cappedProgress.status, "mature");
assert.ok(cappedProgress.dueAt > scheduleNow, "the final stage must schedule another annual review");

const relearningProgress = api.nextReviewSchedule({ ...longTermProgress, dueAt: scheduleNow }, "lapse", false, scheduleNow);
assert.equal(relearningProgress.status, "relearning");
assert.equal(relearningProgress.step, 0);
assert.equal(relearningProgress.dueAt, scheduleNow + 10 * 60 * 1000);
assert.equal(relearningProgress.lapses, 1);
assert.equal(relearningProgress.correct, longTermProgress.correct, "a lapse must not fabricate a successful recall");
assert.equal(relearningProgress.lastSuccessAt, longTermProgress.lastSuccessAt, "relearning preserves earlier success history");

const hardProgress = api.nextReviewSchedule({ ...longTermProgress, step: 6, dueAt: scheduleNow }, "hard", false, scheduleNow);
assert.equal(hardProgress.step, 6, "Hard keeps the current stage instead of granting a Good advance");
assert.equal(hardProgress.status, "mature");
assert.equal(hardProgress.lastGrade, "hard");
assert.equal(hardProgress.dueAt, new Date(2026, 10, 28, 8, 0, 0).getTime());

const easyProgress = api.nextReviewSchedule({ ...longTermProgress, step: 5, dueAt: scheduleNow }, "easy", false, scheduleNow);
assert.equal(easyProgress.step, 7, "Easy may skip one stage after verified independent recall");
assert.equal(easyProgress.status, "mature");
assert.equal(easyProgress.lastGrade, "easy");

const overloadedProgress = {};
const overloadedDueIds = Array.from({ length: 35 }, (_, index) => {
  const id = `word-${String(index + 1).padStart(2, "0")}`;
  overloadedProgress[id] = {
    status: index === 34 ? "relearning" : "reviewing",
    step: index === 34 ? 0 : 3,
    lapses: index === 20 ? 2 : 0,
    dueAt: scheduleNow - (index + 1) * 60_000
  };
  return id;
});
const overloadedPlan = api.buildDailyPlan(overloadedDueIds, overloadedProgress, 10);
assert.equal(overloadedPlan.dueAllIds.length, 35);
assert.equal(overloadedPlan.plannedReviewIds.length, 25, "daily review work must be capped");
assert.equal(overloadedPlan.reviewBacklogIds.length, 10, "unplanned due cards must remain visible as backlog");
assert.equal(overloadedPlan.newLimit, 0, "more than 30 due cards must create a review-only day");
assert.ok(overloadedPlan.estimatedMinutes <= 20, "the initial plan estimate must respect the time budget");
assert.equal(overloadedPlan.plannedReviewIds[0], "word-35", "a relearning card must be scheduled before ordinary overdue cards");

const moderatePlan = api.buildDailyPlan(overloadedDueIds.slice(0, 20), overloadedProgress, 10);
assert.ok(moderatePlan.newLimit >= 5 && moderatePlan.newLimit <= 8, "11-20 due cards should reduce but not eliminate new words");
assert.ok(moderatePlan.estimatedMinutes <= 20);

const ordinaryDay = {
  pausedAt: null,
  newIds: ["ket:test"],
  learnedIds: [],
  practicedIds: []
};
assert.equal(api.ordinaryHomeAction(ordinaryDay, 2).action, "start-review", "ordinary days must lead with planned reviews before new study");
assert.equal(api.ordinaryHomeAction(ordinaryDay, 0).route, "learn");
assert.equal(api.ordinaryHomeAction({ ...ordinaryDay, pausedAt: 123 }, 2).action, "resume-today");

assert.deepEqual(
  JSON.parse(JSON.stringify(api.learnAvailability({ newIds: [], learnedIds: [], practicedIds: [] }, { reviewRemaining: 35 }))),
  { kind: "review-only", reviewRemaining: 35 },
  "a review-only day must never be described as a completed word bank"
);
assert.equal(api.learnAvailability({
  newIds: ["ket:test"], learnedIds: ["ket:test"], practicedIds: []
}).kind, "ready-for-practice", "finished picture study must lead into spelling");
assert.equal(api.learnAvailability({
  completed: true, newIds: ["ket:test"], learnedIds: ["ket:test"], practicedIds: ["ket:test"]
}).kind, "day-complete", "a completed day must not invite extra new study");
assert.equal(api.learnAvailability({
  newIds: [], learnedIds: [], practicedIds: []
}, { coreSetComplete: true, nextCoreSetAvailable: true, bankComplete: false }).kind, "core-set-complete");
assert.equal(api.learnAvailability({
  newIds: [], learnedIds: [], practicedIds: []
}, { bankComplete: true }).kind, "bank-complete", "only verified full-bank completion gets the completion message");
assert.equal(api.learnAvailability({
  newIds: [], learnedIds: [], practicedIds: []
}, { bankComplete: false }).kind, "no-new-today");

const metricsNow = new Date(2026, 8, 30, 12, 0, 0).getTime();
const truckLexeme = api.lexemeIdForWord(testWord);
const memoryLexeme = api.lexemeIdForWord(coreWord);
const metrics = api.learningMetrics({
  progress: {
    "ket:test": { learnedAt: metricsNow - 5 * 86_400_000 },
    "core2000:test": { learnedAt: metricsNow - 20 * 86_400_000 }
  },
  lexemeProgress: {
    [truckLexeme]: { status: "mature", dueAt: metricsNow + 60 * 86_400_000 },
    [memoryLexeme]: { status: "reviewing", dueAt: metricsNow + 86_400_000 }
  },
  attemptEvents: [
    { eventId: "m1", cardId: "core2000:test", lexemeId: memoryLexeme, occurredAt: metricsNow - 2 * 86_400_000, mode: "full", source: "new", firstAttempt: true, firstAttemptCorrect: true, answerCorrect: true, usedHint: false, answerShown: false, grade: "good", durationMs: 60_000 },
    { eventId: "m2", cardId: "ket:test", lexemeId: truckLexeme, occurredAt: metricsNow - 86_400_000, mode: "full", source: "review", firstAttempt: true, firstAttemptCorrect: false, answerCorrect: false, usedHint: false, answerShown: true, grade: "again", durationMs: 120_000 },
    { eventId: "m3", cardId: "ket:test", lexemeId: truckLexeme, occurredAt: metricsNow - 3_600_000, mode: "full", source: "review", firstAttempt: true, firstAttemptCorrect: true, answerCorrect: true, usedHint: false, answerShown: false, grade: "good", durationMs: 60_000 }
  ],
  today: { reviewBacklogIds: ["ket:test"] }
}, metricsNow);
assert.equal(metrics.seen, 2);
assert.equal(metrics.recognized, null, "recognition must remain unmeasured until a dedicated test exists");
assert.equal(metrics.independentlySpelled, 2);
assert.equal(metrics.mature, 1);
assert.equal(metrics.new7, 1);
assert.equal(metrics.new30, 2);
assert.equal(metrics.firstAttemptRate, 67);
assert.equal(metrics.retentionRate, 50);
assert.equal(metrics.backlog, 1);
assert.equal(metrics.difficultWords[0].word, "truck");

const recognitionEvents = api.sanitizeRecognitionEvents([
  { eventId: "recognition:device:1", cardId: "ket:test", selectedCardId: "ket:test", occurredAt: metricsNow, weekKey: "2026-09-28", correct: true, sessionId: "s", deviceId: "d", sequence: 1 },
  { eventId: "recognition:device:2", cardId: "missing:test", selectedCardId: "ket:test", occurredAt: metricsNow, weekKey: "2026-09-28", correct: true }
]);
assert.equal(recognitionEvents.length, 1);
assert.equal(recognitionEvents[0].firstAttempt, true);
const recognitionMetrics = api.learningMetrics({
  progress: { "ket:test": { learnedAt: metricsNow - 5 * 86_400_000 } },
  lexemeProgress: {},
  attemptEvents: [],
  recognitionEvents,
  today: { reviewBacklogIds: [] }
}, metricsNow);
assert.equal(recognitionMetrics.recognized, 1);
assert.equal(recognitionMetrics.recognitionMeasured, true);
const checkupMetrics = api.recognitionMetrics({ recognitionEvents: [
  ...recognitionEvents,
  { eventId: "recognition:device:3", cardId: "core2000:test", senseId: "core2000:test:default", occurredAt: metricsNow - 7 * 86_400_000, weekKey: "2026-09-21", correct: false },
  { eventId: "recognition:device:4", cardId: "core2000:truck", senseId: "core2000:truck:default", occurredAt: metricsNow - 7 * 86_400_000, weekKey: "2026-09-21", correct: true }
] }, metricsNow);
assert.deepEqual(JSON.parse(JSON.stringify(checkupMetrics.currentWeek)), { weekKey: "2026-09-28", correct: 1, total: 1 });
assert.equal(checkupMetrics.averagePercent, 67, "four-week average must use actual checkup answers, not total learned words");
assert.equal(checkupMetrics.uniqueCorrectEver, 2);
assert.equal(checkupMetrics.testedUniqueEver, 3);
assert.equal(checkupMetrics.completedThisWeek, true);
const partialCheckupMetrics = api.recognitionMetrics({ recognitionEvents }, metricsNow, 5);
assert.equal(partialCheckupMetrics.currentWeekPlanned, 5);
assert.equal(partialCheckupMetrics.completedThisWeek, false, "one answered checkup item must not be reported as a completed five-item week");

assert.equal(api.localWeekKey(new Date(2026, 8, 30, 12)), "2026-09-28");
const weeklyPlan = api.weeklyCheckPlan({
  progress: {
    "ket:test": { learnedAt: 10 },
    "core2000:test": { learnedAt: 20 },
    "core2000:truck": { learnedAt: 30 }
  },
  today: { newIds: ["core2000:test"] }
}, new Date(2026, 8, 30, 12));
assert.deepEqual(Array.from(weeklyPlan), ["ket:test"], "weekly check must exclude today's new cards and deduplicate the same spelling");
assert.ok(api.weeklyCheckOptions("ket:test", weeklyPlan, "2026-09-28").includes("ket:test"));
const weeklySource = {
  progress: { "ket:test": { learnedAt: 10 } },
  today: { newIds: [] },
  recognitionEvents: [],
  recognitionPlans: {}
};
assert.deepEqual(Array.from(api.ensureWeeklyCheckPlan(weeklySource, new Date(2026, 8, 29, 12), 1234)), ["ket:test"]);
weeklySource.today.newIds = ["ket:test"];
assert.deepEqual(
  Array.from(api.weeklyCheckPlan(weeklySource, new Date(2026, 9, 2, 12))),
  ["ket:test"],
  "after the first start, the same weekly recognition cards must stay frozen across days"
);
assert.equal(weeklySource.recognitionPlans["2026-09-28"].startedAt, 1234);
assert.deepEqual(JSON.parse(JSON.stringify(api.sanitizeRecognitionPlans(weeklySource.recognitionPlans))), {
  "2026-09-28": { weekKey: "2026-09-28", cardIds: ["ket:test"], startedAt: 1234 }
});
const migratedStartedWeek = {
  progress: { "ket:test": { learnedAt: 10 }, "core2000:test": { learnedAt: 20 } },
  today: { newIds: ["ket:test"] },
  recognitionEvents: [{ cardId: "ket:test", weekKey: "2026-09-28", occurredAt: 100 }],
  recognitionPlans: {}
};
assert.equal(
  api.ensureWeeklyCheckPlan(migratedStartedWeek, new Date(2026, 9, 2, 12), 200)[0],
  "ket:test",
  "a migrated in-progress week must retain already answered cards even after the date changes"
);

const baseBackup = {
  schemaVersion: 1,
  settings: {
    bank: "ket",
    dailyGoal: 10,
    practiceMode: "full",
    autoSound: true,
    sound: true,
    typoAssist: true,
    showEnglish: true
  },
  stats: {},
  progress: {
    "ket:test": {
      status: "reviewing",
      learnedAt: 10,
      step: 0,
      scheduleToken: 4,
      dueAt: Date.now() - 1000
    }
  },
  today: {
    date: "2026-07-27",
    bank: "ket",
    goal: 10,
    practiceMode: "full",
    newIds: [],
    learnedIds: [],
    dueIds: ["ket:test"],
    tasks: [
      { id: "fake-a", wordId: "ket:test", source: "review", mode: "full", status: "queued" },
      { id: "fake-b", wordId: "ket:test", source: "review", mode: "full", status: "queued" }
    ]
  }
};

const merged = api.mergeState(baseBackup, true);
assert.equal(merged.schemaVersion, 2, "V1 state must migrate to the explicit V2 schema");
assert.equal(merged.migratedFromSchema, 1);
assert.equal(merged.historyQuality, "legacy-summary", "legacy totals must not be presented as fabricated item-level evidence");
assert.equal(merged.today.tasks.length, 1, "semantic duplicate review tasks must collapse");
assert.equal(merged.today.tasks[0].id, "review:ket:test:4:full");
assert.equal(merged.today.planVersion, 1);
assert.deepEqual(Array.from(merged.today.plannedReviewIds), ["ket:test"]);
assert.deepEqual(JSON.parse(JSON.stringify(merged.recognitionPlans)), {}, "legacy V1/V2 records must migrate safely without recognition plans");
assert.deepEqual(JSON.parse(JSON.stringify(merged.unresolvedData)), {
  savedWords: {},
  recognitionEvents: [],
  recognitionPlans: {}
}, "legacy V1/V2 records must migrate safely without unresolved catalog data");
const unavailableHistoryBank = api.mergeState({
  ...baseBackup,
  history: [{ date: "2026-07-20", bank: "pet", learned: 4, reviewed: 2, xp: 30 }],
  today: null
}, true);
assert.equal(unavailableHistoryBank.history[0].bank, "pet", "historical bank identity must survive temporary catalog unavailability");

const frozenPlan = api.mergeState({
  ...baseBackup,
  progress: {
    ...baseBackup.progress,
    "core2000:test": {
      status: "reviewing",
      learnedAt: 10,
      step: 1,
      scheduleToken: 2,
      dueAt: Date.now() - 500
    }
  },
  today: {
    ...baseBackup.today,
    planVersion: 1,
    dueAllIds: ["ket:test", "core2000:test"],
    plannedReviewIds: ["ket:test"],
    reviewBacklogIds: ["core2000:test"],
    baselineDueIds: ["ket:test"]
  }
}, true);
assert.deepEqual(Array.from(frozenPlan.today.plannedReviewIds), ["ket:test"]);
assert.equal(frozenPlan.today.plannedReviewIds.includes("core2000:test"), false, "a later due card must not expand today's frozen plan");
assert.deepEqual(Array.from(frozenPlan.today.reviewBacklogIds), ["core2000:test"]);

const pausedPlan = api.mergeState({
  ...baseBackup,
  today: { ...baseBackup.today, pausedAt: 456789 }
}, true);
assert.equal(pausedPlan.today.pausedAt, 456789, "a voluntary rest must survive reload without completing or deleting today's plan");
assert.equal(pausedPlan.today.completed, false);
assert.equal(pausedPlan.today.goalAwarded, false);

const sharedLexemeState = api.mergeState({
  ...baseBackup,
  progress: {
    "ket:test": {
      status: "mature",
      learnedAt: 10,
      step: 6,
      scheduleVersion: 2,
      scheduleToken: 5,
      dueAt: Date.now() + 60 * 86_400_000,
      lastReviewedAt: 100,
      lastSuccessAt: 100
    },
    "core2000:truck": {
      status: "relearning",
      learnedAt: 20,
      step: 0,
      scheduleVersion: 2,
      scheduleToken: 2,
      dueAt: Date.now() + 10 * 60_000,
      lastReviewedAt: 200,
      lastSuccessAt: 50
    }
  },
  today: null
}, true);
const truckLexemeId = api.lexemeIdForWord(testWord);
assert.equal(Object.keys(sharedLexemeState.lexemeProgress).length, 1, "duplicate source cards must migrate into one spelling schedule");
assert.equal(sharedLexemeState.lexemeProgress[truckLexemeId].status, "relearning", "the latest observed lapse must win as one complete schedule record");
assert.equal(sharedLexemeState.lexemeProgress[truckLexemeId].step, 0);
assert.equal(api.initialScheduleNeeded(sharedLexemeState.lexemeProgress[truckLexemeId], true), false, "studying the same spelling from another source must not reset its schedule");

const savedWordState = api.mergeState({
  ...baseBackup,
  savedWords: {
    "ket:test": { cardId: "ket:test", sourceTag: "Dragon Masters", train: true, addedAt: 123 },
    "missing:test": { cardId: "missing:test", sourceTag: "Unknown", train: true, addedAt: 124 }
  },
  today: null
}, true);
assert.deepEqual(JSON.parse(JSON.stringify(savedWordState.savedWords)), {
  "ket:test": {
    cardId: "ket:test",
    train: true,
    addedAt: 123,
    sources: [{ sourceTag: "Dragon Masters", context: "", addedAt: 123 }]
  }
});
assert.deepEqual(Array.from(api.savedTrainingIds(savedWordState)), ["ket:test"]);
assert.deepEqual(
  Array.from(api.filterDueIdsForBank(["ket:test", "core2000:test"], "core2000", [], savedWordState)),
  ["ket:test", "core2000:test"],
  "Core daily review must include due My Words cards whose train flag is true"
);
const multiSourceSavedWords = api.sanitizeSavedWords({
  "ket:test": {
    cardId: "ket:test",
    train: true,
    addedAt: 100,
    sources: [
      { sourceTag: "Dragon Masters", context: "The cave was dark.", addedAt: 101 },
      { sourceTag: "dragon masters", context: "the cave was dark.", addedAt: 102 },
      { sourceTag: "Mighty Robot", context: "A robot whispered.", addedAt: 103 }
    ]
  }
});
assert.equal(multiSourceSavedWords["ket:test"].sources.length, 2, "source + normalized context must deduplicate repeated reading encounters");
assert.equal(multiSourceSavedWords["ket:test"].sources[1].sourceTag, "Mighty Robot");
const editedSources = api.mergeReadingSources(multiSourceSavedWords["ket:test"].sources, [
  { sourceTag: "New Book", context: "A new reading scene.", addedAt: 104 }
], 100);
assert.equal(editedSources.length, 3, "editing or adding a reading encounter must preserve all existing sources");
assert.equal(editedSources[0].sourceTag, "Dragon Masters");

const customDraft = api.sanitizeCustomWordDraft({
  word: "whispered",
  pos: "verb",
  lemma: "whisper",
  formType: "past tense",
  en: "spoke very quietly",
  example: "The dragon whispered a secret.",
  context: "Kevin found it in Dragon Masters.",
  sourceTag: "Dragon Masters",
  image: "javascript:alert(1)"
});
assert.equal(customDraft.word, "whispered");
assert.equal(customDraft.lemma, "whisper");
assert.equal(customDraft.formType, "past tense");
assert.equal(api.lemmaIdForWord(customDraft), api.lemmaIdForWord({ word: "whisper", lemma: "whisper" }), "inflected forms should link to the same word family");
assert.notEqual(api.lexemeIdForWord(customDraft), api.lexemeIdForWord({ word: "whisper" }), "the exact inflected spelling must keep its own spelling schedule");
assert.equal(customDraft.visual.image, undefined, "custom picture input must reject unsafe URL schemes");
assert.ok(customDraft.breakdown.parts.length > 1, "custom cards need safe visual spelling chunks for the shared study view");
assert.equal(customDraft.breakdown.type, "spelling chunks");
assert.equal(api.sanitizeCustomWordDraft({ word: "123", en: "a number", example: "It is 123." }), null);

const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const aiWordPack = api.sanitizeAiWordPack({
  format: "kevin-word-quest-ai-pack",
  version: 1,
  title: "Dragon Masters test pack",
  source: "Dragon Masters",
  trainByDefault: true,
  words: [{
    word: "whispered",
    partOfSpeech: "verb",
    ipa: "/ˈwɪspərd/",
    lemma: "whisper",
    formType: "past tense",
    definition: "spoke very quietly",
    example: "The dragon whispered a secret.",
    context: "The dragon whispered into Ana's ear.",
    spellingChunks: ["whis", "pered"],
    memoryTip: "Picture a secret moving quietly.",
    image: { mimeType: "image/png", base64: tinyPngBase64, alt: "A quiet secret" }
  }]
});
assert.equal(aiWordPack.words.length, 1);
assert.equal(aiWordPack.words[0].draft.ipa, "/ˈwɪspərd/");
assert.deepEqual(Array.from(aiWordPack.words[0].draft.breakdown.parts, (part) => part.text), ["whis", "pered"]);
assert.match(aiWordPack.words[0].draft.visual.image, /^data:image\/png;base64,/);
assert.ok(aiWordPack.imageBytes > 32);
assert.equal(api.safeCustomImage("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "", "embedded SVG must not be accepted as a card image");
assert.equal(api.safeCustomImage("data:image/png;base64,QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB"), "", "a mislabeled Base64 payload must not pass image validation");
assert.throws(() => api.sanitizeAiWordPack({
  format: "kevin-word-quest-ai-pack",
  version: 1,
  source: "Broken pack",
  words: [{ word: "empty", definition: "with nothing inside", example: "The box is empty.", image: { mimeType: "image/webp", base64: "" } }]
}), /缺少|图片|有效单词/);
const importedWordPackState = { customWords: {}, savedWords: {} };
const firstWordPackImport = api.applyAiWordPack(importedWordPackState, aiWordPack, 1_000);
assert.equal(firstWordPackImport.added, 1);
assert.equal(Object.keys(importedWordPackState.customWords).length, 1);
const importedWordPackId = firstWordPackImport.importedIds[0];
assert.equal(importedWordPackState.savedWords[importedWordPackId].train, true);
assert.match(importedWordPackState.customWords[importedWordPackId].visual.image, /^data:image\/png;base64,/);
const repeatedWordPackImport = api.applyAiWordPack(importedWordPackState, aiWordPack, 2_000);
assert.equal(repeatedWordPackImport.added, 0);
assert.equal(repeatedWordPackImport.merged, 1, "reimporting the same AI card must merge its reading source instead of duplicating the card");
assert.equal(Object.keys(importedWordPackState.customWords).length, 1);
assert.equal(api.sanitizeCustomWords(importedWordPackState.customWords)[importedWordPackId].ipa, "/ˈwɪspərd/", "embedded pictures and IPA must survive a state reload");
const archivedAiImportState = {
  customWords: {
    "custom:archived-ai-001": {
      ...aiWordPack.words[0].draft,
      id: "custom:archived-ai-001",
      archived: true,
      archivedSavedEntry: {
        train: false,
        addedAt: 500,
        sources: [{ sourceTag: "Older Reader", context: "An older context.", addedAt: 500 }]
      }
    }
  },
  savedWords: {}
};
api.applyAiWordPack(archivedAiImportState, aiWordPack, 3_000);
assert.equal(archivedAiImportState.customWords["custom:archived-ai-001"].archived, false);
assert.equal(archivedAiImportState.savedWords["custom:archived-ai-001"].sources.length, 2, "restoring an archived AI card must preserve all earlier reading sources");
const compactAiBackup = JSON.parse(api.compactBackupJson(JSON.stringify({
  customWords: importedWordPackState.customWords,
  progress: { "custom:test": { correct: 7 } }
})));
assert.equal(compactAiBackup.customWords[importedWordPackId].visual.image, undefined, "the rolling local backup must not duplicate embedded image bytes");
assert.equal(compactAiBackup.customWords[importedWordPackId].visual.emoji, "📖");
assert.equal(compactAiBackup.progress["custom:test"].correct, 7, "compacting pictures must preserve learning evidence");

const archivedCustomDraft = api.sanitizeCustomWordDraft({
  ...customDraft,
  id: "custom:archive-001",
  archived: true,
  archivedSavedEntry: {
    train: true,
    addedAt: 90,
    sources: [
      { sourceTag: "Dragon Masters", context: "First full context.", addedAt: 91 },
      { sourceTag: "Mighty Robot", context: "Second full context.", addedAt: 92 }
    ]
  }
}, "custom:archive-001");
assert.equal(archivedCustomDraft.archivedSavedEntry.train, true);
assert.equal(archivedCustomDraft.archivedSavedEntry.sources.length, 2, "archive migration must retain every reading source for restoration");

const customCardId = "custom:whispered-001";
const customWordState = api.mergeState({
  ...baseBackup,
  customWords: {
    [customCardId]: {
      ...customDraft,
      id: customCardId,
      createdAt: 111,
      updatedAt: 222
    }
  },
  savedWords: {
    [customCardId]: { cardId: customCardId, sourceTag: "Dragon Masters", train: true, addedAt: 333 }
  },
  progress: {
    ...baseBackup.progress,
    [customCardId]: { status: "learning", learnedAt: 444, step: 0, dueAt: null }
  },
  today: null
}, true);
assert.equal(customWordState.customWords[customCardId].word, "whispered");
assert.equal(customWordState.savedWords[customCardId].train, true);
assert.equal(customWordState.progress[customCardId].learnedAt, 444, "custom-card learning history must survive export/import sanitization");
assert.ok(customWordState.lexemeProgress[api.lexemeIdForWord(customWordState.customWords[customCardId])]);

const frozenSavedWordPlan = api.mergeState({
  ...baseBackup,
  savedWords: {},
  today: {
    ...baseBackup.today,
    planVersion: 1,
    newLimit: 1,
    newIds: ["core2000:truck"],
    learnedIds: [],
    dueIds: [],
    dueAllIds: [],
    plannedReviewIds: [],
    baselineDueIds: [],
    reviewBacklogIds: [],
    tasks: []
  }
}, true);
assert.deepEqual(
  Array.from(frozenSavedWordPlan.today.newIds),
  ["core2000:truck"],
  "removing a saved-word tag must not rewrite an already frozen daily plan"
);

const duplicateNewBackup = {
  ...baseBackup,
  progress: {
    "ket:test": {
      status: "learning",
      learnedAt: 10,
      step: 0,
      scheduleToken: 0,
      dueAt: null
    }
  },
  today: {
    ...baseBackup.today,
    newIds: ["ket:test"],
    learnedIds: ["ket:test"],
    dueIds: [],
    tasks: [
      { id: "fake-new-a", wordId: "ket:test", source: "new", mode: "full", status: "queued" },
      { id: "fake-new-b", wordId: "ket:test", source: "new", mode: "full", status: "done" }
    ]
  }
};
const mergedNew = api.mergeState(duplicateNewBackup, true);
assert.equal(mergedNew.today.tasks.length, 1);
assert.equal(mergedNew.today.tasks[0].status, "done", "the most complete duplicate task must win");

const orphaned = api.mergeState({
  ...baseBackup,
  progress: {
    "future-bank:missing-card": {
      status: "reviewing",
      learnedAt: 10,
      step: 2,
      scheduleToken: 3,
      lapses: 1,
      correct: 3,
      dueAt: Date.now() - 1000
    }
  },
  today: null
}, true);
assert.equal(Object.keys(orphaned.progress).length, 0);
assert.equal(orphaned.orphanProgress["future-bank:missing-card"].status, "reviewing");
assert.equal(orphaned.orphanProgress["future-bank:missing-card"].reason, "missing-card");

const rehydrated = api.mergeState({
  ...baseBackup,
  progress: {},
  orphanProgress: {
    "ket:test": {
      status: "reviewing",
      learnedAt: 10,
      step: 1,
      scheduleToken: 2,
      dueAt: Date.now() + 1000
    }
  },
  today: null
}, true);
assert.equal(rehydrated.progress["ket:test"].status, "reviewing", "a restored word bank must recover quarantined progress");
assert.equal(Object.keys(rehydrated.orphanProgress).length, 0);

windowStub.WORD_BANKS.pet = [temporaryPetWord];
api.invalidateWordCatalogCaches();
const petHistoryState = api.mergeState({
  ...baseBackup,
  progress: {
    [temporaryPetWord.id]: {
      status: "reviewing",
      learnedAt: 10,
      step: 2,
      scheduleToken: 3,
      dueAt: Date.now() + 1000
    }
  },
  savedWords: {
    [temporaryPetWord.id]: {
      cardId: temporaryPetWord.id,
      train: true,
      addedAt: 20,
      sources: [{ sourceTag: "PET Reader", context: "A long journey began.", addedAt: 21 }]
    }
  },
  recognitionEvents: [{
    eventId: "recognition:pet-device:1",
    cardId: temporaryPetWord.id,
    selectedCardId: temporaryPetWord.id,
    occurredAt: 30,
    weekKey: "2026-09-28",
    correct: true,
    sessionId: "pet-session",
    deviceId: "pet-device",
    sequence: 1
  }],
  recognitionPlans: {
    "2026-09-28": {
      weekKey: "2026-09-28",
      cardIds: [temporaryPetWord.id],
      startedAt: 25
    }
  },
  today: {
    ...baseBackup.today,
    bank: "pet",
    goal: 1,
    newIds: [temporaryPetWord.id],
    learnedIds: [temporaryPetWord.id],
    practicedIds: [],
    dueIds: [],
    dueAllIds: [],
    plannedReviewIds: [],
    baselineDueIds: [],
    reviewBacklogIds: [],
    tasks: [],
    completed: false
  }
}, true);
assert.ok(petHistoryState.progress[temporaryPetWord.id]);
assert.ok(petHistoryState.savedWords[temporaryPetWord.id]);
assert.equal(petHistoryState.recognitionEvents.length, 1);
assert.deepEqual(Array.from(petHistoryState.recognitionPlans["2026-09-28"].cardIds), [temporaryPetWord.id]);

delete windowStub.WORD_BANKS.pet;
api.invalidateWordCatalogCaches();
const degradedPetState = api.mergeState(petHistoryState, true);
assert.ok(degradedPetState.orphanProgress[temporaryPetWord.id], "missing-bank progress must stay quarantined");
assert.equal(degradedPetState.savedWords[temporaryPetWord.id], undefined);
assert.equal(degradedPetState.recognitionEvents.length, 0);
assert.equal(degradedPetState.recognitionPlans["2026-09-28"], undefined);
assert.equal(degradedPetState.today.catalogUnavailableBank, "pet", "an unfinished Today session must be explicitly paused when its bank is unavailable");
assert.ok(degradedPetState.today.pausedAt);
assert.deepEqual(Array.from(degradedPetState.today.newIds), [temporaryPetWord.id]);
assert.ok(degradedPetState.unresolvedData.savedWords[temporaryPetWord.id], "missing-bank My Words data must stay quarantined");
assert.equal(degradedPetState.unresolvedData.recognitionEvents.length, 1, "missing-bank recognition history must stay quarantined");
assert.deepEqual(
  Array.from(degradedPetState.unresolvedData.recognitionPlans["2026-09-28"].cardIds),
  [temporaryPetWord.id],
  "a frozen weekly plan must stay intact while its bank is unavailable"
);
assert.deepEqual(
  Array.from(api.weeklyCheckPlan(degradedPetState, new Date(2026, 9, 2, 12))),
  [],
  "an unresolved frozen plan must not participate in the current UI or be silently replaced"
);
const pausedPetSprint = api.sanitizeToday({
  date: "2026-09-30",
  bank: "pet",
  practiceMode: "sprint",
  completed: false,
  sprint: {
    sessionId: "pet:d3:paused-test",
    day: 3,
    scheduleKey: "pet:d3:v1",
    wordIds: [temporaryPetWord.id],
    phase: "drill",
    cycle: 2,
    awaitingStart: false,
    mistakeIds: [temporaryPetWord.id],
    lastScore: 0,
    roundHistory: [{ cycle: 1, score: 0, mistakes: [temporaryPetWord.id] }]
  },
  newIds: [temporaryPetWord.id],
  learnedIds: [temporaryPetWord.id],
  practicedIds: [],
  tasks: []
}, {
  ...baseBackup.settings,
  bank: "pet",
  practiceMode: "sprint",
  sprintDays: { pet: 3 }
}, {
  [temporaryPetWord.id]: petHistoryState.progress[temporaryPetWord.id]
}, {}, {});
assert.equal(pausedPetSprint.catalogUnavailableBank, "pet");
assert.equal(pausedPetSprint.sprint.day, 3, "a missing catalog must not reset the selected sprint day");
assert.equal(pausedPetSprint.sprint.phase, "drill", "a missing catalog must not reset the active sprint phase");
assert.deepEqual(Array.from(pausedPetSprint.sprint.wordIds), [temporaryPetWord.id]);
assert.deepEqual(Array.from(pausedPetSprint.sprint.mistakeIds), [temporaryPetWord.id]);

const savedWhilePetMissing = JSON.parse(JSON.stringify(degradedPetState));
windowStub.WORD_BANKS.pet = [temporaryPetWord];
api.invalidateWordCatalogCaches();
const restoredPetState = api.mergeState(savedWhilePetMissing, true);
assert.ok(restoredPetState.progress[temporaryPetWord.id], "progress must return when the missing bank loads again");
assert.equal(restoredPetState.savedWords[temporaryPetWord.id].sources[0].context, "A long journey began.");
assert.equal(restoredPetState.recognitionEvents[0].cardId, temporaryPetWord.id);
assert.deepEqual(Array.from(restoredPetState.recognitionPlans["2026-09-28"].cardIds), [temporaryPetWord.id]);
assert.equal(restoredPetState.today.catalogUnavailableBank, "");
assert.deepEqual(Array.from(restoredPetState.today.newIds), [temporaryPetWord.id], "the paused Today plan must return with its bank");
assert.equal(Object.keys(restoredPetState.unresolvedData.savedWords).length, 0);
assert.equal(restoredPetState.unresolvedData.recognitionEvents.length, 0);
assert.equal(Object.keys(restoredPetState.unresolvedData.recognitionPlans).length, 0);
delete windowStub.WORD_BANKS.pet;
api.invalidateWordCatalogCaches();

assert.equal(api.shouldRejectStaleWrite(
  { revision: 5 },
  { revision: 6, writerId: "another-tab" },
  "this-tab"
), true, "a stale tab must not silently overwrite a newer revision");
assert.equal(api.shouldRejectStaleWrite(
  { revision: 6 },
  { revision: 6, writerId: "another-tab" },
  "this-tab"
), false);
assert.equal(api.shouldRejectStaleWrite(
  { revision: 5 },
  { revision: 6, writerId: "this-tab" },
  "this-tab"
), false, "the current writer may continue its own revision chain");

const completionState = {
  settings: { bank: "core2000" },
  stats: { streak: 3, bestStreak: 3, lastGoalDate: "2026-07-26" },
  scoreLedger: [],
  dailyCompletion: {},
  courseCompletion: {},
  progress: {
    "core2000:test": { dueAt: 100, initialModesDone: ["cloze", "full"] },
    "core2000:truck": { dueAt: 100, initialModesDone: ["cloze", "full"] }
  },
  lexemeProgress: {},
  history: []
};
const firstSetDay = {
  date: "2026-07-27",
  bank: "core2000",
  coreBatchId: "core2000-b1-u01-a",
  coreExerciseId: "core2000-b1-u01-a-exercise",
  practicedIds: ["core2000:test"],
  reviewDoneIds: [],
  sessionXp: 75
};
assert.equal(api.dailyCompletionExists(completionState, firstSetDay.date), false);
assert.equal(api.recordCompletionState(completionState, firstSetDay, 1000, true), true);
assert.equal(completionState.stats.streak, 4);
assert.equal(completionState.history.length, 1);
assert.ok(completionState.courseCompletion["core2000-b1-u01-a"]);

const incompleteCoreSetState = {
  ...completionState,
  stats: { streak: 0, bestStreak: 0, lastGoalDate: null },
  dailyCompletion: {},
  courseCompletion: {},
  history: [],
  progress: {
    "core2000:test": { dueAt: 100, initialModesDone: ["cloze", "full"] },
    "core2000:truck": { dueAt: null, initialModesDone: ["cloze"] }
  }
};
api.recordCompletionState(incompleteCoreSetState, firstSetDay, 1500, true);
assert.equal(incompleteCoreSetState.courseCompletion["core2000-b1-u01-a"], undefined, "a partial Core day must not mark the whole set complete");

const secondSetDay = {
  ...firstSetDay,
  coreBatchId: "core2000-b1-u01-b",
  coreExerciseId: "core2000-b1-u01-b-exercise",
  sessionXp: 40
};
assert.equal(api.dailyCompletionExists(completionState, secondSetDay.date), true);
assert.equal(api.recordCompletionState(completionState, secondSetDay, 2000, false), false);
assert.equal(completionState.stats.streak, 4, "a second set on the same day must not reset or increase the streak");
assert.equal(completionState.history.length, 1, "daily goal history must have one row per completed date");
assert.equal(completionState.courseCompletion["core2000-b1-u01-b"], undefined, "an unknown or incomplete Core set must not enter course completion");

assert.equal(api.dayDistance("2026-03-07", "2026-03-10"), 3, "calendar-day distance must remain stable across daylight-saving changes");
const returnAfterBreak = {
  stats: { streak: 6, bestStreak: 6, lastGoalDate: "2026-09-20" },
  scoreLedger: [],
  dailyCompletion: {},
  courseCompletion: {},
  history: []
};
assert.equal(api.recordCompletionState(returnAfterBreak, {
  ...firstSetDay,
  date: "2026-09-24",
  coreBatchId: "core2000-b1-u02-a"
}, 3000, true), true);
assert.equal(returnAfterBreak.stats.streak, 7, "returning after rest and completing the day must add one learning day");
assert.equal(returnAfterBreak.stats.bestStreak, 7);

assert.throws(
  () => api.mergeState({ schemaVersion: 1, settings: [], stats: [], progress: [] }, true),
  /必要字段/
);

const phaseProgress = {
  "ket:test": {
    initialModesDone: []
  }
};
api.restoreInitialModesFromLedger(phaseProgress, [
  { id: "new:2026-07-26:ket:test:cloze:pass" }
]);
assert.equal(Array.from(phaseProgress["ket:test"].initialModesDone).join(","), "cloze");

console.log("app state regressions: ok");
