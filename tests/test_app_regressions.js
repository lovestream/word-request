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

const windowStub = {
  CORE2000_COURSE: {
    batches: [{ exercise: { id: "core2000-b1-u01-a-exercise" } }],
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
const pkSource = appSource.slice(appSource.indexOf("function renderPkGame()"), appSource.indexOf("function submitPk()"));
const gradeSource = appSource.slice(appSource.indexOf("function gradePractice()"), appSource.indexOf("function advancePractice()"));
const submitPkSource = appSource.slice(appSource.indexOf("function submitPk()"), appSource.indexOf("function finishPk()"));
assert.doesNotMatch(practiceSource, /data-word=/, "pre-answer spelling DOM must not carry the complete answer");
assert.doesNotMatch(practiceSource, /word\.en/, "original study definitions must never render as pre-answer clues");
assert.doesNotMatch(pkSource, /word\.en/, "PK must not use an answer-bearing Core definition");
assert.doesNotMatch(gradeSource, /acceptedAnswers/, "semantic alternatives must not pass spelling practice");
assert.doesNotMatch(submitPkSource, /acceptedAnswers/, "semantic alternatives must not pass spelling PK");
assert.match(practiceSource, /aria-label="\$\{coreEnglish \? "Book picture clue" : "单词图片提示"\}"/);

assert.deepEqual(
  Array.from(api.bankKeys),
  ["core2000", "movers", "ket", "pet"],
  "only the four complete vocabulary banks should remain available"
);
assert.equal("junior" in windowStub.WORD_BANKS, false, "discontinued demo banks should be removed from the runtime store");
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
assert.equal(checkedExercise.wrongIndices.length, 0);
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
  stats: { streak: 3, bestStreak: 3, lastGoalDate: "2026-07-26" },
  scoreLedger: [],
  dailyCompletion: {},
  courseCompletion: {},
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
assert.ok(completionState.courseCompletion["core2000-b1-u01-b"], "both course sets must remain recorded");

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
assert.equal(returnAfterBreak.stats.streak, 6, "returning after missed days must preserve the habit chain without granting extra days");
assert.equal(returnAfterBreak.stats.bestStreak, 6);

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
