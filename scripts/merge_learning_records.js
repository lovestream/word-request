#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");

const FORMAT = "kevin-word-quest-portable-record";
const FORMAT_VERSION = 1;

function unwrapRecord(record) {
  if (record?.format === FORMAT) return record.state;
  return record;
}

function readState(filename) {
  const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
  const state = unwrapRecord(parsed);
  if (!state || state.schemaVersion !== 1 || !state.progress || !state.stats) {
    throw new Error(`${filename} 不是有效的 Word Quest 学习记录`);
  }
  return state;
}

function dateKeyFromFilename(filename) {
  return path.basename(filename).match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

function sourceRank(source) {
  return [
    source.state.stats?.lastGoalDate || "",
    dateKeyFromFilename(source.filename),
    Number(source.state.savedAt) || 0
  ];
}

function compareRank(left, right) {
  const a = sourceRank(left);
  const b = sourceRank(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function unique(values) {
  return [...new Set(values)];
}

function mergeProgress(records) {
  const ids = unique(records.flatMap((record) => Object.keys(record || {})));
  const merged = {};
  const statusRank = { learning: 1, reviewing: 2, mastered: 3 };

  for (const id of ids) {
    const candidates = records.map((record) => record?.[id]).filter(Boolean);
    const newest = [...candidates].sort((left, right) =>
      (Number(right.lastSuccessAt) || Number(right.learnedAt) || 0)
      - (Number(left.lastSuccessAt) || Number(left.learnedAt) || 0)
    )[0];
    const strongest = [...candidates].sort((left, right) =>
      (statusRank[right.status] || 0) - (statusRank[left.status] || 0)
    )[0];
    merged[id] = {
      ...newest,
      status: statusRank[strongest.status] > statusRank[newest.status] ? strongest.status : newest.status,
      learnedAt: Math.min(...candidates.map((item) => Number(item.learnedAt) || Number.MAX_SAFE_INTEGER)),
      lapses: Math.max(...candidates.map((item) => Number(item.lapses) || 0)),
      initialModesDone: unique(candidates.flatMap((item) => item.initialModesDone || []))
    };
  }
  return merged;
}

function mergeById(lists, choose) {
  const map = new Map();
  for (const item of lists.flat()) {
    if (!item?.id) continue;
    map.set(item.id, map.has(item.id) ? choose(map.get(item.id), item) : item);
  }
  return [...map.values()];
}

function mergeExercises(records) {
  const result = {};
  for (const exercises of records) {
    for (const [id, candidate] of Object.entries(exercises || {})) {
      const current = result[id];
      const candidateRank = [candidate.completedAt ? 1 : 0, candidate.correctIndices?.length || 0, candidate.attempts || 0, candidate.completedAt || 0];
      const currentRank = current
        ? [current.completedAt ? 1 : 0, current.correctIndices?.length || 0, current.attempts || 0, current.completedAt || 0]
        : [-1];
      if (!current || candidateRank.some((value, index) => value !== currentRank[index]
        && value > currentRank[index]
        && candidateRank.slice(0, index).every((earlier, earlierIndex) => earlier === currentRank[earlierIndex]))) {
        result[id] = candidate;
      }
    }
  }
  return result;
}

function mergeBadges(records) {
  const result = {};
  for (const badges of records) {
    for (const [id, badge] of Object.entries(badges || {})) {
      const unlockedAt = Number(badge?.unlockedAt) || Date.now();
      if (!result[id] || unlockedAt < result[id].unlockedAt) result[id] = { unlockedAt };
    }
  }
  return result;
}

function historyKey(item) {
  return [item.date, item.bank, item.learned, item.reviewed, item.xp].join(":");
}

function estimatedSpentCoins(state) {
  const awarded = (state.scoreLedger || []).reduce((sum, event) => sum + (Number(event.coins) || 0), 0);
  return Math.max(0, 20 + awarded - (Number(state.stats?.coins) || 0));
}

function duplicatePracticeCount(states) {
  const overlap = Object.keys(states[0].progress || {}).filter((id) => states.slice(1).every((state) => state.progress?.[id]));
  return overlap.reduce((sum, id) => {
    const minimumCorrect = Math.min(...states.map((state) => Number(state.progress[id]?.correct) || 0));
    return sum + Math.max(0, minimumCorrect + 1);
  }, 0);
}

function countReviewed(progress) {
  return Object.values(progress).reduce((sum, item) => sum + Math.max(0, (Number(item.correct) || 0) - 1), 0);
}

function consecutiveStreak(history, lastGoalDate) {
  const dates = unique(history.map((item) => item.date)).sort();
  if (!lastGoalDate || !dates.includes(lastGoalDate)) return 0;
  let streak = 1;
  let cursor = new Date(`${lastGoalDate}T12:00:00Z`);
  const set = new Set(dates);
  while (true) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    const previous = cursor.toISOString().slice(0, 10);
    if (!set.has(previous)) break;
    streak += 1;
  }
  return streak;
}

function mergeStates(sources) {
  const ordered = [...sources].sort(compareRank);
  const current = ordered.at(-1).state;
  const states = sources.map((source) => source.state);
  const progress = mergeProgress(states.map((state) => state.progress));
  const scoreLedger = mergeById(states.map((state) => state.scoreLedger || []), (left, right) =>
    (Number(right.at) || 0) >= (Number(left.at) || 0) ? right : left
  ).sort((left, right) => (Number(left.at) || 0) - (Number(right.at) || 0)).slice(-500);
  const historyMap = new Map();
  for (const item of states.flatMap((state) => state.history || [])) historyMap.set(historyKey(item), item);
  const history = [...historyMap.values()].sort((left, right) => left.date.localeCompare(right.date)).slice(-120);
  const lastGoalDate = states.map((state) => state.stats?.lastGoalDate).filter(Boolean).sort().at(-1) || null;
  const streak = consecutiveStreak(history, lastGoalDate);
  const duplicateCount = duplicatePracticeCount(states);
  const correct = Math.max(0, states.reduce((sum, state) => sum + (Number(state.stats?.correct) || 0), 0) - duplicateCount);
  const attempts = Math.max(correct, states.reduce((sum, state) => sum + (Number(state.stats?.attempts) || 0), 0) - duplicateCount);
  const awardedCoins = scoreLedger.reduce((sum, event) => sum + (Number(event.coins) || 0), 0);
  const spentCoins = states.reduce((sum, state) => sum + estimatedSpentCoins(state), 0);
  const sprintDays = {};
  for (const bank of ["core2000", "movers", "ket", "pet"]) {
    sprintDays[bank] = Math.max(...states.map((state) => Number(state.settings?.sprintDays?.[bank]) || 1));
  }

  return {
    schemaVersion: 1,
    savedAt: Date.now(),
    profile: { name: "Kevin", avatar: "🦊" },
    settings: { ...current.settings, sprintDays },
    stats: {
      xp: scoreLedger.reduce((sum, event) => sum + (Number(event.xp) || 0), 0),
      coins: Math.max(0, 20 + awardedCoins - spentCoins),
      streak,
      bestStreak: Math.max(streak, ...states.map((state) => Number(state.stats?.bestStreak) || 0)),
      combo: Number(current.stats?.combo) || 0,
      bestCombo: Math.max(...states.map((state) => Number(state.stats?.bestCombo) || 0)),
      learned: Object.keys(progress).length,
      reviewed: countReviewed(progress),
      correct,
      attempts,
      lastGoalDate
    },
    progress,
    coreExercises: mergeExercises(states.map((state) => state.coreExercises)),
    badges: mergeBadges(states.map((state) => state.badges)),
    scoreLedger,
    history,
    today: current.today
  };
}

function main() {
  const filenames = process.argv.slice(2, -1);
  const output = process.argv.at(-1);
  if (process.argv.length < 5) {
    throw new Error("用法: node scripts/merge_learning_records.js <记录1.json> <记录2.json> [更多记录...] <输出.json>");
  }
  const sources = filenames.map((filename) => ({ filename, state: readState(filename) }));
  const state = mergeStates(sources);
  const payload = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    mergeInfo: {
      sources: filenames.map((filename) => path.basename(filename)),
      policy: "同一单词保留更新的复习状态；同一积分事件仅计一次；独有进度与练习全部保留"
    },
    state
  };
  fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  process.stdout.write(JSON.stringify({
    output,
    words: Object.keys(state.progress).length,
    completedExercises: Object.values(state.coreExercises).filter((item) => item.completedAt).length,
    xp: state.stats.xp,
    coins: state.stats.coins,
    streak: state.stats.streak,
    reviewed: state.stats.reviewed,
    correct: state.stats.correct,
    attempts: state.stats.attempts,
    currentBank: state.settings.bank,
    currentCoreBatch: state.settings.coreBatch,
    todayCoreBatchId: state.today?.coreBatchId || null
  }, null, 2));
}

main();
