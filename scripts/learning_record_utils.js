#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");

const PORTABLE_FORMAT = "kevin-word-quest-portable-record";

function readRecord(filename) {
  const bytes = fs.readFileSync(filename);
  const parsed = JSON.parse(bytes.toString("utf8"));
  const state = parsed?.format === PORTABLE_FORMAT ? parsed.state : parsed;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("学习记录必须是 JSON 对象");
  }
  if (state.schemaVersion !== 1) {
    throw new Error(`当前只支持只读审计 V1 记录，收到 schemaVersion=${state.schemaVersion}`);
  }
  for (const key of ["settings", "stats", "progress"]) {
    if (!state[key] || typeof state[key] !== "object" || Array.isArray(state[key])) {
      throw new Error(`学习记录缺少 ${key}`);
    }
  }
  return {
    filename,
    bytes,
    parsed,
    state,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
  };
}

function bankForCardId(cardId) {
  for (const bank of ["core2000", "movers", "ket", "pet", "custom"]) {
    if (cardId === bank || cardId.startsWith(`${bank}-`) || cardId.startsWith(`${bank}:`)) return bank;
  }
  return "unknown";
}

function countBy(values, keyForValue) {
  const counts = {};
  for (const value of values) {
    const key = keyForValue(value);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function summarizeRecord(record) {
  const { state } = record;
  const progressEntries = Object.entries(state.progress || {});
  const asOf = Number(state.savedAt) || Date.now();
  const dueEntries = progressEntries.filter(([, progress]) =>
    progress
    && progress.status !== "learning"
    && Number.isFinite(Number(progress.dueAt))
    && Number(progress.dueAt) <= asOf
  );
  const exercises = Object.values(state.coreExercises || {});
  const ledger = Array.isArray(state.scoreLedger) ? state.scoreLedger : [];
  const history = Array.isArray(state.history) ? state.history : [];
  const attemptEvents = Array.isArray(state.attemptEvents) ? state.attemptEvents : [];

  return {
    sha256: record.sha256,
    schemaVersion: state.schemaVersion,
    format: record.parsed?.format || "legacy-raw-state",
    formatVersion: record.parsed?.formatVersion || null,
    savedAt: Number(state.savedAt) || null,
    selectedBank: state.settings.bank || null,
    progress: {
      total: progressEntries.length,
      byBank: countBy(progressEntries, ([cardId]) => bankForCardId(cardId)),
      byStatus: countBy(progressEntries, ([, progress]) => progress?.status || "unknown"),
      pendingInitial: progressEntries.filter(([, progress]) => progress?.status === "learning").length,
      dueAsOfSavedAt: dueEntries.length,
      dueByBank: countBy(dueEntries, ([cardId]) => bankForCardId(cardId))
    },
    stats: {
      learned: Number(state.stats.learned) || 0,
      reviewed: Number(state.stats.reviewed) || 0,
      correct: Number(state.stats.correct) || 0,
      attempts: Number(state.stats.attempts) || 0,
      xp: Number(state.stats.xp) || 0,
      coins: Number(state.stats.coins) || 0,
      streak: Number(state.stats.streak) || 0,
      lastGoalDate: state.stats.lastGoalDate || null
    },
    retainedHistory: {
      scoreLedgerEvents: ledger.length,
      ledgerXp: ledger.reduce((sum, event) => sum + (Number(event?.xp) || 0), 0),
      ledgerCoins: ledger.reduce((sum, event) => sum + (Number(event?.coins) || 0), 0),
      goalHistoryRows: history.length,
      ledgerIsTruncated: ledger.length >= 500,
      goalHistoryMayBeTruncated: history.length >= 120
    },
    attemptEvidence: {
      events: attemptEvents.length,
      firstAttempts: attemptEvents.filter((event) => event?.firstAttempt).length,
      independentGood: attemptEvents.filter((event) => event?.grade === "good" && !event?.usedHint && !event?.answerShown).length,
      byGrade: countBy(attemptEvents, (event) => event?.grade || "unknown"),
      byCueType: countBy(attemptEvents, (event) => event?.cueType || "unknown")
    },
    coreExercises: {
      total: exercises.length,
      completed: exercises.filter((exercise) => exercise?.completedAt).length
    },
    today: state.today ? {
      date: state.today.date || null,
      bank: state.today.bank || null,
      newIds: Array.isArray(state.today.newIds) ? state.today.newIds.length : 0,
      dueIds: Array.isArray(state.today.dueIds) ? state.today.dueIds.length : 0,
      baselineDueIds: Array.isArray(state.today.baselineDueIds) ? state.today.baselineDueIds.length : 0,
      pendingTasks: Array.isArray(state.today.tasks)
        ? state.today.tasks.filter((task) => task?.status === "queued").length
        : 0,
      coreBatchId: state.today.coreBatchId || null,
      completed: Boolean(state.today.completed)
    } : null
  };
}

function stableStateHash(state) {
  return crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

module.exports = {
  PORTABLE_FORMAT,
  bankForCardId,
  readRecord,
  stableStateHash,
  summarizeRecord
};
