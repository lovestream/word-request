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
  en: "a large road vehicle",
  zh: "卡车",
  visual: {},
  breakdown: []
};

const coreWord = {
  id: "core2000:test",
  word: "memory",
  acceptedAnswers: [],
  en: "the ability to remember",
  zh: "",
  visual: {},
  breakdown: { label: "SOUND CHUNKS", parts: [] },
  englishOnly: true
};

const windowStub = {
  CORE2000_COURSE: {
    batches: [{ exercise: { id: "core2000-b1-u01-a-exercise" } }]
  },
  CORE2000_EXERCISE_ANSWERS: {
    "core2000-b1-u01-a-exercise": ["a", "a", "d", "b", "c", "ease", "dentist", "finger", "body", "healthy"]
  },
  WORD_BANKS: {
    core2000: [coreWord],
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

assert.equal(api.studyDefinitionFor({ word: "blood", en: "Blood is the red liquid in your body." }), "Blood is the red liquid in your body.");
assert.equal(api.quizClueFor({ word: "blood", quizClue: "Blood is the red liquid in your body." }), "", "a clue containing the answer must be rejected");
assert.equal(api.quizClueFor({ word: "truck", acceptedAnswers: ["lorry"], quizClue: "A large road vehicle for carrying goods." }), "A large road vehicle for carrying goods.");
assert.equal(api.quizClueFor({ word: "truck", acceptedAnswers: ["lorry"], quizClue: "Another word for a lorry." }), "", "accepted answers must also stay out of quiz clues");
assert.equal(api.quizClueFor({ word: "website", quizClue: "Websites can contain many pages." }), "", "common inflections must not reveal the target");

const appSource = fs.readFileSync(path.join(__dirname, "..", "assets", "app.js"), "utf8");
const practiceSource = appSource.slice(appSource.indexOf("function renderPractice()"), appSource.indexOf("function renderCoreExercise()"));
const pkSource = appSource.slice(appSource.indexOf("function renderPkGame()"), appSource.indexOf("function submitPk()"));
assert.doesNotMatch(practiceSource, /data-word=/, "pre-answer spelling DOM must not carry the complete answer");
assert.doesNotMatch(practiceSource, /word\.en/, "original study definitions must never render as pre-answer clues");
assert.doesNotMatch(pkSource, /word\.en/, "PK must not use an answer-bearing Core definition");
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
assert.equal(portableRecord.formatVersion, 1);
assert.equal(portableRecord.summary.activeBank, "core2000");
assert.equal(portableRecord.summary.learnedWords, 1);
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
  nearMissUsed: false,
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
assert.equal(masteredProgress["ket:test"].step, 7);
assert.equal(masteredProgress["ket:test"].dueAt, null);

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
assert.equal(merged.today.tasks.length, 1, "semantic duplicate review tasks must collapse");
assert.equal(merged.today.tasks[0].id, "review:ket:test:4:full");

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
