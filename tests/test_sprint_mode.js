"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function makeWord(index) {
  const number = String(index + 1).padStart(3, "0");
  return {
    id: `ket:sprint-${number}`,
    word: `term${number}`,
    acceptedAnswers: [],
    en: `ordered test word ${number}`,
    zh: `测试词 ${number}`,
    visual: {},
    breakdown: []
  };
}

const ketWords = Array.from({ length: 65 }, (_, index) => makeWord(index));
const moversWordCards = [
  { ...makeWord(100), id: "movers:day1-word1", word: "aunt", sourceNumber: 1, sourceDay: 1 },
  { ...makeWord(101), id: "movers:day1-word2", word: "daughter", sourceNumber: 2, sourceDay: 1 },
  { ...makeWord(102), id: "movers:day2-word1", word: "bat", sourceNumber: 31, sourceDay: 2 },
  { ...makeWord(103), id: "movers:day2-word2", word: "cage", sourceNumber: 32, sourceDay: 2 },
  { ...makeWord(104), id: "movers:day2-word3", word: "dolphin", sourceNumber: 33, sourceDay: 2 }
];
const moversPhraseCards = Array.from({ length: 25 }, (_, index) => ({
  ...makeWord(200 + index),
  id: `movers:phrase-${String(index + 1).padStart(2, "0")}`,
  word: `phrase ${index + 1}`,
  cardType: "phrase",
  sourceNumber: index + 1,
  sourcePart: Math.floor(index / 10) + 1
}));
const moversWords = [...moversWordCards, ...moversPhraseCards];
const outsideWord = {
  ...makeWord(999),
  id: "pet:outside-word",
  word: "outsider"
};

const stubElement = {
  innerHTML: "",
  addEventListener() {},
  classList: {
    add() {},
    remove() {},
    toggle() {}
  }
};

const windowStub = {
  __WORD_QUEST_TEST_ONLY__: true,
  WORD_BANKS: {
    movers: moversWords,
    ket: ketWords,
    pet: [outsideWord],
    junior: [],
    senior: [],
    cet4: [],
    cet6: [],
    ielts: [],
    toefl: []
    // Deliberately omit SAT so app.js exports its test API, then exits before render.
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
assert.ok(api, "sprint regression API should be available");
for (const name of [
  "sprintDayCount",
  "normalizeSprintDay",
  "sprintBatchInfo",
  "evaluateSprintPhase",
  "sanitizeSprintState",
  "sprintStageIsComplete",
  "progressForStudyView",
  "shouldSyncSprintDateBeforeAdvance"
]) {
  assert.equal(typeof api[name], "function", `WordQuestTest must export ${name}`);
}

function ids(items) {
  return Array.from(items, (item) => typeof item === "string" ? item : item.id);
}

function cleanTask(wordId) {
  return { wordId, cleanPass: true };
}

function missedTask(wordId) {
  return { wordId, cleanPass: false };
}

// Sixty-five ordered words must form two full 30-word days and one 5-word day.
assert.equal(api.sprintDayCount("ket"), 3);
assert.equal(api.normalizeSprintDay(-20, "ket"), 1);
assert.equal(api.normalizeSprintDay(2, "ket"), 2);
assert.equal(api.normalizeSprintDay(999, "ket"), 3);

const firstDay = api.sprintBatchInfo("ket", 1);
assert.equal(firstDay.start, 0);
assert.equal(firstDay.end, 30);
assert.equal(firstDay.total, 30);
assert.equal(ids(firstDay.wordIds).join(","), ids(ketWords.slice(0, 30)).join(","));

const secondDay = api.sprintBatchInfo("ket", 2);
assert.equal(secondDay.start, 30);
assert.equal(secondDay.end, 60);
assert.equal(secondDay.total, 30);
assert.equal(ids(secondDay.wordIds).join(","), ids(ketWords.slice(30, 60)).join(","));

const thirdDay = api.sprintBatchInfo("ket", 3);
assert.equal(thirdDay.start, 60);
assert.equal(thirdDay.end, 65);
assert.equal(thirdDay.total, 5);
assert.equal(ids(thirdDay.wordIds).join(","), ids(ketWords.slice(60)).join(","));

const clampedBatch = api.sprintBatchInfo("ket", 999);
assert.equal(clampedBatch.day, 3);
assert.equal(ids(clampedBatch.wordIds).join(","), ids(thirdDay.wordIds).join(","));

// Movers keeps PDF Word Days first, then schedules the phrase appendix in
// later 20-phrase days instead of mixing phrases into ordinary word days.
assert.equal(api.sprintDayCount("movers"), 4);
const moversDay1 = api.sprintBatchInfo("movers", 1);
assert.equal(moversDay1.scheduleKind, "movers-pdf-word");
assert.equal(moversDay1.sourceDay, 1);
assert.equal(moversDay1.wordTotal, 2);
assert.equal(moversDay1.phraseTotal, 0);
assert.equal(moversDay1.total, 2);
assert.deepEqual(ids(moversDay1.wordIds), [
  "movers:day1-word1",
  "movers:day1-word2"
]);
const moversDay2 = api.sprintBatchInfo("movers", 2);
assert.equal(moversDay2.start, 2);
assert.equal(moversDay2.end, 5);
assert.equal(moversDay2.wordTotal, 3);
assert.equal(moversDay2.phraseTotal, 0);
assert.deepEqual(ids(moversDay2.wordIds), [
  "movers:day2-word1",
  "movers:day2-word2",
  "movers:day2-word3"
]);
const moversPhraseDay1 = api.sprintBatchInfo("movers", 3);
assert.equal(moversPhraseDay1.scheduleKind, "movers-pdf-phrase");
assert.equal(moversPhraseDay1.wordTotal, 0);
assert.equal(moversPhraseDay1.phraseTotal, 20);
assert.equal(moversPhraseDay1.phraseStart, 1);
assert.equal(moversPhraseDay1.phraseEnd, 20);
assert.deepEqual(ids(moversPhraseDay1.wordIds), ids(moversPhraseCards.slice(0, 20)));
const moversPhraseDay2 = api.sprintBatchInfo("movers", 4);
assert.equal(moversPhraseDay2.phraseTotal, 5);
assert.equal(moversPhraseDay2.phraseStart, 21);
assert.equal(moversPhraseDay2.phraseEnd, 25);
assert.deepEqual(ids(moversPhraseDay2.wordIds), ids(moversPhraseCards.slice(20)));

const migratedMovers = api.sanitizeSprintState({
  sessionId: "movers:d1:old-fixed-30",
  day: 1,
  phase: "complete",
  cycle: 7,
  awaitingStart: true,
  wordIds: moversWordCards.slice(0, 2).map((word) => word.id),
  lastScore: 30,
  roundHistory: [{ cycle: 7, score: 30, mistakes: [] }]
}, "movers", 1);
assert.equal(migratedMovers.scheduleKey, "movers-word-list-2025:v2");
assert.equal(migratedMovers.phase, "cloze", "an old fixed-30 Movers session must restart on the PDF task");
assert.equal(migratedMovers.cycle, 1);
assert.equal(migratedMovers.awaitingStart, false);
assert.deepEqual(ids(migratedMovers.wordIds), ids(moversDay1.wordIds));

const phaseIds = ids(ketWords.slice(0, 3));

const afterCloze = api.evaluateSprintPhase(
  "cloze",
  phaseIds.map(cleanTask),
  phaseIds,
  1
);
assert.equal(afterCloze.phase, "full", "cloze must always advance to full spelling");
assert.equal(afterCloze.complete, false);

const afterFullMiss = api.evaluateSprintPhase(
  "full",
  [cleanTask(phaseIds[0]), missedTask(phaseIds[1]), cleanTask(phaseIds[2])],
  phaseIds,
  1
);
assert.equal(afterFullMiss.phase, "drill", "a full-spelling miss must enter drill");
assert.equal(ids(afterFullMiss.mistakes).join(","), phaseIds[1]);
assert.equal(afterFullMiss.cycle, 1);

const afterDrill = api.evaluateSprintPhase(
  "drill",
  [cleanTask(phaseIds[1])],
  phaseIds,
  1
);
assert.equal(afterDrill.phase, "final", "drill must be followed by a full final round");
assert.equal(afterDrill.complete, false);

const afterFinalMiss = api.evaluateSprintPhase(
  "final",
  [cleanTask(phaseIds[0]), cleanTask(phaseIds[1]), missedTask(phaseIds[2])],
  phaseIds,
  4
);
assert.equal(afterFinalMiss.phase, "drill");
assert.equal(afterFinalMiss.cycle, 5, "a failed final round must increment the cycle");
assert.equal(ids(afterFinalMiss.mistakes).join(","), phaseIds[2]);
assert.equal(afterFinalMiss.complete, false);

const afterPerfectFinal = api.evaluateSprintPhase(
  "final",
  phaseIds.map(cleanTask),
  phaseIds,
  5
);
assert.equal(afterPerfectFinal.phase, "complete");
assert.equal(afterPerfectFinal.cycle, 5);
assert.equal(afterPerfectFinal.complete, true);

// Repeated rows may not stand in for a missing word in the all-clean final round.
const duplicatedFinal = api.evaluateSprintPhase(
  "final",
  [cleanTask(phaseIds[0]), cleanTask(phaseIds[0]), cleanTask(phaseIds[1])],
  phaseIds,
  5
);
assert.equal(duplicatedFinal.complete, false, "duplicate word rows cannot complete a final round");
assert.equal(duplicatedFinal.phase, "drill");
assert.equal(ids(duplicatedFinal.mistakes).join(","), phaseIds[2]);

const expectedStageTasks = ["task:a", "task:b", "task:c"];
assert.equal(api.sprintStageIsComplete(expectedStageTasks, [
  { id: "task:a", status: "done" },
  { id: "task:b", status: "done" }
]), false, "a partially restored stage must not advance early");
assert.equal(api.sprintStageIsComplete(expectedStageTasks, [
  { id: "task:a", status: "done" },
  { id: "task:b", status: "done" },
  { id: "task:c", status: "done" }
]), true);

const sanitizedSprint = api.sanitizeSprintState({
  sessionId: "<script>alert(1)</script>",
  day: 999,
  wordIds: [outsideWord.id, ketWords[0].id, ketWords[0].id],
  phase: "not-a-real-phase",
  cycle: 10_000,
  awaitingStart: true,
  mistakeIds: [ketWords[60].id, ketWords[60].id, ketWords[0].id, outsideWord.id, "missing:id"],
  lastScore: 10_000,
  roundHistory: [{
    cycle: -5,
    score: 10_000,
    mistakes: [ketWords[61].id, ketWords[61].id, ketWords[1].id, outsideWord.id]
  }]
}, "ket", 1);

assert.equal(sanitizedSprint.day, 3);
assert.equal(ids(sanitizedSprint.wordIds).join(","), ids(ketWords.slice(60)).join(","));
assert.equal(sanitizedSprint.phase, "cloze");
assert.equal(sanitizedSprint.cycle, 999);
assert.equal(sanitizedSprint.lastScore, 5);
assert.match(sanitizedSprint.sessionId, /^ket:d3:\d+$/);
assert.equal(ids(sanitizedSprint.mistakeIds).join(","), ketWords[60].id);
assert.equal(ids(sanitizedSprint.roundHistory[0].mistakes).join(","), ketWords[61].id);

// Import sanitization must canonicalize semantic duplicate task IDs, reject
// words outside the selected block, and recompute cleanPass instead of trusting it.
const sprintSettings = {
  bank: "ket",
  dailyGoal: 10,
  practiceMode: "sprint",
  sprintDays: { ket: 1 }
};
const sanitizedToday = api.sanitizeToday({
  date: "2026-08-06",
  bank: "ket",
  goal: 999,
  practiceMode: "sprint",
  sprint: {
    sessionId: "ket:d1:test-session",
    day: 1,
    phase: "cloze",
    cycle: 1,
    awaitingStart: false
  },
  newIds: [outsideWord.id],
  learnedIds: firstDay.wordIds,
  practicedIds: [ketWords[30].id, outsideWord.id],
  dueIds: [],
  tasks: [
    {
      id: "forged-queued-id",
      wordId: ketWords[0].id,
      source: "sprint",
      mode: "cloze",
      sprintPhase: "cloze",
      status: "queued",
      attempts: 0
    },
    {
      id: "forged-done-id",
      wordId: ketWords[0].id,
      source: "sprint",
      mode: "cloze",
      sprintPhase: "cloze",
      status: "done",
      attempts: 1
    },
    {
      id: "forged-clean-pass",
      wordId: ketWords[1].id,
      source: "sprint",
      mode: "cloze",
      sprintPhase: "cloze",
      status: "done",
      attempts: 2,
      cleanPass: true
    },
    {
      id: "wrong-day-word",
      wordId: ketWords[30].id,
      source: "sprint",
      mode: "cloze",
      sprintPhase: "cloze",
      status: "done",
      attempts: 1
    },
    {
      id: "wrong-bank-word",
      wordId: outsideWord.id,
      source: "sprint",
      mode: "cloze",
      sprintPhase: "cloze",
      status: "done",
      attempts: 1
    },
    {
      id: "wrong-phase",
      wordId: ketWords[2].id,
      source: "sprint",
      mode: "full",
      sprintPhase: "full",
      status: "done",
      attempts: 1
    }
  ]
}, sprintSettings, {});

assert.equal(sanitizedToday.goal, 30);
assert.equal(ids(sanitizedToday.newIds).join(","), ids(ketWords.slice(0, 30)).join(","));
assert.equal(sanitizedToday.practicedIds.length, 0);
assert.equal(sanitizedToday.tasks.length, 2);
assert.equal(
  sanitizedToday.tasks[0].id,
  `sprint:ket:d1:test-session:cloze:${ketWords[0].id}:cloze`
);
assert.equal(sanitizedToday.tasks[0].status, "done", "the most complete duplicate task must win");
assert.equal(sanitizedToday.tasks[0].cleanPass, true);
assert.equal(sanitizedToday.tasks[1].wordId, ketWords[1].id);
assert.equal(sanitizedToday.tasks[1].cleanPass, false, "a forged cleanPass cannot override two attempts");

// Browsing an already scheduled word inside a sprint must not reset its
// Ebbinghaus step or due date merely because this is its first view today.
const scheduledProgress = {
  status: "reviewing",
  learnedAt: 1_700_000_000_000,
  step: 4,
  scheduleToken: 7,
  lapses: 1,
  correct: 9,
  dueAt: 1_800_000_000_000,
  initialModesDone: ["cloze", "full"]
};
const revisited = api.progressForStudyView(scheduledProgress, 1_900_000_000_000);
assert.equal(revisited.firstEver, false);
assert.equal(revisited.progress.status, "reviewing");
assert.equal(revisited.progress.step, 4);
assert.equal(revisited.progress.scheduleToken, 7);
assert.equal(revisited.progress.dueAt, 1_800_000_000_000);

const firstView = api.progressForStudyView(null, 1_900_000_000_000);
assert.equal(firstView.firstEver, true);
assert.equal(firstView.progress.status, "learning");
assert.equal(firstView.progress.learnedAt, 1_900_000_000_000);
assert.equal(firstView.progress.dueAt, null);

assert.equal(api.shouldSyncSprintDateBeforeAdvance(
  { practiceMode: "sprint", date: "2026-08-06" },
  null,
  "2026-08-07"
), true, "an unfinished sprint waiting on its result button must move to the new date before settlement");
assert.equal(api.shouldSyncSprintDateBeforeAdvance(
  { practiceMode: "sprint", date: "2026-08-06" },
  "review",
  "2026-08-07"
), false, "a separate review queue must not be redirected into the sprint queue");
assert.equal(api.shouldSyncSprintDateBeforeAdvance(
  { practiceMode: "mixed", date: "2026-08-06" },
  null,
  "2026-08-07"
), false);

console.log("sprint mode regressions: ok");
