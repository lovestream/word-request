(() => {
  "use strict";

  const STATE_KEY = "kevin-wordquest:state:v1";
  const BACKUP_KEY = "kevin-wordquest:backup:v1";
  const BACKUP_FORMAT = "kevin-word-quest-portable-record";
  const STATE_SCHEMA_VERSION = 2;
  const BACKUP_FORMAT_VERSION = 2;
  const APP_VERSION = "2026.09.30";
  const DEVICE_KEY = "kevin-wordquest:device-id:v1";
  const DAY_MS = 86_400_000;
  const WRITER_ID = window.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const DEVICE_ID = getOrCreateDeviceId();
  const SESSION_ID = window.crypto?.randomUUID?.() || `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const SPRINT_SIZE = 30;
  const REVIEW_SCHEDULE_VERSION = 2;
  const MATURE_STEP = 6;
  const DAILY_PLAN_VERSION = 1;
  const DAILY_REVIEW_CAP = 25;
  const DAILY_TIME_BUDGET_MINUTES = 20;
  const REVIEW_ESTIMATE_MINUTES = 0.55;
  const NEW_WORD_ESTIMATE_MINUTES = 1.4;
  const REVIEW_DELAYS = [
    { label: "10 分钟", ms: 10 * 60 * 1000, icon: "⏱" },
    { label: "1 天", days: 1, icon: "🌱" },
    { label: "3 天", days: 3, icon: "🌿" },
    { label: "7 天", days: 7, icon: "🪴" },
    { label: "14 天", days: 14, icon: "🌳" },
    { label: "30 天", days: 30, icon: "🏕️" },
    { label: "60 天", days: 60, icon: "🏆" },
    { label: "120 天", days: 120, icon: "🗻" },
    { label: "240 天", days: 240, icon: "🌌" },
    { label: "365 天", days: 365, icon: "⭐" }
  ];

  const BANK_META = {
    core2000: { name: "2000 Core English Words", short: "CORE 2000", icon: "📚", color: "rgba(0,169,207,.28)", description: "Four complete books · 1,280 picture words · 128 workbook exercises" },
    movers: { name: "Movers 图像词表", short: "Movers", icon: "🛴", color: "rgba(125,211,252,.32)", description: "247 个文档原图单词＋80 个开放配图短语，共 327 张记忆卡" },
    ket: { name: "KET 官方词表", short: "KET", icon: "🛶", color: "rgba(97,197,207,.32)", description: "Cambridge 2025 A2 Key 完整指导词表，Kevin 当前主线" },
    pet: { name: "PET 官方词表", short: "PET", icon: "⛺", color: "rgba(121,170,105,.3)", description: "Cambridge 2025 B1 Preliminary 完整指导词表" }
  };

  const BANK_ENGLISH = {
    core2000: { name: "2000 Core English Words", description: "Four complete books · 1,280 picture words · 128 workbook exercises" },
    movers: { name: "Movers Picture Word List", description: "Cambridge Movers words and phrases with offline picture cards" },
    ket: { name: "KET Official Word List", description: "Complete Cambridge 2025 A2 Key guide word list" },
    pet: { name: "PET Official Word List", description: "Complete Cambridge 2025 B1 Preliminary guide word list" }
  };

  // The starter file still supplies richer cards for selected KET/PET entries.
  // Once all sources have loaded, discard its discontinued demo banks entirely.
  for (const bankKey of Object.keys(window.WORD_BANKS || {})) {
    if (!Object.prototype.hasOwnProperty.call(BANK_META, bankKey)) delete window.WORD_BANKS[bankKey];
  }

  const LEVEL_TITLES = [
    "小探险家",
    "词语侦察员",
    "拼写骑手",
    "记忆领航员",
    "词汇博物学家",
    "星际语言家"
  ];

  const BADGES = [
    { id: "first_word", emoji: "🥾", name: "迈出第一步", test: (s) => s.stats.learned >= 1 },
    { id: "ten_words", emoji: "🗺️", name: "十词地图", test: (s) => s.stats.learned >= 10 },
    { id: "combo_five", emoji: "⚡", name: "五连闪电", test: (s) => s.stats.bestCombo >= 5 },
    { id: "streak_three", emoji: "🔥", name: "三日火苗", test: (s) => s.stats.streak >= 3 },
    { id: "reviewer", emoji: "🌿", name: "曲线园丁", test: (s) => s.stats.reviewed >= 5 },
    { id: "master", emoji: "🏆", name: "记忆大师", test: (s) => masteredCount(s) >= 1 }
  ];

  const root = document.getElementById("viewRoot");
  const dialog = document.getElementById("appDialog");
  const dialogBody = document.getElementById("dialogBody");
  const toastRegion = document.getElementById("toastRegion");
  const confettiLayer = document.getElementById("confettiLayer");

  let state;
  let route = "home";
  let speechToken = 0;
  let pkTimer = null;
  let cachedWordIndex = null;
  let cachedBankWordIds = null;
  let cachedLexemeMembers = null;
  let customCatalogOverride = null;
  const runtime = {
    breakdownOpen: false,
    feedback: null,
    lastWordId: null,
    autoSpeakWord: null,
    browseStudy: false,
    bookQuery: "",
    notebookQuery: "",
    notebookSource: "Reading",
    notebookContext: "",
    notebookStatus: "all",
    notebookSourceFilter: "all",
    notebookSort: "recent",
    notebookDialogTab: "existing",
    editingCustomId: null,
    pendingCustomDraft: null,
    checkupFeedback: null,
    practiceResult: null,
    practiceSource: null,
    pk: null,
    storageConflict: false,
    pendingImport: null
  };

  function resetTransientRuntime() {
    window.clearTimeout(runtime.notebookSearchTimer);
    runtime.breakdownOpen = false;
    runtime.feedback = null;
    runtime.lastWordId = null;
    runtime.autoSpeakWord = null;
    runtime.browseStudy = false;
    runtime.bookQuery = "";
    runtime.notebookQuery = "";
    runtime.notebookSearchTimer = null;
    runtime.editingCustomId = null;
    runtime.pendingCustomDraft = null;
    runtime.checkupFeedback = null;
    runtime.practiceResult = null;
    runtime.practiceSource = null;
    runtime.pk = null;
    clearPkTimer();
  }

  function defaultState() {
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      migratedFromSchema: null,
      historyQuality: "event-log",
      savedAt: Date.now(),
      updatedAt: Date.now(),
      revision: 0,
      writerId: "",
      lastImport: null,
      profile: { name: "Kevin", avatar: "🦊" },
      settings: {
        bank: "ket",
        dailyGoal: 10,
        coreBatch: 1,
        practiceMode: "mixed",
        sprintDays: {
          core2000: 1,
          movers: 1,
          ket: 1,
          pet: 1
        },
        autoSound: true,
        sound: true,
        typoAssist: true,
        showEnglish: true
      },
      stats: {
        xp: 0,
        coins: 20,
        streak: 0,
        bestStreak: 0,
        combo: 0,
        bestCombo: 0,
        learned: 0,
        reviewed: 0,
        correct: 0,
        attempts: 0,
        lastGoalDate: null
      },
      progress: {},
      lexemeProgress: {},
      orphanProgress: {},
      coreExercises: {},
      badges: {},
      scoreLedger: [],
      attemptEvents: [],
      recognitionEvents: [],
      attemptSequence: 0,
      customWords: {},
      savedWords: {},
      today: null,
      history: [],
      dailyCompletion: {},
      courseCompletion: {}
    };
  }

  function finiteNumber(value, fallback = 0, minimum = 0, maximum = 1_000_000_000) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(minimum, Math.min(maximum, number));
  }

  function safeInteger(value, fallback = 0, minimum = 0, maximum = 1_000_000) {
    return Math.round(finiteNumber(value, fallback, minimum, maximum));
  }

  function normalizeDailyGoal(value, fallback = 10) {
    const parsed = String(value ?? "").trim() ? Number(value) : fallback;
    return Math.max(1, Math.min(50, Math.round(Number.isFinite(parsed) ? parsed : fallback)));
  }

  function safeText(value, fallback = "", maximum = 180) {
    if (typeof value !== "string") return fallback;
    return value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maximum);
  }

  function safeDateKey(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  }

  function getOrCreateDeviceId() {
    try {
      const storage = window.localStorage;
      if (!storage) return `ephemeral-${WRITER_ID}`;
      const existing = storage.getItem(DEVICE_KEY);
      if (existing && /^[a-z0-9._-]{8,180}$/i.test(existing)) return existing;
      const created = window.crypto?.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      storage.setItem(DEVICE_KEY, created);
      return created;
    } catch (error) {
      return `ephemeral-${WRITER_ID}`;
    }
  }

  function safeBank(value, fallback = "ket") {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(BANK_META, value) && Array.isArray(window.WORD_BANKS?.[value]) ? value : fallback;
  }

  function coreCourse() {
    return window.CORE2000_COURSE || { books: [], batches: [], words: [] };
  }

  function canonicalWordId(id) {
    if (typeof id !== "string") return id;
    const alias = coreCourse().idAliases?.[id];
    return typeof alias === "string" && alias ? alias : id;
  }

  function coreBatchInfo(value = state?.settings?.coreBatch || 1) {
    const batches = coreCourse().batches || [];
    const sequence = safeInteger(value, 1, 1, Math.max(1, batches.length));
    return batches[sequence - 1] || null;
  }

  function coreBatchById(id) {
    return (coreCourse().batches || []).find((batch) => batch.id === id) || null;
  }

  function isCoreDay(day = state?.today) {
    return day?.bank === "core2000";
  }

  function coreExerciseRecord(exerciseId = state?.today?.coreExerciseId) {
    return exerciseId ? state.coreExercises?.[exerciseId] || null : null;
  }

  function coreExerciseAnswers(exerciseId) {
    const answers = window.CORE2000_EXERCISE_ANSWERS?.[exerciseId];
    return Array.isArray(answers) ? answers : [];
  }

  function coreExerciseIsComplete(day = state?.today) {
    return Boolean(day?.coreExerciseId && coreExerciseRecord(day.coreExerciseId)?.completedAt);
  }

  function coreBatchReadyForExercise(day = state?.today) {
    if (!isCoreDay(day)) return false;
    const batch = coreBatchById(day.coreBatchId);
    return Boolean(batch?.wordIds?.length && batch.wordIds.every((id) => {
      const progress = state.progress[id];
      return spellingProgress(id)?.dueAt && progress?.initialModesDone?.includes("cloze") && progress?.initialModesDone?.includes("full");
    }));
  }

  function orderedBankWords(bankKey) {
    const words = window.WORD_BANKS?.[bankKey] || [];
    return bankKey === "movers" ? sortMoversWords(words) : [...words];
  }

  function sprintTaskGroups(bankKey) {
    const words = orderedBankWords(bankKey);
    if (bankKey === "movers" && words.length) {
      const wordCards = words.filter((word) => word.cardType !== "phrase");
      const phraseCards = words.filter((word) => word.cardType === "phrase");
      const wordGroups = new Map();
      const hasCompleteWordSchedule = wordCards.length && wordCards.every((word) => {
        const sourceDay = Number(word.sourceDay);
        if (!Number.isInteger(sourceDay) || sourceDay < 1) return false;
        if (!wordGroups.has(sourceDay)) wordGroups.set(sourceDay, []);
        wordGroups.get(sourceDay).push(word);
        return true;
      });
      const hasCompletePhraseSchedule = phraseCards.every((word) =>
        Number.isInteger(Number(word.sourceNumber)) && Number(word.sourceNumber) > 0
      );
      if (hasCompleteWordSchedule && hasCompletePhraseSchedule) {
        const sourceWordGroups = [...wordGroups.entries()]
          .sort(([leftDay], [rightDay]) => leftDay - rightDay)
          .map(([sourceDay, batch]) => ({
            sourceDay,
            batch,
            contentKind: "word",
            scheduleKind: "movers-pdf-word",
            scheduleKey: "movers-word-list-2025:v2"
          }));
        const phraseGroups = [];
        for (let start = 0; start < phraseCards.length; start += 20) {
          const batch = phraseCards.slice(start, start + 20);
          phraseGroups.push({
            sourceDay: sourceWordGroups.length + phraseGroups.length + 1,
            batch,
            contentKind: "phrase",
            phraseStart: Number(batch[0]?.sourceNumber) || start + 1,
            phraseEnd: Number(batch.at(-1)?.sourceNumber) || start + batch.length,
            scheduleKind: "movers-pdf-phrase",
            scheduleKey: "movers-word-list-2025:v2"
          });
        }
        return [...sourceWordGroups, ...phraseGroups];
      }
    }
    const groups = [];
    for (let start = 0; start < words.length; start += SPRINT_SIZE) {
      groups.push({
        sourceDay: groups.length + 1,
        batch: words.slice(start, start + SPRINT_SIZE),
        contentKind: "word",
        scheduleKind: "fixed-size",
        scheduleKey: `fixed-${SPRINT_SIZE}:v1`
      });
    }
    return groups;
  }

  function sprintDayCount(bankKey) {
    return Math.max(1, sprintTaskGroups(bankKey).length);
  }

  function normalizeSprintDay(value, bankKey) {
    return safeInteger(value, 1, 1, sprintDayCount(bankKey));
  }

  function sprintBatchInfo(bankKey, requestedDay) {
    const words = orderedBankWords(bankKey);
    const day = normalizeSprintDay(requestedDay, bankKey);
    const groups = sprintTaskGroups(bankKey);
    const group = groups[day - 1] || {
      sourceDay: day,
      batch: [],
      contentKind: "word",
      scheduleKind: "fixed-size",
      scheduleKey: `fixed-${SPRINT_SIZE}:v1`
    };
    const start = groups.slice(0, day - 1).reduce((total, item) => total + item.batch.length, 0);
    const batch = group.batch;
    const phraseTotal = batch.filter((word) => word.cardType === "phrase").length;
    return {
      bank: bankKey,
      day,
      maxDay: sprintDayCount(bankKey),
      start,
      end: start + batch.length,
      total: batch.length,
      wordTotal: batch.length - phraseTotal,
      phraseTotal,
      sourceDay: group.sourceDay,
      contentKind: group.contentKind,
      phraseStart: group.phraseStart || null,
      phraseEnd: group.phraseEnd || null,
      scheduleKind: group.scheduleKind,
      scheduleKey: group.scheduleKey,
      words,
      batch,
      wordIds: batch.map((word) => word.id)
    };
  }

  function sprintDayFor(bankKey, settings = state?.settings) {
    return normalizeSprintDay(settings?.sprintDays?.[bankKey] || 1, bankKey);
  }

  function newSprintState(bankKey, requestedDay) {
    const batch = sprintBatchInfo(bankKey, requestedDay);
    return {
      sessionId: `${bankKey}:d${batch.day}:${Date.now()}`,
      day: batch.day,
      scheduleKey: batch.scheduleKey,
      wordIds: batch.wordIds,
      phase: "cloze",
      cycle: 1,
      awaitingStart: false,
      mistakeIds: [],
      lastScore: 0,
      roundHistory: []
    };
  }

  function sanitizeSprintState(rawSprint, bankKey, fallbackDay) {
    const day = normalizeSprintDay(rawSprint?.day ?? fallbackDay, bankKey);
    const batch = sprintBatchInfo(bankKey, day);
    const allowedIds = new Set(batch.wordIds);
    const oldMoversSchedule = bankKey === "movers" && rawSprint?.scheduleKey !== batch.scheduleKey;
    let phase = !oldMoversSchedule && ["cloze", "full", "drill", "final", "complete"].includes(rawSprint?.phase)
      ? rawSprint.phase
      : "cloze";
    const sanitizedMistakeIds = oldMoversSchedule ? [] : batch.wordIds.filter((id) =>
      safeWordIds(rawSprint?.mistakeIds).includes(id)
    );
    if (phase === "drill" && sanitizedMistakeIds.length === 0) phase = "final";
    const roundHistory = !oldMoversSchedule && Array.isArray(rawSprint?.roundHistory)
      ? rawSprint.roundHistory.slice(-20).map((item) => ({
        cycle: safeInteger(item?.cycle, 1, 0, 999),
        score: safeInteger(item?.score, 0, 0, batch.total),
        mistakes: batch.wordIds.filter((id) =>
          safeWordIds(item?.mistakes).filter((wordId) => allowedIds.has(wordId)).includes(id)
        )
      }))
      : [];
    return {
      sessionId: !oldMoversSchedule && typeof rawSprint?.sessionId === "string" && /^[a-z0-9:_-]{1,180}$/i.test(rawSprint.sessionId)
        ? rawSprint.sessionId
        : `${bankKey}:d${day}:${Date.now()}`,
      day,
      scheduleKey: batch.scheduleKey,
      wordIds: batch.wordIds,
      phase,
      cycle: oldMoversSchedule ? 1 : safeInteger(rawSprint?.cycle, 1, 1, 999),
      awaitingStart: phase === "complete" || oldMoversSchedule ? false : Boolean(rawSprint?.awaitingStart),
      mistakeIds: sanitizedMistakeIds,
      lastScore: oldMoversSchedule ? 0 : safeInteger(rawSprint?.lastScore, 0, 0, batch.total),
      roundHistory
    };
  }

  function evaluateSprintPhase(phase, tasks, allWordIds, cycle = 1) {
    const orderedIds = [...allWordIds];
    const cleanIds = new Set(tasks.filter((task) => task.cleanPass).map((task) => task.wordId));
    const mistakes = orderedIds.filter((id) => !cleanIds.has(id));
    const score = orderedIds.filter((id) => cleanIds.has(id)).length;
    if (phase === "cloze") return { phase: "full", cycle, mistakes: [], score, complete: false };
    if (phase === "full") return { phase: mistakes.length ? "drill" : "final", cycle, mistakes, score, complete: false };
    if (phase === "drill") return { phase: "final", cycle, mistakes: [], score, complete: false };
    if (phase === "final" && mistakes.length === 0) {
      return { phase: "complete", cycle, mistakes: [], score, complete: true };
    }
    if (phase === "final") return { phase: "drill", cycle: cycle + 1, mistakes, score, complete: false };
    return { phase, cycle, mistakes: [], score, complete: phase === "complete" };
  }

  function sprintStageIsComplete(expectedTaskIds, tasks) {
    if (!expectedTaskIds.length) return false;
    const doneIds = new Set(tasks.filter((task) => task.status === "done").map((task) => task.id));
    return expectedTaskIds.every((id) => doneIds.has(id));
  }

  function safeWordIds(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .filter((id) => typeof id === "string")
      .map(canonicalWordId)
      .filter((id) => Boolean(getWord(id))))];
  }

  function sanitizeProgressItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const learnedAt = finiteNumber(item.learnedAt, Date.now(), 0, 9_999_999_999_999);
    const lastSuccessAt = item.lastSuccessAt == null ? null : finiteNumber(item.lastSuccessAt, null, 0, 9_999_999_999_999);
    const legacySchedule = safeInteger(item.scheduleVersion, 1, 1, REVIEW_SCHEDULE_VERSION) < REVIEW_SCHEDULE_VERSION;
    let status = ["learning", "reviewing", "mature", "relearning", "suspended", "mastered"].includes(item.status) ? item.status : "learning";
    let step = safeInteger(item.step, 0, 0, REVIEW_DELAYS.length - 1);
    let dueAt = item.dueAt == null ? null : finiteNumber(item.dueAt, null, 1, 9_999_999_999_999);
    if (status === "mastered") {
      status = "mature";
      step = MATURE_STEP;
      dueAt = addLocalDays(lastSuccessAt || learnedAt, REVIEW_DELAYS[MATURE_STEP].days);
    } else if (legacySchedule && status === "reviewing") {
      step = [0, 1, 2, 3, 3, 4, 5][Math.min(step, 6)];
    }
    if (["reviewing", "relearning"].includes(status) && dueAt == null) {
      // A reviewing word without a due date can never re-enter either the
      // learning queue or the review queue. Recover it as unfinished study.
      status = "learning";
    } else if (status === "mature" && dueAt == null) {
      step = Math.max(MATURE_STEP, step);
      const delay = REVIEW_DELAYS[Math.min(step, REVIEW_DELAYS.length - 1)];
      dueAt = addLocalDays(lastSuccessAt || learnedAt, delay.days);
    } else if (["learning", "suspended"].includes(status)) {
      dueAt = null;
    }
    return {
      status,
      learnedAt,
      step,
      scheduleVersion: REVIEW_SCHEDULE_VERSION,
      scheduleToken: safeInteger(item.scheduleToken, 0, 0, 1_000_000),
      lapses: safeInteger(item.lapses, 0),
      correct: safeInteger(item.correct, 0),
      dueAt,
      lastSuccessAt,
      lastReviewedAt: item.lastReviewedAt == null ? null : finiteNumber(item.lastReviewedAt, null, 0, 9_999_999_999_999),
      lastGrade: ["again", "hard", "good", "easy"].includes(item.lastGrade) ? item.lastGrade : null,
      initialModesDone: Array.isArray(item.initialModesDone)
        ? [...new Set(item.initialModesDone.filter((mode) => mode === "cloze" || mode === "full"))]
        : []
    };
  }

  function sanitizeProgress(rawProgress, orphanSink = null) {
    const result = {};
    if (!rawProgress || typeof rawProgress !== "object" || Array.isArray(rawProgress)) return result;
    for (const [id, item] of Object.entries(rawProgress)) {
      const sanitized = sanitizeProgressItem(item);
      if (!sanitized) continue;
      const canonicalId = canonicalWordId(id);
      if (!getWord(canonicalId)) {
        if (orphanSink) orphanSink[id] = { ...sanitized, reason: "missing-card" };
        continue;
      }
      const existing = result[canonicalId];
      if (!existing) result[canonicalId] = sanitized;
      else {
        const newer = (sanitized.lastSuccessAt || sanitized.learnedAt) >= (existing.lastSuccessAt || existing.learnedAt) ? sanitized : existing;
        result[canonicalId] = {
          ...newer,
          learnedAt: Math.min(existing.learnedAt, sanitized.learnedAt),
          scheduleToken: Math.max(existing.scheduleToken, sanitized.scheduleToken),
          lapses: Math.max(existing.lapses, sanitized.lapses),
          correct: Math.max(existing.correct, sanitized.correct),
          initialModesDone: [...new Set([...existing.initialModesDone, ...sanitized.initialModesDone])]
        };
      }
    }
    return result;
  }

  function restoreOrphanProgress(rawOrphans, progress, orphanSink) {
    if (!rawOrphans || typeof rawOrphans !== "object" || Array.isArray(rawOrphans)) return;
    for (const [id, item] of Object.entries(rawOrphans)) {
      const sanitized = sanitizeProgressItem(item);
      if (!sanitized) continue;
      const canonicalId = canonicalWordId(id);
      if (getWord(canonicalId)) progress[canonicalId] = sanitized;
      else orphanSink[id] = { ...sanitized, reason: safeText(item.reason, "missing-card", 80) };
    }
  }

  function progressEvidenceAt(item) {
    return finiteNumber(item?.lastReviewedAt ?? item?.lastSuccessAt ?? item?.learnedAt, 0, 0, 9_999_999_999_999);
  }

  function sanitizeLexemeProgress(rawLexemeProgress, cardProgress) {
    const result = {};
    if (rawLexemeProgress && typeof rawLexemeProgress === "object" && !Array.isArray(rawLexemeProgress)) {
      for (const [lexemeId, item] of Object.entries(rawLexemeProgress)) {
        if (!/^lexeme-[\p{L}\p{N}-]{1,100}$/u.test(lexemeId)) continue;
        const sanitized = sanitizeProgressItem(item);
        if (sanitized) result[lexemeId] = sanitized;
      }
    }
    for (const [cardId, item] of Object.entries(cardProgress || {})) {
      const lexemeId = lexemeIdForWord(cardId);
      if (!lexemeId) continue;
      const existing = result[lexemeId];
      if (!existing || progressEvidenceAt(item) > progressEvidenceAt(existing)) {
        result[lexemeId] = { ...item };
      }
    }
    return result;
  }

  function sanitizeCoreExercises(raw) {
    const result = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    const validIds = new Set((coreCourse().batches || []).map((batch) => batch.exercise?.id).filter(Boolean));
    for (const [id, item] of Object.entries(raw)) {
      if (!validIds.has(id) || !item || typeof item !== "object" || Array.isArray(item)) continue;
      const answerCount = coreExerciseAnswers(id).length || 10;
      const correctIndices = [...new Set((Array.isArray(item.correctIndices) ? item.correctIndices : [])
        .map((index) => safeInteger(index, -1, -1, answerCount - 1))
        .filter((index) => index >= 0 && index < answerCount))].sort((a, b) => a - b);
      const correctSet = new Set(correctIndices);
      const wrongIndices = [...new Set((Array.isArray(item.wrongIndices) ? item.wrongIndices : [])
        .map((index) => safeInteger(index, -1, -1, answerCount - 1))
        .filter((index) => index >= 0 && index < answerCount && !correctSet.has(index)))].sort((a, b) => a - b);
      result[id] = {
        responses: Array.from({ length: answerCount }, (_, index) => safeText(item.responses?.[index], "", 120)),
        correctIndices,
        wrongIndices,
        attempts: safeInteger(item.attempts, 0, 0, 1000),
        completedAt: correctIndices.length === answerCount && item.completedAt != null
          ? finiteNumber(item.completedAt, null, 0, 9_999_999_999_999)
          : null
      };
    }
    return result;
  }

  function sanitizeTask(item) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !getWord(item.wordId)) return null;
    const id = typeof item.id === "string" && /^[a-z0-9:_-]{1,220}$/i.test(item.id) ? item.id : null;
    if (!id) return null;
    const wordId = canonicalWordId(item.wordId);
    const actualWord = getWord(wordId);
    const feedbackType = item.feedback?.type === "correct" ? "correct" : item.feedback?.type === "wrong" ? "wrong" : null;
    const feedback = feedbackType ? {
      type: feedbackType,
      message: safeText(item.feedback.message, "", 240),
      word: item.feedback.word && normalizeAnswer(item.feedback.word) === normalizeAnswer(actualWord.word) ? actualWord.word : ""
    } : null;
    return {
      id,
      wordId,
      source: item.source === "review" ? "review" : item.source === "sprint" ? "sprint" : "new",
      mode: item.mode === "full" ? "full" : "cloze",
      status: ["queued", "passed", "done"].includes(item.status) ? item.status : "queued",
      attempts: safeInteger(item.attempts, 0, 0, 1000),
      hadLapse: Boolean(item.hadLapse),
      assisted: Boolean(item.assisted),
      usedAudio: Boolean(item.usedAudio),
      nearMissUsed: Boolean(item.nearMissUsed),
      attemptStartedAt: finiteNumber(item.attemptStartedAt, Date.now(), 0, 9_999_999_999_999),
      maskSeed: safeText(item.maskSeed, id, 220),
      completedAt: item.completedAt == null ? null : finiteNumber(item.completedAt, null, 0, 9_999_999_999_999),
      hintIndices: Array.isArray(item.hintIndices) ? [...new Set(item.hintIndices.map((index) => safeInteger(index, -1, -1, 100)).filter((index) => index >= 0 && index < actualWord.word.length))] : [],
      draft: safeText(item.draft, "", actualWord.word.length).toLowerCase(),
      errorIndices: Array.isArray(item.errorIndices) ? [...new Set(item.errorIndices.map((index) => safeInteger(index, -1, -1, 100)).filter((index) => index >= 0 && index < actualWord.word.length))] : [],
      sprintPhase: ["cloze", "full", "drill", "final"].includes(item.sprintPhase) ? item.sprintPhase : null,
      sprintCycle: safeInteger(item.sprintCycle, 1, 1, 999),
      cleanPass: ["passed", "done"].includes(item.status)
        && safeInteger(item.attempts, 0, 0, 1000) === 1
        && !item.hadLapse
        && !item.assisted
        && !item.nearMissUsed,
      feedback
    };
  }

  function sanitizeToday(rawToday, settings, progress = {}, lexemeProgress = {}, savedWords = {}) {
    if (!rawToday || typeof rawToday !== "object" || Array.isArray(rawToday) || !safeDateKey(rawToday.date)) return null;
    const bank = safeBank(rawToday.bank, settings.bank);
    const practiceMode = ["mixed", "cloze", "full", "sprint"].includes(rawToday.practiceMode) ? rawToday.practiceMode : settings.practiceMode;
    const isSprint = practiceMode === "sprint";
    const sprint = isSprint ? sanitizeSprintState(rawToday.sprint, bank, sprintDayFor(bank, settings)) : null;
    const allowedNewIds = new Set([
      ...bankWordIds(bank),
      ...savedTrainingIds({ savedWords }),
      ...safeWordIds(rawToday.newIds)
    ]);
    const rawNewIds = isSprint
      ? [...sprint.wordIds]
      : safeWordIds(rawToday.newIds).filter((id) => allowedNewIds.has(id));
    const rawDueAllIds = safeWordIds([
      ...(rawToday.dueAllIds || []),
      ...(rawToday.baselineDueIds || []),
      ...(rawToday.dueIds || []),
      ...(rawToday.reviewBacklogIds || [])
    ]).filter((id) => Boolean(progress[id]));
    const generatedPlan = buildDailyPlan(
      rawDueAllIds,
      Object.fromEntries(rawDueAllIds.map((id) => [id, lexemeProgress[lexemeIdForWord(id)] || progress[id]])),
      settings.dailyGoal
    );
    const hasFrozenPlan = safeInteger(rawToday.planVersion, 0, 0, DAILY_PLAN_VERSION) === DAILY_PLAN_VERSION;
    const plannedReviewIds = isSprint
      ? []
      : hasFrozenPlan
        ? safeWordIds(rawToday.plannedReviewIds || rawToday.baselineDueIds || rawToday.dueIds).filter((id) => Boolean(progress[id]))
        : generatedPlan.plannedReviewIds;
    const plannedReviewSet = new Set(plannedReviewIds);
    const dueAllIds = [...new Set([...rawDueAllIds, ...plannedReviewIds])];
    const reviewBacklogIds = isSprint
      ? dueAllIds
      : [...new Set([
        ...safeWordIds(rawToday.reviewBacklogIds).filter((id) => Boolean(progress[id])),
        ...dueAllIds.filter((id) => !plannedReviewSet.has(id))
      ])];
    const protectedNewIds = new Set([
      ...safeWordIds(rawToday.learnedIds),
      ...safeWordIds(rawToday.practicedIds),
      ...(Array.isArray(rawToday.tasks)
        ? rawToday.tasks.filter((task) => task?.source === "new" && (task.status !== "queued" || safeInteger(task.attempts, 0) > 0)).map((task) => task.wordId)
        : [])
    ]);
    const frozenNewLimit = isSprint
      ? rawNewIds.length
      : hasFrozenPlan
        ? safeInteger(rawToday.newLimit, rawNewIds.length, 0, 50)
        : generatedPlan.newLimit;
    const protectedPlannedIds = rawNewIds.filter((id) => protectedNewIds.has(id));
    const newIds = isSprint || hasFrozenPlan
      ? rawNewIds
      : [...new Set([
        ...protectedPlannedIds,
        ...rawNewIds.filter((id) => !protectedNewIds.has(id)).slice(0, Math.max(0, frozenNewLimit - protectedPlannedIds.length))
      ])];
    const deferredNewIds = isSprint
      ? []
      : [...new Set([
        ...safeWordIds(rawToday.deferredNewIds).filter((id) => allowedNewIds.has(id)),
        ...rawNewIds.filter((id) => !newIds.includes(id))
      ])];
    const newIdSet = new Set(newIds);
    const learnedIds = safeWordIds(rawToday.learnedIds).filter((id) => newIdSet.has(id));
    const learnedIdSet = new Set(learnedIds);
    const dueIds = [...plannedReviewIds];
    const dueIdSet = new Set(dueIds);
    const allowedNewModes = new Set(practiceMode === "mixed" ? ["cloze", "full"] : [practiceMode]);
    const reviewMode = practiceMode === "cloze" ? "cloze" : "full";
    const sprintTaskIds = new Set(sprint?.phase === "drill" ? sprint.mistakeIds : sprint?.wordIds || []);
    const taskCandidates = Array.isArray(rawToday.tasks)
      ? rawToday.tasks
        .map(sanitizeTask)
        .map((task) => {
          if (!task) return null;
          if (task.source === "new") {
            if (isSprint || !learnedIdSet.has(task.wordId) || !allowedNewModes.has(task.mode)) return null;
            task.id = `new:${rawToday.date}:${task.wordId}:${task.mode}`;
            return task;
          }
          if (task.source === "sprint") {
            if (!isSprint || sprint.awaitingStart || sprint.phase === "complete") return null;
            const expectedMode = sprint.phase === "cloze" ? "cloze" : "full";
            if (task.sprintPhase !== sprint.phase || task.mode !== expectedMode || !sprintTaskIds.has(task.wordId)) return null;
            task.sprintCycle = sprint.cycle;
            const stageToken = ["drill", "final"].includes(sprint.phase)
              ? `${sprint.phase}:r${sprint.cycle}`
              : sprint.phase;
            task.id = `sprint:${sprint.sessionId}:${stageToken}:${task.wordId}:${expectedMode}`;
            task.maskSeed = task.id;
            return task;
          }
          const wordProgress = lexemeProgress[lexemeIdForWord(task.wordId)] || progress[task.wordId];
          if (!dueIdSet.has(task.wordId) || !wordProgress || task.mode !== reviewMode) return null;
          if (task.status === "queued" && !isDue(wordProgress)) return null;
          const currentToken = safeInteger(wordProgress.scheduleToken, 0, 0, 1_000_000);
          const prefix = `review:${task.wordId}:`;
          const suffix = `:${task.mode}`;
          const tokenText = task.id.startsWith(prefix) && task.id.endsWith(suffix)
            ? task.id.slice(prefix.length, -suffix.length)
            : "";
          const parsedToken = /^\d+$/.test(tokenText) ? safeInteger(tokenText, -1, -1, 1_000_000) : -1;
          const taskToken = task.status === "queued"
            ? currentToken
            : parsedToken >= 0 && parsedToken < currentToken
              ? parsedToken
              : Math.max(0, currentToken - 1);
          task.id = `review:${task.wordId}:${taskToken}:${task.mode}`;
          return task;
        })
        .filter(Boolean)
      : [];
    const preferredTasks = new Map();
    const statusRank = { queued: 1, passed: 2, done: 3 };
    for (const task of taskCandidates) {
      const existing = preferredTasks.get(task.id);
      if (!existing || statusRank[task.status] > statusRank[existing.status]) {
        preferredTasks.set(task.id, task);
      }
    }
    const sprintOrder = new Map((sprint?.wordIds || []).map((id, index) => [id, index]));
    const tasks = [...preferredTasks.values()].sort((left, right) => {
      if (left.source === "sprint" && right.source === "sprint") {
        return (sprintOrder.get(left.wordId) ?? 10_000) - (sprintOrder.get(right.wordId) ?? 10_000);
      }
      if (left.source === "sprint") return -1;
      if (right.source === "sprint") return 1;
      return 0;
    });
    return {
      date: rawToday.date,
      bank,
      goal: isSprint ? Math.max(1, sprint.wordIds.length) : newIds.length,
      practiceMode,
      sprint,
      coreBatchId: bank === "core2000" && coreBatchById(rawToday.coreBatchId) ? rawToday.coreBatchId : null,
      coreExerciseId: bank === "core2000" && (coreCourse().batches || []).some((batch) => batch.exercise?.id === rawToday.coreExerciseId) ? rawToday.coreExerciseId : null,
      planVersion: DAILY_PLAN_VERSION,
      plannedAt: finiteNumber(rawToday.plannedAt, Date.now(), 0, 9_999_999_999_999),
      dueAllIds,
      plannedReviewIds: dueIds,
      reviewBacklogIds,
      reviewCapacity: DAILY_REVIEW_CAP,
      newLimit: frozenNewLimit,
      estimatedMinutes: safeInteger(
        rawToday.estimatedMinutes,
        Math.min(DAILY_TIME_BUDGET_MINUTES, Math.ceil(dueIds.length * REVIEW_ESTIMATE_MINUTES + newIds.length * NEW_WORD_ESTIMATE_MINUTES)),
        0,
        180
      ),
      newIds,
      deferredNewIds,
      carryoverIds: isSprint ? [] : safeWordIds(rawToday.carryoverIds).filter((id) => newIdSet.has(id)),
      learnedIds,
      practicedIds: safeWordIds(rawToday.practicedIds).filter((id) => newIdSet.has(id)),
      dueIds,
      baselineDueIds: dueIds,
      reviewDoneIds: safeWordIds(rawToday.reviewDoneIds).filter((id) => Boolean(progress[id])),
      studyCursor: safeInteger(rawToday.studyCursor, 0, 0, 10_000),
      tasks,
      pausedAt: rawToday.pausedAt == null ? null : finiteNumber(rawToday.pausedAt, null, 0, 9_999_999_999_999),
      goalAwarded: Boolean(rawToday.goalAwarded),
      completed: Boolean(rawToday.completed),
      sessionXp: safeInteger(rawToday.sessionXp, 0),
      sessionCorrect: safeInteger(rawToday.sessionCorrect, 0),
      sessionMistakes: safeInteger(rawToday.sessionMistakes, 0)
    };
  }

  function restoreInitialModesFromLedger(progress, scoreLedger) {
    for (const event of scoreLedger) {
      const match = /^new:\d{4}-\d{2}-\d{2}:(.+):(cloze|full):pass$/.exec(event.id);
      if (!match || !progress[match[1]] || !getWord(match[1])) continue;
      progress[match[1]].initialModesDone = [
        ...new Set([...(progress[match[1]].initialModesDone || []), match[2]])
      ];
    }
    return progress;
  }

  function sanitizeDailyCompletion(raw) {
    const result = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    for (const [date, item] of Object.entries(raw)) {
      if (!safeDateKey(date) || !item || typeof item !== "object" || Array.isArray(item)) continue;
      result[date] = {
        completedAt: finiteNumber(item.completedAt, Date.now(), 0, 9_999_999_999_999),
        rewardEventId: safeText(item.rewardEventId, `daily:${date}`, 180)
      };
    }
    return result;
  }

  function sanitizeCourseCompletion(raw) {
    const result = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    for (const [setId, item] of Object.entries(raw)) {
      if (!/^[a-z0-9:_-]{1,180}$/i.test(setId) || !item || typeof item !== "object" || Array.isArray(item)) continue;
      result[setId] = {
        completedAt: finiteNumber(item.completedAt, Date.now(), 0, 9_999_999_999_999),
        date: safeDateKey(item.date),
        exerciseId: safeText(item.exerciseId, "", 180)
      };
    }
    return result;
  }

  function safeCustomImage(value) {
    const image = safeText(value, "", 500).trim();
    if (!image) return "";
    if (/^https:\/\/[^\s]+$/i.test(image)) return image;
    if (/^assets\/[a-z0-9_./-]+$/i.test(image) && !image.includes("..")) return image;
    return "";
  }

  function sanitizeCustomWordDraft(raw, existingId = "") {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const word = safeText(raw.word, "", 80).trim().replace(/\s+/g, " ");
    const en = safeText(raw.en, "", 320).trim().replace(/\s+/g, " ");
    const example = safeText(raw.example, "", 320).trim().replace(/\s+/g, " ");
    const sourceTag = safeText(raw.sourceTag, "Reading", 80).trim() || "Reading";
    if (!/^[a-z][a-z' -]{0,78}$/i.test(word) || !en || !example) return null;
    const id = /^custom:[a-z0-9-]{6,100}$/i.test(existingId || raw.id || "")
      ? (existingId || raw.id)
      : "";
    const pos = safeText(raw.pos, "", 40).trim();
    const lemma = (safeText(raw.lemma, word, 80).trim().replace(/\s+/g, " ") || word).toLowerCase();
    if (!/^[a-z][a-z' -]{0,78}$/i.test(lemma)) return null;
    const formType = safeText(raw.formType, "", 60).trim();
    const context = safeText(raw.context, "", 320).trim().replace(/\s+/g, " ");
    const image = safeCustomImage(raw.image || raw.visual?.image);
    const spellingParts = word.split(/([ '-])/).filter(Boolean).flatMap((part) =>
      /^[a-z]+$/i.test(part) && part.length > 4
        ? part.match(/.{1,3}/g) || [part]
        : [part]
    );
    return {
      id,
      word,
      pos,
      lemma,
      formType,
      en,
      example,
      context,
      sourceTag,
      englishOnly: true,
      acceptedAnswers: [],
      semanticAlternatives: [],
      spellingVariants: [],
      quizClue: en,
      visual: image ? { image } : { emoji: "📖" },
      breakdown: {
        label: "SPELLING CHUNKS",
        type: "spelling chunks",
        parts: spellingParts.map((text) => ({ text }))
      },
      tip: context || `Picture the scene where you met “${word}”.`,
      zh: "",
      ipa: "",
      custom: true,
      archived: Boolean(raw.archived),
      createdAt: finiteNumber(raw.createdAt, Date.now(), 0, 9_999_999_999_999),
      updatedAt: finiteNumber(raw.updatedAt, Date.now(), 0, 9_999_999_999_999)
    };
  }

  function sanitizeCustomWords(raw) {
    const result = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    for (const [rawId, item] of Object.entries(raw)) {
      if (!/^custom:[a-z0-9-]{6,100}$/i.test(rawId)) continue;
      const word = sanitizeCustomWordDraft(item, rawId);
      if (!word) continue;
      result[rawId] = word;
    }
    return result;
  }

  function sanitizeSavedWords(raw) {
    const result = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    for (const [rawId, item] of Object.entries(raw)) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const cardId = canonicalWordId(safeText(item.cardId || rawId, "", 220));
      if (!getWord(cardId)) continue;
      const legacyAddedAt = finiteNumber(item.addedAt, Date.now(), 0, 9_999_999_999_999);
      const sourceRows = Array.isArray(item.sources) && item.sources.length
        ? item.sources
        : [{ sourceTag: item.sourceTag, context: item.context, addedAt: legacyAddedAt }];
      const sources = [];
      const sourceKeys = new Set();
      for (const source of sourceRows) {
        if (!source || typeof source !== "object" || Array.isArray(source)) continue;
        const sourceTag = safeText(source.sourceTag, "Reading", 80).trim() || "Reading";
        const context = safeText(source.context, "", 320).trim();
        const key = `${normalizeAnswer(sourceTag)}\n${normalizeAnswer(context)}`;
        if (sourceKeys.has(key)) continue;
        sourceKeys.add(key);
        sources.push({
          sourceTag,
          context,
          addedAt: finiteNumber(source.addedAt, legacyAddedAt, 0, 9_999_999_999_999)
        });
      }
      result[cardId] = {
        cardId,
        train: Boolean(item.train),
        addedAt: legacyAddedAt,
        sources: sources.length ? sources : [{ sourceTag: "Reading", context: "", addedAt: legacyAddedAt }]
      };
    }
    return result;
  }

  function sanitizeAttemptEvents(raw) {
    if (!Array.isArray(raw)) return [];
    const unique = new Map();
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const eventId = safeText(item.eventId, "", 260);
      const cardId = safeText(canonicalWordId(item.cardId), "", 220);
      if (!/^[a-z0-9:._-]{8,260}$/i.test(eventId) || !cardId) continue;
      const event = {
        eventId,
        cardId,
        lexemeId: /^lexeme-/.test(item.lexemeId || "")
          ? safeText(item.lexemeId, lexemeIdForWord(cardId) || cardId, 220)
          : lexemeIdForWord(cardId) || safeText(canonicalWordId(item.lexemeId || cardId), cardId, 220),
        senseId: safeText(item.senseId, `${cardId}:default`, 240),
        occurredAt: finiteNumber(item.occurredAt, 0, 0, 9_999_999_999_999),
        mode: item.mode === "cloze" ? "cloze" : "full",
        source: ["new", "review", "sprint", "pk"].includes(item.source) ? item.source : "new",
        cueType: ["image", "definition", "audio-dictation", "sentence", "translation", "partial-spelling"].includes(item.cueType) ? item.cueType : "image",
        firstAttempt: Boolean(item.firstAttempt),
        firstAttemptCorrect: item.firstAttemptCorrect == null
          ? Boolean(item.firstAttempt && item.answerCorrect)
          : Boolean(item.firstAttemptCorrect),
        usedHint: Boolean(item.usedHint),
        answerShown: Boolean(item.answerShown),
        nearMiss: Boolean(item.nearMiss),
        answerCorrect: Boolean(item.answerCorrect),
        grade: ["again", "hard", "good", "easy"].includes(item.grade) ? item.grade : "again",
        durationMs: finiteNumber(item.durationMs, 0, 0, 86_400_000),
        oldDueAt: item.oldDueAt == null ? null : finiteNumber(item.oldDueAt, null, 0, 9_999_999_999_999),
        newDueAt: item.newDueAt == null ? null : finiteNumber(item.newDueAt, null, 0, 9_999_999_999_999),
        sessionId: safeText(item.sessionId, "legacy-session", 180),
        deviceId: safeText(item.deviceId, "legacy-device", 180),
        sequence: safeInteger(item.sequence, 0, 0, 1_000_000_000),
        appVersion: safeText(item.appVersion, "unknown", 40),
        contentVersion: safeText(item.contentVersion, "", 80)
      };
      if (!unique.has(eventId)) unique.set(eventId, event);
    }
    return [...unique.values()].sort((left, right) => left.occurredAt - right.occurredAt || left.eventId.localeCompare(right.eventId));
  }

  function sanitizeRecognitionEvents(raw) {
    if (!Array.isArray(raw)) return [];
    const unique = new Map();
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const cardId = canonicalWordId(safeText(item.cardId, "", 220));
      const selectedCardId = canonicalWordId(safeText(item.selectedCardId, "", 220));
      if (!getWord(cardId) || !getWord(selectedCardId)) continue;
      const eventId = safeText(item.eventId, "", 240);
      if (!/^[a-z0-9:_-]{1,240}$/i.test(eventId) || unique.has(eventId)) continue;
      const occurredAt = finiteNumber(item.occurredAt, 0, 0, 9_999_999_999_999);
      unique.set(eventId, {
        eventId,
        cardId,
        selectedCardId,
        senseId: safeText(item.senseId, `${cardId}:default`, 240),
        occurredAt,
        weekKey: safeDateKey(item.weekKey),
        correct: selectedCardId === cardId && Boolean(item.correct),
        firstAttempt: true,
        sessionId: safeText(item.sessionId, "legacy-session", 180),
        deviceId: safeText(item.deviceId, "legacy-device", 180),
        sequence: safeInteger(item.sequence, 0, 0, 1_000_000_000),
        appVersion: safeText(item.appVersion, "unknown", 40)
      });
    }
    return [...unique.values()].sort((left, right) => left.occurredAt - right.occurredAt || left.eventId.localeCompare(right.eventId));
  }

  function mergeState(raw, strict = false) {
    const fresh = defaultState();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      if (strict) throw new Error("学习记录不是对象");
      return fresh;
    }
    if (strict && (
      ![1, STATE_SCHEMA_VERSION].includes(raw.schemaVersion)
      || !raw.settings
      || typeof raw.settings !== "object"
      || Array.isArray(raw.settings)
      || !raw.stats
      || typeof raw.stats !== "object"
      || Array.isArray(raw.stats)
      || !raw.progress
      || typeof raw.progress !== "object"
      || Array.isArray(raw.progress)
    )) {
      throw new Error("学习记录缺少必要字段");
    }
    const customWords = sanitizeCustomWords(raw.customWords);
    const previousCatalogOverride = customCatalogOverride;
    customCatalogOverride = customWords;
    try {
    const rawSettings = raw.settings && typeof raw.settings === "object" ? raw.settings : {};
    const bank = safeBank(rawSettings.bank, fresh.settings.bank);
    const rawSprintDays = rawSettings.sprintDays && typeof rawSettings.sprintDays === "object" && !Array.isArray(rawSettings.sprintDays)
      ? rawSettings.sprintDays
      : {};
    const sprintDays = {};
    for (const bankKey of Object.keys(BANK_META)) {
      sprintDays[bankKey] = normalizeSprintDay(rawSprintDays[bankKey], bankKey);
    }
    const settings = {
      bank,
      dailyGoal: safeInteger(rawSettings.dailyGoal, fresh.settings.dailyGoal, 1, 50),
      coreBatch: safeInteger(rawSettings.coreBatch, fresh.settings.coreBatch, 1, Math.max(1, coreCourse().batches.length)),
      practiceMode: ["mixed", "cloze", "full", "sprint"].includes(rawSettings.practiceMode) ? rawSettings.practiceMode : fresh.settings.practiceMode,
      sprintDays,
      autoSound: typeof rawSettings.autoSound === "boolean" ? rawSettings.autoSound : fresh.settings.autoSound,
      sound: typeof rawSettings.sound === "boolean" ? rawSettings.sound : fresh.settings.sound,
      typoAssist: typeof rawSettings.typoAssist === "boolean" ? rawSettings.typoAssist : fresh.settings.typoAssist,
      showEnglish: typeof rawSettings.showEnglish === "boolean" ? rawSettings.showEnglish : fresh.settings.showEnglish
    };
    const rawStats = raw.stats && typeof raw.stats === "object" ? raw.stats : {};
    const stats = {
      xp: safeInteger(rawStats.xp, 0),
      coins: safeInteger(rawStats.coins, 20),
      streak: safeInteger(rawStats.streak, 0, 0, 100_000),
      bestStreak: safeInteger(rawStats.bestStreak, 0, 0, 100_000),
      combo: safeInteger(rawStats.combo, 0, 0, 100_000),
      bestCombo: safeInteger(rawStats.bestCombo, 0, 0, 100_000),
      learned: safeInteger(rawStats.learned, 0),
      reviewed: safeInteger(rawStats.reviewed, 0),
      correct: safeInteger(rawStats.correct, 0),
      attempts: safeInteger(rawStats.attempts, 0),
      lastGoalDate: safeDateKey(rawStats.lastGoalDate)
    };
    const validBadgeIds = new Set(BADGES.map((badge) => badge.id));
    const badges = {};
    if (raw.badges && typeof raw.badges === "object" && !Array.isArray(raw.badges)) {
      for (const [id, badge] of Object.entries(raw.badges)) {
        if (validBadgeIds.has(id)) badges[id] = { unlockedAt: finiteNumber(badge?.unlockedAt, Date.now(), 0, 9_999_999_999_999) };
      }
    }
    const scoreLedger = Array.isArray(raw.scoreLedger) ? raw.scoreLedger
      .filter((event) => event && typeof event === "object" && typeof event.id === "string" && /^[a-z0-9:_-]{1,240}$/i.test(event.id))
      .slice(-500)
      .map((event) => ({ id: event.id, xp: safeInteger(event.xp, 0), coins: safeInteger(event.coins, 0), at: finiteNumber(event.at, Date.now(), 0, 9_999_999_999_999) })) : [];
    const history = Array.isArray(raw.history) ? raw.history
      .filter((item) => item && typeof item === "object" && safeDateKey(item.date))
      .slice(-120)
      .map((item) => ({ date: item.date, bank: safeBank(item.bank, settings.bank), learned: safeInteger(item.learned, 0), reviewed: safeInteger(item.reviewed, 0), xp: safeInteger(item.xp, 0) })) : [];
    const attemptEvents = sanitizeAttemptEvents(raw.attemptEvents);
    const recognitionEvents = sanitizeRecognitionEvents(raw.recognitionEvents);
    const historyQuality = ["legacy-summary", "mixed", "event-log"].includes(raw.historyQuality)
      ? raw.historyQuality
      : raw.schemaVersion === 1
        ? (attemptEvents.length || recognitionEvents.length ? "mixed" : "legacy-summary")
        : "event-log";
    const maxDeviceAttemptSequence = [...attemptEvents, ...recognitionEvents].reduce(
      (maximum, event) => event.deviceId === DEVICE_ID ? Math.max(maximum, event.sequence) : maximum,
      0
    );
    const orphanProgress = {};
    const progress = restoreInitialModesFromLedger(sanitizeProgress(raw.progress, orphanProgress), scoreLedger);
    restoreOrphanProgress(raw.orphanProgress, progress, orphanProgress);
    const lexemeProgress = sanitizeLexemeProgress(raw.lexemeProgress, progress);
    const savedWords = sanitizeSavedWords(raw.savedWords);
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      migratedFromSchema: raw.schemaVersion === 1 ? 1 : (raw.migratedFromSchema === 1 ? 1 : null),
      historyQuality,
      savedAt: finiteNumber(raw.savedAt, Date.now(), 0, 9_999_999_999_999),
      updatedAt: finiteNumber(raw.updatedAt, raw.savedAt || Date.now(), 0, 9_999_999_999_999),
      revision: safeInteger(raw.revision, 0, 0, 1_000_000_000),
      writerId: safeText(raw.writerId, "", 180),
      lastImport: raw.lastImport && typeof raw.lastImport === "object" && !Array.isArray(raw.lastImport) ? {
        sourceSha256: /^[a-f0-9]{64}$/i.test(raw.lastImport.sourceSha256 || "") ? raw.lastImport.sourceSha256 : "",
        importedAt: finiteNumber(raw.lastImport.importedAt, 0, 0, 9_999_999_999_999),
        sourceSavedAt: finiteNumber(raw.lastImport.sourceSavedAt, 0, 0, 9_999_999_999_999)
      } : null,
      profile: { name: "Kevin", avatar: "🦊" },
      settings,
      stats,
      progress,
      lexemeProgress,
      orphanProgress,
      coreExercises: sanitizeCoreExercises(raw.coreExercises),
      badges,
      scoreLedger,
      attemptEvents,
      recognitionEvents,
      attemptSequence: Math.max(
        safeInteger(raw.attemptSequence, 0, 0, 1_000_000_000),
        maxDeviceAttemptSequence
      ),
      customWords,
      savedWords,
      history,
      dailyCompletion: sanitizeDailyCompletion(raw.dailyCompletion),
      courseCompletion: sanitizeCourseCompletion(raw.courseCompletion),
      today: sanitizeToday(raw.today, settings, progress, lexemeProgress, savedWords)
    };
    } finally {
      customCatalogOverride = previousCatalogOverride;
    }
  }

  function loadState() {
    let candidates;
    try {
      candidates = [localStorage.getItem(STATE_KEY), localStorage.getItem(BACKUP_KEY)];
    } catch (error) {
      console.warn("浏览器禁止读取本地学习记录", error);
      return defaultState();
    }
    for (const candidate of candidates) {
      if (!candidate) continue;
      try {
        return mergeState(JSON.parse(candidate), true);
      } catch (error) {
        console.warn("忽略损坏的本地学习记录", error);
      }
    }
    return defaultState();
  }

  function shouldRejectStaleWrite(localState, storedState, writerId = WRITER_ID) {
    if (!storedState || typeof storedState !== "object" || Array.isArray(storedState)) return false;
    const localRevision = safeInteger(localState?.revision, 0, 0, 1_000_000_000);
    const storedRevision = safeInteger(storedState.revision, 0, 0, 1_000_000_000);
    const storedWriter = safeText(storedState.writerId, "", 180);
    return storedRevision > localRevision && Boolean(storedWriter) && storedWriter !== writerId;
  }

  function saveState() {
    try {
      const previous = localStorage.getItem(STATE_KEY);
      let storedState = null;
      if (previous) {
        try {
          storedState = JSON.parse(previous);
        } catch (error) {
          console.warn("当前主记录无法解析，将保留备份并写入已验证状态", error);
        }
      }
      if (shouldRejectStaleWrite(state, storedState)) {
        runtime.storageConflict = true;
        toast("另一个标签页刚刚保存了更新记录；本页已停止写入，请刷新后继续", "⚠️");
        updateChrome();
        return false;
      }
      const now = Date.now();
      state.revision = Math.max(
        safeInteger(state.revision, 0, 0, 1_000_000_000),
        safeInteger(storedState?.revision, 0, 0, 1_000_000_000)
      ) + 1;
      state.writerId = WRITER_ID;
      state.updatedAt = now;
      state.savedAt = now;
      runtime.storageConflict = false;
      if (previous) localStorage.setItem(BACKUP_KEY, previous);
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error("保存学习记录失败", error);
      toast("浏览器空间不足，学习记录暂未保存", "⚠️");
      return false;
    }
    updateChrome();
    return true;
  }

  function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function humanDate(date = new Date()) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      weekday: "short"
    }).format(date);
  }

  function addLocalDays(timestamp, days) {
    const date = new Date(timestamp);
    date.setDate(date.getDate() + days);
    return date.getTime();
  }

  function dayDistance(fromKey, toKey) {
    if (!fromKey || !toKey) return Infinity;
    const [fy, fm, fd] = fromKey.split("-").map(Number);
    const [ty, tm, td] = toKey.split("-").map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
  }

  function dailyCompletionExists(targetState, date) {
    if (!safeDateKey(date)) return false;
    return Boolean(
      targetState.dailyCompletion?.[date]
      || targetState.stats?.lastGoalDate === date
      || targetState.scoreLedger?.some((event) => event?.id === `daily:${date}`)
    );
  }

  function recordCompletionState(targetState, day, completedAt, isNewDailyCompletion) {
    targetState.dailyCompletion ||= {};
    targetState.courseCompletion ||= {};
    if (day.coreBatchId) {
      targetState.courseCompletion[day.coreBatchId] = {
        completedAt,
        date: day.date,
        exerciseId: day.coreExerciseId || ""
      };
    }
    if (!targetState.dailyCompletion[day.date]) {
      targetState.dailyCompletion[day.date] = {
        completedAt,
        rewardEventId: `daily:${day.date}`
      };
    }
    if (!isNewDailyCompletion) return false;

    const previous = targetState.stats.lastGoalDate;
    const distance = dayDistance(previous, day.date);
    targetState.stats.streak = !previous
      ? 1
      : distance === 1
        ? targetState.stats.streak + 1
        : Math.max(1, targetState.stats.streak);
    targetState.stats.bestStreak = Math.max(targetState.stats.bestStreak, targetState.stats.streak);
    targetState.stats.lastGoalDate = day.date;
    targetState.history.push({
      date: day.date,
      bank: day.bank,
      learned: day.practicedIds.length,
      reviewed: day.reviewDoneIds.length,
      xp: day.sessionXp
    });
    targetState.history = targetState.history.slice(-120);
    return true;
  }

  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function seededShuffle(items, seed) {
    const result = [...items];
    let value = hashString(seed) || 1;
    for (let index = result.length - 1; index > 0; index -= 1) {
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      const swap = Math.abs(value) % (index + 1);
      [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
  }

  function allWords() {
    const customWords = Object.values(customCatalogOverride || state?.customWords || {}).filter((word) => !word.archived);
    return [...Object.keys(BANK_META).flatMap((key) => window.WORD_BANKS?.[key] || []), ...customWords];
  }

  function invalidateCustomCatalog() {
    cachedLexemeMembers = null;
  }

  function wordIndex() {
    if (!cachedWordIndex) {
      cachedWordIndex = new Map(
        Object.keys(BANK_META)
          .flatMap((key) => window.WORD_BANKS?.[key] || [])
          .map((word) => [word.id, word])
      );
    }
    return cachedWordIndex;
  }

  function bankWordIds(bankKey) {
    if (!cachedBankWordIds) cachedBankWordIds = new Map();
    if (!cachedBankWordIds.has(bankKey)) {
      cachedBankWordIds.set(
        bankKey,
        new Set((window.WORD_BANKS?.[bankKey] || []).map((word) => word.id))
      );
    }
    return cachedBankWordIds.get(bankKey);
  }

  function getWord(id) {
    const canonicalId = canonicalWordId(id);
    return (customCatalogOverride || state?.customWords || {})[canonicalId] || wordIndex().get(canonicalId);
  }

  function lexemeIdForWord(wordOrId) {
    const word = typeof wordOrId === "string" ? getWord(wordOrId) : wordOrId;
    const surface = normalizeAnswer(word?.word || "").normalize("NFKC");
    if (!surface) return "";
    const slug = surface.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "word";
    return `lexeme-${slug}-${hashString(surface).toString(16).padStart(8, "0")}`;
  }

  function lemmaIdForWord(wordOrId) {
    const word = typeof wordOrId === "string" ? getWord(wordOrId) : wordOrId;
    const lemma = normalizeAnswer(word?.lemma || word?.word || "").normalize("NFKC");
    if (!lemma) return "";
    const slug = lemma.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "word";
    return `lemma-${slug}-${hashString(lemma).toString(16).padStart(8, "0")}`;
  }

  function lexemeMembers() {
    if (cachedLexemeMembers) return cachedLexemeMembers;
    cachedLexemeMembers = new Map();
    for (const word of allWords()) {
      const lexemeId = lexemeIdForWord(word);
      if (!cachedLexemeMembers.has(lexemeId)) cachedLexemeMembers.set(lexemeId, []);
      cachedLexemeMembers.get(lexemeId).push(word.id);
    }
    return cachedLexemeMembers;
  }

  function spellingProgress(wordId, source = state) {
    const lexemeId = lexemeIdForWord(wordId);
    return source?.lexemeProgress?.[lexemeId] || source?.progress?.[canonicalWordId(wordId)] || null;
  }

  function spellingProgressMap(ids, source = state) {
    return Object.fromEntries((ids || []).map((id) => [id, spellingProgress(id, source)]));
  }

  function bankKeyForWordId(wordId) {
    if (getWord(wordId)?.custom) return "custom";
    return Object.keys(BANK_META).find((bankKey) => bankWordIds(bankKey).has(canonicalWordId(wordId))) || "";
  }

  function savedTrainingIds(source = state) {
    return Object.values(source?.savedWords || {})
      .filter((entry) => entry.train && getWord(entry.cardId))
      .sort((left, right) => left.addedAt - right.addedAt || left.cardId.localeCompare(right.cardId))
      .map((entry) => entry.cardId);
  }

  function allowedDailyNewIds(bankKey, source = state) {
    return new Set([...bankWordIds(bankKey), ...savedTrainingIds(source)]);
  }

  function pendingSavedTrainingIds(excluding = [], source = state) {
    const excluded = new Set(excluding);
    return savedTrainingIds(source).filter((id) => {
      if (excluded.has(id)) return false;
      const progress = source.progress?.[id];
      return !progress?.learnedAt || (progress.status === "learning" && !progress.dueAt);
    });
  }

  function moversSequenceValue(word) {
    if (!word) return Number.MAX_SAFE_INTEGER;
    const section = word.cardType === "phrase" ? 1 : 0;
    const sourceNumber = Number.isFinite(Number(word.sourceNumber))
      ? Number(word.sourceNumber)
      : Number.MAX_SAFE_INTEGER / 2;
    return section * 10_000 + sourceNumber;
  }

  function sortMoversWords(words) {
    return [...words].sort((left, right) =>
      moversSequenceValue(left) - moversSequenceValue(right)
      || String(left.id).localeCompare(String(right.id))
    );
  }

  function sortMoversIds(ids) {
    return [...new Set(ids)].sort((leftId, rightId) =>
      moversSequenceValue(getWord(leftId)) - moversSequenceValue(getWord(rightId))
      || String(leftId).localeCompare(String(rightId))
    );
  }

  function currentBankWords() {
    const words = window.WORD_BANKS?.[state.settings.bank] || [];
    return state.settings.bank === "movers" ? sortMoversWords(words) : words;
  }

  function isDue(progress, now = Date.now()) {
    return Boolean(progress?.dueAt && progress.dueAt <= now && progress.status !== "suspended");
  }

  function getDueIds(now = Date.now(), bankKey = null) {
    const allowed = bankKey ? bankWordIds(bankKey) : null;
    const representatives = new Map();
    for (const id of Object.keys(state.progress)) {
      const word = getWord(id);
      if (!word || word.archived || (allowed && !allowed.has(id))) continue;
      const progress = spellingProgress(id);
      if (!isDue(progress, now)) continue;
      const lexemeId = lexemeIdForWord(id);
      const existingId = representatives.get(lexemeId);
      if (!existingId || progressEvidenceAt(state.progress[id]) > progressEvidenceAt(state.progress[existingId])) {
        representatives.set(lexemeId, id);
      }
    }
    return [...representatives.values()].sort((left, right) =>
      (spellingProgress(left)?.dueAt || 0) - (spellingProgress(right)?.dueAt || 0)
      || String(left).localeCompare(String(right))
    );
  }

  function coreDueIds(now = Date.now(), excluding = []) {
    return filterDueIdsForBank(getDueIds(now, "core2000"), "core2000", excluding);
  }

  function filterDueIdsForBank(dueIds, bankKey, excluding = []) {
    const excluded = new Set(excluding);
    const allowedIds = bankWordIds(bankKey);
    return [...new Set(dueIds)].filter((id) => allowedIds.has(id) && !excluded.has(id));
  }

  function reviewQueuePriority(id, progress = {}) {
    const item = progress[id] || {};
    const shortTerm = item.status === "relearning" || safeInteger(item.step, 0, 0, 99) <= 1 ? 0 : 1;
    const fragile = safeInteger(item.lapses, 0, 0, 1_000_000) > 0 ? 0 : 1;
    return [shortTerm, fragile, finiteNumber(item.dueAt, Number.MAX_SAFE_INTEGER, 0, Number.MAX_SAFE_INTEGER), String(id)];
  }

  function compareReviewPriority(leftId, rightId, progress = {}) {
    const left = reviewQueuePriority(leftId, progress);
    const right = reviewQueuePriority(rightId, progress);
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] < right[index]) return -1;
      if (left[index] > right[index]) return 1;
    }
    return 0;
  }

  function dailyNewLimit(dueCount, requestedNew, reviewCount = Math.min(dueCount, DAILY_REVIEW_CAP)) {
    const requested = Math.min(10, Math.max(0, safeInteger(requestedNew, 10, 0, 50)));
    const thresholdLimit = dueCount > 30 ? 0 : dueCount > 20 ? 5 : dueCount > 10 ? 8 : 10;
    const remainingMinutes = Math.max(0, DAILY_TIME_BUDGET_MINUTES - reviewCount * REVIEW_ESTIMATE_MINUTES);
    const timeLimit = Math.floor(remainingMinutes / NEW_WORD_ESTIMATE_MINUTES);
    return Math.max(0, Math.min(requested, thresholdLimit, timeLimit));
  }

  function buildDailyPlan(dueIds, progress = {}, requestedNew = 10) {
    const dueAllIds = [...new Set(Array.isArray(dueIds) ? dueIds.filter((id) => typeof id === "string") : [])]
      .sort((left, right) => compareReviewPriority(left, right, progress));
    const plannedReviewIds = dueAllIds.slice(0, DAILY_REVIEW_CAP);
    const reviewBacklogIds = dueAllIds.slice(plannedReviewIds.length);
    const newLimit = dailyNewLimit(dueAllIds.length, requestedNew, plannedReviewIds.length);
    const estimatedMinutes = Math.ceil(
      plannedReviewIds.length * REVIEW_ESTIMATE_MINUTES + newLimit * NEW_WORD_ESTIMATE_MINUTES
    );
    return {
      dueAllIds,
      plannedReviewIds,
      reviewBacklogIds,
      reviewCapacity: DAILY_REVIEW_CAP,
      newLimit,
      estimatedMinutes: Math.min(DAILY_TIME_BUDGET_MINUTES, estimatedMinutes)
    };
  }

  function masteredCount(source = state) {
    return Object.values(source.lexemeProgress || source.progress || {}).filter((item) => item.status === "mature").length;
  }

  function learningMetrics(source = state, now = Date.now()) {
    const sevenDaysAgo = now - 7 * DAY_MS;
    const thirtyDaysAgo = now - 30 * DAY_MS;
    const learnedLexemes = new Map();
    for (const [cardId, item] of Object.entries(source?.progress || {})) {
      const word = getWord(cardId);
      if (!word || word.archived || !item?.learnedAt) continue;
      const lexemeId = lexemeIdForWord(word);
      const learnedAt = finiteNumber(item.learnedAt, 0, 0, 9_999_999_999_999);
      const previous = learnedLexemes.get(lexemeId);
      if (!previous || learnedAt < previous.learnedAt) learnedLexemes.set(lexemeId, { cardId, learnedAt });
    }
    const matureLexemes = new Set(
      Object.entries(source?.lexemeProgress || {})
        .filter(([, item]) => item?.status === "mature" && item.dueAt)
        .map(([lexemeId]) => lexemeId)
    );
    const recognitionEvents = (source?.recognitionEvents || []).filter((event) => event && event.occurredAt <= now);
    const recognizedSenses = new Set(recognitionEvents.filter((event) => event.correct).map((event) => event.senseId || `${event.cardId}:default`));
    const events = (source?.attemptEvents || []).filter((event) => event && event.occurredAt <= now);
    const recentEvents = events.filter((event) => event.occurredAt >= thirtyDaysAgo);
    const independentLexemes = new Set(events
      .filter((event) => event.mode === "full"
        && event.firstAttempt
        && event.firstAttemptCorrect
        && event.answerCorrect
        && !event.usedHint
        && !event.answerShown
        && ["good", "easy"].includes(event.grade))
      .map((event) => event.lexemeId || lexemeIdForWord(event.cardId))
      .filter(Boolean));
    const recentFirstAttempts = recentEvents.filter((event) => event.mode === "full" && event.firstAttempt);
    const recentReviewAttempts = recentFirstAttempts.filter((event) => event.source === "review");
    const firstAttemptCorrect = recentFirstAttempts.filter((event) => event.firstAttemptCorrect && !event.usedHint && !event.answerShown).length;
    const retainedReviews = recentReviewAttempts.filter((event) => event.firstAttemptCorrect && !event.usedHint && !event.answerShown).length;
    const timedEvents = recentEvents.filter((event) => event.durationMs > 0);
    const activeDays = new Set(recentEvents.map((event) => localDateKey(new Date(event.occurredAt))));
    const difficulty = new Map();
    for (const event of recentEvents) {
      if (!event.cardId || !["again", "hard"].includes(event.grade)) continue;
      const word = getWord(event.cardId);
      if (!word) continue;
      const key = event.lexemeId || lexemeIdForWord(word);
      const current = difficulty.get(key) || { cardId: word.id, word: word.word, again: 0, hard: 0, score: 0 };
      if (event.grade === "again") current.again += 1;
      else current.hard += 1;
      current.score = current.again * 2 + current.hard;
      difficulty.set(key, current);
    }
    return {
      seen: learnedLexemes.size,
      recognized: recognitionEvents.length ? recognizedSenses.size : null,
      recognitionMeasured: recognitionEvents.length > 0,
      independentlySpelled: independentLexemes.size,
      mature: matureLexemes.size,
      new7: [...learnedLexemes.values()].filter((item) => item.learnedAt >= sevenDaysAgo).length,
      new30: [...learnedLexemes.values()].filter((item) => item.learnedAt >= thirtyDaysAgo).length,
      firstAttemptRate: recentFirstAttempts.length ? Math.round(firstAttemptCorrect / recentFirstAttempts.length * 100) : null,
      retentionRate: recentReviewAttempts.length ? Math.round(retainedReviews / recentReviewAttempts.length * 100) : null,
      firstAttemptCount: recentFirstAttempts.length,
      reviewAttemptCount: recentReviewAttempts.length,
      averageActiveMinutes: activeDays.size && timedEvents.length
        ? Math.round(timedEvents.reduce((total, event) => total + event.durationMs, 0) / activeDays.size / 60_000 * 10) / 10
        : null,
      activeDays30: activeDays.size,
      backlog: source?.today?.reviewBacklogIds?.length || 0,
      difficultWords: [...difficulty.values()].sort((left, right) => right.score - left.score || left.word.localeCompare(right.word)).slice(0, 8),
      hasEventEvidence: events.length > 0 || recognitionEvents.length > 0
    };
  }

  function localWeekKey(date = new Date()) {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    return localDateKey(monday);
  }

  function weeklyCheckPlan(source = state, date = new Date()) {
    const excluded = new Set(source?.today?.newIds || []);
    const seenLexemes = new Set();
    const eligible = Object.keys(source?.progress || {}).filter((cardId) => {
      const word = getWord(cardId);
      if (!word || word.archived || excluded.has(cardId) || !source.progress[cardId]?.learnedAt) return false;
      if (!quizClueFor(word) && !word.visual?.image && !word.visual?.emoji) return false;
      const lexemeId = lexemeIdForWord(word);
      if (!lexemeId || seenLexemes.has(lexemeId)) return false;
      seenLexemes.add(lexemeId);
      return true;
    });
    return seededShuffle(eligible, `weekly-check:${localWeekKey(date)}`).slice(0, 5);
  }

  function weeklyCheckOptions(cardId, plannedIds, weekKey) {
    const correct = getWord(cardId);
    if (!correct) return [];
    const usedWords = new Set([normalizeAnswer(correct.word)]);
    const distractors = seededShuffle(
      [...(plannedIds || []).filter((id) => id !== cardId), ...allWords().map((word) => word.id)],
      `weekly-options:${weekKey}:${cardId}`
    ).filter((id) => {
      const word = getWord(id);
      const normalized = normalizeAnswer(word?.word);
      if (!word || word.archived || !normalized || usedWords.has(normalized)) return false;
      usedWords.add(normalized);
      return true;
    }).slice(0, 3);
    return seededShuffle([cardId, ...distractors], `weekly-order:${weekKey}:${cardId}`);
  }

  function learnedInBank(bankKey) {
    return (window.WORD_BANKS?.[bankKey] || []).filter((word) => state.progress[word.id]?.learnedAt).length;
  }

  function levelInfo() {
    const level = 1 + Math.floor(Math.sqrt(state.stats.xp / 100));
    const previousFloor = Math.pow(level - 1, 2) * 100;
    const nextFloor = Math.pow(level, 2) * 100;
    const percent = Math.max(0, Math.min(100, ((state.stats.xp - previousFloor) / (nextFloor - previousFloor)) * 100));
    return {
      level,
      title: LEVEL_TITLES[Math.min(LEVEL_TITLES.length - 1, level - 1)],
      percent,
      current: state.stats.xp - previousFloor,
      needed: nextFloor - previousFloor
    };
  }

  function markInitialModeDone(wordId, mode) {
    if (!getWord(wordId) || !["cloze", "full"].includes(mode)) return;
    const progress = state.progress[wordId] || {
      status: "learning",
      learnedAt: Date.now(),
      step: 0,
      scheduleToken: 0,
      lapses: 0,
      correct: 0,
      dueAt: null,
      initialModesDone: []
    };
    progress.initialModesDone = [...new Set([...(progress.initialModesDone || []), mode])];
    state.progress[wordId] = progress;
  }

  function taskCountsAsCleanInitial(task) {
    return Boolean(task?.source === "new" && task.cleanPass === true && (task.status === "passed" || task.status === "done"));
  }

  function rememberCompletedInitialModes(day = state.today) {
    if (!day || !Array.isArray(day.tasks)) return;
    for (const task of day.tasks) {
      if (taskCountsAsCleanInitial(task)) {
        markInitialModeDone(task.wordId, task.mode);
      }
    }
  }

  function initialModeIsDone(wordId, mode) {
    return Boolean(state.progress[wordId]?.initialModesDone?.includes(mode));
  }

  function ensureToday(force = false) {
    const todayKey = localDateKey();
    rememberCompletedInitialModes();
    if (!force && state.today?.date === todayKey) {
      normalizeToday();
      syncDueTasks();
      return;
    }

    const previousDay = state.today;
    if (!force && previousDay?.practiceMode === "sprint" && previousDay.sprint?.phase !== "complete") {
      previousDay.date = todayKey;
      previousDay.goalAwarded = false;
      previousDay.completed = false;
      previousDay.baselineDueIds = [];
      state.today = previousDay;
      resetTransientRuntime();
      normalizeToday();
      syncDueTasks();
      saveState();
      return;
    }
    resetTransientRuntime();
    if (state.settings.bank === "core2000") {
      const batch = coreBatchInfo(state.settings.coreBatch);
      const dueAllIds = coreDueIds(Date.now());
      const plan = buildDailyPlan(dueAllIds, spellingProgressMap(dueAllIds), state.settings.dailyGoal);
      const pendingSetIds = (batch?.wordIds || []).filter((id) => {
        const progress = state.progress[id];
        return !progress?.dueAt && (!progress?.learnedAt || progress.status === "learning");
      });
      const savedCandidates = pendingSavedTrainingIds(batch?.wordIds || []);
      const plannedSavedIds = savedCandidates.slice(0, Math.min(3, plan.newLimit));
      const plannedSetIds = pendingSetIds.slice(0, Math.max(0, plan.newLimit - plannedSavedIds.length));
      const newIds = [...plannedSavedIds, ...plannedSetIds];
      const deferredNewIds = [...savedCandidates.slice(plannedSavedIds.length), ...pendingSetIds.slice(plannedSetIds.length)];
      const carryoverIds = newIds.filter((id) => state.progress[id]?.learnedAt);
      state.today = {
        date: todayKey,
        bank: "core2000",
        goal: newIds.length,
        practiceMode: "mixed",
        sprint: null,
        coreBatchId: batch?.id || null,
        coreExerciseId: batch?.exercise?.id || null,
        planVersion: DAILY_PLAN_VERSION,
        plannedAt: Date.now(),
        dueAllIds: plan.dueAllIds,
        plannedReviewIds: plan.plannedReviewIds,
        reviewBacklogIds: plan.reviewBacklogIds,
        reviewCapacity: plan.reviewCapacity,
        newLimit: plan.newLimit,
        estimatedMinutes: Math.min(DAILY_TIME_BUDGET_MINUTES, Math.ceil(plan.plannedReviewIds.length * REVIEW_ESTIMATE_MINUTES + newIds.length * NEW_WORD_ESTIMATE_MINUTES)),
        newIds,
        deferredNewIds,
        carryoverIds,
        learnedIds: [...carryoverIds],
        practicedIds: [],
        dueIds: [...plan.plannedReviewIds],
        baselineDueIds: [...plan.plannedReviewIds],
        reviewDoneIds: [],
        studyCursor: 0,
        tasks: [],
        goalAwarded: false,
        completed: false,
        sessionXp: 0,
        sessionCorrect: 0,
        sessionMistakes: 0
      };
      syncPracticeTasks();
      saveState();
      return;
    }
    if (state.settings.practiceMode === "sprint") {
      const bank = state.settings.bank;
      const sprintDay = sprintDayFor(bank);
      const sprint = newSprintState(bank, sprintDay);
      const dueAllIds = getDueIds();
      state.settings.sprintDays[bank] = sprint.day;
      state.today = {
        date: todayKey,
        bank,
        goal: sprint.wordIds.length,
        practiceMode: "sprint",
        sprint,
        planVersion: DAILY_PLAN_VERSION,
        plannedAt: Date.now(),
        dueAllIds,
        plannedReviewIds: [],
        reviewBacklogIds: [...dueAllIds],
        reviewCapacity: DAILY_REVIEW_CAP,
        newLimit: sprint.wordIds.length,
        estimatedMinutes: 0,
        newIds: [...sprint.wordIds],
        deferredNewIds: [],
        carryoverIds: [],
        learnedIds: [],
        practicedIds: [],
        dueIds: [],
        baselineDueIds: [],
        reviewDoneIds: [],
        studyCursor: 0,
        tasks: [],
        goalAwarded: false,
        completed: false,
        sessionXp: 0,
        sessionCorrect: 0,
        sessionMistakes: 0
      };
      syncPracticeTasks();
      saveState();
      return;
    }
    const bankWords = currentBankWords();
    const bankIds = allowedDailyNewIds(state.settings.bank);
    const previousCarryover = previousDay
      ? (previousDay.newIds || []).filter((id) =>
        !(previousDay.practicedIds || []).includes(id)
        && bankIds.has(id)
      )
      : [];
    // A learner may switch banks before finishing both spelling phases. Those
    // cards already have learnedAt, so they are not "unseen", but they also do
    // not have a review schedule yet. Always restore this unfinished backlog
    // when its bank becomes active again instead of letting it disappear.
    const incompleteBacklog = bankWords
      .filter((word) => {
        const progress = state.progress[word.id];
        return Boolean(progress?.learnedAt && progress.status === "learning" && !progress.dueAt);
      })
      .map((word) => word.id);
    const rawCarryover = [...new Set([...previousCarryover, ...incompleteBacklog])];
    const carryover = state.settings.bank === "movers"
      ? sortMoversIds(rawCarryover)
      : rawCarryover;
    const carryLearned = carryover.filter((id) => state.progress[id]?.learnedAt);
    const savedCandidateSet = new Set(savedTrainingIds());
    const unseen = bankWords.filter((word) => !state.progress[word.id]?.learnedAt && !carryover.includes(word.id) && !savedCandidateSet.has(word.id));
    const dueAllIds = getDueIds();
    const plan = buildDailyPlan(dueAllIds, spellingProgressMap(dueAllIds), state.settings.dailyGoal);
    const plannedCarryover = carryover.slice(0, plan.newLimit);
    const savedCandidates = pendingSavedTrainingIds(plannedCarryover);
    const plannedSavedIds = savedCandidates.slice(0, Math.min(3, Math.max(0, plan.newLimit - plannedCarryover.length)));
    const slots = Math.max(0, plan.newLimit - plannedCarryover.length - plannedSavedIds.length);
    const selectedPool = state.settings.bank === "movers"
      ? sortMoversWords(unseen)
      : seededShuffle(unseen, `kevin:${todayKey}:${state.settings.bank}`);
    const selected = selectedPool.slice(0, slots).map((word) => word.id);
    const newIds = [...plannedCarryover, ...plannedSavedIds, ...selected];

    state.today = {
      date: todayKey,
      bank: state.settings.bank,
      goal: newIds.length,
      practiceMode: state.settings.practiceMode,
      sprint: null,
      planVersion: DAILY_PLAN_VERSION,
      plannedAt: Date.now(),
      dueAllIds: plan.dueAllIds,
      plannedReviewIds: plan.plannedReviewIds,
      reviewBacklogIds: plan.reviewBacklogIds,
      reviewCapacity: plan.reviewCapacity,
      newLimit: plan.newLimit,
      estimatedMinutes: Math.min(DAILY_TIME_BUDGET_MINUTES, Math.ceil(plan.plannedReviewIds.length * REVIEW_ESTIMATE_MINUTES + newIds.length * NEW_WORD_ESTIMATE_MINUTES)),
      newIds,
      deferredNewIds: [
        ...carryover.filter((id) => !plannedCarryover.includes(id)),
        ...savedCandidates.filter((id) => !plannedSavedIds.includes(id))
      ],
      carryoverIds: plannedCarryover,
      learnedIds: carryLearned.filter((id) => newIds.includes(id)),
      practicedIds: [],
      dueIds: [...plan.plannedReviewIds],
      baselineDueIds: [...plan.plannedReviewIds],
      reviewDoneIds: [],
      studyCursor: Math.min(carryLearned.length, Math.max(0, newIds.length - 1)),
      tasks: [],
      goalAwarded: false,
      completed: false,
      sessionXp: 0,
      sessionCorrect: 0,
      sessionMistakes: 0
    };
    syncPracticeTasks();
    saveState();
  }

  function normalizeToday() {
    const defaults = {
      bank: state.settings.bank,
      goal: state.settings.dailyGoal,
      practiceMode: state.settings.practiceMode,
      planVersion: DAILY_PLAN_VERSION,
      plannedAt: Date.now(),
      dueAllIds: [],
      plannedReviewIds: [],
      reviewBacklogIds: [],
      reviewCapacity: DAILY_REVIEW_CAP,
      newLimit: 0,
      estimatedMinutes: 0,
      newIds: [],
      deferredNewIds: [],
      carryoverIds: [],
      learnedIds: [],
      practicedIds: [],
      dueIds: [],
      baselineDueIds: [],
      reviewDoneIds: [],
      studyCursor: 0,
      tasks: [],
      goalAwarded: false,
      completed: false,
      sessionXp: 0,
      sessionCorrect: 0,
      sessionMistakes: 0
    };
    state.today = { ...defaults, ...state.today };
    for (const key of ["dueAllIds", "plannedReviewIds", "reviewBacklogIds", "newIds", "deferredNewIds", "carryoverIds", "learnedIds", "practicedIds", "dueIds", "baselineDueIds", "reviewDoneIds", "tasks"]) {
      if (!Array.isArray(state.today[key])) state.today[key] = [];
    }
    state.today.bank = safeBank(state.today.bank, state.settings.bank);
    if (state.today.practiceMode === "sprint") {
      state.today.sprint = sanitizeSprintState(
        state.today.sprint,
        state.today.bank,
        sprintDayFor(state.today.bank)
      );
      const sprintIds = new Set(state.today.sprint.wordIds);
      state.today.goal = state.today.sprint.wordIds.length;
      state.today.newIds = [...state.today.sprint.wordIds];
      state.today.deferredNewIds = [];
      state.today.carryoverIds = [];
      state.today.learnedIds = [...new Set(state.today.learnedIds.filter((id) => sprintIds.has(id)))];
      state.today.practicedIds = [...new Set(state.today.practicedIds.filter((id) => sprintIds.has(id)))];
      const sprintTaskPrefix = `sprint:${state.today.sprint.sessionId}:`;
      state.today.tasks = state.today.tasks.filter((task) =>
        task
        && getWord(task.wordId)
        && (
          task.source === "review"
          || (
            task.source === "sprint"
            && sprintIds.has(task.wordId)
            && typeof task.id === "string"
            && task.id.startsWith(sprintTaskPrefix)
          )
        )
      );
      state.today.studyCursor = Math.max(
        0,
        Math.min(state.today.studyCursor, Math.max(0, state.today.newIds.length - 1))
      );
      return;
    }
    if (state.today.bank === "core2000") {
      const batch = coreBatchById(state.today.coreBatchId) || coreBatchInfo(state.settings.coreBatch);
      const courseIds = new Set(batch?.wordIds || []);
      const allowedIds = new Set([...courseIds, ...savedTrainingIds(), ...state.today.newIds]);
      state.today.practiceMode = "mixed";
      state.today.sprint = null;
      state.today.coreBatchId = batch?.id || null;
      state.today.coreExerciseId = batch?.exercise?.id || null;
      state.today.newIds = [...new Set(state.today.newIds.filter((id) => allowedIds.has(id)))];
      state.today.goal = state.today.newIds.length;
      const pendingSetIds = [...courseIds].filter((id) => {
        const progress = state.progress[id];
        return !progress?.dueAt && (!progress?.learnedAt || progress.status === "learning");
      });
      state.today.deferredNewIds = [...new Set([
        ...state.today.deferredNewIds.filter((id) => allowedIds.has(id)),
        ...pendingSetIds.filter((id) => !state.today.newIds.includes(id))
      ])];
      state.today.carryoverIds = state.today.carryoverIds.filter((id) => state.today.newIds.includes(id));
      state.today.learnedIds = [...new Set(state.today.learnedIds.filter((id) => allowedIds.has(id)))];
      state.today.practicedIds = [...new Set(state.today.practicedIds.filter((id) => allowedIds.has(id)))];
      state.today.dueIds = [...new Set(state.today.dueIds.filter((id) => bankWordIds("core2000").has(id)))];
      state.today.plannedReviewIds = [...state.today.dueIds];
      state.today.baselineDueIds = [...new Set(state.today.baselineDueIds.filter((id) => bankWordIds("core2000").has(id)))];
      state.today.tasks = state.today.tasks.filter((task) => task && (
        (task.source === "new" && allowedIds.has(task.wordId))
        || (task.source === "review" && bankWordIds("core2000").has(task.wordId))
      ));
      state.today.studyCursor = Math.max(0, Math.min(state.today.studyCursor, Math.max(0, state.today.newIds.length - 1)));
      return;
    }
    state.today.sprint = null;
    const allowedNewIds = new Set([...allowedDailyNewIds(state.today.bank), ...state.today.newIds]);
    state.today.newIds = [...new Set(state.today.newIds.filter((id) => allowedNewIds.has(id)))];
    const missingBacklog = (window.WORD_BANKS?.[state.today.bank] || [])
      .filter((word) => {
        const progress = state.progress[word.id];
        return Boolean(
          progress?.learnedAt
          && progress.status === "learning"
          && !progress.dueAt
          && !state.today.newIds.includes(word.id)
        );
      })
      .map((word) => word.id);
    state.today.deferredNewIds = [...new Set([...state.today.deferredNewIds, ...missingBacklog.filter((id) => !state.today.newIds.includes(id))])];
    let newIdSet = new Set(state.today.newIds);
    state.today.carryoverIds = state.today.carryoverIds.filter((id) => newIdSet.has(id));
    state.today.learnedIds = state.today.learnedIds.filter((id) => newIdSet.has(id));
    state.today.practicedIds = state.today.practicedIds.filter((id) => newIdSet.has(id));
    reconcileMoversToday();
    newIdSet = new Set(state.today.newIds);
    state.today.tasks = state.today.tasks.filter((task) =>
      task
      && getWord(task.wordId)
      && (task.source === "review" || newIdSet.has(task.wordId))
      && !(task.source === "new" && task.status === "queued" && initialModeIsDone(task.wordId, task.mode))
    );
    state.today.studyCursor = Math.max(
      0,
      Math.min(state.today.studyCursor, Math.max(0, state.today.newIds.length - 1))
    );
  }

  function reconcileMoversToday() {
    if (state.today.bank !== "movers") return;
    const orderedMovers = sortMoversWords(window.WORD_BANKS?.movers || []);
    const moverIds = new Set(orderedMovers.map((word) => word.id));
    const allPreviousIds = [...state.today.newIds];
    const previousIds = allPreviousIds.filter((id) => moverIds.has(id));
    const externalIds = allPreviousIds.filter((id) => !moverIds.has(id));
    const previousCursor = Math.max(
      0,
      Math.min(state.today.studyCursor, Math.max(0, allPreviousIds.length - 1))
    );
    const currentWordId = allPreviousIds[previousCursor] || null;
    if (state.today.planVersion === DAILY_PLAN_VERSION) {
      state.today.newIds = [...externalIds, ...sortMoversIds(previousIds)];
      state.today.deferredNewIds = [...new Set(state.today.deferredNewIds.filter((id) => !state.today.newIds.includes(id)))];
      state.today.carryoverIds = state.today.carryoverIds.filter((id) => state.today.newIds.includes(id));
      state.today.learnedIds = state.today.learnedIds.filter((id) => state.today.newIds.includes(id));
      state.today.practicedIds = state.today.practicedIds.filter((id) => state.today.newIds.includes(id));
      state.today.studyCursor = currentWordId && state.today.newIds.includes(currentWordId)
        ? state.today.newIds.indexOf(currentWordId)
        : Math.max(0, Math.min(state.today.studyCursor, Math.max(0, state.today.newIds.length - 1)));
      return;
    }
    const plannedIds = previousIds;
    const protectedIds = plannedIds.filter((id) =>
      state.today.learnedIds.includes(id)
      || state.today.practicedIds.includes(id)
      || state.today.carryoverIds.includes(id)
    );
    const targetSize = Math.max(
      safeInteger(state.today.goal, state.settings.dailyGoal, 1, 50),
      protectedIds.length
    );
    const protectedSet = new Set(protectedIds);
    const earliestUnseen = orderedMovers
      .filter((word) => !state.progress[word.id]?.learnedAt && !protectedSet.has(word.id))
      .slice(0, Math.max(0, targetSize - protectedIds.length))
      .map((word) => word.id);
    state.today.newIds = sortMoversIds([...protectedIds, ...earliestUnseen]);
    state.today.carryoverIds = sortMoversIds(
      state.today.carryoverIds.filter((id) => state.today.newIds.includes(id))
    );
    state.today.learnedIds = sortMoversIds(
      state.today.learnedIds.filter((id) => state.today.newIds.includes(id))
    );
    state.today.practicedIds = sortMoversIds(
      state.today.practicedIds.filter((id) => state.today.newIds.includes(id))
    );
    if (currentWordId && state.today.newIds.includes(currentWordId)) {
      // Normal renders, “上一个”, and “再浏览一遍” must keep the word the
      // learner explicitly selected. Only old random plans whose current word
      // was removed should jump to the earliest unseen sequential card.
      state.today.studyCursor = state.today.newIds.indexOf(currentWordId);
    } else {
      const firstUnlearned = state.today.newIds.findIndex(
        (id) => !state.today.learnedIds.includes(id)
      );
      state.today.studyCursor = firstUnlearned >= 0
        ? firstUnlearned
        : Math.max(0, state.today.newIds.length - 1);
    }
  }

  function syncDueTasks() {
    if (!state.today) return;
    const dueNow = isCoreDay()
      ? coreDueIds(Date.now())
      : getDueIds();
    const plannedSet = new Set(state.today.plannedReviewIds || state.today.dueIds);
    state.today.dueIds = [...plannedSet];
    state.today.baselineDueIds = [...plannedSet];
    state.today.dueAllIds = [...new Set([...(state.today.dueAllIds || []), ...dueNow])];
    state.today.reviewBacklogIds = state.today.dueAllIds.filter((id) =>
      !plannedSet.has(id)
      && !state.today.reviewDoneIds.includes(id)
      && isDue(spellingProgress(id))
    );
    syncPracticeTasks();
  }

  function sprintPhaseWordIds(sprint = state.today?.sprint) {
    if (!sprint) return [];
    return sprint.phase === "drill" ? [...sprint.mistakeIds] : [...sprint.wordIds];
  }

  function sprintTaskId(sprint, phase, wordId) {
    const cycleToken = ["drill", "final"].includes(phase) ? `:r${sprint.cycle}` : "";
    const mode = phase === "cloze" ? "cloze" : "full";
    return `sprint:${sprint.sessionId}:${phase}${cycleToken}:${wordId}:${mode}`;
  }

  function finalizeSprintDay() {
    const day = state.today;
    const sprint = day?.sprint;
    if (!day || !sprint || sprint.phase !== "complete") return;
    day.practicedIds = [...sprint.wordIds];
    for (const wordId of sprint.wordIds) {
      markInitialModeDone(wordId, "cloze");
      markInitialModeDone(wordId, "full");
      const progress = state.progress[wordId];
      if (progress?.status === "learning" && !progress.dueAt) scheduleWord(wordId, "correct", true);
    }
  }

  function finishSprintPhase(sprintTasks) {
    const sprint = state.today.sprint;
    const result = evaluateSprintPhase(sprint.phase, sprintTasks, sprint.wordIds, sprint.cycle);
    if (["full", "final"].includes(sprint.phase)) {
      sprint.roundHistory.push({
        cycle: sprint.phase === "full" ? 0 : sprint.cycle,
        score: result.score,
        mistakes: result.mistakes
      });
      sprint.roundHistory = sprint.roundHistory.slice(-20);
    }
    sprint.phase = result.phase;
    sprint.cycle = result.cycle;
    sprint.mistakeIds = result.mistakes;
    sprint.lastScore = result.score;
    sprint.awaitingStart = !result.complete;
    const remainingTasks = state.today.tasks.filter((task) => task.source !== "sprint");
    state.today.tasks.length = 0;
    state.today.tasks.push(...remainingTasks);
    if (result.complete) finalizeSprintDay();
  }

  function syncSprintTasks() {
    const day = state.today;
    const sprint = day?.sprint;
    if (!day || day.practiceMode !== "sprint" || !sprint || sprint.phase === "complete") return;
    if (!sprint.wordIds.length || !sprint.wordIds.every((id) => day.learnedIds.includes(id))) return;
    const phaseWordIds = sprintPhaseWordIds(sprint);
    const expectedTaskIds = phaseWordIds.map((wordId) => sprintTaskId(sprint, sprint.phase, wordId));
    const expectedTaskIdSet = new Set(expectedTaskIds);
    const sprintTasks = day.tasks.filter((task) => task.source === "sprint" && expectedTaskIdSet.has(task.id));
    const existingTaskIds = new Set(sprintTasks.map((task) => task.id));
    if (sprintStageIsComplete(expectedTaskIds, sprintTasks)) {
      finishSprintPhase(sprintTasks);
      return;
    }
    if (sprint.awaitingStart) return;
    const mode = sprint.phase === "cloze" ? "cloze" : "full";
    for (const wordId of phaseWordIds) {
      const id = sprintTaskId(sprint, sprint.phase, wordId);
      if (!existingTaskIds.has(id)) {
        day.tasks.push(makeTask(id, wordId, "sprint", mode, {
          sprintPhase: sprint.phase,
          sprintCycle: sprint.cycle
        }));
      }
    }
  }

  function selectedModes() {
    if (isCoreDay()) return ["cloze", "full"];
    const mode = state.today?.practiceMode || state.settings.practiceMode;
    if (mode === "cloze") return ["cloze"];
    if (mode === "full") return ["full"];
    return ["cloze", "full"];
  }

  function syncPracticeTasks() {
    if (!state.today) return;
    const tasks = state.today.tasks;
    const existingIds = new Set(tasks.map((task) => task.id));
    const modes = selectedModes();

    if (state.today.practiceMode === "sprint") {
      syncSprintTasks();
      if (runtime.practiceSource !== "review") return;
    } else {
      for (const wordId of state.today.learnedIds) {
        if (state.today.practicedIds.includes(wordId)) continue;
        let hasPendingMode = false;
        for (const mode of modes) {
          if (initialModeIsDone(wordId, mode)) continue;
          hasPendingMode = true;
          const id = `new:${state.today.date}:${wordId}:${mode}`;
          if (!existingIds.has(id)) {
            tasks.push(makeTask(id, wordId, "new", mode));
            existingIds.add(id);
          }
        }
        if (!hasPendingMode) {
          state.today.practicedIds.push(wordId);
          const progress = state.progress[wordId];
          if (progress?.status === "learning" && !progress.dueAt) scheduleWord(wordId, "correct", true);
        }
      }
    }

    for (const wordId of state.today.dueIds) {
      if (!isDue(spellingProgress(wordId))) continue;
      const mode = state.today.practiceMode === "cloze" ? "cloze" : "full";
      const token = spellingProgress(wordId)?.scheduleToken || 0;
      const id = `review:${wordId}:${token}:${mode}`;
      if (!existingIds.has(id)) {
        tasks.push(makeTask(id, wordId, "review", mode));
        existingIds.add(id);
      }
    }
  }

  function makeTask(id, wordId, source, mode, options = {}) {
    return {
      id,
      wordId,
      source,
      mode,
      status: "queued",
      attempts: 0,
      hadLapse: false,
      assisted: false,
      usedAudio: false,
      nearMissUsed: false,
      attemptStartedAt: Date.now(),
      maskSeed: id,
      completedAt: null,
      draft: "",
      hintIndices: [],
      errorIndices: [],
      sprintPhase: options.sprintPhase || null,
      sprintCycle: safeInteger(options.sprintCycle, 1, 1, 999),
      cleanPass: false
    };
  }

  function resetTaskForMasteryRetry(task) {
    if (!task || typeof task !== "object") return task;
    task.status = "queued";
    task.attempts = 0;
    task.hadLapse = false;
    task.assisted = false;
    task.usedAudio = false;
    task.nearMissUsed = false;
    task.attemptStartedAt = Date.now();
    task.completedAt = null;
    task.draft = "";
    task.hintIndices = [];
    task.errorIndices = [];
    task.feedback = null;
    task.cleanPass = false;
    return task;
  }

  function resetNewWordMasteryCycle(wordId) {
    const modes = new Set(selectedModes());
    const progress = state.progress[wordId];
    if (progress) progress.initialModesDone = (progress.initialModesDone || []).filter((mode) => !modes.has(mode));
    state.today.practicedIds = state.today.practicedIds.filter((id) => id !== wordId);
    for (const candidate of state.today.tasks) {
      if (candidate.source === "new" && candidate.wordId === wordId && modes.has(candidate.mode)) {
        resetTaskForMasteryRetry(candidate);
      }
    }
  }

  function currentTask() {
    syncPracticeTasks();
    const activeTasks = state.today.tasks.filter((task) => task.status !== "done" && getWord(task.wordId));
    if (runtime.practiceSource === "review") {
      const reviewTask = activeTasks.find((task) => task.source === "review");
      if (reviewTask) return reviewTask;
      return null;
    }
    if (state.today.practiceMode === "sprint") {
      const sprintTask = activeTasks.find((task) => task.source === "sprint");
      if (!sprintTask) return null;
      const passedSprintTask = activeTasks.find((task) => task.source === "sprint" && task.status === "passed");
      return passedSprintTask || sprintTask;
    }
    const passedTask = activeTasks.find((task) => task.status === "passed");
    if (passedTask) return passedTask;
    return activeTasks[0] || null;
  }

  function award(eventId, xp, coins, message) {
    if (state.scoreLedger.some((event) => event.id === eventId)) return false;
    const event = { id: eventId, xp, coins, at: Date.now() };
    state.scoreLedger.push(event);
    state.scoreLedger = state.scoreLedger.slice(-500);
    state.stats.xp += xp;
    state.stats.coins += coins;
    if (state.today) state.today.sessionXp += xp;
    if (message) toast(`${message}  +${xp} XP`, "✦");
    return true;
  }

  function evaluateBadges() {
    for (const badge of BADGES) {
      if (!state.badges[badge.id] && badge.test(state)) {
        state.badges[badge.id] = { unlockedAt: Date.now() };
        toast(isCoreDay() ? "New adventure badge unlocked!" : `解锁徽章：${badge.name}`, badge.emoji);
      }
    }
  }

  function nextReviewSchedule(existing, outcome = "good", isInitial = false, now = Date.now()) {
    const progress = {
      ...(existing || {
      status: "learning",
      learnedAt: now,
      step: 0,
      scheduleToken: 0,
      lapses: 0,
      correct: 0,
      initialModesDone: []
      })
    };
    const grade = ["again", "hard", "good", "easy"].includes(outcome)
      ? outcome
      : outcome === "correct" ? "good" : "again";
    const currentStep = safeInteger(progress.step, 0, 0, REVIEW_DELAYS.length - 1);
    let step = isInitial ? 0 : currentStep;
    if (!isInitial && grade === "good") step = Math.min(REVIEW_DELAYS.length - 1, currentStep + 1);
    if (!isInitial && grade === "easy") step = Math.min(REVIEW_DELAYS.length - 1, currentStep + 2);
    if (!isInitial && grade === "again") {
      step = 0;
      progress.lapses = (progress.lapses || 0) + 1;
    }

    const delay = REVIEW_DELAYS[step];
    progress.status = grade === "again" && !isInitial
      ? "relearning"
      : step >= MATURE_STEP ? "mature" : "reviewing";
    progress.step = step;
    progress.scheduleVersion = REVIEW_SCHEDULE_VERSION;
    progress.dueAt = delay.ms ? now + delay.ms : addLocalDays(now, delay.days);
    progress.lastReviewedAt = now;
    progress.lastGrade = isInitial ? "good" : grade;
    if (isInitial || grade !== "again") {
      progress.lastSuccessAt = now;
      progress.correct = (progress.correct || 0) + 1;
    }
    progress.scheduleToken = (progress.scheduleToken || 0) + 1;
    return progress;
  }

  function initialScheduleNeeded(existing, requestedInitial) {
    return Boolean(requestedInitial && !existing?.dueAt);
  }

  function scheduleWord(wordId, outcome = "good", isInitial = false) {
    const canonicalId = canonicalWordId(wordId);
    const lexemeId = lexemeIdForWord(canonicalId);
    const existing = spellingProgress(canonicalId) || state.progress[canonicalId];
    const effectiveInitial = initialScheduleNeeded(existing, isInitial);
    const next = nextReviewSchedule(existing, outcome, effectiveInitial);
    state.lexemeProgress[lexemeId] = next;
    state.progress[canonicalId] = {
      ...(state.progress[canonicalId] || next),
      status: next.status,
      step: next.step,
      scheduleVersion: next.scheduleVersion,
      scheduleToken: next.scheduleToken,
      lapses: next.lapses,
      correct: next.correct,
      dueAt: next.dueAt,
      lastSuccessAt: next.lastSuccessAt,
      lastReviewedAt: next.lastReviewedAt,
      lastGrade: next.lastGrade
    };
  }

  function completeGoalIfReady() {
    const day = state.today;
    if (!day || day.goalAwarded) return false;
    const isSprint = day.practiceMode === "sprint";
    const allNewDone = isSprint
      ? day.sprint?.phase === "complete" && day.sprint.wordIds.every((id) => day.practicedIds.includes(id))
      : day.newIds.length === 0 || day.newIds.every((id) => day.practicedIds.includes(id));
    const baselineReviewsDone = isSprint
      ? true
      : day.baselineDueIds.every((id) => day.reviewDoneIds.includes(id) || !isDue(spellingProgress(id)));
    const hadPlannedWork = isSprint ? Boolean(day.sprint?.wordIds.length) : day.newIds.length > 0 || day.baselineDueIds.length > 0;
    if (!hadPlannedWork || !allNewDone || !baselineReviewsDone) return false;

    day.goalAwarded = true;
    day.completed = true;
    const isNewDailyCompletion = !dailyCompletionExists(state, day.date);
    if (isNewDailyCompletion) {
      award(`daily:${day.date}`, 50, 30, isCoreDay(day) ? "Today's English quest is complete" : "今日探险完成");
    }
    recordCompletionState(state, day, Date.now(), isNewDailyCompletion);
    evaluateBadges();
    confetti();
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function missingAssetLabel(image) {
    if (image?.closest?.(".core-workbook-page")) return "Original exercise image is unavailable in this copy. The answer sheet still works.";
    if (image?.closest?.(".core-reading")) return "Optional reading image is unavailable in this copy.";
    return "Picture unavailable — use the English clue and audio.";
  }

  function replaceMissingImage(image) {
    if (!image || image.dataset?.assetFallback === "true") return;
    image.dataset.assetFallback = "true";
    image.hidden = true;
    const placeholder = document.createElement("div");
    placeholder.className = "asset-missing-placeholder";
    placeholder.setAttribute("role", "img");
    placeholder.textContent = missingAssetLabel(image);
    image.insertAdjacentElement("afterend", placeholder);
  }

  function safeColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
  }

  function toast(message, icon = "✓") {
    const element = document.createElement("div");
    element.className = "toast";
    element.innerHTML = `<span class="toast-icon">${escapeHtml(icon)}</span><span>${escapeHtml(message)}</span>`;
    toastRegion.append(element);
    window.setTimeout(() => element.classList.add("is-leaving"), 2700);
    window.setTimeout(() => element.remove(), 3050);
  }

  function confetti() {
    const colors = ["#ffca4b", "#f26f5e", "#61c5cf", "#79aa69", "#fffaf0"];
    for (let index = 0; index < 54; index += 1) {
      const piece = document.createElement("i");
      piece.className = "confetti-piece";
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[index % colors.length];
      piece.style.setProperty("--fall-duration", `${1.9 + Math.random() * 1.8}s`);
      piece.style.setProperty("--drift", `${-80 + Math.random() * 160}px`);
      piece.style.animationDelay = `${Math.random() * 0.38}s`;
      confettiLayer.append(piece);
      window.setTimeout(() => piece.remove(), 4100);
    }
  }

  function illustrationSvg(word) {
    if (word.visual?.image) {
      const isCommonsImage = word.visual.sourceKind === "wikimedia-commons";
      const sourceDetail = [
        word.sourcePage ? `第 ${word.sourcePage} 页` : "",
        word.sourceNumber ? `编号 ${word.sourceNumber}` : ""
      ].filter(Boolean).join(" · ");
      const commonsUrl = /^https:\/\/commons\.wikimedia\.org\//i.test(word.visual.sourceUrl || "") ? word.visual.sourceUrl : "";
      const creditTitle = [word.visual.creator, word.visual.fileTitle].filter(Boolean).join(" · ");
      const creditLabel = [word.visual.creator || "Wikimedia Commons", word.visual.license || "开放许可"].join(" · ");
      const sourceCredit = isCommonsImage && commonsUrl
        ? `<a href="${escapeHtml(commonsUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(creditTitle)}">${escapeHtml(creditLabel)} ↗</a>`
        : escapeHtml(sourceDetail);
      return `
        <figure class="source-picture-frame">
          <img src="${escapeHtml(word.visual.image)}" alt="${escapeHtml(word.englishOnly ? `Book picture for ${word.word}` : `${word.word}：${word.zh}`)}" draggable="false" />
          <figcaption><span>${word.custom ? "PARENT-SELECTED IMAGE" : word.englishOnly ? "ORIGINAL BOOK IMAGE" : isCommonsImage ? `开放配图 · 短语 ${escapeHtml(word.sourceNumber)}` : "PDF 原图"}</span>${word.custom ? escapeHtml(word.sourceTag || "Reading") : word.englishOnly ? escapeHtml(word.visual.source || "2000 Core English Words") : sourceCredit}</figcaption>
        </figure>`;
    }
    const first = safeColor(word.visual?.color1, "#61c5cf");
    const second = safeColor(word.visual?.color2, "#ffca4b");
    const id = `g${hashString(word.id)}`;
    return `
      <svg viewBox="0 0 360 300" role="img" aria-label="${escapeHtml(word.visual?.scene || word.zh)}">
        <defs>
          <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${first}" />
            <stop offset="1" stop-color="${second}" />
          </linearGradient>
        </defs>
        <path d="M40 205c26-48 63-61 104-38 28-55 92-65 131-15 20 25 24 70 4 93H55c-30-5-35-22-15-40Z" fill="url(#${id})" opacity=".78" />
        <circle cx="284" cy="55" r="28" fill="${second}" opacity=".78" />
        <path d="M46 78c35-28 70-31 104-9M250 105c21-19 41-23 65-9" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".5" />
        <ellipse cx="180" cy="244" rx="100" ry="17" fill="#173f3a" opacity=".12" />
        <g class="illustration-emoji">
          <text x="180" y="194" text-anchor="middle" font-size="122" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif">${escapeHtml(word.visual?.emoji || "🖼️")}</text>
        </g>
        <path d="M87 268c49 8 137 8 186 0" fill="none" stroke="#173f3a" stroke-width="3" stroke-linecap="round" opacity=".16" />
      </svg>`;
  }

  function compactPictureMarkup(word, imageClass, emojiClass) {
    if (word.visual?.image) {
      return `<img class="${imageClass}" src="${escapeHtml(word.visual.image)}" alt="" aria-hidden="true" draggable="false" />`;
    }
    return `<span class="${emojiClass}">${escapeHtml(word.visual?.emoji || "🖼️")}</span>`;
  }

  function stopSpeech() {
    speechToken += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    document.querySelectorAll(".is-speaking").forEach((item) => item.classList.remove("is-speaking"));
  }

  function selectAmericanVoice(voices) {
    const englishVoices = Array.from(voices || []).filter((voice) => /^en(?:-|$)/i.test(voice?.lang || ""));
    if (!englishVoices.length) return null;
    const noveltyPattern = /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox/i;
    const qualityPattern = /natural|enhanced|premium|samantha|ava|allison|susan|tom|aria|jenny|guy|google us english|siri/i;
    const normalVoices = englishVoices.filter((voice) => !noveltyPattern.test(`${voice.name || ""} ${voice.voiceURI || ""}`));
    const americanVoices = normalVoices.filter((voice) => /^en-US/i.test(voice.lang || ""));
    const candidates = americanVoices.length ? americanVoices : normalVoices;
    if (!candidates.length) return null;
    return candidates
      .map((voice, index) => {
        const identity = `${voice.name || ""} ${voice.voiceURI || ""}`;
        let score = 0;
        if (qualityPattern.test(identity)) score += 35;
        if (voice.localService) score += 4;
        if (voice.default) score += 2;
        return { voice, score, index };
      })
      .sort((left, right) => right.score - left.score || left.index - right.index)[0].voice;
  }

  function speechVoiceLabel(voices) {
    const voice = selectAmericanVoice(voices);
    if (!voice) return "en-US voice requested";
    const language = safeText(voice.lang, "English", 20);
    return /^en-US/i.test(language) ? `US voice · ${language}` : `English fallback · ${language}`;
  }

  function speak(text, button = null, rate = 0.78) {
    if (!text) return;
    if (!state.settings.sound) {
      if (button) toast("英语发音已关闭，可在设置中重新开启", "🔈");
      return;
    }
    if (!("speechSynthesis" in window)) {
      toast("当前浏览器没有可用的英语语音", "🔈");
      return;
    }
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = rate;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const voice = selectAmericanVoice(voices);
    if (voice) utterance.voice = voice;
    const token = ++speechToken;
    button?.classList.add("is-speaking");
    utterance.onend = utterance.onerror = () => {
      if (token === speechToken) button?.classList.remove("is-speaking");
    };
    window.speechSynthesis.speak(utterance);
  }

  function buildStudySpeechSequence(word, definition, example) {
    return [
      { text: String(word || "").trim(), rate: 0.72, kind: "word" },
      { text: String(definition || "").trim(), rate: 0.74, kind: "definition" },
      { text: String(example || "").trim(), rate: 0.76, kind: "example" }
    ].filter((item) => item.text);
  }

  function speakSequence(items, button = null) {
    const sequence = Array.isArray(items) ? items.filter((item) => item?.text) : [];
    if (!sequence.length) return;
    if (!state.settings.sound) {
      if (button) toast("英语发音已关闭，可在设置中重新开启", "🔈");
      return;
    }
    if (!("speechSynthesis" in window)) {
      toast("当前浏览器没有可用的英语语音", "🔈");
      return;
    }
    stopSpeech();
    const token = ++speechToken;
    const voice = selectAmericanVoice(window.speechSynthesis.getVoices());
    button?.classList.add("is-speaking");

    const playItem = (index) => {
      if (token !== speechToken) return;
      if (index >= sequence.length) {
        button?.classList.remove("is-speaking");
        return;
      }
      const item = sequence[index];
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = "en-US";
      utterance.rate = finiteNumber(item.rate, 0.76, 0.5, 1.5);
      utterance.pitch = 1;
      if (voice) utterance.voice = voice;
      utterance.onend = () => {
        if (token === speechToken) window.setTimeout(() => playItem(index + 1), 230);
      };
      utterance.onerror = () => {
        if (token === speechToken) button?.classList.remove("is-speaking");
      };
      window.speechSynthesis.speak(utterance);
    };
    playItem(0);
  }

  function makeMask(word, seed, mode) {
    const chars = [...word.toLowerCase()];
    const letterIndices = chars.map((char, index) => (isPracticeLetter(char) ? index : -1)).filter((index) => index >= 0);
    if (mode === "full") return new Set(letterIndices);
    const candidates = letterIndices.filter((index) => {
      if (letterIndices.length < 4) return true;
      return index !== letterIndices[0] && index !== letterIndices.at(-1);
    });
    const shuffled = seededShuffle(candidates, seed);
    const target = Math.max(1, Math.min(candidates.length, Math.ceil(letterIndices.length * 0.52)));
    return new Set(shuffled.slice(0, target));
  }

  function canEnterPracticeAnswer(candidate, canonical, mask, lockedIndices = new Set()) {
    const candidateChars = [...normalizeAnswer(candidate)];
    const canonicalChars = [...normalizeAnswer(canonical)];
    if (candidateChars.length !== canonicalChars.length) return false;
    return canonicalChars.every((char, index) => {
      if (!isPracticeLetter(char)) return candidateChars[index] === char;
      if (!mask.has(index) || lockedIndices.has(index)) return candidateChars[index] === char;
      return isPracticeLetter(candidateChars[index] || "");
    });
  }

  function isPracticeLetter(value) {
    return /^\p{L}$/u.test(String(value || ""));
  }

  function normalizeAnswer(value) {
    return String(value || "").normalize("NFKC").trim().toLowerCase().replaceAll("’", "'");
  }

  function spellingVariants(word) {
    const forms = new Set();
    const normalized = normalizeAnswer(word).replace(/\s+/g, " ");
    if (!normalized) return forms;
    forms.add(normalized);
    if (!/^[a-z]{3,}$/.test(normalized)) return forms;
    forms.add(`${normalized}s`);
    forms.add(`${normalized}ed`);
    forms.add(`${normalized}ing`);
    if (normalized.endsWith("e")) {
      forms.add(`${normalized}d`);
      forms.add(`${normalized.slice(0, -1)}ing`);
    }
    if (/[^aeiou]y$/.test(normalized)) {
      forms.add(`${normalized.slice(0, -1)}ies`);
      forms.add(`${normalized.slice(0, -1)}ied`);
    }
    if (/(?:s|x|z|ch|sh)$/.test(normalized)) forms.add(`${normalized}es`);
    return forms;
  }

  function answerFormsFor(word) {
    return [...new Set([word?.word, ...(Array.isArray(word?.acceptedAnswers) ? word.acceptedAnswers : [])]
      .flatMap((form) => [...spellingVariants(form)]))];
  }

  function semanticAlternativesFor(word) {
    const values = Array.isArray(word?.semanticAlternatives) ? word.semanticAlternatives : word?.acceptedAnswers;
    return [...new Set((Array.isArray(values) ? values : []).map(normalizeAnswer).filter(Boolean))];
  }

  function spellingAnswersFor(word) {
    return [...new Set([word?.word, ...(Array.isArray(word?.spellingVariants) ? word.spellingVariants : [])]
      .map(normalizeAnswer)
      .filter(Boolean))];
  }

  function clueContainsAnswer(clue, word) {
    const searchable = normalizeAnswer(clue).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (!searchable) return false;
    return answerFormsFor(word).some((form) => {
      const target = form.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      return target && (` ${searchable} `).includes(` ${target} `);
    });
  }

  function studyDefinitionFor(word) {
    return safeText(word?.studyDefinition || word?.en, "", 900);
  }

  function feedbackDefinitionFor(word) {
    return safeText(word?.feedbackDefinition || studyDefinitionFor(word), "", 900);
  }

  function quizClueFor(word) {
    const clue = safeText(word?.quizClue, "", 500);
    return clue && !clueContainsAnswer(clue, word) ? clue : "";
  }

  function normalizeExerciseAnswer(value) {
    return normalizeAnswer(value)
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .replace(/\s*[,;/&+]\s*/g, ",")
      .replace(/\s+and\s+/g, ",")
      .replace(/[^a-z0-9,' -]/g, "")
      .trim();
  }

  function coreExerciseAnswerMatches(value, expected) {
    const candidates = Array.isArray(expected) ? expected : [expected];
    const actual = normalizeExerciseAnswer(value);
    return candidates.some((candidate) => {
      const target = normalizeExerciseAnswer(candidate);
      if (!target) return false;
      const targetChoices = target.replaceAll(",", "");
      if (/^[a-e]{2,5}$/.test(targetChoices) && target.includes(",")) {
        const actualChoices = actual.replaceAll(",", "");
        return /^[a-e]{2,5}$/.test(actualChoices)
          && [...new Set(actualChoices)].sort().join("") === [...new Set(targetChoices)].sort().join("");
      }
      return actual.replaceAll(",", " ").replace(/\s+/g, " ")
        === target.replaceAll(",", " ").replace(/\s+/g, " ");
    });
  }

  function damerauDistanceOne(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 1) return 2;
    if (a.length === b.length) {
      const diff = [];
      for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff.push(i);
      if (diff.length === 1) return 1;
      if (diff.length === 2 && diff[1] === diff[0] + 1 && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return 1;
      return 2;
    }
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    let left = 0;
    let right = 0;
    let edits = 0;
    while (left < shorter.length && right < longer.length) {
      if (shorter[left] === longer[right]) left += 1;
      else if ((edits += 1) > 1) return 2;
      right += 1;
    }
    return 1;
  }

  function updateChrome() {
    if (!state) return;
    const level = levelInfo();
    const english = isCoreDay();
    document.documentElement.lang = english ? "en" : "zh-CN";
    document.querySelectorAll("[data-zh][data-en]").forEach((item) => {
      item.textContent = english ? item.dataset.en : item.dataset.zh;
    });
    document.getElementById("topStreak").textContent = state.stats.streak;
    document.getElementById("topCoins").textContent = state.stats.coins;
    document.getElementById("topLevel").textContent = english ? `Lv. ${level.level} Word Explorer` : `Lv. ${level.level} ${level.title}`;
    const dueCount = getDueIds().length;
    const badge = document.getElementById("reviewBadge");
    badge.textContent = dueCount;
    badge.hidden = dueCount === 0;
    document.querySelectorAll("[data-route]").forEach((item) => {
      item.classList.toggle("is-active", item.dataset.route === route);
    });
    document.querySelector('[data-action="open-more-menu"]')?.classList.toggle(
      "is-active",
      ["settings", "parent", "pk"].includes(route)
    );
  }

  function render() {
    ensureToday();
    runtime.feedback = null;
    const renderers = {
      home: renderHome,
      learn: renderLearn,
      practice: renderPractice,
      review: renderReview,
      books: renderBooks,
      notebook: renderNotebook,
      parent: renderParentReport,
      checkup: renderWeeklyCheckup,
      pk: renderPk,
      settings: renderSettings
    };
    const renderer = renderers[route] || renderHome;
    root.innerHTML = renderer();
    document.body.dataset.currentRoute = route;
    updateChrome();
    root.focus({ preventScroll: true });
    afterRender();
  }

  function afterRender() {
    if (route === "practice") {
      window.setTimeout(() => document.querySelector(".letter-cell:not([disabled])")?.focus(), 60);
    }
    if (route === "learn") {
      if (runtime.autoSpeakWord && state.settings.autoSound && state.settings.sound) {
        window.setTimeout(() => speak(runtime.autoSpeakWord), 180);
      }
      runtime.autoSpeakWord = null;
    }
  }

  function navigate(nextRoute) {
    if (!nextRoute) return;
    if (state.today?.pausedAt && ["learn", "practice"].includes(nextRoute)) {
      state.today.pausedAt = null;
      saveState();
    }
    if (nextRoute !== route) stopSpeech();
    if (window.location.hash !== `#${nextRoute}`) window.location.hash = nextRoute;
    else {
      route = nextRoute;
      render();
    }
  }

  function pauseToday() {
    if (!state.today || state.today.completed || state.today.practiceMode === "sprint") return;
    state.today.pausedAt = Date.now();
    stopSpeech();
    saveState();
    navigate("home");
    render();
    toast("今天的进度已保存，休息不会受罚", "🌙");
  }

  function resumeToday() {
    if (!state.today?.pausedAt) return;
    state.today.pausedAt = null;
    saveState();
    const cta = homeCta();
    navigate(cta.route || "home");
  }

  const SPRINT_PHASE_META = [
    { id: "cloze", short: "补空", title: "补空热身", icon: "◐" },
    { id: "full", short: "首测", title: "完整拼写首测", icon: "●" },
    { id: "drill", short: "加练", title: "错词加练", icon: "↻" },
    { id: "final", short: "终测", title: "整组终极默写", icon: "🏁" }
  ];

  function sprintPhaseMeta(phase) {
    return SPRINT_PHASE_META.find((item) => item.id === phase) || SPRINT_PHASE_META[0];
  }

  function sprintRangeText(sprint) {
    const batch = sprintBatchInfo(state.today?.bank || state.settings.bank, sprint?.day || 1);
    if (!batch.total) return "本组暂无学习内容";
    if (batch.scheduleKind === "movers-pdf-word") {
      return `PDF 单词 Day ${batch.sourceDay} · ${batch.wordTotal} 个单词`;
    }
    if (batch.scheduleKind === "movers-pdf-phrase") {
      return `PDF 短语编号 ${batch.phraseStart}–${batch.phraseEnd} · ${batch.phraseTotal} 个短语`;
    }
    return `词表第 ${batch.start + 1}–${batch.end} 项`;
  }

  function sprintRouteMarkup(sprint, compact = false) {
    const activeIndex = sprint.phase === "complete"
      ? SPRINT_PHASE_META.length
      : Math.max(0, SPRINT_PHASE_META.findIndex((item) => item.id === sprint.phase));
    return `<ol class="sprint-route ${compact ? "is-compact" : ""}" aria-label="考试冲刺训练路线">${SPRINT_PHASE_META.map((item, index) => {
      const done = sprint.phase === "complete" || index < activeIndex;
      const active = sprint.phase !== "complete" && index === activeIndex;
      const detail = item.id === "drill" && sprint.phase === "drill"
        ? `${sprint.mistakeIds.length} 个错词`
        : item.id === "final" && sprint.cycle > 1
          ? `第 ${sprint.cycle} 轮`
          : item.short;
      const status = done ? "已完成" : active ? "进行中" : "未解锁";
      return `<li class="sprint-stage ${done ? "is-done" : active ? "is-active" : "is-locked"}" aria-label="${escapeHtml(`${item.title}，${status}，${detail}`)}" ${active ? `aria-current="step"` : ""}><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(detail)}</small></li>`;
    }).join("")}</ol>`;
  }

  function sprintStageTasks(day = state.today) {
    return day.tasks.filter((task) => task.source === "sprint" && task.sprintPhase === day.sprint?.phase);
  }

  function sprintProgressPercent(day = state.today) {
    const total = Math.max(1, day.sprint?.wordIds.length || 0);
    const learnedRatio = Math.min(1, day.learnedIds.length / total);
    if (learnedRatio < 1) return Math.round(learnedRatio * 20);
    if (day.sprint?.phase === "complete") return 100;
    const bases = { cloze: 20, full: 40, drill: 60, final: 75 };
    const spans = { cloze: 20, full: 20, drill: 15, final: 25 };
    const tasks = sprintStageTasks(day);
    const done = tasks.filter((task) => task.status === "done").length;
    const ratio = tasks.length ? done / tasks.length : 0;
    return Math.min(99, Math.round((bases[day.sprint.phase] || 20) + ratio * (spans[day.sprint.phase] || 0)));
  }

  function homeCta() {
    const day = state.today;
    if (day.pausedAt) return { action: "resume-today", label: "继续今天的任务", icon: "↻" };
    const learned = day.learnedIds.length;
    if (day.practiceMode === "sprint") {
      const sprint = day.sprint;
      if (learned < sprint.wordIds.length) {
        const isPhraseDay = sprintBatchInfo(day.bank, sprint.day).contentKind === "phrase";
        return { route: "learn", label: learned ? "继续顺序学习" : `开始第 1 个${isPhraseDay ? "短语" : "单词"}`, icon: "✦" };
      }
      if (sprint.phase === "complete") return { route: "practice", label: `查看 ${sprint.wordIds.length}/${sprint.wordIds.length} 成绩`, icon: "🏆" };
      if (sprint.awaitingStart) return { route: "practice", label: `开始${sprintPhaseMeta(sprint.phase).title}`, icon: sprintPhaseMeta(sprint.phase).icon };
      return { route: "practice", label: `继续${sprintPhaseMeta(sprint.phase).title}`, icon: sprintPhaseMeta(sprint.phase).icon };
    }
    return ordinaryHomeAction(day, dailyPlanMetrics(day).reviewRemaining);
  }

  function ordinaryHomeAction(day, reviewRemaining) {
    if (day.pausedAt) return { action: "resume-today", label: "继续今天的任务", icon: "↻" };
    const learned = day.learnedIds.length;
    const newDone = day.newIds.length === 0 || day.newIds.every((id) => day.practicedIds.includes(id));
    if (reviewRemaining > 0) return { action: "start-review", label: `先复习 ${reviewRemaining} 个旧词`, icon: "↻" };
    if (day.newIds.length === 0) return { route: "books", label: "换一本词库", icon: "▤" };
    if (learned < day.newIds.length) return { route: "learn", label: learned ? "继续学习" : "出发学新词", icon: "✦" };
    if (!newDone) return { route: "practice", label: "开始拼写训练", icon: "✎" };
    return { route: "review", label: "查看记忆地图", icon: "↻" };
  }

  function dailyPlanMetrics(day = state.today) {
    const plannedReviewIds = day?.plannedReviewIds || day?.baselineDueIds || [];
    const reviewDone = plannedReviewIds.filter((id) => day.reviewDoneIds?.includes(id) || !isDue(spellingProgress(id))).length;
    const reviewRemaining = Math.max(0, plannedReviewIds.length - reviewDone);
    const backlog = (day?.reviewBacklogIds || []).filter((id) => isDue(spellingProgress(id))).length;
    return {
      dueAll: reviewRemaining + backlog,
      plannedReviews: plannedReviewIds.length,
      reviewDone,
      reviewRemaining,
      backlog,
      newWords: day?.newIds?.length || 0,
      estimatedMinutes: safeInteger(day?.estimatedMinutes, 0, 0, 180)
    };
  }

  function renderDailyPlanSummary(day = state.today, english = false) {
    const plan = dailyPlanMetrics(day);
    const selectedWords = (day?.newIds || []).filter((id) => Boolean(state.savedWords?.[id])).length;
    const workTotal = plan.newWords + plan.plannedReviews;
    const workDone = (day?.practicedIds || []).length + plan.reviewDone;
    const completion = workTotal ? Math.min(100, Math.round(workDone / workTotal * 100)) : 100;
    return `<div class="review-summary daily-plan-summary" aria-label="${english ? "Frozen daily learning plan" : "今日冻结学习计划"}">
      <div class="review-stat-card"><strong>${plan.estimatedMinutes}</strong><span>${english ? "EST. MINUTES" : "预计分钟"}</span></div>
      <div class="review-stat-card"><strong>${plan.plannedReviews}</strong><span>${english ? "PLANNED REVIEWS" : "计划旧词"}</span></div>
      <div class="review-stat-card"><strong>${plan.newWords}</strong><span>${english ? "NEW WORDS" : "可学新词"}</span></div>
      <div class="review-stat-card"><strong>${selectedWords}</strong><span>${english ? "MY WORDS" : "自选词"}</span></div>
      <div class="review-stat-card"><strong>${completion}%</strong><span>${english ? "COMPLETED" : "今日完成"}</span></div>
    </div>`;
  }

  function renderHome() {
    const day = state.today;
    if (isCoreDay(day)) return renderCoreHome();
    if (day.practiceMode === "sprint") return renderSprintHome();
    const bank = BANK_META[day.bank] || BANK_META.ket;
    const learned = day.learnedIds.length;
    const total = day.newIds.length;
    const practiced = day.practicedIds.length;
    const plan = dailyPlanMetrics(day);
    const due = plan.reviewRemaining;
    const workTotal = total + plan.plannedReviews;
    const workDone = practiced + plan.reviewDone;
    const cta = homeCta();
    const remaining = Math.max(0, total - learned);

    return `
      <section class="view-page home-page">
        <div class="page-heading">
          <div>
            <p class="eyebrow">TODAY'S EXPEDITION</p>
            <h1>早上好，Kevin！</h1>
            <p>${day.completed ? "今日任务已经完成，记忆正在悄悄变牢。" : "背上小书包，今天也去捕捉几个新单词吧。"}</p>
          </div>
          <span class="date-stamp">${escapeHtml(humanDate())}</span>
        </div>

        <section class="home-hero" aria-labelledby="hero-title">
          <div class="hero-copy">
            <span class="hero-kicker">${escapeHtml(bank.icon)} 当前地图 · ${escapeHtml(bank.short)}</span>
            <h2 class="hero-title" id="hero-title">${day.pausedAt ? "今天先休息，进度已经收好" : day.completed ? "今天的探险，漂亮收官！" : total ? `还差 <em>${remaining}</em> 个新发现` : due ? `今天先守住 <em>${due}</em> 个旧朋友` : "今天的合理计划已经清空"}</h2>
            <p class="hero-subtitle">${day.pausedAt ? "不会扣连续天数，也不会清空未完成词；明天会把需要的内容平稳接回来。" : `今日任务已按约 20 分钟冻结；${plan.backlog ? `${plan.backlog} 个积压安全留到后续。` : "没有额外积压偷偷加入。"}`}</p>
            <div class="hero-actions">
              <button class="btn btn-primary" type="button" ${cta.action ? `data-action="${cta.action}"` : `data-route="${cta.route}"`}><span>${cta.icon}</span>${cta.label}</button>
              <button class="btn btn-ghost" type="button" data-route="books">${escapeHtml(bank.name)} · 切换词库</button>
              ${!day.completed && !day.pausedAt && (workDone > 0 || workTotal > 0) ? `<button class="btn btn-ghost" type="button" data-action="pause-today">今天先到这里</button>` : ""}
            </div>
          </div>
          <div class="hero-compass" aria-hidden="true">
            <div class="compass-orbit"></div>
            <div class="compass-card"><span class="big-emoji">${day.completed ? "🏆" : "🗺️"}</span><strong>${day.completed ? "+50 XP" : `MISSION ${Math.min(learned + 1, Math.max(total, 1))}`}</strong></div>
          </div>
        </section>

        ${renderDailyPlanSummary(day)}
        <section class="home-detail-links"><button class="btn btn-soft" type="button" data-route="review">查看记忆阶段详情</button><button class="btn btn-soft" type="button" data-route="notebook">管理阅读生词</button><button class="btn btn-soft" type="button" data-route="parent">打开家长报告</button></section>
      </section>`;
  }

  function renderCoreHome() {
    const day = state.today;
    const batch = coreBatchById(day.coreBatchId) || coreBatchInfo();
    const learned = day.learnedIds.length;
    const practiced = day.practicedIds.length;
    const exerciseDone = coreExerciseIsComplete(day);
    const exerciseAvailable = coreBatchReadyForExercise(day);
    const total = day.newIds.length;
    const spellingTasks = day.tasks.filter((task) => task.source === "new");
    const spellingDone = spellingTasks.filter((task) => task.status === "done").length;
    const plan = dailyPlanMetrics(day);
    const newComplete = total === 0 || practiced >= total;
    const workTotal = total + plan.plannedReviews;
    const progress = workTotal ? Math.round(((practiced + plan.reviewDone) / workTotal) * 100) : 100;
    const action = day.pausedAt
      ? { action: "resume-today", label: "Resume today's plan", icon: "↻" }
      : plan.reviewRemaining
      ? { action: "start-review", label: `Review ${plan.reviewRemaining} planned word${plan.reviewRemaining === 1 ? "" : "s"}`, icon: "↻" }
      : learned < total
      ? { route: "learn", label: learned ? "Continue picture study" : "Start picture study", icon: "✦" }
      : practiced < total
        ? { route: "practice", label: "Continue spelling", icon: "✎" }
        : exerciseAvailable && !exerciseDone
          ? { route: "practice", label: "Optional book exercise", icon: "▤" }
          : { route: "practice", label: day.completed ? "View today's results" : "Finish today's plan", icon: "🏆" };
    return `
      <section class="view-page home-page core-home" style="--core-book-color:${safeColor(batch?.bookColor, "#00a9cf")}">
        <div class="page-heading"><div><p class="eyebrow">2000 CORE ENGLISH WORDS</p><h1>Ready for Set ${batch?.sequence || 1}, Kevin?</h1><p>Today's frozen plan balances older memories with ${total} new word${total === 1 ? "" : "s"} from this ten-word set.</p></div><span class="date-stamp">BOOK ${batch?.book || 1} · UNIT ${batch?.unit || 1}</span></div>
        <section class="home-hero core-course-hero">
          <div class="hero-copy"><span class="hero-kicker">BOOK ${batch?.book || 1} · UNIT ${batch?.unit || 1} · ${escapeHtml(batch?.setLabel || "Set A")}</span><h2 class="hero-title">${day.pausedAt ? "Progress saved. Rest for today." : escapeHtml(batch?.theme || "Core English")}</h2><p class="hero-subtitle">${day.pausedAt ? "No streak penalty and no lost words. The unfinished cards stay safely queued." : "Review comes first. The remaining words in this set stay safely queued for another day; the workbook page unlocks after all ten have been learned."}</p><div class="hero-actions"><button class="btn btn-primary" type="button" ${action.action ? `data-action="${action.action}"` : `data-route="${action.route}"`}><span>${action.icon}</span>${action.label}</button><button class="btn btn-ghost" type="button" data-route="books">Choose another set</button>${!day.completed && !day.pausedAt ? `<button class="btn btn-ghost" type="button" data-action="pause-today">Stop for today</button>` : ""}</div></div>
          <div class="core-book-badge" aria-label="Book ${batch?.book || 1}, set ${batch?.sequence || 1}"><strong>${batch?.book || 1}</strong><span>BOOK</span><small>SET ${batch?.sequence || 1}/128</small></div>
        </section>
        ${renderDailyPlanSummary(day, true)}
        <section class="paper-card core-route-card"><div class="card-head"><div><h2>Your learning route</h2><p>Complete each stop to unlock the next one.</p></div><strong>${progress}%</strong></div><ol class="core-route">
          <li class="${plan.reviewRemaining ? "is-active" : "is-done"}"><span>1</span><strong>Memory Review</strong><small>${plan.plannedReviews ? `${plan.reviewDone}/${plan.plannedReviews} planned words` : "All clear today"}</small></li>
          <li class="${total === 0 || learned >= total ? "is-done" : !plan.reviewRemaining ? "is-active" : "is-locked"}"><span>2</span><strong>Picture Study</strong><small>${total ? `${learned}/${total} words today` : "0 new words today"}</small></li>
          <li class="${newComplete ? "is-done" : learned >= total && !plan.reviewRemaining ? "is-active" : "is-locked"}"><span>3</span><strong>Spelling</strong><small>${total ? `${spellingDone}/${Math.max(total * 2, spellingTasks.length)} rounds` : "No new rounds"}</small></li>
          <li class="${exerciseDone ? "is-done" : exerciseAvailable ? "is-active" : "is-locked"}"><span>4</span><strong>Book Exercise</strong><small>${exerciseDone ? "Complete" : exerciseAvailable ? "Available · not required today" : `${day.deferredNewIds.length} set words remain`}</small></li>
        </ol></section>
      </section>`;
  }

  function renderSprintHome() {
    const day = state.today;
    const sprint = day.sprint;
    if (completeGoalIfReady()) saveState();
    const bank = BANK_META[day.bank] || BANK_META.ket;
    const total = sprint.wordIds.length;
    const learned = day.learnedIds.length;
    const due = getDueIds().length;
    const progressPercent = sprintProgressPercent(day);
    const circumference = 276.46;
    const dashOffset = circumference * (1 - progressPercent / 100);
    const cta = homeCta();
    const phase = sprintPhaseMeta(sprint.phase);
    const stageTasks = sprintStageTasks(day);
    const stageDone = stageTasks.filter((task) => task.status === "done").length;
    const headline = sprint.phase === "complete"
      ? `${total}/${total} 一次准确，冲刺通关！`
      : learned < total
        ? `第 ${sprint.day} 天 · 还差 ${total - learned} 张图卡`
        : `${phase.title} · ${stageDone}/${stageTasks.length || total}`;

    return `
      <section class="view-page home-page sprint-home">
        <div class="page-heading">
          <div><p class="eyebrow">EXAM SPRINT · DAY ${sprint.day}</p><h1>考试冲刺通行证</h1><p>严格按词表顺序练习，终极默写必须整组一次写对才算通关。</p></div>
          <span class="date-stamp">${escapeHtml(humanDate())}</span>
        </div>

        <section class="home-hero sprint-home-hero" aria-labelledby="hero-title">
          <div class="hero-copy">
            <span class="hero-kicker">${escapeHtml(bank.icon)} ${escapeHtml(bank.short)} · 第 ${sprint.day} 天 · ${escapeHtml(sprintRangeText(sprint))}</span>
            <h2 class="hero-title" id="hero-title">${headline}</h2>
            <p class="hero-subtitle">先完成整组补空，再完整拼写；错词集中加练后，重新默写整组，直到出现一次 ${total}/${total}。</p>
            <div class="hero-actions"><button class="btn btn-primary" type="button" data-route="${cta.route}"><span>${cta.icon}</span>${escapeHtml(cta.label)}</button><button class="btn btn-ghost" type="button" data-route="settings">选择冲刺天数</button></div>
          </div>
          <div class="sprint-ticket-stamp" aria-label="本组 ${total} 项学习内容"><strong>${total}</strong><span>${sprintBatchInfo(day.bank, sprint.day).contentKind === "phrase" ? "PHRASES" : "WORDS"}</span></div>
        </section>

        <div class="home-grid">
          <section class="paper-card mission-card">
            <div class="card-head"><div><h2>今日冲刺路线</h2><p>每一关都沿用同一组顺序词</p></div><span class="book-tag">DAY ${sprint.day}</span></div>
            <div class="mission-progress">
              <div class="progress-ring" role="progressbar" aria-label="今日冲刺进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="ring-track" cx="50" cy="50" r="44"></circle><circle class="ring-value" cx="50" cy="50" r="44" stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"></circle></svg><span class="ring-copy"><strong>${progressPercent}%</strong><small>冲刺进度</small></span></div>
              <div class="mission-steps">
                ${missionStep("1", "按序看图学习", `${learned}/${total} 个`, learned >= total)}
                ${missionStep("2", "补空与完整首测", sprint.phase === "cloze" ? "正在补空" : ["full"].includes(sprint.phase) ? "正在首测" : "已经完成", ["drill", "final", "complete"].includes(sprint.phase))}
                ${missionStep("3", "整组一次准确", sprint.phase === "complete" ? `${total}/${total}` : `目标 ${total}/${total}`, sprint.phase === "complete")}
              </div>
            </div>
            ${sprintRouteMarkup(sprint, true)}
          </section>

          <section class="paper-card memory-card">
            <div class="card-head"><div><h2>艾宾浩斯回访</h2><p>与冲刺队列分开，不会打乱当天任务顺序</p></div></div>
            <div class="memory-count"><strong>${due}</strong><span>个旧词<br />现在需要复习</span></div>
            <p class="feature-note">可以单独去复习站完成；考试冲刺只统计今天这组 ${total} 项内容。</p>
            <button class="btn ${due ? "btn-coral" : "btn-soft"}" type="button" data-route="review">${due ? `另行复习 ${due} 个旧词` : "查看记忆生长地图"}</button>
          </section>
        </div>
      </section>`;
  }

  function missionStep(number, title, count, done) {
    return `<div class="mission-step ${done ? "is-done" : ""}"><span class="step-check">${done ? "✓" : number}</span><span><strong>${title}</strong><small>${done ? "已经完成" : "等待 Kevin 出发"}</small></span><span class="step-count">${count}</span></div>`;
  }

  function getStudyWord() {
    const day = state.today;
    if (!day.newIds.length) return null;
    const unlearnedIndex = day.newIds.findIndex((id) => !day.learnedIds.includes(id));
    if (unlearnedIndex >= 0 && day.studyCursor >= day.newIds.length) day.studyCursor = unlearnedIndex;
    const index = Math.max(0, Math.min(day.studyCursor, day.newIds.length - 1));
    return getWord(day.newIds[index]);
  }

  function hasCompletedInitialStudy(wordOrId, source = state) {
    const wordId = typeof wordOrId === "string" ? wordOrId : wordOrId?.id;
    const progress = wordId ? source?.progress?.[wordId] : null;
    if (!progress?.learnedAt) return false;
    const modes = new Set(progress.initialModesDone || []);
    return Boolean(progress.dueAt || (modes.has("cloze") && modes.has("full")));
  }

  function learnAvailability(day, options = {}) {
    const newIds = Array.isArray(day?.newIds) ? day.newIds : [];
    const learnedIds = new Set(day?.learnedIds || []);
    const practicedIds = new Set(day?.practicedIds || []);
    const reviewRemaining = safeInteger(options.reviewRemaining, 0, 0, 10_000);
    const allLearned = newIds.length > 0 && newIds.every((id) => learnedIds.has(id));
    const allPracticed = newIds.length > 0 && newIds.every((id) => practicedIds.has(id));

    if (reviewRemaining > 0 && newIds.length === 0) return { kind: "review-only", reviewRemaining };
    if (day?.completed || allPracticed) return { kind: "day-complete" };
    if (allLearned) return { kind: "ready-for-practice" };
    if (newIds.length > 0) return { kind: "study" };
    if (options.coreSetComplete && !options.bankComplete) {
      return { kind: "core-set-complete", nextCoreSetAvailable: Boolean(options.nextCoreSetAvailable) };
    }
    if (options.bankComplete) return { kind: "bank-complete" };
    return { kind: "no-new-today" };
  }

  function currentLearnAvailability(day = state.today) {
    const bankWords = window.WORD_BANKS?.[day.bank] || [];
    const bankComplete = bankWords.length > 0 && bankWords.every((word) => hasCompletedInitialStudy(word));
    const batch = day.bank === "core2000" ? coreBatchById(day.coreBatchId) : null;
    const coreSetComplete = Boolean(batch?.wordIds?.length && batch.wordIds.every((id) => hasCompletedInitialStudy(id)));
    return learnAvailability(day, {
      reviewRemaining: dailyPlanMetrics(day).reviewRemaining,
      bankComplete,
      coreSetComplete,
      nextCoreSetAvailable: Boolean(batch && batch.sequence < (coreCourse().batches || []).length)
    });
  }

  function renderLearnUnavailable(availability) {
    if (availability.kind === "review-only") {
      return `<section class="view-page empty-state"><div><span class="empty-icon">🌿</span><h1>今天先守住旧记忆</h1><p>今天的复习量已经比较多，所以系统没有再加入新词。</p><div class="button-row" style="justify-content:center"><button class="btn btn-primary" type="button" data-action="start-review">开始复习 ${availability.reviewRemaining} 个旧词</button><button class="btn btn-soft" type="button" data-route="home">返回今日任务</button></div></div></section>`;
    }
    if (availability.kind === "ready-for-practice") {
      return `<section class="view-page empty-state"><div><span class="empty-icon">✎</span><h1>今天的新词已经看完</h1><p>下一步完成拼写训练。</p><button class="btn btn-primary" type="button" data-route="practice">开始拼写训练</button></div></section>`;
    }
    if (availability.kind === "day-complete") {
      return `<section class="view-page empty-state"><div><span class="empty-icon">🏆</span><h1>今天的词汇任务已经完成</h1><p>不需要再加量，休息会让记忆慢慢长牢。</p><div class="button-row" style="justify-content:center"><button class="btn btn-primary" type="button" data-route="home">返回今日任务</button><button class="btn btn-soft" type="button" data-route="review">查看记忆地图</button></div></div></section>`;
    }
    if (availability.kind === "core-set-complete") {
      const primary = availability.nextCoreSetAvailable
        ? `<button class="btn btn-primary" type="button" data-action="start-next-core-set">下一 Set →</button>`
        : `<button class="btn btn-primary" type="button" data-route="books">查看课程地图</button>`;
      return `<section class="view-page empty-state"><div><span class="empty-icon">📘</span><h1>这个 Set 的新词已经完成</h1><p>整套 Core 课程还没有结束，可以继续下一组十词。</p><div class="button-row" style="justify-content:center">${primary}<button class="btn btn-soft" type="button" data-route="home">返回今日任务</button></div></div></section>`;
    }
    if (availability.kind === "bank-complete") {
      return `<section class="view-page empty-state"><div><span class="empty-icon">🗺️</span><h1>这个词库已经全部学完</h1><p>所有单词都完成了首次学习与拼写，接下来按记忆地图复习。</p><div class="button-row" style="justify-content:center"><button class="btn btn-primary" type="button" data-route="books">选择其他词库</button><button class="btn btn-soft" type="button" data-route="review">去记忆地图</button></div></div></section>`;
    }
    return `<section class="view-page empty-state"><div><span class="empty-icon">☀️</span><h1>今天没有安排新词</h1><p>今天的合理学习量已经安排完成，不代表整个词库已经学完。</p><button class="btn btn-primary" type="button" data-route="home">返回今日任务</button></div></section>`;
  }

  function renderLearn() {
    const day = state.today;
    const coreEnglish = isCoreDay(day);
    const availability = currentLearnAvailability(day);
    if (availability.kind !== "study" && !(availability.kind === "ready-for-practice" && runtime.browseStudy)) {
      return availability.kind === "ready-for-practice" && day.studyCursor >= day.newIds.length - 1
        ? renderLearnComplete()
        : renderLearnUnavailable(availability);
    }
    const word = getStudyWord();
    if (!word) return renderEmpty("🧭", "没有找到今天的单词", "返回今日任务重新生成探险路线。", "home", "返回今日任务");
    if (word.id !== runtime.lastWordId) {
      runtime.breakdownOpen = false;
      runtime.lastWordId = word.id;
      runtime.autoSpeakWord = word.word;
    }
    const index = day.newIds.indexOf(word.id);
    const alreadyLearned = day.learnedIds.includes(word.id);
    const breakdownClass = runtime.breakdownOpen ? "" : "is-collapsed";
    const verifiedSoundChunks = word.breakdown?.type !== "spelling chunks";
    const studyDefinition = studyDefinitionFor(word);
    const voiceLabel = speechVoiceLabel("speechSynthesis" in window ? window.speechSynthesis.getVoices() : []);
    const englishMeaning = (coreEnglish || state.settings.showEnglish) ? `<div class="meaning-audio-row"><p class="english-meaning">${escapeHtml(studyDefinition)}</p><button class="meaning-sound" type="button" data-action="speak" data-say="${escapeHtml(studyDefinition)}" data-rate="0.74" aria-label="${coreEnglish ? `Hear the definition: ${escapeHtml(studyDefinition)}` : "播放英文释义"}" title="${coreEnglish ? "Hear the definition" : "播放英文释义"}">▶</button></div>` : "";
    const sessionTag = day.practiceMode === "sprint"
      ? `${BANK_META[day.bank]?.short || day.bank} · DAY ${day.sprint.day} · ${sprintRangeText(day.sprint)}`
      : BANK_META[day.bank]?.short || day.bank;
    const learnProgress = Math.round(((index + (alreadyLearned ? 1 : 0)) / day.newIds.length) * 100);

    return `
      <section class="view-page">
        <div class="study-topline">
          <button class="back-button" type="button" data-route="home" aria-label="${coreEnglish ? "Back to today's quest" : "返回今日任务"}">←</button>
          <div class="session-progress" role="progressbar" aria-label="${coreEnglish ? "Picture study progress" : "看图学习进度"}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${learnProgress}"><div class="progress-track"><div class="progress-fill" style="width:${learnProgress}%"></div></div><strong>${index + 1} / ${day.newIds.length}</strong></div>
          <span class="book-tag">${escapeHtml(sessionTag)}</span>
        </div>

        <article class="study-card">
          <div class="visual-panel" style="--visual-bg:${safeColor(word.visual.color1, "#61c5cf")}">
            <span class="visual-ribbon">${coreEnglish ? "PICTURE MEMORY" : "PICTURE MEMORY · 看图联想"}</span>
            <div class="word-illustration">${illustrationSvg(word)}</div>
            <p class="visual-caption">${coreEnglish ? "Connect this picture with the sound. Close your eyes and see it again." : "把这幅画面和声音绑在一起，闭上眼也能想起来。"}</p>
          </div>

          <div class="word-panel">
            <div class="word-title-row">
              <div>
                <button class="study-word word-trigger ${word.word.includes(" ") ? "is-phrase" : ""}" type="button" data-action="toggle-breakdown" aria-expanded="${runtime.breakdownOpen}">${escapeHtml(word.word)}</button>
                <div class="ipa-row"><span title="Dictionary IPA; browser speech may use a different English voice">${escapeHtml(word.ipa || "/—/")}</span>${word.pos?.length ? `<span class="pos-pill">${escapeHtml(Array.isArray(word.pos) ? word.pos.join(" · ") : word.pos)}</span>` : ""}<small>· ${escapeHtml(voiceLabel)}</small></div>
                ${word.custom && word.lemma && normalizeAnswer(word.lemma) !== normalizeAnswer(word.word) ? `<div class="study-form-relation"><span>WORD FAMILY</span><strong>${escapeHtml(word.word)} → ${escapeHtml(word.lemma)}</strong>${word.formType ? `<small>${escapeHtml(word.formType)}</small>` : ""}</div>` : ""}
              </div>
              <button class="sound-button is-sequence" type="button" data-action="speak-sequence" data-word="${escapeHtml(word.word)}" data-definition="${escapeHtml(studyDefinition)}" data-example="${escapeHtml(word.example || "")}" aria-label="${coreEnglish ? "Play the word, definition, and example" : "依次播放单词、英文释义和例句"}" title="${coreEnglish ? "Play word → definition → example" : "连读：单词 → 英文释义 → 例句"}"><span>▶</span><small>${coreEnglish ? "PLAY ALL" : "连读"}</small></button>
            </div>

            <div class="meaning-block">${englishMeaning}${coreEnglish ? "" : `<p class="chinese-meaning">${escapeHtml(word.zh)}</p>`}</div>

            <div class="breakdown-wrap ${breakdownClass}">
              <p class="section-label"><span>${escapeHtml(word.breakdown.label)}</span><span>${verifiedSoundChunks ? (coreEnglish ? "Tap each checked sound chunk to hear it" : "点每一块听读音") : (coreEnglish ? "Visual spelling groups — not pronunciation units" : "仅帮助看清拼写，不代表音节或词根")}</span></p>
              <div class="breakdown-parts">
                ${word.breakdown.parts.map((part) => `<span class="word-part">${verifiedSoundChunks ? `<button class="part-sound" type="button" data-action="speak" data-say="${escapeHtml(part.say || part.text)}" title="${escapeHtml(part.say || part.text)}">${escapeHtml(part.text)}</button>` : `<span class="part-sound is-static">${escapeHtml(part.text)}</span>`}${part.meaning ? `<span class="part-meaning">${escapeHtml(part.meaning)}</span>` : ""}</span>`).join("")}
              </div>
            </div>
            ${runtime.breakdownOpen ? "" : `<button class="breakdown-hint" type="button" data-action="toggle-breakdown">${coreEnglish ? "Tap the word to open its spelling groups" : "点一下单词，把它拆成记忆积木"} <span>↓</span></button>`}

            ${word.example ? `<div class="example-card"><div class="example-copy"><p>${escapeHtml(word.example)}</p>${word.exampleZh ? `<small>${escapeHtml(word.exampleZh)}</small>` : ""}</div><button class="example-sound" type="button" data-action="speak" data-say="${escapeHtml(word.example)}" data-rate="0.76" aria-label="${coreEnglish ? `Hear the example sentence: ${escapeHtml(word.example)}` : "播放例句发音"}" title="${coreEnglish ? "Hear the example sentence" : "播放例句发音"}">▶</button></div>` : ""}
            <div class="memory-tip"><span>💡</span><span><strong>${coreEnglish ? "Memory hook: " : "Kevin 的记忆钩："}</strong>${escapeHtml(word.tip)}</span></div>

            <div class="study-actions">
              <button class="btn btn-soft" type="button" data-action="study-prev" ${index === 0 ? "disabled" : ""}>← ${coreEnglish ? "Previous" : "上一个"}</button>
              <button class="btn btn-primary" type="button" data-action="study-next" data-word-id="${escapeHtml(word.id)}">${coreEnglish ? (alreadyLearned ? "Next word →" : "I know this word  +2 XP →") : (alreadyLearned ? "下一个单词 →" : "记进背包  +2 XP →")}</button>
              <small class="enter-key-hint">↵ ${coreEnglish ? "Press Enter to continue" : "按 Enter 继续"}</small>
            </div>
          </div>
        </article>
      </section>`;
  }

  function renderLearnComplete() {
    const isSprint = state.today.practiceMode === "sprint";
    const coreEnglish = isCoreDay();
    const sprint = state.today.sprint;
    return `
      <section class="view-page round-complete">
        <div>
          <div class="result-medal">🦊</div>
          <p class="eyebrow" style="justify-content:center">${isSprint ? `EXAM SPRINT · DAY ${sprint.day}` : "STUDY ROUND COMPLETE"}</p>
          <h1 class="result-title">${coreEnglish ? "All ten pictures are in your memory!" : "图片都装进脑海啦！"}</h1>
          <p class="result-subtitle">${coreEnglish ? "Now rebuild each word from its picture: first fill the gaps, then spell the whole word." : isSprint ? `接下来按同样顺序完成 ${sprint.wordIds.length} 个补空题，再进入完整拼写。` : "接下来不看答案，只看图片和提示，把刚认识的单词一个个拼出来。"}</p>
          <div class="result-stats"><span class="result-stat"><strong>${state.today.learnedIds.length}</strong><small>${coreEnglish ? "PICTURE WORDS" : isSprint ? "顺序图卡" : "今日新词"}</small></span>${isSprint ? `<span class="result-stat"><strong>DAY ${sprint.day}</strong><small>${escapeHtml(sprintRangeText(sprint))}</small></span>` : `<span class="result-stat"><strong>+${state.today.learnedIds.length * 2}</strong><small>${coreEnglish ? "STUDY XP" : "学习 XP"}</small></span>`}</div>
          <div class="button-row" style="justify-content:center"><button class="btn btn-primary" type="button" data-route="practice">${coreEnglish ? "Start gap spelling →" : isSprint ? "开始补空热身 →" : "开始拼写闯关 →"}</button><button class="btn btn-soft" type="button" data-action="review-study">${coreEnglish ? "Review pictures" : "再浏览一遍"}</button></div>
        </div>
      </section>`;
  }

  function renderSprintCheckpoint() {
    const sprint = state.today.sprint;
    const total = sprint.wordIds.length;
    const retry = sprint.phase === "drill";
    const success = sprint.phase === "full" || sprint.phase === "final";
    const lastRound = sprint.roundHistory.at(-1) || null;
    let eyebrow = "SPRINT CHECKPOINT";
    let title = `下一关：${sprintPhaseMeta(sprint.phase).title}`;
    let text = "喝口水，准备好后再继续；刷新页面也会停在这里。";

    if (sprint.phase === "full") {
      eyebrow = "CLOZE ROUND COMPLETE";
      title = "补空热身完成，进入完整拼写";
      text = `接下来 ${total} 个词会隐藏全部字母；第一次写对才算首测准确。`;
    } else if (sprint.phase === "drill") {
      eyebrow = sprint.cycle > 1 ? `FINAL ROUND ${sprint.cycle - 1} RESULT` : "FIRST SPELLING RESULT";
      title = `${sprint.mistakeIds.length} 个词需要加练`;
      text = `上轮一次准确 ${sprint.lastScore}/${total}。先集中练会这些错词，再重新默写整组 ${total} 个。`;
    } else if (sprint.phase === "final") {
      eyebrow = "READY FOR FULL DICTATION";
      title = sprint.cycle > 1 ? `准备第 ${sprint.cycle} 轮终极默写` : "准备终极默写整组";
      text = lastRound?.cycle === 0 && lastRound.score === total
        ? `首测已经 ${total}/${total}，再完成一次无提示终测，就能正式通关。`
        : `错词已经加练完毕。现在重新默写整组 ${total} 个，必须全部第一次写对。`;
    }

    return `
      <section class="view-page practice-shell">
        <div class="practice-topline is-sprint"><button class="back-button" type="button" data-route="home" aria-label="返回今日任务">←</button><span class="book-tag">${escapeHtml(BANK_META[state.today.bank]?.short || state.today.bank)} · DAY ${sprint.day}</span><span class="combo-pill">目标 ${total}/${total}</span></div>
        ${sprintRouteMarkup(sprint)}
        <article class="sprint-checkpoint ${retry ? "is-retry" : success ? "is-success" : ""}" role="status">
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(text)}</p>
          ${lastRound ? `<div class="sprint-score ${lastRound.score === total ? "is-perfect" : "is-warning"}"><strong>${lastRound.score}/${total}</strong><span>上轮一次准确</span></div>` : ""}
          <div class="button-row"><button class="btn btn-primary" type="button" data-action="start-sprint-stage">开始${escapeHtml(sprintPhaseMeta(sprint.phase).title)} →</button><button class="btn btn-soft" type="button" data-route="home">先休息一下</button></div>
        </article>
      </section>`;
  }

  function renderSprintComplete() {
    const day = state.today;
    const sprint = day.sprint;
    if (completeGoalIfReady()) saveState();
    return `
      <section class="view-page round-complete">
        <div>
          <div class="result-medal">🏁</div>
          <p class="eyebrow" style="justify-content:center">EXAM SPRINT · DAY ${sprint.day} COMPLETE</p>
          <h1 class="result-title">${sprint.wordIds.length}/${sprint.wordIds.length} 一次准确！</h1>
          <p class="result-subtitle">Kevin 已经在同一轮里把整组词全部准确默写出来。第 ${sprint.day} 天冲刺正式盖章通关。</p>
          <div class="result-stats"><span class="result-stat"><strong>${sprint.wordIds.length}</strong><small>顺序词汇</small></span><span class="result-stat"><strong>${sprint.cycle}</strong><small>终测轮次</small></span><span class="result-stat"><strong>+${day.sessionXp}</strong><small>本次 XP</small></span></div>
          <div class="button-row" style="justify-content:center"><button class="btn btn-primary" type="button" data-route="home">收下通关章</button><button class="btn btn-soft" type="button" data-route="settings">选择另一天</button></div>
        </div>
      </section>`;
  }

  function renderPractice() {
    syncDueTasks();
    const coreEnglish = isCoreDay();
    const sprintMode = state.today.practiceMode === "sprint" && runtime.practiceSource !== "review";
    if (sprintMode) {
      const sprint = state.today.sprint;
      if (!sprint.wordIds.every((id) => state.today.learnedIds.includes(id))) {
        return renderEmpty("✦", "先按顺序看完这组图卡", `完成第 ${sprint.day} 天的 ${sprint.wordIds.length} 张图卡后，补空训练才会解锁。`, "learn", "继续学习");
      }
      if (sprint.phase === "complete") return renderSprintComplete();
      if (sprint.awaitingStart) return renderSprintCheckpoint();
    }
    const task = currentTask();
    if (coreEnglish && !task && coreBatchReadyForExercise() && !coreExerciseIsComplete()) {
      return renderCoreExercise();
    }
    if (!task) {
      const hasAnything = state.today.learnedIds.length || state.today.dueIds.length;
      if (!hasAnything) {
        if (!state.today.newIds.length) return renderEmpty("🗃️", "当前词库已经完成", "选择另一本词库继续学习，或者稍后回来做曲线复习。", "books", "选择新词库");
        return renderEmpty("✏️", "先认识几个新单词吧", "拼写闯关需要先完成今天的看图学习。", "learn", "去学习单词");
      }
      if (runtime.practiceSource === "review") runtime.practiceSource = null;
      completeGoalIfReady();
      saveState();
      return renderPracticeComplete();
    }

    const word = getWord(task.wordId);
    const progress = spellingProgress(word.id);
    const mask = makeMask(word.word, task.maskSeed, task.mode);
    const isPassed = task.status === "passed";
    const feedback = task.feedback || null;
    const scopedTasks = task.source === "sprint"
      ? sprintStageTasks()
      : task.source === "review" && (runtime.practiceSource === "review" || coreEnglish)
        ? state.today.tasks.filter((item) => item.source === "review")
        : state.today.tasks;
    const taskIndex = scopedTasks.filter((item) => item.status === "done").length + 1;
    const totalTasks = scopedTasks.length;
    const modeLabel = coreEnglish
      ? task.source === "review" ? "Memory review · recall the complete word" : task.mode === "cloze" ? "Gap spelling · complete the missing letters" : "Full spelling · rebuild the whole word"
      : task.source === "sprint" && task.sprintPhase === "final"
      ? `第 ${task.sprintCycle} 轮终极默写 · 全部字母隐藏`
      : task.source === "sprint" && task.sprintPhase === "drill"
        ? "错词加练 · 完整拼写"
        : task.mode === "cloze" ? "半遮罩 · 补上消失的字母" : "全拼写 · 从图片找回单词";
    const sourceLabel = coreEnglish
      ? task.source === "review" ? `EBBINGHAUS REVIEW · ${REVIEW_DELAYS[Math.min(progress?.step || 0, REVIEW_DELAYS.length - 1)]?.label.replace("分钟", "MIN").replace("天", "DAY") || "DUE NOW"}` : `CORE 2000 · ${task.mode === "cloze" ? "ROUND 1" : "ROUND 2"}`
      : task.source === "review"
      ? `记忆曲线 · ${REVIEW_DELAYS[Math.min(progress?.step || 0, REVIEW_DELAYS.length - 1)]?.label || "复习"}回访`
      : task.source === "sprint"
        ? `考试冲刺 · DAY ${state.today.sprint.day} · ${sprintPhaseMeta(task.sprintPhase).title}`
        : "今日新词 · 拼写训练";
    const letters = [...word.word.toLowerCase()].map((char, index) => {
      if (!isPracticeLetter(char)) return `<span class="letter-fixed">${escapeHtml(char)}</span>`;
      if (!mask.has(index)) return `<span class="letter-fixed" data-index="${index}">${char}</span>`;
      const isHinted = (task.hintIndices || []).includes(index);
      const draftLetter = task.draft?.[index] || "";
      const value = isPassed || isHinted ? char : isPracticeLetter(draftLetter) ? draftLetter : "";
      const isError = !isPassed && !isHinted && (task.errorIndices || []).includes(index);
      return `<input class="letter-cell ${isPassed || isHinted ? "is-success" : ""} ${isError ? "is-error" : ""}" type="text" inputmode="text" maxlength="1" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="${coreEnglish ? `Letter ${index + 1}` : `第 ${index + 1} 个字母`}" data-index="${index}" value="${value}" ${isError ? `aria-invalid="true"` : ""} ${isPassed || isHinted ? "disabled" : ""} />`;
    }).join("");
    const safeQuizClue = quizClueFor(word);
    const englishClue = state.settings.showEnglish && safeQuizClue && !(task.source === "sprint" && task.sprintPhase === "final") ? `<span class="clue-chip">📖 ${escapeHtml(safeQuizClue)}</span>` : "";
    const progressWidth = totalTasks ? ((taskIndex - (isPassed ? 0 : 1)) / totalTasks) * 100 : 0;
    const lastInStage = scopedTasks.filter((item) => item.status !== "done").length === 1;
    const noHint = task.source === "sprint" && task.sprintPhase === "final";
    const practiceInstruction = coreEnglish
      ? task.source === "review" ? "This word is due now. Recall it from the picture and strengthen the memory before it fades." : task.mode === "cloze" ? "Use the book picture and the visible letters. Fill every empty box." : "Use the book picture and your memory. Spell the complete word."
      : noHint
      ? "只看图片与中文回忆单词；本题提交后才知道结果，首答必须准确。"
      : task.mode === "cloze"
        ? "看清已经留下的字母，把空格补完整。"
        : "所有字母都藏起来了，慢慢回想画面和声音。";
    const answerRevealed = isPassed || Boolean(feedback?.word);
    const feedbackDefinition = answerRevealed ? feedbackDefinitionFor(word) : "";

    return `
      <section class="view-page practice-shell">
        <div class="practice-topline ${task.source === "sprint" ? "is-sprint" : ""}">
          <button class="back-button" type="button" data-route="home" aria-label="${coreEnglish ? "Back to today's quest" : "返回今日任务"}">←</button>
          <div class="session-progress" role="progressbar" aria-label="${escapeHtml(modeLabel)}进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progressWidth)}"><div class="progress-track"><div class="progress-fill" style="width:${progressWidth}%"></div></div><strong>${Math.min(taskIndex, totalTasks)} / ${totalTasks}</strong></div>
          <span class="combo-pill">⚡ ${state.stats.combo} ${coreEnglish ? "COMBO" : "连击"}</span>
        </div>
        ${task.source === "sprint" ? sprintRouteMarkup(state.today.sprint) : ""}

        <article class="practice-card ${task.source === "sprint" ? "is-sprint" : ""} ${feedback?.type === "wrong" ? "is-wrong" : ""} ${isPassed ? "is-correct" : ""}">
          <span class="practice-mode-label ${task.source === "sprint" ? "is-sprint" : ""}">${task.mode === "cloze" ? "◐" : task.sprintPhase === "final" ? "🏁" : "●"} ${escapeHtml(sourceLabel)}</span>
          <div class="practice-content">
            <div class="practice-picture ${word.visual?.image ? "has-source-image" : ""}" style="--visual-bg:${safeColor(word.visual.color1, "#61c5cf")}" role="img" aria-label="${coreEnglish ? "Book picture clue" : "单词图片提示"}">${compactPictureMarkup(word, "practice-source-image", "picture-emoji")}</div>
            <div class="practice-side">
              <h1>${escapeHtml(modeLabel)}</h1>
              <p>${escapeHtml(practiceInstruction)}</p>
              <div class="letter-board" id="letterBoard">${letters}</div>
              <div class="practice-clues">${coreEnglish ? "" : `<span class="clue-chip">🇨🇳 ${escapeHtml(word.zh)}</span>`}${englishClue}${noHint ? "" : `<button class="clue-chip" type="button" data-action="speak-practice-word">🔊 ${coreEnglish ? "Hear word · hint" : "听单词（算提示）"}</button>`}</div>
              ${feedback ? `<div class="feedback-box is-visible ${feedback.type}" aria-live="polite">${feedbackMarkup(feedback)}${feedbackDefinition ? `<span class="feedback-definition">${escapeHtml(feedbackDefinition)}</span>` : ""}</div>` : `<div class="feedback-box" id="practiceFeedback" aria-live="polite"></div>`}
              <div class="practice-actions">
                ${isPassed ? `<button class="btn btn-primary" type="button" data-action="advance-practice">${task.source === "new" && !task.cleanPass ? coreEnglish ? "Restart this word →" : "从补空重新练习 →" : coreEnglish ? task.source === "review" ? "Next review →" : "Next word →" : task.source === "sprint" && lastInStage ? "查看本轮成绩 →" : "下一关 →"}</button>` : `${noHint ? `<span class="feature-note">🏁 终测无提示，首答准确才计入 ${state.today.sprint.wordIds.length}/${state.today.sprint.wordIds.length}</span>` : `<button class="btn btn-soft btn-small" type="button" data-action="practice-hint">${coreEnglish ? "Reveal one letter · 3 coins" : "提示一个字母 · 3 金币"}</button>`}<button class="btn btn-coral" type="button" data-action="check-practice">${coreEnglish ? "Check spelling" : "检查拼写"} ✓</button>`}
                <small class="enter-key-hint">↵ ${coreEnglish ? (isPassed ? "Enter for the next word" : "Enter to check") : (isPassed ? "按 Enter 进入下一题" : "按 Enter 检查")}</small>
              </div>
            </div>
          </div>
        </article>
      </section>`;
  }

  function renderCoreExercise() {
    const day = state.today;
    const batch = coreBatchById(day.coreBatchId) || coreBatchInfo();
    const exercise = batch?.exercise;
    if (!exercise) return renderEmpty("▤", "Exercise page unavailable", "Choose another set and try again.", "books", "Choose a set");
    const answers = coreExerciseAnswers(exercise.id);
    if (!answers.length) return renderEmpty("▤", "Answer key unavailable", "This workbook page cannot be checked yet. Choose another set and try again.", "books", "Choose a set");
    const answerCount = answers.length;
    const record = coreExerciseRecord(exercise.id) || { responses: Array(answerCount).fill(""), correctIndices: [], wrongIndices: [], attempts: 0, completedAt: null };
    const responses = Array.from({ length: answerCount }, (_, index) => record.responses?.[index] || "");
    const correctSet = new Set(record.correctIndices || []);
    const wrongSet = new Set(record.wrongIndices || []);
    const correctCount = correctSet.size;
    const ready = responses.every((value, index) => correctSet.has(index) || value.trim());
    const feedback = record.attempts
      ? wrongSet.size
        ? `<div class="core-exercise-feedback is-retry" role="status"><strong>${correctCount} correct · ${wrongSet.size} to fix</strong><span>The green answers are locked. Correct only the red boxes, then check again.</span></div>`
        : `<div class="core-exercise-feedback is-success" role="status"><strong>All ${answerCount} answers are correct!</strong><span>This set is complete and the next learning set is unlocked.</span></div>`
      : "";
    const reading = batch.readingImages?.length ? `<details class="core-reading"><summary>Optional Unit Reading Challenge</summary><p>Set B completes this unit. Try the original reading pages when you want an extra challenge.</p><div>${batch.readingImages.map((src, index) => `<img src="${escapeHtml(src)}" alt="Book ${batch.book}, Unit ${batch.unit}, reading page ${index + 1}" loading="lazy" />`).join("")}</div></details>` : "";
    return `
      <section class="view-page core-exercise-page" style="--core-book-color:${safeColor(batch?.bookColor, "#00a9cf")}">
        <div class="study-topline"><button class="back-button" type="button" data-route="home" aria-label="Back to today's quest">←</button><div class="session-progress" role="progressbar" aria-label="Book exercise progress" aria-valuemin="0" aria-valuemax="${answerCount}" aria-valuenow="${correctCount}"><div class="progress-track"><div class="progress-fill" style="width:${answerCount ? (correctCount / answerCount) * 100 : 0}%"></div></div><strong>${correctCount} / ${answerCount}</strong></div><span class="book-tag">BOOK ${batch.book} · UNIT ${batch.unit} · ${escapeHtml(batch.setLabel)}</span></div>
        <div class="page-heading"><div><p class="eyebrow">USE THE WORDS · WORKBOOK PAGE</p><h1>Now use your ten words.</h1><p>Read the original exercise on the left, answer on the right, and keep correcting until every answer is right.</p></div><span class="date-stamp">STEP 3 OF 3</span></div>
        <div class="core-exercise-layout">
          <figure class="core-workbook-page"><img src="${escapeHtml(exercise.image)}" alt="Original exercise page for Book ${batch.book}, Unit ${batch.unit}, ${escapeHtml(batch.setLabel)}" /><figcaption>Original page · 2000 Core English Words ${batch.book}</figcaption></figure>
          <section class="paper-card core-answer-sheet"><div class="card-head"><div><h2>Answer sheet</h2><p>For multiple choice, type the letter. For blanks, type the missing word or words.</p></div><span class="book-tag">${correctCount}/${answerCount}</span></div>
            <div class="core-answer-grid">${responses.map((value, index) => {
              const isCorrect = correctSet.has(index);
              const isWrong = wrongSet.has(index);
              const label = `${index < 5 ? "A" : "B"}${index < 5 ? index + 1 : index - 4}`;
              return `<label class="${isCorrect ? "is-correct" : isWrong ? "is-error" : ""}"><span>${label}</span><input class="core-exercise-answer" data-index="${index}" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(value)}" placeholder="Your answer" ${isCorrect ? "disabled aria-label=\"Correct answer locked\"" : isWrong ? "aria-invalid=\"true\"" : ""} />${isCorrect ? "<em>✓ Locked</em>" : isWrong ? "<em>Try again</em>" : ""}</label>`;
            }).join("")}</div>
            ${feedback}
            <p class="feature-note">Press Enter to move forward. Correct answers lock automatically after each check; only the red answers remain editable.</p>
            <button class="btn btn-primary" type="button" data-action="complete-core-exercise" ${ready ? "" : "disabled"}>Check answers →</button>
          </section>
        </div>${reading}
      </section>`;
  }

  function renderPracticeComplete() {
    const day = state.today;
    if (isCoreDay(day)) {
      const batch = coreBatchById(day.coreBatchId) || coreBatchInfo();
      const plan = dailyPlanMetrics(day);
      const setReady = coreBatchReadyForExercise(day);
      const exerciseDone = coreExerciseIsComplete(day);
      const nextAction = exerciseDone
        ? `<button class="btn btn-primary" type="button" data-action="start-next-core-set">Start Set ${Math.min(128, (batch?.sequence || 1) + 1)} →</button>`
        : setReady
          ? `<button class="btn btn-primary" type="button" data-route="practice">Open optional book exercise →</button>`
          : `<button class="btn btn-primary" type="button" data-route="home">Back to today's plan</button>`;
      return `<section class="view-page round-complete"><div><div class="result-medal">📘</div><p class="eyebrow" style="justify-content:center">TODAY'S CORE PLAN COMPLETE</p><h1 class="result-title">A balanced day of learning is complete!</h1><p class="result-subtitle">Kevin finished the frozen daily plan. ${day.deferredNewIds.length ? `${day.deferredNewIds.length} remaining set word${day.deferredNewIds.length === 1 ? " stays" : "s stay"} safely queued for another day.` : setReady ? "All ten set words are learned; the workbook page is now available." : "The next plan will continue from this set."}</p><div class="result-stats"><span class="result-stat"><strong>${day.newIds.length}</strong><small>NEW WORDS</small></span><span class="result-stat"><strong>${plan.reviewDone}</strong><small>MEMORY REVIEWS</small></span><span class="result-stat"><strong>${plan.backlog}</strong><small>SAFE BACKLOG</small></span></div><div class="button-row" style="justify-content:center">${nextAction}<button class="btn btn-soft" type="button" data-route="books">Choose a different set</button></div></div></section>`;
    }
    const dueAt = Object.values(state.progress)
      .map((progress) => progress.dueAt)
      .filter((time) => time && time > Date.now())
      .sort((a, b) => a - b)[0];
    const nextText = dueAt ? relativeTime(dueAt) : "暂无待复习";
    return `
      <section class="view-page round-complete">
        <div>
          <div class="result-medal">${day.goalAwarded ? "🏆" : "⭐"}</div>
          <p class="eyebrow" style="justify-content:center">QUEST COMPLETE</p>
          <h1 class="result-title">${day.goalAwarded ? "今日单词，全都抓住了！" : "这一轮漂亮通关！"}</h1>
          <p class="result-subtitle">${day.goalAwarded ? `Kevin 获得了今日完成奖励。下一次记忆回访：${escapeHtml(nextText)}。` : "还有新词或到期复习没有完成，休息一下再继续也没关系。"}</p>
          <div class="result-stats">
            <span class="result-stat"><strong>${day.sessionCorrect}</strong><small>答对关卡</small></span>
            <span class="result-stat"><strong>+${day.sessionXp}</strong><small>本轮 XP</small></span>
            <span class="result-stat"><strong>${state.stats.bestCombo}</strong><small>最佳连击</small></span>
          </div>
          <div class="button-row" style="justify-content:center"><button class="btn btn-primary" type="button" data-route="home">收下奖励，回到首页</button><button class="btn btn-soft" type="button" data-route="review">查看记忆地图</button></div>
        </div>
      </section>`;
  }

  function relativeTime(timestamp) {
    const diff = timestamp - Date.now();
    if (diff <= 0) return "现在";
    if (diff < 60 * 60 * 1000) return `${Math.max(1, Math.ceil(diff / 60000))} 分钟后`;
    if (diff < DAY_MS) return `${Math.ceil(diff / 3600000)} 小时后`;
    return `${Math.ceil(diff / DAY_MS)} 天后`;
  }

  function renderEmpty(icon, title, text, targetRoute, buttonText) {
    return `<section class="view-page empty-state"><div><span class="empty-icon">${icon}</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><button class="btn btn-primary" type="button" data-route="${targetRoute}">${escapeHtml(buttonText)}</button></div></section>`;
  }

  function renderBooks() {
    const englishLibrary = state.settings.bank === "core2000";
    const query = runtime.bookQuery.trim().toLowerCase();
    const totalWords = Object.keys(BANK_META).reduce((sum, key) => sum + (window.WORD_BANKS[key]?.length || 0), 0);
    let visibleCards = 0;
    const cards = Object.entries(BANK_META)
      .map(([key, meta]) => {
        const displayMeta = englishLibrary ? BANK_ENGLISH[key] || { name: meta.short, description: "Offline English vocabulary collection" } : meta;
        const words = window.WORD_BANKS[key] || [];
        const learned = learnedInBank(key);
        const percent = words.length ? Math.round((learned / words.length) * 100) : 0;
        const selected = state.settings.bank === key;
        const matches = !query || `${key} ${meta.name} ${meta.short} ${meta.description}`.toLowerCase().includes(query);
        if (matches) visibleCards += 1;
        return `
          <button class="book-card ${selected ? "is-selected" : ""}" type="button" data-action="select-bank" data-bank="${key}" style="--book-color:${meta.color}" ${matches ? "" : "hidden"}>
            ${selected ? `<span class="selected-sticker">${englishLibrary ? "CURRENT COURSE" : "正在学习"}</span>` : ""}
            <span class="book-icon">${escapeHtml(meta.icon)}</span>
            <h2>${escapeHtml(displayMeta.name)}</h2>
            <p>${escapeHtml(displayMeta.description)}${!englishLibrary && ["ket", "pet"].includes(key) && words.some((word) => word.official) ? " · Cambridge 2025 官方表" : ""}${!englishLibrary && key === "movers" && words.some((word) => word.visual?.image) ? " · 全部离线可用" : ""}</p>
            <span class="book-meta"><span>${learned} / ${words.length} ${englishLibrary ? "learned" : "已学习"}</span><span class="book-progress"><span style="width:${percent}%"></span></span><span>${percent}%</span></span>
          </button>`;
      }).join("");

    return `
      <section class="view-page">
        <div class="page-heading">
          <div><p class="eyebrow">EXPEDITION LIBRARY</p><h1>${englishLibrary ? "Choose your next word map" : "选择下一张词汇地图"}</h1><p>${englishLibrary ? `Explore ${Object.keys(BANK_META).length} offline word banks. Your learning progress stays safe when you switch.` : `当前内置 ${Object.keys(BANK_META).length} 个精选离线词库；切换后，已经学过的记录不会丢失。`}</p></div>
          <span class="date-stamp">${totalWords.toLocaleString("en-US")} ITEMS · OFFLINE</span>
        </div>
        <div class="books-toolbar">
          <label class="search-box"><span aria-hidden="true">⌕</span><input id="bookSearch" type="search" placeholder="${englishLibrary ? "Search Movers, KET, IELTS…" : "搜索 Movers、KET、雅思…"}" value="${escapeHtml(runtime.bookQuery)}" /></label>
          <span class="book-tag">${Object.keys(BANK_META).length} ${englishLibrary ? "WORD BANKS" : "个词库"}</span>
        </div>
        <div class="book-grid" id="bookGrid">${cards}<p id="bookEmpty" class="book-empty" ${visibleCards ? "hidden" : ""}>${englishLibrary ? "No matching word bank found." : "没有找到匹配的词库。"}</p></div>
        ${state.settings.bank === "core2000" ? renderCoreCoursePicker() : ""}
      </section>`;
  }

  function renderNotebookWordCard(word, savedEntry = null, inCatalog = false) {
    const bankKey = bankKeyForWordId(word.id);
    const bank = BANK_META[bankKey] || { short: word.custom ? "MY WORD" : bankKey.toUpperCase(), icon: "📖" };
    const image = word.visual?.image
      ? `<img src="${escapeHtml(word.visual.image)}" alt="Picture for ${escapeHtml(word.word)}" loading="lazy" />`
      : `<span class="notebook-word-emoji" aria-hidden="true">${escapeHtml(word.visual?.emoji || bank.icon || "📖")}</span>`;
    const sources = savedEntry?.sources || [];
    const spelling = spellingProgress(word.id);
    const cardProgress = state.progress[word.id];
    const status = spelling?.status === "mature"
      ? { key: "mature", label: "Mature" }
      : cardProgress?.learnedAt
        ? { key: "reviewing", label: "Reviewing" }
        : savedEntry?.train
          ? { key: "waiting", label: "等待学习" }
          : { key: "saved", label: "只收藏" };
    const nextReview = spelling?.dueAt ? relativeDue(spelling.dueAt) : "";
    const sourceChips = sources.map((source, index) => `<span class="saved-word-source">${escapeHtml(source.sourceTag)}${source.context ? ` · ${escapeHtml(source.context)}` : ""}<button type="button" data-action="remove-saved-source" data-card-id="${escapeHtml(word.id)}" data-source-index="${index}" aria-label="移除来源 ${escapeHtml(source.sourceTag)}">×</button></span>`).join("");
    return `<article class="notebook-word-card" data-card-id="${escapeHtml(word.id)}">
      <div class="notebook-word-visual">${image}</div>
      <div class="notebook-word-copy">
        <div class="notebook-word-title"><span class="book-tag">${escapeHtml(bank.icon)} ${escapeHtml(bank.short)}</span>${word.custom && word.lemma && normalizeAnswer(word.lemma) !== normalizeAnswer(word.word) ? `<span class="word-family-tag">FORM OF ${escapeHtml(word.lemma)}${word.formType ? ` · ${escapeHtml(word.formType)}` : ""}</span>` : ""}</div>
        <h2>${escapeHtml(word.word)}${word.pos?.length ? `<small>${escapeHtml(Array.isArray(word.pos) ? word.pos.join(" · ") : word.pos)}</small>` : ""}</h2>
        <p>${escapeHtml(studyDefinitionFor(word) || "Definition unavailable")}</p>
        ${savedEntry ? `<div class="saved-word-sources">${sourceChips}</div><div class="saved-word-meta"><span class="word-status is-${status.key}">${status.label}</span>${nextReview ? `<span>下次复习 ${escapeHtml(nextReview)}</span>` : ""}</div>` : ""}
      </div>
      <div class="notebook-word-actions">
        ${inCatalog
          ? `<button class="btn btn-small btn-primary" type="button" data-action="save-word" data-card-id="${escapeHtml(word.id)}" data-train="true">${savedEntry ? "添加这个阅读来源" : "收藏并加入训练候选"}</button><button class="btn btn-small btn-soft" type="button" data-action="save-word" data-card-id="${escapeHtml(word.id)}" data-train="false">只收藏</button>`
          : savedEntry
          ? `<button class="btn btn-small ${savedEntry.train ? "btn-coral" : "btn-soft"}" type="button" data-action="toggle-saved-training" data-card-id="${escapeHtml(word.id)}">${savedEntry.train ? "✓ 加入训练候选" : "只收藏 · 点此加入训练"}</button>${word.custom ? `<button class="btn btn-small btn-soft" type="button" data-action="edit-custom-word" data-card-id="${escapeHtml(word.id)}">纠正内容</button><button class="btn btn-small btn-ghost" type="button" data-action="archive-custom-word" data-card-id="${escapeHtml(word.id)}">归档</button>` : `<button class="btn btn-small btn-ghost" type="button" data-action="remove-saved-word" data-card-id="${escapeHtml(word.id)}">移除</button>`}`
          : `<button class="btn btn-small btn-primary" type="button" data-action="save-word" data-card-id="${escapeHtml(word.id)}" data-train="true">收藏并候选训练</button><button class="btn btn-small btn-soft" type="button" data-action="save-word" data-card-id="${escapeHtml(word.id)}" data-train="false">只收藏</button>`}
      </div>
    </article>`;
  }

  function customWordFormValue(word, key) {
    if (!word) return "";
    if (key === "image") return word.visual?.image || "";
    return word[key] || "";
  }

  function renderCustomWordForm() {
    const existing = runtime.editingCustomId ? getWord(runtime.editingCustomId) : null;
    const editing = existing || runtime.pendingCustomDraft;
    const isEditing = Boolean(existing);
    return `<section class="custom-word-panel">
      <div class="card-head"><div><p class="eyebrow">PARENT-CHECKED CUSTOM CARD</p><h2>${isEditing ? `纠正 ${escapeHtml(editing.word)}` : "词库里没有？由家长新建"}</h2><p>只录入 Kevin 真实遇到的词。保存前会先预览，不会自动抓书或生成未经核实的释义。</p></div>${isEditing ? `<span class="book-tag">EDITING</span>` : `<span class="book-tag">NEW CARD</span>`}</div>
      <div class="custom-word-form">
        <label><span>Word / form *</span><input id="customWord" type="text" maxlength="80" value="${escapeHtml(customWordFormValue(editing, "word"))}" placeholder="whispered" /></label>
        <label><span>Part of speech</span><input id="customPos" type="text" maxlength="40" value="${escapeHtml(customWordFormValue(editing, "pos"))}" placeholder="verb" /></label>
        <label><span>Base form / lemma</span><input id="customLemma" type="text" maxlength="80" value="${escapeHtml(customWordFormValue(editing, "lemma"))}" placeholder="whisper" /></label>
        <label><span>Form note</span><input id="customFormType" type="text" maxlength="60" value="${escapeHtml(customWordFormValue(editing, "formType"))}" placeholder="past tense" /></label>
        <label class="custom-wide"><span>Child-friendly English definition *</span><textarea id="customDefinition" maxlength="320" rows="2" placeholder="spoke very quietly">${escapeHtml(customWordFormValue(editing, "en"))}</textarea></label>
        <label class="custom-wide"><span>Standard example sentence *</span><textarea id="customExample" maxlength="320" rows="2" placeholder="The dragon whispered a secret.">${escapeHtml(customWordFormValue(editing, "example"))}</textarea></label>
        <label class="custom-wide"><span>Reading context (optional)</span><textarea id="customContext" maxlength="320" rows="2" placeholder="What was happening when Kevin met this word?">${escapeHtml(customWordFormValue(editing, "context"))}</textarea></label>
        <label><span>Source *</span><input id="customSource" type="text" maxlength="80" value="${escapeHtml(customWordFormValue(editing, "sourceTag") || runtime.notebookSource)}" placeholder="Dragon Masters" /></label>
        <label><span>Picture URL (optional)</span><input id="customImage" type="url" maxlength="500" value="${escapeHtml(customWordFormValue(editing, "image"))}" placeholder="https://…" /></label>
      </div>
      <div class="custom-word-controls"><label class="custom-train-choice"><input id="customTrain" type="checkbox" ${isEditing ? (state.savedWords[editing.id]?.train ? "checked" : "") : editing?.train === false ? "" : "checked"} /><span>加入后续训练候选（不会临时增加今天任务）</span></label><div class="notebook-word-actions">${isEditing ? `<button class="btn btn-small btn-ghost" type="button" data-action="cancel-custom-edit">取消修改</button>` : ""}<button class="btn btn-primary" type="button" data-action="preview-custom-word">先预览，再由家长确认 →</button></div></div>
    </section>`;
  }

  function renderArchivedCustomWord(word) {
    return `<article class="archived-word-row"><div><strong>${escapeHtml(word.word)}</strong><span>${escapeHtml(word.sourceTag)} · ${escapeHtml(word.en)}</span></div><button class="btn btn-small btn-soft" type="button" data-action="restore-custom-word" data-card-id="${escapeHtml(word.id)}">恢复为只收藏</button></article>`;
  }

  function renderNotebook() {
    const query = normalizeAnswer(runtime.notebookQuery).trim();
    const savedEntries = Object.values(state.savedWords || {})
      .filter((entry) => {
        const word = getWord(entry.cardId);
        if (!word) return false;
        if (query && !normalizeAnswer(`${word.word} ${studyDefinitionFor(word)}`).includes(query)) return false;
        if (runtime.notebookSourceFilter !== "all" && !(entry.sources || []).some((source) => source.sourceTag === runtime.notebookSourceFilter)) return false;
        if (runtime.notebookStatus === "training" && !entry.train) return false;
        if (runtime.notebookStatus === "saved" && entry.train) return false;
        if (runtime.notebookStatus === "custom" && !word.custom) return false;
        return true;
      })
      .sort((left, right) => {
        if (runtime.notebookSort === "az") return getWord(left.cardId).word.localeCompare(getWord(right.cardId).word);
        if (runtime.notebookSort === "due") return (spellingProgress(left.cardId)?.dueAt || Number.MAX_SAFE_INTEGER) - (spellingProgress(right.cardId)?.dueAt || Number.MAX_SAFE_INTEGER);
        return right.addedAt - left.addedAt || left.cardId.localeCompare(right.cardId);
      });
    const savedCards = savedEntries
      .map((entry) => getWord(entry.cardId))
      .filter(Boolean)
      .map((word) => renderNotebookWordCard(word, state.savedWords[word.id]))
      .join("");
    const allSavedEntries = Object.values(state.savedWords || {});
    const trainingCount = allSavedEntries.filter((entry) => entry.train && !state.progress[entry.cardId]?.learnedAt).length;
    const reviewingCount = allSavedEntries.filter((entry) => Boolean(spellingProgress(entry.cardId)?.dueAt)).length;
    const sourceNames = [...new Set(allSavedEntries.flatMap((entry) => (entry.sources || []).map((source) => source.sourceTag)))].sort();
    const archivedCustomWords = Object.values(state.customWords || {}).filter((word) => word.archived);
    return `<section class="view-page notebook-page">
      <header class="notebook-header"><div><p class="eyebrow">MY WORDS</p><h1>阅读中遇到的词，都放在这里</h1><p>从 Mighty Robot、Dragon Masters 或其他阅读中收藏生词，再决定是否进入训练。</p></div><button class="btn btn-primary" type="button" data-action="open-add-word">＋ 添加阅读生词</button></header>
      <section class="notebook-summary" aria-label="生词本概览"><div><strong>${allSavedEntries.length}</strong><span>收藏总数</span></div><div><strong>${trainingCount}</strong><span>训练候选</span></div><div><strong>${reviewingCount}</strong><span>已进入复习</span></div><div><strong>${sourceNames.length}</strong><span>来源数</span></div></section>
      <section class="notebook-toolbar"><label class="search-box"><span aria-hidden="true">⌕</span><input id="notebookSearch" type="search" autocomplete="off" placeholder="搜索已收藏的词" value="${escapeHtml(runtime.notebookQuery)}" /></label><select id="notebookStatus" aria-label="状态筛选"><option value="all" ${runtime.notebookStatus === "all" ? "selected" : ""}>全部状态</option><option value="training" ${runtime.notebookStatus === "training" ? "selected" : ""}>训练中</option><option value="saved" ${runtime.notebookStatus === "saved" ? "selected" : ""}>只收藏</option><option value="custom" ${runtime.notebookStatus === "custom" ? "selected" : ""}>自建词</option></select><select id="notebookSourceFilter" aria-label="来源筛选"><option value="all">全部来源</option>${sourceNames.map((name) => `<option value="${escapeHtml(name)}" ${runtime.notebookSourceFilter === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select><select id="notebookSort" aria-label="排序"><option value="recent" ${runtime.notebookSort === "recent" ? "selected" : ""}>最近加入</option><option value="due" ${runtime.notebookSort === "due" ? "selected" : ""}>下次复习</option><option value="az" ${runtime.notebookSort === "az" ? "selected" : ""}>A–Z</option></select></section>
      <section class="notebook-section"><div class="notebook-word-grid">${savedCards || `<div class="notebook-empty"><span>📖</span><h2>${allSavedEntries.length ? "没有符合筛选条件的词" : "阅读时遇到不会的词，就把它放进来。"}</h2><p>${allSavedEntries.length ? "换一个状态、来源或搜索词试试。" : "可以先收藏，之后再决定是否加入每天的训练。"}</p><button class="btn btn-primary" type="button" data-action="open-add-word">${allSavedEntries.length ? "清除筛选后再看" : "添加第一个阅读生词"}</button></div>`}</div></section>
      ${archivedCustomWords.length ? `<section class="notebook-section archived-word-section"><div class="card-head"><div><h2>已归档自建词</h2><p>历史仍保留，可随时恢复。</p></div></div>${archivedCustomWords.map(renderArchivedCustomWord).join("")}</section>` : ""}
    </section>`;
  }

  function renderCoreCoursePicker() {
    const batch = coreBatchInfo();
    const first = getWord(batch?.wordIds?.[0]);
    const last = getWord(batch?.wordIds?.at(-1));
    return `<section class="paper-card core-picker" style="--core-book-color:${safeColor(batch?.bookColor, "#00a9cf")}"><div class="card-head"><div><p class="eyebrow">COURSE MAP</p><h2>Choose a 10-word set</h2><p>Four books · 16 units per book · Set A and Set B in every unit.</p></div><span class="core-picker-number">${batch?.sequence || 1}/128</span></div><div class="core-picker-controls"><button class="btn btn-soft" type="button" data-action="core-batch-prev" ${(batch?.sequence || 1) <= 1 ? "disabled" : ""}>← Previous</button><label><span>Set number</span><input id="coreBatchInput" type="number" min="1" max="128" step="1" value="${batch?.sequence || 1}" /></label><button class="btn btn-soft" type="button" data-action="core-batch-next" ${(batch?.sequence || 1) >= 128 ? "disabled" : ""}>Next →</button></div><div class="core-picker-preview"><span>BOOK ${batch?.book || 1}</span><strong>Unit ${batch?.unit || 1} · ${escapeHtml(batch?.theme || "Core English")} · ${escapeHtml(batch?.setLabel || "Set A")}</strong><small>${escapeHtml(first?.word || "—")} → ${escapeHtml(last?.word || "—")}</small></div><button class="btn btn-primary" type="button" data-action="save-core-batch">Study this set →</button></section>`;
  }

  function renderReview() {
    if (isCoreDay()) return renderCoreReview();
    const dueIds = getDueIds();
    const plan = dailyPlanMetrics();
    const progressItems = Object.values(state.lexemeProgress || state.progress);
    const scheduled = progressItems.filter((item) => ["reviewing", "relearning", "mature"].includes(item.status)).length;
    const mastered = masteredCount();
    const nextDue = progressItems.map((item) => item.dueAt).filter((time) => time && time > Date.now()).sort((a, b) => a - b)[0];
    const stationCounts = REVIEW_DELAYS.map((_, step) => progressItems.filter((item) => ["reviewing", "relearning", "mature"].includes(item.status) && item.step === step).length);

    return `
      <section class="view-page">
        <div class="page-heading">
          <div><p class="eyebrow">MEMORY GROWTH MAP</p><h1>记忆不是硬背，是按时回来</h1><p>每次在快忘记前成功想起，下一次复习就能走得更远。</p></div>
          ${plan.reviewRemaining ? `<button class="btn btn-coral" type="button" data-action="start-review">复习 ${plan.reviewRemaining} 个今日计划词 →</button>` : `<span class="date-stamp">${plan.backlog ? `${plan.backlog} 个积压留待后续` : "ALL CLEAR ✓"}</span>`}
        </div>

        <div class="review-summary">
          <div class="review-stat-card"><strong>${dueIds.length}</strong><span>现在到期</span></div>
          <div class="review-stat-card"><strong>${scheduled}</strong><span>曲线生长中</span></div>
          <div class="review-stat-card"><strong>${mastered}</strong><span>长期低频复习</span></div>
          <div class="review-stat-card"><strong>${nextDue ? relativeTime(nextDue) : "—"}</strong><span>下一次回访</span></div>
        </div>

        <section class="memory-map" aria-label="艾宾浩斯十站长期复习地图">
          <div class="map-path" aria-hidden="true"></div>
          <div class="map-stations">
            ${REVIEW_DELAYS.map((delay, index) => {
              const count = stationCounts[index];
              const masteredStation = index >= MATURE_STEP && count > 0;
              return `<div class="map-station ${count ? "has-words" : ""} ${masteredStation ? "is-mastered" : ""}"><span class="station-node">${delay.icon}</span><strong>第 ${index + 1} 站 · ${delay.label}</strong><small>${count ? `${count} 个单词在这里` : "等待抵达"}</small></div>`;
            }).join("")}
          </div>
          <div class="map-legend"><p><strong>复习规则：</strong>答对就前进一站；答错进入 10 分钟重新学习，但不会清空以前的记录。<br />10 分钟 → 1 天 → 3 天 → 7 天 → 14 天 → 30 天 → 60 天 → 120 天 → 240 天 → 365 天</p>${plan.reviewRemaining ? `<button class="btn btn-coral" type="button" data-action="start-review">完成今日 ${plan.reviewRemaining} 个计划词</button>` : `<span class="book-tag">🌿 ${plan.backlog ? "积压已安全留到后续计划" : "记忆正在生长"}</span>`}</div>
        </section>
      </section>`;
  }

  function renderCoreReview() {
    const coreIds = bankWordIds("core2000");
    const seenLexemes = new Set();
    const entries = Object.keys(state.progress)
      .filter((id) => coreIds.has(id))
      .map((id) => [lexemeIdForWord(id), spellingProgress(id)])
      .filter(([lexemeId, progress]) => {
        if (!progress || seenLexemes.has(lexemeId)) return false;
        seenLexemes.add(lexemeId);
        return true;
      });
    const dueIds = coreDueIds(Date.now(), state.today.newIds);
    const plan = dailyPlanMetrics();
    const scheduled = entries.filter(([, item]) => ["reviewing", "relearning", "mature"].includes(item.status)).length;
    const mastered = entries.filter(([, item]) => item.status === "mature").length;
    const nextDue = entries.map(([, item]) => item.dueAt).filter((time) => time && time > Date.now()).sort((a, b) => a - b)[0];
    const labels = ["10 MIN", "1 DAY", "3 DAYS", "7 DAYS", "14 DAYS", "30 DAYS", "60 DAYS", "120 DAYS", "240 DAYS", "365 DAYS"];
    const counts = REVIEW_DELAYS.map((_, step) => entries.filter(([, item]) => ["reviewing", "relearning", "mature"].includes(item.status) && item.step === step).length);
    const nextText = !nextDue ? "—" : nextDue - Date.now() < 3_600_000 ? `${Math.max(1, Math.ceil((nextDue - Date.now()) / 60_000))} MIN` : nextDue - Date.now() < DAY_MS ? `${Math.ceil((nextDue - Date.now()) / 3_600_000)} HOURS` : `${Math.ceil((nextDue - Date.now()) / DAY_MS)} DAYS`;
    return `<section class="view-page"><div class="page-heading"><div><p class="eyebrow">EBBINGHAUS MEMORY MAP</p><h1>Come back just before the memory fades.</h1><p>Every successful recall moves a word to a longer interval. A missed word returns sooner for extra support.</p></div>${plan.reviewRemaining ? `<button class="btn btn-coral" type="button" data-action="start-review">Review ${plan.reviewRemaining} planned word${plan.reviewRemaining === 1 ? "" : "s"} →</button>` : `<span class="date-stamp">${plan.backlog ? `${plan.backlog} BACKLOG · SAFELY DEFERRED` : "ALL CLEAR ✓"}</span>`}</div><div class="review-summary"><div class="review-stat-card"><strong>${dueIds.length}</strong><span>DUE NOW</span></div><div class="review-stat-card"><strong>${scheduled}</strong><span>SCHEDULED</span></div><div class="review-stat-card"><strong>${mastered}</strong><span>LONG-TERM</span></div><div class="review-stat-card"><strong>${nextText}</strong><span>NEXT REVIEW</span></div></div><section class="memory-map" aria-label="Ten-stage long-term Ebbinghaus review map"><div class="map-path" aria-hidden="true"></div><div class="map-stations">${REVIEW_DELAYS.map((delay, index) => `<div class="map-station ${counts[index] ? "has-words" : ""} ${index >= MATURE_STEP && counts[index] ? "is-mastered" : ""}"><span class="station-node">${delay.icon}</span><strong>STAGE ${index + 1} · ${labels[index]}</strong><small>${counts[index] ? `${counts[index]} word${counts[index] === 1 ? "" : "s"} here` : "Waiting for a word"}</small></div>`).join("")}</div><div class="map-legend"><p><strong>Review path:</strong> 10 minutes → 1 day → 3 days → 7 days → 14 days → 30 days → 60 days → 120 days → 240 days → 365 days.<br />Correct recall moves forward; a lapse starts a 10-minute relearning step without erasing earlier history.</p>${plan.reviewRemaining ? `<button class="btn btn-coral" type="button" data-action="start-review">Review today's ${plan.reviewRemaining}</button>` : `<span class="book-tag">🌿 ${plan.backlog ? "BACKLOG KEPT FOR A LATER PLAN" : "MEMORY IS GROWING"}</span>`}</div></section></section>`;
  }

  function metricValue(value, suffix = "") {
    return value == null ? "—" : `${value}${suffix}`;
  }

  function renderWeeklyCheckup() {
    const weekKey = localWeekKey();
    const plannedIds = weeklyCheckPlan();
    if (!plannedIds.length) {
      return renderEmpty("🔎", "还没有适合独立抽检的旧词", "完成一些新词学习后，这里会每周抽取最多 5 个非当天词。", "home", "返回今日任务");
    }
    const weekEvents = state.recognitionEvents.filter((event) => event.weekKey === weekKey && plannedIds.includes(event.cardId));
    const answered = new Set(weekEvents.map((event) => event.cardId));
    const feedback = plannedIds.includes(runtime.checkupFeedback?.cardId) ? runtime.checkupFeedback : null;
    if (!feedback) runtime.checkupFeedback = null;
    if (!feedback && answered.size >= plannedIds.length) {
      const correct = weekEvents.filter((event) => event.correct).length;
      return `<section class="view-page checkup-page"><div class="checkup-complete"><span>🔎</span><p class="eyebrow">WEEKLY INDEPENDENT CHECK</p><h1>本周轻量抽检完成</h1><strong>${correct} / ${plannedIds.length}</strong><p>这里只记录第一次选择；答错不会扣金币，也不会伪装成已经认识。</p><div class="dialog-actions"><button class="btn btn-primary" type="button" data-route="parent">查看家长报告</button><button class="btn btn-soft" type="button" data-route="home">返回今日任务</button></div></div></section>`;
    }
    const cardId = feedback?.cardId || plannedIds.find((id) => !answered.has(id));
    const word = getWord(cardId);
    if (!word) return renderEmpty("🔎", "抽检词卡暂时不可用", "返回后重新生成即可。", "home", "返回今日任务");
    const options = weeklyCheckOptions(cardId, plannedIds, weekKey);
    const clue = quizClueFor(word);
    const visual = compactPictureMarkup(word, "checkup-picture", "checkup-emoji");
    const completedBefore = feedback ? answered.size - 1 : answered.size;
    return `<section class="view-page checkup-page"><div class="page-heading"><div><p class="eyebrow">WEEKLY INDEPENDENT CHECK</p><h1>这个意思对应哪个词？</h1><p>最多 5 题，只记第一次选择；本周题目避开今天的新词。</p></div><span class="date-stamp">${Math.max(1, completedBefore + 1)} / ${plannedIds.length}</span></div><article class="paper-card checkup-card"><div class="checkup-visual">${visual}</div><div class="checkup-copy">${clue ? `<p>${escapeHtml(clue)}</p>` : `<p>Look at the picture and choose the matching word.</p>`}<div class="checkup-options">${options.map((optionId) => {
      const option = getWord(optionId);
      const isSelected = feedback?.selectedCardId === optionId;
      const isCorrect = feedback && optionId === cardId;
      const className = feedback ? (isCorrect ? "is-correct" : isSelected ? "is-wrong" : "") : "";
      return `<button class="checkup-option ${className}" type="button" data-action="weekly-answer" data-card-id="${escapeHtml(cardId)}" data-selected-id="${escapeHtml(optionId)}" ${feedback ? "disabled" : ""}>${escapeHtml(option?.word || "")}</button>`;
    }).join("")}</div>${feedback ? `<div class="checkup-feedback ${feedback.correct ? "is-correct" : "is-wrong"}"><strong>${feedback.correct ? "✓ 独立认出" : `正确答案：${escapeHtml(word.word)}`}</strong><span>第一次选择已经记录，不需要反复点到正确。</span></div><button class="btn btn-primary" type="button" data-action="weekly-next">${answered.size >= plannedIds.length ? "查看本周结果 →" : "下一题 →"}</button>` : `<small>答案提交前不会显示反馈，也不会播放目标词读音。</small>`}</div></article></section>`;
  }

  function answerWeeklyCheck(cardId, selectedCardId) {
    const weekKey = localWeekKey();
    const plannedIds = weeklyCheckPlan();
    const canonicalCardId = canonicalWordId(cardId);
    const canonicalSelectedId = canonicalWordId(selectedCardId);
    if (!plannedIds.includes(canonicalCardId) || !getWord(canonicalSelectedId)) return;
    if (state.recognitionEvents.some((event) => event.weekKey === weekKey && event.cardId === canonicalCardId)) return;
    const sequence = ++state.attemptSequence;
    const correct = canonicalCardId === canonicalSelectedId;
    state.recognitionEvents.push({
      eventId: `recognition:${DEVICE_ID}:${sequence}`,
      cardId: canonicalCardId,
      selectedCardId: canonicalSelectedId,
      senseId: `${canonicalCardId}:default`,
      occurredAt: Date.now(),
      weekKey,
      correct,
      firstAttempt: true,
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      sequence,
      appVersion: APP_VERSION
    });
    runtime.checkupFeedback = { cardId: canonicalCardId, selectedCardId: canonicalSelectedId, correct };
    saveState();
    render();
  }

  function advanceWeeklyCheck() {
    runtime.checkupFeedback = null;
    render();
  }

  function renderParentReport() {
    const metrics = learningMetrics();
    const difficultRows = metrics.difficultWords.map((item) => {
      const progress = spellingProgress(item.cardId);
      const due = progress?.dueAt ? relativeTime(progress.dueAt) : "未排期";
      return `<tr><th scope="row">${escapeHtml(item.word)}</th><td>${item.again}</td><td>${item.hard}</td><td>${escapeHtml(due)}</td></tr>`;
    }).join("");
    return `<section class="view-page parent-report-page">
      <div class="page-heading"><div><p class="eyebrow">PARENT LEARNING REPORT</p><h1>只看真实证据，不把“翻过卡片”当作掌握</h1><p>以下数据来自 Kevin 的独立首答、复习结果和长期排期；旧版本没有逐题日志的部分不会被凭空补齐。</p></div><span class="date-stamp">最近 30 天</span></div>
      <section class="parent-level-grid" aria-label="词汇能力分层">
        <article><span>01 · SEEN</span><strong>${metrics.seen}</strong><p>看过并进入学习记录</p></article>
        <article class="${metrics.recognitionMeasured ? "" : "is-unmeasured"}"><span>02 · RECOGNIZED</span><strong>${metricValue(metrics.recognized)}</strong><p>${metrics.recognitionMeasured ? "每周独立识词抽检答对" : "尚无独立选择题证据，不用拼写成绩冒充"}</p></article>
        <article><span>03 · RECALLED SPELLING</span><strong>${metrics.independentlySpelled}</strong><p>完整拼写首次独立答对</p></article>
        <article><span>04 · LONG-TERM</span><strong>${metrics.mature}</strong><p>进入 60 天以上仍继续抽检</p></article>
      </section>
      <div class="parent-report-grid">
        <section class="paper-card parent-summary-card"><div class="card-head"><div><h2>学习流量</h2><p>控制新词流入，优先守住旧记忆</p></div></div><div class="parent-number-grid"><div><strong>${metrics.new7}</strong><span>7 天新接触</span></div><div><strong>${metrics.new30}</strong><span>30 天新接触</span></div><div><strong>${metrics.backlog}</strong><span>安全延期积压</span></div><div><strong>${metrics.activeDays30}</strong><span>30 天活跃日</span></div></div></section>
        <section class="paper-card parent-summary-card"><div class="card-head"><div><h2>回忆质量</h2><p>只统计有逐题证据的记录</p></div></div><div class="parent-number-grid"><div><strong>${metricValue(metrics.firstAttemptRate, "%")}</strong><span>完整拼写首答正确率</span></div><div><strong>${metricValue(metrics.retentionRate, "%")}</strong><span>旧词独立保持率</span></div><div><strong>${metricValue(metrics.averageActiveMinutes)}</strong><span>活跃日可记录答题分钟</span></div><div><strong>${metrics.reviewAttemptCount}</strong><span>30 天独立复习首答</span></div></div></section>
      </div>
      <section class="paper-card parent-checkup-card"><div><p class="eyebrow">3–5 MINUTES · ONCE A WEEK</p><h2>每周独立识词抽检</h2><p>随机抽取最多 5 个非当天新词，只记录第一次选择，不给金币压力。</p></div><button class="btn btn-primary" type="button" data-route="checkup">开始／继续本周抽检 →</button></section>
      <section class="paper-card parent-difficult-card"><div class="card-head"><div><h2>最近的困难词</h2><p>Again 权重高于 Hard；用于决定减量或多给一次回访，不用于惩罚。</p></div><button class="btn btn-small btn-soft" type="button" data-route="settings">调整每日新词上限</button></div>${difficultRows ? `<div class="parent-table-wrap"><table><thead><tr><th>单词</th><th>Again</th><th>Hard</th><th>下次回访</th></tr></thead><tbody>${difficultRows}</tbody></table></div>` : `<div class="book-empty">最近 30 天还没有可用的困难词逐题证据。</div>`}</section>
      <section class="parent-data-note"><strong>${metrics.hasEventEvidence ? "逐题证据已启用" : "当前主要是旧版汇总记录"}</strong><p>“可记录答题分钟”只包括有计时的拼写作答，不等于 Kevin 的完整学习时长；识词能力将在独立轻量测验上线后单独统计。</p></section>
    </section>`;
  }

  function renderSettings() {
    const level = levelInfo();
    const goals = [5, 10, 20, 30];
    const sprintBatch = sprintBatchInfo(state.settings.bank, sprintDayFor(state.settings.bank));
    const firstSprintWord = sprintBatch.batch[0]?.word || "—";
    const lastSprintWord = sprintBatch.batch.at(-1)?.word || "—";
    const activeSprint = state.today.practiceMode === "sprint" && state.today.bank === state.settings.bank
      ? state.today.sprint
      : null;
    const pendingSprintDay = activeSprint && activeSprint.day !== sprintBatch.day
      ? ` · 当前正在第 ${activeSprint.day} 天；第 ${sprintBatch.day} 天将在通关后生效`
      : "";
    const modes = [
      { id: "mixed", icon: "🪜", title: "阶梯模式（推荐）", text: "每个新词先补空，再完整拼写" },
      { id: "cloze", icon: "◐", title: "补空模式", text: "保留部分字母，填上消失的部分" },
      { id: "full", icon: "●", title: "全拼模式", text: "只看图片与释义，完整写出单词" },
      { id: "sprint", icon: "🏁", title: "考试冲刺模式", text: "按所选词表的当天任务顺序，补空、全拼、错词加练，直到整组一次默写准确" }
    ];

    return `
      <section class="view-page">
        <div class="page-heading"><div><p class="eyebrow">KEVIN'S FIELD KIT</p><h1>定制每日训练</h1><p>调整只影响学习方式；当天已经抽出的词不会突然消失。</p></div><button class="btn btn-soft" type="button" data-route="parent">查看家长学习报告</button></div>
        <div class="settings-layout">
          <section class="paper-card settings-card">
            <div class="setting-group">
              <h2>普通模式每天认识多少个新词？</h2><p>冲刺模式按所选的当天任务执行，不会改动这里保存的普通模式词量。</p>
              <div class="goal-picker">
                ${goals.map((goal) => `<label class="goal-choice"><input type="radio" name="dailyGoal" value="${goal}" ${state.settings.dailyGoal === goal ? "checked" : ""} /><span>${goal} 个</span></label>`).join("")}
              </div>
              <label class="custom-goal"><span>自定义</span><input id="customGoal" type="number" min="1" max="50" step="1" value="${state.settings.dailyGoal}" /><button class="btn btn-small btn-soft" type="button" data-action="save-custom-goal">保存</button></label>
            </div>

            <div class="setting-group">
              <h2 id="practiceModeHeading">选择拼写训练方式</h2><p>阶梯模式适合日常积累；临近考试时，可选固定顺序的冲刺模式。</p>
              <div class="mode-grid">
                <div class="practice-mode-options" role="radiogroup" aria-labelledby="practiceModeHeading">
                  ${modes.map((mode) => mode.id === "sprint"
                    ? `<label class="mode-choice is-sprint"><input type="radio" name="practiceMode" value="sprint" ${state.settings.practiceMode === "sprint" ? "checked" : ""} /><span class="sprint-ticket"><span class="sprint-ticket-copy"><small class="sprint-ticket-kicker">EXAM SPRINT PASS</small><strong class="sprint-ticket-title">🏁 ${escapeHtml(mode.title)}</strong><small class="sprint-ticket-description">${escapeHtml(mode.text)}</small><span class="sprint-ticket-rule"><span>按任务顺序</span><span>错词集中加练</span><span>整组全对才停</span></span></span><span class="sprint-ticket-stamp"><strong>${sprintBatch.total}</strong><span>${sprintBatch.contentKind === "phrase" ? "PHRASES" : "WORDS"}</span></span></span></label>`
                    : `<label class="mode-choice"><input type="radio" name="practiceMode" value="${mode.id}" ${state.settings.practiceMode === mode.id ? "checked" : ""} /><span><strong>${mode.icon} ${mode.title}</strong><small>${mode.text}</small></span></label>`).join("")}
                </div>
                ${state.settings.practiceMode === "sprint" ? `<div class="sprint-day-controls" role="group" aria-label="选择考试冲刺天数">
                  <button class="btn btn-soft" type="button" data-action="sprint-prev" aria-label="上一天" ${sprintBatch.day <= 1 ? "disabled" : ""}>←</button>
                  <label><span class="sr-only">冲刺第几天</span><input class="sprint-day-input" id="sprintDayInput" type="number" min="1" max="${sprintBatch.maxDay}" step="1" value="${sprintBatch.day}" aria-describedby="sprintRangeText" /></label>
                  <button class="btn btn-soft" type="button" data-action="sprint-next" aria-label="下一天" ${sprintBatch.day >= sprintBatch.maxDay ? "disabled" : ""}>→</button>
                  <span class="sprint-range" id="sprintRangeText"><strong>${escapeHtml(BANK_META[state.settings.bank]?.short || state.settings.bank)} 第 ${sprintBatch.day}/${sprintBatch.maxDay} 天 · ${escapeHtml(sprintBatch.scheduleKind === "movers-pdf-word" ? `PDF 单词 Day ${sprintBatch.sourceDay}：${sprintBatch.wordTotal} 个` : sprintBatch.scheduleKind === "movers-pdf-phrase" ? `PDF 短语编号 ${sprintBatch.phraseStart}–${sprintBatch.phraseEnd}：${sprintBatch.phraseTotal} 个` : `词表第 ${sprintBatch.start + 1}–${sprintBatch.end} 项`)}</strong>${escapeHtml(firstSprintWord)} → ${escapeHtml(lastSprintWord)}${!sprintBatch.scheduleKind.startsWith("movers-pdf") && sprintBatch.total < SPRINT_SIZE ? ` · 最后一组共 ${sprintBatch.total} 词，不与前一组重叠` : ""}${escapeHtml(pendingSprintDay)}</span>
                  <button class="btn btn-primary" type="button" data-action="save-sprint-day">选择第 ${sprintBatch.day} 天</button>
                </div>` : ""}
              </div>
            </div>

            <div class="setting-group">
              <h2>声音与辅助</h2>
              ${settingToggle("soundToggle", "开启英语发音", "整词与词根/音节都可以点击朗读", state.settings.sound)}
              ${settingToggle("autoSoundToggle", "学习卡自动朗读", "翻到新单词时先听一次标准声音", state.settings.autoSound)}
              ${settingToggle("englishToggle", "显示英文辅助", "学习页显示原书释义；训练只显示不含答案的安全提示", state.settings.showEnglish)}
              ${settingToggle("typoToggle", "一次轻微拼写容错", "长词只错一个字母时先温柔提醒", state.settings.typoAssist)}
            </div>

            <div class="setting-group">
              <h2>在两台 Mac 之间同步学习记录</h2><p>平时仍会自动保存在当前浏览器。换电脑前保存一个可携带记录文件，到另一台 Mac 恢复即可。</p>
              <div class="record-transfer-card">
                <div class="record-transfer-head"><span>📦</span><div><strong>Kevin 的可携带学习档案</strong><small>包含词库进度、艾宾浩斯复习时间、CORE 练习页答案、XP、金币和设置。</small></div></div>
                <ol class="record-transfer-steps"><li><b>1</b><span>在刚练习完的 Mac 上保存记录文件</span></li><li><b>2</b><span>用 AirDrop、U 盘或 iCloud 拷到另一台 Mac</span></li><li><b>3</b><span>在另一台 Mac 打开网站并从文件恢复</span></li></ol>
                <div class="record-transfer-actions"><button class="btn btn-primary" type="button" data-action="export-data">保存学习记录文件</button><button class="btn btn-soft" type="button" data-action="import-data">从记录文件恢复</button></div>
                <p class="record-transfer-note">请使用最新保存的文件；恢复会用文件里的完整进度替换当前浏览器记录。文件不包含密码或账号信息。</p>
                ${runtime.storageConflict ? `<p class="record-transfer-note" role="alert">⚠️ 另一个标签页已有更新。本页不会继续覆盖记录，请刷新后再练习。</p>` : ""}
                ${Object.keys(state.orphanProgress || {}).length ? `<p class="record-transfer-note" role="status">🧰 有 ${Object.keys(state.orphanProgress).length} 条暂时找不到词卡的历史已安全隔离，没有被删除。</p>` : ""}
              </div>
              <button class="btn btn-small" type="button" data-action="reset-data" style="margin-top:12px;color:var(--coral-deep);background:transparent">清空全部记录</button>
              <input id="importFile" type="file" accept=".json,.wordquest,application/json" hidden />
            </div>
          </section>

          <aside class="profile-poster">
            <div class="poster-avatar">🦊</div>
            <h2>Kevin · Lv. ${level.level}</h2>
            <p>${escapeHtml(level.title)} · 已获得 ${state.stats.xp} XP</p>
            <div class="xp-track"><span style="width:${level.percent}%"></span></div>
            <div class="xp-copy"><span>${level.current} XP</span><span>升级还需 ${Math.max(0, level.needed - level.current)} XP</span></div>
            <div class="badge-shelf" aria-label="探险徽章">
              ${BADGES.map((badge) => `<span class="badge-item ${state.badges[badge.id] ? "is-unlocked" : ""}" title="${escapeHtml(badge.name)}">${badge.emoji}</span>`).join("")}
            </div>
          </aside>
        </div>
      </section>`;
  }

  function settingToggle(id, title, text, checked) {
    return `<div class="toggle-row"><span class="toggle-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></span><label class="switch"><input id="${id}" type="checkbox" ${checked ? "checked" : ""} /><span></span></label></div>`;
  }

  function renderPk() {
    const activeBankKey = safeBank(state.today?.bank, state.settings.bank);
    const activeBank = BANK_META[activeBankKey];
    return `
      <section class="view-page">
        <div class="page-heading"><div><p class="eyebrow">FRIENDLY WORD BATTLE</p><h1>把练习变成一场比赛</h1><p>本地版已经可以和机器人试玩；微信登录、好友邀请与排行榜需要联网服务后再开启。</p></div></div>
        <div class="pk-arena">
          <section class="arena-card">
            <span class="hero-kicker">⚑ 45 秒极速拼写</span>
            <h1>Kevin VS.<br />Flash Fox</h1>
            <p>本局从正在学习的「${escapeHtml(activeBank.name)}」抽出 5 个词。看图和提示快速拼写，答对一题得 100 分。</p>
            <div class="arena-versus">
              <div class="fighter"><span class="fighter-avatar">🦊</span><strong>Kevin</strong><small>Lv. ${levelInfo().level} · ${state.stats.bestCombo} 最佳连击</small></div>
              <span class="versus-mark">VS</span>
              <div class="fighter"><span class="fighter-avatar">⚡</span><strong>Flash Fox</strong><small>速度型机器人</small></div>
            </div>
            <div class="button-row"><button class="btn btn-primary" type="button" data-action="start-pk">挑战机器人</button><button class="btn btn-ghost" type="button" data-action="wechat-coming">邀请微信好友</button></div>
          </section>
          <aside class="pk-side">
            <section class="paper-card qr-card"><div class="card-head"><div><h3>微信好友入口</h3><p>未来扫描后即可登录和分享房间</p></div></div><div class="fake-qr" aria-label="微信登录功能预览"><span>🦊</span></div><p class="feature-note">当前是纯本地离线版，这个二维码仅为视觉预览，不会收集任何账号信息。</p></section>
            <section class="paper-card rules-card"><div class="card-head"><div><h3>积分可以怎么玩？</h3></div></div><ul class="rules-list"><li><b>1</b><span>每日任务、连击和按时复习都能获得 XP 与金币。</span></li><li><b>2</b><span>金币可用于提示；未来可换头像装饰、地图皮肤和 PK 门票。</span></li><li><b>3</b><span>线上排行榜必须由服务器验分，避免修改本地记录作弊。</span></li></ul></section>
          </aside>
        </div>
      </section>`;
  }

  function feedbackMarkup(feedback) {
    if (!feedback) return "";
    const word = feedback.word ? ` <strong>${escapeHtml(feedback.word)}</strong>` : "";
    return `${escapeHtml(feedback.message || "")}${word}`;
  }

  function progressForStudyView(existing, timestamp = Date.now()) {
    if (existing && existing.learnedAt != null) return { firstEver: false, progress: existing };
    return {
      firstEver: true,
      progress: {
        status: "learning",
        learnedAt: timestamp,
        step: 0,
        scheduleToken: 0,
        lapses: 0,
        correct: 0,
        dueAt: null,
        initialModesDone: []
      }
    };
  }

  function learnCurrentWord(wordId) {
    stopSpeech();
    const word = getWord(wordId);
    if (!word || !state.today.newIds.includes(wordId)) return;
    const firstViewThisSession = !state.today.learnedIds.includes(wordId);
    const studyView = progressForStudyView(state.progress[wordId]);
    const firstEver = studyView.firstEver;
    if (firstViewThisSession) {
      state.today.learnedIds.push(wordId);
      if (firstEver) {
        state.progress[wordId] = studyView.progress;
        state.stats.learned += 1;
        award(`learn:${wordId}`, 2, 1, isCoreDay() ? "Picture word learned" : "新词装进背包");
        evaluateBadges();
      }
      syncPracticeTasks();
    }
    if (!firstViewThisSession && runtime.browseStudy && state.today.studyCursor >= state.today.newIds.length - 1) {
      runtime.browseStudy = false;
      saveState();
      render();
      return;
    }
    state.today.studyCursor = Math.min(state.today.studyCursor + 1, state.today.newIds.length - 1);
    saveState();
    render();
  }

  function collectPracticeAnswer(word) {
    const chars = [...word.word.toLowerCase()];
    let hasBlank = false;
    const draft = chars.map((char, index) => {
      const input = document.querySelector(`.letter-cell[data-index="${index}"]`);
      if (!input) return char;
      const letter = normalizeAnswer(input.value).slice(0, 1);
      if (!letter) hasBlank = true;
      return letter || " ";
    }).join("");
    return { value: normalizeAnswer(draft), draft, hasBlank };
  }

  function differingLetterIndices(actual, expected) {
    const actualChars = [...String(actual || "").toLowerCase()];
    const expectedChars = [...String(expected || "").toLowerCase()];
    const length = Math.max(actualChars.length, expectedChars.length);
    const indices = [];
    for (let index = 0; index < length; index += 1) {
      if (isPracticeLetter(expectedChars[index] || "") && actualChars[index] !== expectedChars[index]) {
        indices.push(index);
      }
    }
    return indices;
  }

  function practiceCueType(task, word) {
    if (task?.usedAudio) return "audio-dictation";
    if (task?.mode === "cloze") return "partial-spelling";
    if (quizClueFor(word)) return "definition";
    return word?.englishOnly ? "image" : "translation";
  }

  function createAttemptEvent(details, sequence, occurredAt = Date.now()) {
    const task = details.task;
    const word = details.word;
    const cardId = canonicalWordId(word.id);
    const safeSequence = safeInteger(sequence, 1, 1, 1_000_000_000);
    return {
      eventId: `${DEVICE_ID}:${SESSION_ID}:${safeSequence}`,
      cardId,
      lexemeId: lexemeIdForWord(word),
      senseId: `${cardId}:default`,
      occurredAt,
      mode: task.mode === "cloze" ? "cloze" : "full",
      source: ["new", "review", "sprint"].includes(task.source) ? task.source : "new",
      cueType: practiceCueType(task, word),
      firstAttempt: task.attempts === 1,
      firstAttemptCorrect: task.attempts === 1 && Boolean(details.answerCorrect),
      usedHint: Boolean(task.assisted || task.hintIndices?.length),
      answerShown: Boolean(details.answerShown),
      nearMiss: Boolean(details.nearMiss),
      answerCorrect: Boolean(details.answerCorrect),
      grade: ["again", "hard", "good", "easy"].includes(details.grade) ? details.grade : "again",
      durationMs: finiteNumber(occurredAt - finiteNumber(task.attemptStartedAt, occurredAt, 0, occurredAt), 0, 0, 86_400_000),
      oldDueAt: details.oldDueAt ?? null,
      newDueAt: details.newDueAt ?? null,
      sessionId: SESSION_ID,
      deviceId: DEVICE_ID,
      sequence: safeSequence,
      appVersion: APP_VERSION,
      contentVersion: hashString(`${word.word}|${studyDefinitionFor(word)}|${word.example || ""}`).toString(16).padStart(8, "0")
    };
  }

  function appendAttemptEvent(details) {
    state.attemptSequence = safeInteger(state.attemptSequence, 0, 0, 999_999_999) + 1;
    const event = createAttemptEvent(details, state.attemptSequence);
    state.attemptEvents.push(event);
    details.task.attemptStartedAt = Date.now();
    return event;
  }

  function practiceGradeForTask(task, answerCorrect = true) {
    if (!answerCorrect) return task?.nearMissUsed && !task?.hadLapse ? "hard" : "again";
    if (task?.hadLapse || task?.assisted || task?.hintIndices?.length) return "again";
    if (task?.nearMissUsed) return "hard";
    return "good";
  }

  function gradePractice() {
    const task = currentTask();
    if (!task || task.status === "passed") return;
    const word = getWord(task.wordId);
    const oldDueAt = spellingProgress(word.id)?.dueAt ?? null;
    const answer = collectPracticeAnswer(word);
    if (answer.hasBlank) {
      toast(isCoreDay() ? "Fill every letter box first." : "还有字母格没有填完", "✎");
      [...document.querySelectorAll(".letter-cell:not([disabled])")].find((input) => !input.value)?.focus();
      return;
    }

    const activeMask = makeMask(word.word, task.maskSeed, task.mode);
    const lockedIndices = new Set(task.hintIndices || []);
    const spellingAnswers = spellingAnswersFor(word)
      .filter((candidate) => canEnterPracticeAnswer(candidate, word.word, activeMask, lockedIndices));
    const expected = normalizeAnswer(word.word);
    task.draft = answer.draft;
    state.stats.attempts += 1;
    task.attempts += 1;

    if (spellingAnswers.includes(answer.value)) {
      task.errorIndices = [];
      const cleanFirstTry = task.attempts === 1 && !task.hadLapse && !task.assisted && !task.nearMissUsed;
      const reviewGrade = practiceGradeForTask(task, true);
      task.cleanPass = cleanFirstTry;
      if (cleanFirstTry) state.stats.combo += 1;
      else if (task.hadLapse) state.stats.combo = 0;
      state.stats.bestCombo = Math.max(state.stats.bestCombo, state.stats.combo);
      state.stats.correct += 1;
      state.today.sessionCorrect += 1;

      task.status = "passed";
      task.completedAt = Date.now();
      task.feedback = {
        type: "correct",
        message: isCoreDay()
          ? cleanFirstTry ? "Excellent! The picture, meaning, and spelling are connected." : "Corrected. Now repeat both spelling steps without a mistake."
          : task.source === "sprint" && task.sprintPhase === "final" && !cleanFirstTry
          ? "这次已经写对；本轮仍会记作需要重测，继续完成整组。"
          : cleanFirstTry
            ? "漂亮！画面、声音和拼写连起来了。"
            : task.source === "new" ? "已经改对；现在要把补空和完整默写连续一次答对。" : "追回成功！这次已经稳稳写对。"
      };

      const stepBonus = task.source === "review"
        ? 4 + Math.min(12, (spellingProgress(word.id)?.step || 0) * 2)
        : task.source === "sprint" && task.sprintPhase === "drill"
          ? 4
          : task.source === "sprint" && task.sprintPhase === "final"
            ? 14
            : task.mode === "full" ? 12 : 8;
      const multiplier = cleanFirstTry ? 1 + Math.min(0.5, Math.floor(state.stats.combo / 5) * 0.1) : 0.35;
      const points = Math.max(2, Math.round(stepBonus * multiplier));
      const awardId = task.source !== "sprint"
        ? `${task.id}:pass`
        : task.sprintPhase === "drill"
          ? `sprint:${state.today.sprint.sessionId}:${word.id}:recovery`
          : task.sprintPhase === "final"
            ? `sprint:${state.today.sprint.sessionId}:${word.id}:mastery`
            : `${task.id}:pass`;
      award(awardId, points, cleanFirstTry ? 3 : 1, isCoreDay() ? (cleanFirstTry ? "First-try spelling" : "Spelling recovered") : cleanFirstTry ? "一次拼对" : "坚持追回");

      if (task.source === "review") {
        scheduleWord(word.id, reviewGrade, false);
        if (!state.today.reviewDoneIds.includes(word.id)) state.today.reviewDoneIds.push(word.id);
        state.stats.reviewed += 1;
      } else if (task.source === "new" && cleanFirstTry) {
        markInitialModeDone(word.id, task.mode);
        const hasAnotherPhase = state.today.tasks.some((candidate) => candidate.id !== task.id && candidate.wordId === word.id && candidate.source === "new" && candidate.status !== "done" && candidate.status !== "passed");
        if (!hasAnotherPhase) {
          if (!state.today.practicedIds.includes(word.id)) state.today.practicedIds.push(word.id);
          scheduleWord(word.id, "correct", true);
        }
      }
      appendAttemptEvent({
        task,
        word,
        answerCorrect: true,
        answerShown: Boolean(task.hadLapse),
        nearMiss: Boolean(task.nearMissUsed),
        grade: reviewGrade,
        oldDueAt,
        newDueAt: spellingProgress(word.id)?.dueAt ?? null
      });
      completeGoalIfReady();
      evaluateBadges();
      saveState();
      render();
      return;
    }

    const nearCandidate = state.settings.typoAssist && expected.length >= 4 && !task.nearMissUsed
      ? spellingAnswers.find((candidate) => damerauDistanceOne(answer.value, candidate) === 1)
      : null;
    if (nearCandidate) {
      task.nearMissUsed = true;
      task.errorIndices = differingLetterIndices(answer.value, nearCandidate);
      task.feedback = { type: "wrong", message: isCoreDay() ? "Almost there. Check the red letter box and try again." : "只差一个小地方，检查红色字母格，再试一次。" };
    } else {
      task.hadLapse = true;
      task.errorIndices = differingLetterIndices(answer.value, expected);
      state.stats.combo = 0;
      state.today.sessionMistakes += 1;
      task.feedback = { type: "wrong", message: isCoreDay() ? (task.attempts >= 3 ? "Look at the correct spelling, close your eyes, and try again:" : "Not yet. The correct spelling is:") : task.attempts >= 3 ? "先看一眼正确拼写，再闭眼重来：" : "差一点！正确拼写是：", word: word.word };
    }
    appendAttemptEvent({
      task,
      word,
      answerCorrect: false,
      answerShown: !nearCandidate,
      nearMiss: Boolean(nearCandidate),
      grade: nearCandidate ? "hard" : "again",
      oldDueAt,
      newDueAt: spellingProgress(word.id)?.dueAt ?? null
    });
    saveState();
    render();
  }

  function advancePractice() {
    // A tab can stay open across midnight while the final answer is waiting on
    // “查看本轮成绩”. Move the unfinished sprint to today's date before the
    // click turns it into a completed session, so the reward and completion
    // screen are not immediately replaced by a newly generated day.
    if (shouldSyncSprintDateBeforeAdvance(state.today, runtime.practiceSource, localDateKey())) ensureToday();
    const task = currentTask();
    if (!task || task.status !== "passed") return;
    stopSpeech();
    if (task.source === "new" && task.cleanPass !== true) {
      resetNewWordMasteryCycle(task.wordId);
      saveState();
      render();
      toast(isCoreDay()
        ? "Both steps must be right on the first try. Start again with gap spelling."
        : "补空和完整默写都要一次答对；现在从补空重新练习。", "↻");
      return;
    }
    task.status = "done";
    task.feedback = null;
    syncPracticeTasks();
    completeGoalIfReady();
    saveState();
    render();
  }

  function startSprintStage() {
    const sprint = state.today?.sprint;
    if (!sprint || state.today.practiceMode !== "sprint" || sprint.phase === "complete") return;
    sprint.awaitingStart = false;
    syncPracticeTasks();
    saveState();
    render();
  }

  function shouldSyncSprintDateBeforeAdvance(day, practiceSource, currentDate) {
    return Boolean(day?.practiceMode === "sprint" && practiceSource !== "review" && day.date !== currentDate);
  }

  function givePracticeHint() {
    const task = currentTask();
    const word = getWord(task?.wordId);
    if (!task || !word || task.status === "passed") return;
    if (task.source === "sprint" && task.sprintPhase === "final") {
      toast("终极默写不提供提示，要靠自己一次写对", "🏁");
      return;
    }
    if (task.assisted) {
      toast(isCoreDay() ? "You already used a hint on this word." : "这一题已经使用过提示啦", "💡");
      return;
    }
    if (state.stats.coins < 3) {
      toast(isCoreDay() ? "You need 3 coins for a letter hint." : "金币不够，先靠记忆挑战一下", "◉");
      return;
    }
    const empty = [...document.querySelectorAll(".letter-cell:not([disabled])")].find((input) => !input.value);
    if (!empty) {
      toast(isCoreDay() ? "Every box is filled. Check your spelling." : "字母已经填满，可以检查啦", "✓");
      return;
    }
    const index = Number(empty.dataset.index);
    task.draft = collectPracticeAnswer(word).draft;
    task.assisted = true;
    task.hintIndices = [index];
    task.errorIndices = (task.errorIndices || []).filter((item) => item !== index);
    state.stats.coins -= 3;
    state.stats.combo = 0;
    saveState();
    render();
    toast(isCoreDay() ? "One letter has been revealed." : "提示字母已经点亮", "💡");
  }

  function taskHasStarted(task) {
    return Boolean(
      task
      && (
        task.status === "done"
        || task.status === "passed"
        || task.attempts > 0
        || task.assisted
        || (task.hintIndices || []).length > 0
        || (typeof task.draft === "string" && task.draft.length > 0)
      )
    );
  }

  function canRefreshTodayPlan() {
    return state.today.learnedIds.length === 0 && !state.today.tasks.some(taskHasStarted);
  }

  function chooseBank(bankKey) {
    if (!BANK_META[bankKey] || !window.WORD_BANKS[bankKey]) return;
    if (state.settings.bank === bankKey) {
      toast(`已经在学习 ${BANK_META[bankKey].name}`, BANK_META[bankKey].icon);
      return;
    }
    const canRefreshToday = canRefreshTodayPlan();
    state.settings.sprintDays[bankKey] = sprintDayFor(bankKey);
    state.settings.bank = bankKey;
    if (canRefreshToday) {
      state.today = null;
      ensureToday();
      toast(bankKey === "core2000" ? "CORE 2000 is ready — choose your set." : `今日地图已切换为 ${BANK_META[bankKey].name}`, BANK_META[bankKey].icon);
    } else {
      saveState();
      toast(`${BANK_META[bankKey].name} 将从下一次新词任务生效`, BANK_META[bankKey].icon);
    }
    navigate(bankKey === "core2000" ? "books" : "home");
  }

  function applyCoreBatch(value, start = false) {
    const sequence = safeInteger(value, state.settings.coreBatch || 1, 1, Math.max(1, coreCourse().batches.length));
    state.settings.coreBatch = sequence;
    if (start) {
      state.settings.bank = "core2000";
      state.today = null;
      resetTransientRuntime();
      ensureToday(true);
      saveState();
      navigate("home");
      toast(`Book ${coreBatchInfo(sequence)?.book} · Set ${sequence} is ready.`, "📘");
      return;
    }
    saveState();
    render();
  }

  function completeCoreExercise() {
    if (!isCoreDay() || !state.today.coreExerciseId) return;
    const exerciseId = state.today.coreExerciseId;
    const answers = coreExerciseAnswers(exerciseId);
    if (!answers.length) {
      toast("This page does not have an answer key yet.", "⚠️");
      return;
    }
    const answerCount = answers.length;
    const inputs = [...document.querySelectorAll(".core-exercise-answer")];
    const previous = coreExerciseRecord(exerciseId) || { responses: [], correctIndices: [], wrongIndices: [], attempts: 0, completedAt: null };
    const responses = Array.from({ length: answerCount }, (_, index) => {
      const input = inputs.find((candidate) => Number(candidate.dataset.index) === index);
      return safeText(input?.value ?? previous.responses?.[index], "", 120).trim();
    });
    const previousCorrect = new Set(previous.correctIndices || []);
    const firstBlankIndex = responses.findIndex((value, index) => !previousCorrect.has(index) && !value);
    if (firstBlankIndex >= 0) {
      toast("Complete every unlocked answer first.", "✎");
      inputs.find((input) => Number(input.dataset.index) === firstBlankIndex)?.focus();
      return;
    }
    const correctIndices = [];
    const wrongIndices = [];
    for (let index = 0; index < answerCount; index += 1) {
      if (previousCorrect.has(index) || coreExerciseAnswerMatches(responses[index], answers[index])) correctIndices.push(index);
      else wrongIndices.push(index);
    }
    const completed = wrongIndices.length === 0;
    state.coreExercises[exerciseId] = {
      responses,
      correctIndices,
      wrongIndices,
      attempts: safeInteger(previous.attempts, 0, 0, 999) + 1,
      completedAt: completed ? Date.now() : null
    };
    if (!completed) {
      saveState();
      render();
      toast(`${correctIndices.length} correct · fix the ${wrongIndices.length} red answer${wrongIndices.length === 1 ? "" : "s"}.`, "↻");
      window.setTimeout(() => document.querySelector(`.core-exercise-answer[data-index="${wrongIndices[0]}"]`)?.focus(), 30);
      return;
    }
    award(`core-exercise:${exerciseId}`, 25, 8, "Workbook exercise complete");
    completeGoalIfReady();
    saveState();
    confetti();
    render();
  }

  function startNextCoreSet() {
    const current = coreBatchById(state.today?.coreBatchId)?.sequence || state.settings.coreBatch || 1;
    applyCoreBatch(Math.min(coreCourse().batches.length, current + 1), true);
  }

  function applyDailyGoal(goal) {
    const value = normalizeDailyGoal(goal, state.settings.dailyGoal);
    const canRefreshToday = canRefreshTodayPlan();
    state.settings.dailyGoal = value;
    if (state.settings.practiceMode === "sprint") {
      saveState();
      toast(`普通模式的每日目标已保存为 ${value} 个；冲刺按所选当天任务执行`, "🎯");
      render();
      return;
    }
    if (canRefreshToday) {
      state.today = null;
      ensureToday();
      toast(`今天的目标已设为 ${value} 个新词`, "🎯");
    } else {
      saveState();
      toast(`每日 ${value} 个将从明天生效`, "🎯");
    }
    render();
  }

  function applyPracticeMode(mode) {
    if (!["mixed", "cloze", "full", "sprint"].includes(mode)) return;
    const canRefreshToday = canRefreshTodayPlan();
    state.settings.practiceMode = mode;
    if (canRefreshToday) {
      state.today = null;
      ensureToday();
      toast(mode === "sprint" ? "考试冲刺通行证已经启用" : "今天的训练方式已经更新", mode === "sprint" ? "🏁" : "✎");
    } else {
      toast("当前任务已开始，新的训练方式会在完成后生效", mode === "sprint" ? "🏁" : "✎");
    }
    saveState();
    render();
  }

  function applySprintDay(value) {
    const bank = state.settings.bank;
    const day = normalizeSprintDay(value, bank);
    const canRefreshToday = canRefreshTodayPlan();
    state.settings.sprintDays[bank] = day;
    if (state.settings.practiceMode === "sprint" && canRefreshToday) {
      state.today = null;
      ensureToday();
      toast(`冲刺通行证已切换到第 ${day} 天`, "🏁");
    } else {
      saveState();
      const activeSprintComplete = state.today.practiceMode === "sprint" && state.today.sprint?.phase === "complete";
      toast(
        state.settings.practiceMode !== "sprint"
          ? `已预选第 ${day} 天冲刺`
          : activeSprintComplete
            ? `第 ${day} 天已保存，将在下一次冲刺生效`
            : `第 ${day} 天会在当前任务完成后生效`,
        "🏁"
      );
    }
    render();
  }

  function saveWordToNotebook(cardId, train) {
    const word = getWord(cardId);
    if (!word) return;
    const sourceTag = safeText(runtime.notebookSource, "Reading", 80).trim() || "Reading";
    const existing = state.savedWords[word.id];
    const now = Date.now();
    const nextSource = {
      sourceTag,
      context: safeText(runtime.notebookContext, "", 320).trim(),
      addedAt: now
    };
    const sources = [...(existing?.sources || [])];
    const sourceKey = `${normalizeAnswer(nextSource.sourceTag)}\n${normalizeAnswer(nextSource.context)}`;
    if (!sources.some((source) => `${normalizeAnswer(source.sourceTag)}\n${normalizeAnswer(source.context)}` === sourceKey)) sources.push(nextSource);
    state.savedWords[word.id] = {
      cardId: word.id,
      train: Boolean(existing?.train || train),
      addedAt: existing?.addedAt || now,
      sources
    };
    saveState();
    closeDialog();
    render();
    toast(train ? `${word.word} 已加入后续训练候选` : `${word.word} 已收藏`, train ? "✦" : "♡");
  }

  function toggleSavedWordTraining(cardId) {
    const entry = state.savedWords[canonicalWordId(cardId)];
    if (!entry) return;
    entry.train = !entry.train;
    saveState();
    render();
    toast(entry.train ? "已加入后续训练候选" : "已改为只收藏", entry.train ? "✦" : "♡");
  }

  function removeSavedWord(cardId) {
    const id = canonicalWordId(cardId);
    const word = getWord(id);
    if (!state.savedWords[id]) return;
    delete state.savedWords[id];
    saveState();
    render();
    toast(`${word?.word || "这个词"} 已移出阅读生词本；学习记录仍然保留`, "✓");
  }

  function removeSavedWordSource(cardId, sourceIndex) {
    const id = canonicalWordId(cardId);
    const entry = state.savedWords[id];
    const index = safeInteger(sourceIndex, -1, -1, (entry?.sources?.length || 0) - 1);
    if (!entry || index < 0) return;
    entry.sources.splice(index, 1);
    if (!entry.sources.length) delete state.savedWords[id];
    saveState();
    render();
    toast("阅读来源已移除；学习进度和答题记录仍然保留", "✓");
  }

  function notebookCatalogResults(query = runtime.notebookQuery) {
    const normalized = normalizeAnswer(query).trim();
    if (normalized.length < 2) return [];
    return allWords()
      .filter((word) => {
        const haystack = normalizeAnswer(`${word.word} ${word.lemma || ""} ${word.formType || ""} ${studyDefinitionFor(word)} ${(word.pos || []).join?.(" ") || word.pos || ""}`);
        return haystack.includes(normalized) && !word.archived;
      })
      .sort((left, right) => {
        const leftExact = normalizeAnswer(left.word) === normalized ? 0 : 1;
        const rightExact = normalizeAnswer(right.word) === normalized ? 0 : 1;
        return leftExact - rightExact || left.word.localeCompare(right.word) || left.id.localeCompare(right.id);
      })
      .slice(0, 12);
  }

  function showNotebookDialog(tab = runtime.notebookDialogTab) {
    runtime.notebookDialogTab = tab === "custom" ? "custom" : "existing";
    const results = notebookCatalogResults();
    const existingPanel = `<div class="notebook-dialog-search"><label class="search-box"><span aria-hidden="true">⌕</span><input id="notebookCatalogSearch" type="search" autocomplete="off" placeholder="输入 whisper 或英文释义" value="${escapeHtml(runtime.notebookQuery)}" /></label><button class="btn btn-soft" type="button" data-action="run-notebook-search">搜索</button></div><div class="notebook-dialog-source"><label><span>来源</span><input id="notebookSource" type="text" maxlength="80" value="${escapeHtml(runtime.notebookSource)}" placeholder="Dragon Masters" /></label><label><span>阅读语境（可选）</span><input id="notebookContext" type="text" maxlength="320" value="${escapeHtml(runtime.notebookContext)}" placeholder="Kevin 在哪句话里遇到它？" /></label></div><div class="notebook-dialog-results">${results.length ? results.map((word) => renderNotebookWordCard(word, state.savedWords[word.id], true)).join("") : `<div class="notebook-empty compact"><span>⌕</span><p>${runtime.notebookQuery.trim().length >= 2 ? "没有找到现有词条，可以切换到“新建词”。" : "输入至少两个字母开始搜索现有词库。"}</p></div>`}</div>`;
    showDialog(`<div class="dialog-content notebook-dialog"><div class="dialog-title-row"><div><p class="eyebrow">ADD TO MY WORDS</p><h2>添加阅读生词</h2></div><button class="dialog-close" type="button" data-action="close-dialog" aria-label="关闭">×</button></div><div class="notebook-tabs" role="tablist"><button type="button" role="tab" data-action="notebook-tab-existing" aria-selected="${runtime.notebookDialogTab === "existing"}">从已有词库搜索</button><button type="button" role="tab" data-action="notebook-tab-custom" aria-selected="${runtime.notebookDialogTab === "custom"}">新建词</button></div>${runtime.notebookDialogTab === "existing" ? existingPanel : renderCustomWordForm()}</div>`);
    window.setTimeout(() => document.getElementById(runtime.notebookDialogTab === "existing" ? "notebookCatalogSearch" : "customWord")?.focus(), 20);
  }

  function readCustomWordDraft() {
    return sanitizeCustomWordDraft({
      word: document.getElementById("customWord")?.value,
      pos: document.getElementById("customPos")?.value,
      lemma: document.getElementById("customLemma")?.value,
      formType: document.getElementById("customFormType")?.value,
      en: document.getElementById("customDefinition")?.value,
      example: document.getElementById("customExample")?.value,
      context: document.getElementById("customContext")?.value,
      sourceTag: document.getElementById("customSource")?.value,
      image: document.getElementById("customImage")?.value
    }, runtime.editingCustomId || "");
  }

  function previewCustomWord() {
    const draft = readCustomWordDraft();
    if (!draft) {
      toast("请填写有效词形、英文释义、例句和来源", "✎");
      return;
    }
    const image = draft.visual?.image
      ? `<img class="custom-preview-image" src="${escapeHtml(draft.visual.image)}" alt="" />`
      : `<span class="dialog-icon">📖</span>`;
    runtime.pendingCustomDraft = {
      ...draft,
      train: Boolean(document.getElementById("customTrain")?.checked)
    };
    const formRelation = normalizeAnswer(draft.lemma) !== normalizeAnswer(draft.word)
      ? `<p class="custom-form-relation"><strong>Word family:</strong> ${escapeHtml(draft.word)} → ${escapeHtml(draft.lemma)}${draft.formType ? ` · ${escapeHtml(draft.formType)}` : ""}<br /><small>The spelling schedule stays separate for this exact form.</small></p>`
      : "";
    showDialog(`<div class="dialog-content custom-word-preview">${image}<p class="eyebrow">PARENT PREVIEW</p><h2>${escapeHtml(draft.word)}</h2><p><strong>${escapeHtml(draft.pos || "word")}</strong> · ${escapeHtml(draft.en)}</p>${formRelation}<blockquote>${escapeHtml(draft.example)}</blockquote>${draft.context ? `<p class="custom-context"><strong>Reading context:</strong> ${escapeHtml(draft.context)}</p>` : ""}<p><strong>Source:</strong> ${escapeHtml(draft.sourceTag)}</p><div class="dialog-actions"><button class="btn btn-soft" type="button" data-action="custom-back-edit">返回修改</button><button class="btn btn-primary" type="button" data-action="confirm-custom-word">家长确认并保存</button></div></div>`);
  }

  function customWordId(draft) {
    const base = `${Date.now().toString(36)}-${hashString(`${draft.word}:${draft.sourceTag}:${Date.now()}:${Math.random()}`).toString(36)}`;
    return `custom:${base}`;
  }

  function confirmCustomWord() {
    const draft = runtime.pendingCustomDraft;
    if (!draft) return;
    const existing = runtime.editingCustomId ? state.customWords[runtime.editingCustomId] : null;
    const id = existing?.id || customWordId(draft);
    const now = Date.now();
    const oldLexemeId = existing ? lexemeIdForWord(existing) : "";
    const updated = {
      ...draft,
      id,
      archived: false,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    delete updated.train;
    const newLexemeId = lexemeIdForWord(updated);
    if (existing && oldLexemeId && newLexemeId && oldLexemeId !== newLexemeId && state.lexemeProgress[oldLexemeId]) {
      const oldSchedule = state.lexemeProgress[oldLexemeId];
      const currentNewSchedule = state.lexemeProgress[newLexemeId];
      if (!currentNewSchedule || progressEvidenceAt(oldSchedule) > progressEvidenceAt(currentNewSchedule)) {
        state.lexemeProgress[newLexemeId] = { ...oldSchedule };
      }
      const oldSpellingStillUsed = allWords().some((word) => word.id !== id && lexemeIdForWord(word) === oldLexemeId);
      if (!oldSpellingStillUsed) delete state.lexemeProgress[oldLexemeId];
    }
    state.customWords[id] = updated;
    state.savedWords[id] = {
      cardId: id,
      train: Boolean(draft.train),
      addedAt: state.savedWords[id]?.addedAt || now,
      sources: [{ sourceTag: updated.sourceTag, context: updated.context || "", addedAt: state.savedWords[id]?.addedAt || now }]
    };
    invalidateCustomCatalog();
    runtime.editingCustomId = null;
    runtime.pendingCustomDraft = null;
    closeDialog();
    saveState();
    render();
    toast(existing ? `${updated.word} 已纠正，历史记录仍然保留` : `${updated.word} 已加入阅读生词本`, existing ? "✓" : "✦");
  }

  function editCustomWord(cardId) {
    const word = state.customWords[canonicalWordId(cardId)];
    if (!word || word.archived) return;
    runtime.editingCustomId = word.id;
    runtime.notebookSource = word.sourceTag;
    showNotebookDialog("custom");
  }

  function cancelCustomEdit() {
    runtime.editingCustomId = null;
    runtime.pendingCustomDraft = null;
    closeDialog();
    render();
  }

  function archiveCustomWord(cardId) {
    const id = canonicalWordId(cardId);
    const word = state.customWords[id];
    if (!word) return;
    word.archived = true;
    word.updatedAt = Date.now();
    delete state.savedWords[id];
    if (runtime.editingCustomId === id) runtime.editingCustomId = null;
    invalidateCustomCatalog();
    saveState();
    render();
    toast(`${word.word} 已归档；旧练习与答题证据仍保留`, "🗃️");
  }

  function restoreCustomWord(cardId) {
    const id = canonicalWordId(cardId);
    const word = state.customWords[id];
    if (!word) return;
    word.archived = false;
    word.updatedAt = Date.now();
    state.savedWords[id] = { cardId: id, train: false, addedAt: Date.now(), sources: [{ sourceTag: word.sourceTag, context: word.context || "", addedAt: Date.now() }] };
    invalidateCustomCatalog();
    saveState();
    render();
    toast(`${word.word} 已恢复为只收藏`, "♡");
  }

  function showDialog(content) {
    dialogBody.innerHTML = content;
    if (!dialog.open) dialog.showModal();
  }

  function clearPkTimer() {
    if (!pkTimer) return;
    window.clearInterval(pkTimer);
    pkTimer = null;
  }

  function closeDialog() {
    clearPkTimer();
    runtime.pendingImport = null;
    runtime.pendingCustomDraft = null;
    if (dialog.open) dialog.close();
  }

  function confirmReset() {
    showDialog(`<div class="dialog-content"><div class="dialog-icon">🧹</div><h2>真的要清空学习记录吗？</h2><p>词库仍然保留，但 XP、金币、每日连续天数和每个单词的复习进度都会重新开始。这个操作不能撤销。</p><div class="dialog-actions"><button class="btn btn-soft" type="button" data-action="close-dialog">先不清空</button><button class="btn btn-coral" type="button" data-action="confirm-reset">确认清空</button></div></div>`);
  }

  function createPortableRecord(sourceState, exportedAt = Date.now()) {
    return {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: new Date(exportedAt).toISOString(),
      summary: {
        learner: safeText(sourceState?.profile?.name, "Kevin", 80),
        activeBank: safeBank(sourceState?.settings?.bank, "ket"),
        xp: safeInteger(sourceState?.stats?.xp, 0),
        learnedWords: Object.keys(sourceState?.progress || {}).length + Object.keys(sourceState?.orphanProgress || {}).length,
        attemptEvents: Array.isArray(sourceState?.attemptEvents) ? sourceState.attemptEvents.length : 0,
        currentDate: safeDateKey(sourceState?.today?.date)
      },
      state: sourceState
    };
  }

  function portableStateSummary(sourceState) {
    return {
      savedAt: finiteNumber(sourceState?.updatedAt, sourceState?.savedAt || 0, 0, 9_999_999_999_999),
      words: Object.keys(sourceState?.progress || {}).length + Object.keys(sourceState?.orphanProgress || {}).length,
      xp: safeInteger(sourceState?.stats?.xp, 0),
      coins: safeInteger(sourceState?.stats?.coins, 0),
      events: Array.isArray(sourceState?.attemptEvents) ? sourceState.attemptEvents.length : 0,
      pending: Array.isArray(sourceState?.today?.tasks)
        ? sourceState.today.tasks.filter((task) => task?.status !== "done").length
        : 0,
      todayDate: safeDateKey(sourceState?.today?.date)
    };
  }

  function importedRecordIsOlder(currentState, candidateState) {
    const currentTime = portableStateSummary(currentState).savedAt;
    const candidateTime = portableStateSummary(candidateState).savedAt;
    return Boolean(currentTime && candidateTime && candidateTime < currentTime);
  }

  async function sha256Text(text) {
    if (window.crypto?.subtle && typeof TextEncoder !== "undefined") {
      const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return "";
  }

  function downloadPortableRecord(sourceState, filename, exportedAt = Date.now()) {
    const payload = createPortableRecord(sourceState, exportedAt);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function stateFromPortableRecord(parsed) {
    if (parsed?.format !== BACKUP_FORMAT) return parsed;
    if (![1, BACKUP_FORMAT_VERSION].includes(parsed.formatVersion) || !parsed.state || typeof parsed.state !== "object" || Array.isArray(parsed.state)) {
      throw new Error("不支持的学习记录文件版本");
    }
    return parsed.state;
  }

  function exportData() {
    if (!saveState()) return;
    downloadPortableRecord(state, `Kevin-Word-Quest-学习记录-${localDateKey()}.wordquest.json`);
    toast("学习记录文件已保存，可以拷到另一台 Mac", "📦");
  }

  async function importData(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const candidate = mergeState(stateFromPortableRecord(parsed), true);
      const sourceSha256 = await sha256Text(text);
      const before = portableStateSummary(state);
      const after = portableStateSummary(candidate);
      const older = importedRecordIsOlder(state, candidate);
      runtime.pendingImport = { candidate, sourceSha256, before, after, filename: safeText(file.name, "学习记录", 180) };
      const fingerprint = sourceSha256 || "当前浏览器环境不可用";
      showDialog(`<div class="dialog-content"><div class="dialog-icon">${older ? "⚠️" : "📦"}</div><h2>先核对，再恢复学习记录</h2><p>${older ? "这份文件比当前浏览器记录更旧。只有确认它确实是主记录时才继续。" : "网站已完成只读校验；确认后会先下载当前记录的恢复点，再执行替换。"}</p><div class="import-compare"><div><small>当前浏览器</small><strong>${before.words} 个词 · ${before.xp} XP</strong><span>${before.coins} 金币 · ${before.pending} 个未完成任务 · ${before.events} 条逐题记录</span></div><div><small>准备导入</small><strong>${after.words} 个词 · ${after.xp} XP</strong><span>${after.coins} 金币 · ${after.pending} 个未完成任务 · ${after.events} 条逐题记录</span></div></div><p class="record-transfer-note">文件：${escapeHtml(runtime.pendingImport.filename)}<br />SHA-256：${escapeHtml(fingerprint)}</p><div class="dialog-actions"><button class="btn btn-soft" type="button" data-action="close-dialog">取消</button><button class="btn ${older ? "btn-coral" : "btn-primary"}" type="button" data-action="confirm-import">${older ? "我确认使用较旧记录" : "保存恢复点并导入"}</button></div></div>`);
    } catch (error) {
      runtime.pendingImport = null;
      console.warn(error);
      toast("这不是有效的 Word Quest 备份", "⚠️");
    }
  }

  function commitPendingImport() {
    const pending = runtime.pendingImport;
    if (!pending) return false;
    const now = new Date();
    const clock = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
    downloadPortableRecord(state, `Kevin-Word-Quest-导入前恢复点-${localDateKey(now)}-${clock}.wordquest.json`, now.getTime());
    const currentRevision = safeInteger(state.revision, 0, 0, 1_000_000_000);
    const candidate = pending.candidate;
    candidate.revision = Math.max(currentRevision, safeInteger(candidate.revision, 0, 0, 1_000_000_000));
    candidate.writerId = WRITER_ID;
    candidate.lastImport = {
      sourceSha256: pending.sourceSha256,
      importedAt: now.getTime(),
      sourceSavedAt: pending.after.savedAt
    };
    state = candidate;
    invalidateCustomCatalog();
    resetTransientRuntime();
    runtime.pendingImport = null;
    ensureToday();
    saveState();
    closeDialog();
    render();
    toast(`学习记录已经恢复：${portableStateSummary(state).words} 个词的进度`, "✓");
    return true;
  }

  function startPk() {
    clearPkTimer();
    const bankKey = safeBank(state.today?.bank, state.settings.bank);
    const words = seededShuffle(orderedBankWords(bankKey), `pk:${bankKey}:${Date.now()}`).slice(0, 5);
    if (!words.length) return;
    runtime.pk = { id: Date.now(), bankKey, words, index: 0, kevin: 0, bot: 0, seconds: 45, finished: false };
    renderPkGame();
    pkTimer = window.setInterval(() => {
      if (!runtime.pk || runtime.pk.finished) return;
      runtime.pk.seconds -= 1;
      if (runtime.pk.seconds > 0 && runtime.pk.seconds % 4 === 0 && runtime.pk.bot < 500) runtime.pk.bot += 100;
      document.getElementById("pkTimer")?.replaceChildren(document.createTextNode(`${runtime.pk.seconds}s`));
      document.getElementById("botScore")?.replaceChildren(document.createTextNode(runtime.pk.bot));
      if (runtime.pk.seconds <= 0) finishPk();
    }, 1000);
  }

  function renderPkGame() {
    const game = runtime.pk;
    if (!game || game.index >= game.words.length) return finishPk();
    const word = game.words[game.index];
    const bankKey = safeBank(game.bankKey, state.today?.bank || state.settings.bank);
    const clue = quizClueFor(word) || (bankKey === "core2000" ? "Look at the book picture." : word.zh);
    showDialog(`
      <div class="dialog-content">
        <div class="pk-game-head"><div class="pk-score"><span>Kevin <b id="kevinScore">${game.kevin}</b></span><span>Flash Fox <b id="botScore">${game.bot}</b></span></div><span class="pk-timer" id="pkTimer">${game.seconds}s</span></div>
        <div class="pk-prompt">${compactPictureMarkup(word, "pk-source-image", "pk-emoji")}<strong>${escapeHtml(clue)}</strong><small>${game.index + 1} / ${game.words.length} · ${escapeHtml(BANK_META[bankKey].short)}</small></div>
        <input class="pk-input" id="pkInput" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="输入完整英文单词" aria-label="输入对应英文单词" />
        <div class="dialog-actions"><button class="btn btn-soft" type="button" data-action="close-dialog">退出比赛</button><button class="btn btn-coral" type="button" data-action="submit-pk">提交答案</button></div>
      </div>`);
    window.setTimeout(() => document.getElementById("pkInput")?.focus(), 60);
  }

  function submitPk() {
    const game = runtime.pk;
    if (!game || game.finished) return;
    const word = game.words[game.index];
    const input = document.getElementById("pkInput");
    const value = normalizeAnswer(input?.value);
    if (!value) {
      input?.classList.add("is-error");
      input?.focus();
      toast("先写出你想到的英文单词", "✎");
      return;
    }
    const spellingAnswers = spellingAnswersFor(word);
    if (spellingAnswers.includes(value)) {
      game.kevin += 100;
      game.index += 1;
      toast("命中！+100 分", "⚡");
      if (game.index >= game.words.length) finishPk();
      else renderPkGame();
    } else {
      input.classList.add("is-error");
      input.select();
      toast("再想想图片和中文意思", "✎");
    }
  }

  function finishPk() {
    const game = runtime.pk;
    if (!game || game.finished) return;
    game.finished = true;
    clearPkTimer();
    const won = game.kevin > game.bot;
    const tied = game.kevin === game.bot;
    const xp = won ? 15 : 5;
    award(`pk:${game.id}`, xp, won ? 5 : 1, won ? "机器人挑战胜利" : "完成 PK 试玩");
    saveState();
    if (won) confetti();
    showDialog(`<div class="dialog-content" style="text-align:center"><div class="dialog-icon" style="margin-left:auto;margin-right:auto">${won ? "🏆" : tied ? "🤝" : "⚡"}</div><h2>${won ? "Kevin 赢下这一局！" : tied ? "势均力敌，平局！" : "Flash Fox 先到终点"}</h2><p>Kevin ${game.kevin} 分 · Flash Fox ${game.bot} 分<br />这只是本地机器人试玩，不会上传成绩。</p><div class="dialog-actions" style="justify-content:center"><button class="btn btn-soft" type="button" data-action="close-dialog">返回 PK 乐园</button><button class="btn btn-primary" type="button" data-action="start-pk">再来一局</button></div></div>`);
  }

  document.addEventListener("click", (event) => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) {
      if (routeButton.dataset.route === "practice") runtime.practiceSource = null;
      if (dialog.open) closeDialog();
      navigate(routeButton.dataset.route);
      return;
    }
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    if (action === "speak") speak(target.dataset.say, target, finiteNumber(target.dataset.rate, 0.78, 0.5, 1.5));
    else if (action === "speak-practice-word") {
      const task = currentTask();
      const word = task ? getWord(task.wordId) : null;
      if (!task || !word) return;
      task.assisted = true;
      task.usedAudio = true;
      saveState();
      speak(word.word, target, 0.72);
      toast(isCoreDay() ? "Audio counted as a hint for this attempt." : "这次听音已记作提示", "🔊");
    }
    else if (action === "speak-sequence") speakSequence(buildStudySpeechSequence(
      target.dataset.word,
      target.dataset.definition,
      target.dataset.example
    ), target);
    else if (action === "toggle-breakdown") {
      runtime.breakdownOpen = !runtime.breakdownOpen;
      document.querySelector(".breakdown-wrap")?.classList.toggle("is-collapsed", !runtime.breakdownOpen);
      const hint = document.querySelector(".breakdown-hint");
      if (hint) hint.hidden = runtime.breakdownOpen;
      document.querySelector(".word-trigger")?.setAttribute("aria-expanded", String(runtime.breakdownOpen));
    } else if (action === "study-next") learnCurrentWord(target.dataset.wordId);
    else if (action === "study-prev") {
      stopSpeech();
      state.today.studyCursor = Math.max(0, state.today.studyCursor - 1);
      saveState();
      render();
    } else if (action === "review-study") {
      stopSpeech();
      state.today.studyCursor = 0;
      runtime.browseStudy = true;
      runtime.lastWordId = null;
      navigate("learn");
    } else if (action === "start-review") {
      runtime.practiceSource = "review";
      navigate("practice");
    } else if (action === "check-practice") gradePractice();
    else if (action === "advance-practice") advancePractice();
    else if (action === "start-sprint-stage") startSprintStage();
    else if (action === "practice-hint") givePracticeHint();
    else if (action === "select-bank") chooseBank(target.dataset.bank);
    else if (action === "save-word") saveWordToNotebook(target.dataset.cardId, target.dataset.train === "true");
    else if (action === "toggle-saved-training") toggleSavedWordTraining(target.dataset.cardId);
    else if (action === "remove-saved-word") removeSavedWord(target.dataset.cardId);
    else if (action === "remove-saved-source") removeSavedWordSource(target.dataset.cardId, target.dataset.sourceIndex);
    else if (action === "open-add-word") showNotebookDialog("existing");
    else if (action === "notebook-tab-existing") showNotebookDialog("existing");
    else if (action === "notebook-tab-custom") showNotebookDialog("custom");
    else if (action === "run-notebook-search") {
      runtime.notebookQuery = document.getElementById("notebookCatalogSearch")?.value || "";
      runtime.notebookSource = document.getElementById("notebookSource")?.value || "Reading";
      runtime.notebookContext = document.getElementById("notebookContext")?.value || "";
      showNotebookDialog("existing");
    }
    else if (action === "preview-custom-word") previewCustomWord();
    else if (action === "custom-back-edit") {
      showNotebookDialog("custom");
    }
    else if (action === "confirm-custom-word") confirmCustomWord();
    else if (action === "edit-custom-word") editCustomWord(target.dataset.cardId);
    else if (action === "cancel-custom-edit") cancelCustomEdit();
    else if (action === "archive-custom-word") archiveCustomWord(target.dataset.cardId);
    else if (action === "restore-custom-word") restoreCustomWord(target.dataset.cardId);
    else if (action === "weekly-answer") answerWeeklyCheck(target.dataset.cardId, target.dataset.selectedId);
    else if (action === "weekly-next") advanceWeeklyCheck();
    else if (action === "pause-today") pauseToday();
    else if (action === "resume-today") resumeToday();
    else if (action === "core-batch-prev") applyCoreBatch((state.settings.coreBatch || 1) - 1);
    else if (action === "core-batch-next") applyCoreBatch((state.settings.coreBatch || 1) + 1);
    else if (action === "save-core-batch") applyCoreBatch(document.getElementById("coreBatchInput")?.value, true);
    else if (action === "complete-core-exercise") completeCoreExercise();
    else if (action === "start-next-core-set") startNextCoreSet();
    else if (action === "open-more-menu") showDialog(`<div class="dialog-content mobile-more-menu"><p class="eyebrow">MORE</p><h2>更多功能</h2><p>家长工具与实验功能放在这里，不会打断 Kevin 的今日学习路线。</p><div class="mobile-more-links"><button class="btn btn-soft" type="button" data-route="settings">⚙ 设置</button><button class="btn btn-soft" type="button" data-route="parent">◎ 家长报告</button><button class="btn btn-soft" type="button" data-route="pk">⚑ PK 试玩</button></div><div class="dialog-actions"><button class="btn btn-primary" type="button" data-action="close-dialog">返回</button></div></div>`);
    else if (action === "save-custom-goal") applyDailyGoal(document.getElementById("customGoal")?.value);
    else if (action === "sprint-prev") applySprintDay(sprintDayFor(state.settings.bank) - 1);
    else if (action === "sprint-next") applySprintDay(sprintDayFor(state.settings.bank) + 1);
    else if (action === "save-sprint-day") applySprintDay(document.getElementById("sprintDayInput")?.value);
    else if (action === "export-data") exportData();
    else if (action === "import-data") document.getElementById("importFile")?.click();
    else if (action === "confirm-import") commitPendingImport();
    else if (action === "reset-data") confirmReset();
    else if (action === "confirm-reset") {
      localStorage.removeItem(STATE_KEY);
      localStorage.removeItem(BACKUP_KEY);
      state = defaultState();
      state.today = null;
      resetTransientRuntime();
      ensureToday();
      closeDialog();
      navigate("home");
      toast("新的探险记录已经准备好", "🧭");
    } else if (action === "close-dialog") closeDialog();
    else if (action === "wechat-coming") showDialog(`<div class="dialog-content"><div class="dialog-icon">💬</div><h2>好友功能需要联网服务</h2><p>正式上线时会接入微信扫码登录、邀请房间和服务端验分。当前本地版不会伪造登录，也不会把 Kevin 的记录传到网络。</p><div class="dialog-actions"><button class="btn btn-primary" type="button" data-action="close-dialog">明白了</button></div></div>`);
    else if (action === "start-pk") startPk();
    else if (action === "submit-pk") submitPk();
    else if (action === "reload-app") window.location.reload();
  });

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (input.classList.contains("letter-cell")) {
      input.value = input.value.replace(/[^a-z]/gi, "").slice(-1).toLowerCase();
      input.classList.remove("is-error");
      const task = currentTask();
      const word = getWord(task?.wordId);
      if (task && word) {
        task.draft = collectPracticeAnswer(word).draft;
        task.errorIndices = (task.errorIndices || []).filter((index) => index !== Number(input.dataset.index));
      }
      if (input.value) {
        const cells = [...document.querySelectorAll(".letter-cell:not([disabled])")];
        const next = cells[cells.indexOf(input) + 1];
        next?.focus();
      }
    }
    if (input.id === "pkInput" && input.value) input.classList.remove("is-error");
    if (input.id === "bookSearch") {
      runtime.bookQuery = input.value;
      const query = runtime.bookQuery.trim().toLowerCase();
      let visibleCards = 0;
      document.querySelectorAll(".book-card").forEach((card) => {
        const key = card.dataset.bank;
        const meta = BANK_META[key];
        const matches = !query || `${key} ${meta.name} ${meta.short} ${meta.description}`.toLowerCase().includes(query);
        card.hidden = !matches;
        if (matches) visibleCards += 1;
      });
      const emptyMessage = document.getElementById("bookEmpty");
      if (emptyMessage) emptyMessage.hidden = visibleCards > 0;
    }
    if (input.id === "notebookSearch") {
      runtime.notebookQuery = input.value;
      window.clearTimeout(runtime.notebookSearchTimer);
      runtime.notebookSearchTimer = window.setTimeout(() => {
        if (route !== "notebook") return;
        render();
        const search = document.getElementById("notebookSearch");
        search?.focus();
        search?.setSelectionRange(search.value.length, search.value.length);
      }, 120);
    }
    if (input.id === "notebookCatalogSearch") runtime.notebookQuery = input.value;
    if (input.id === "notebookSource") runtime.notebookSource = safeText(input.value, "Reading", 80);
    if (input.id === "notebookContext") runtime.notebookContext = safeText(input.value, "", 320);
    if (input.id === "notebookStatus") {
      runtime.notebookStatus = ["all", "training", "saved", "custom"].includes(input.value) ? input.value : "all";
      render();
    }
    if (input.id === "notebookSourceFilter") {
      runtime.notebookSourceFilter = safeText(input.value, "all", 80);
      render();
    }
    if (input.id === "notebookSort") {
      runtime.notebookSort = ["recent", "due", "az"].includes(input.value) ? input.value : "recent";
      render();
    }
    if (input.classList.contains("core-exercise-answer")) {
      const exerciseId = state.today?.coreExerciseId;
      if (exerciseId) {
        const answerCount = coreExerciseAnswers(exerciseId).length || 10;
        const record = coreExerciseRecord(exerciseId) || { responses: Array(answerCount).fill(""), correctIndices: [], wrongIndices: [], attempts: 0, completedAt: null };
        const inputIndex = Number(input.dataset.index);
        record.responses = Array.from({ length: answerCount }, (_, index) => index === inputIndex ? safeText(input.value, "", 120) : record.responses?.[index] || "");
        record.correctIndices = record.correctIndices || [];
        record.wrongIndices = (record.wrongIndices || []).filter((index) => index !== inputIndex);
        record.completedAt = null;
        state.coreExercises[exerciseId] = record;
        saveState();
        const correctSet = new Set(record.correctIndices);
        const ready = record.responses.every((value, index) => correctSet.has(index) || value.trim());
        const button = document.querySelector('[data-action="complete-core-exercise"]');
        if (button) button.disabled = !ready;
        input.closest("label")?.classList.remove("is-error");
        input.removeAttribute("aria-invalid");
      }
    }
  });

  function shouldIgnoreGlobalEnter(target) {
    const tag = String(target?.tagName || "").toLowerCase();
    if (target?.isContentEditable) return true;
    return ["button", "a", "select", "textarea"].includes(tag) || tag === "input";
  }

  function handleEnterShortcut(event) {
    if (event.key !== "Enter" || event.isComposing || event.repeat) return false;
    const input = event.target;

    if (input.classList?.contains("letter-cell")) {
      event.preventDefault();
      const task = currentTask();
      if (task?.status === "passed") advancePractice();
      else gradePractice();
      return true;
    }

    if (input.classList?.contains("core-exercise-answer")) {
      event.preventDefault();
      if (!input.value.trim()) {
        toast("Type an answer before continuing.", "✎");
        return true;
      }
      const inputs = [...document.querySelectorAll(".core-exercise-answer:not([disabled])")];
      const index = inputs.indexOf(input);
      const nextBlank = inputs.slice(index + 1).find((item) => !item.value.trim());
      if (nextBlank) nextBlank.focus();
      else if (inputs.every((item) => item.value.trim())) completeCoreExercise();
      else inputs.find((item) => !item.value.trim())?.focus();
      return true;
    }

    if (input.id === "pkInput") {
      event.preventDefault();
      submitPk();
      return true;
    }
    if (input.id === "sprintDayInput") {
      event.preventDefault();
      applySprintDay(input.value);
      return true;
    }
    if (input.id === "coreBatchInput") {
      event.preventDefault();
      applyCoreBatch(input.value, true);
      return true;
    }
    if (dialog.open || shouldIgnoreGlobalEnter(input)) return false;

    if (route === "learn") {
      const nextWord = document.querySelector('[data-action="study-next"]');
      if (nextWord) {
        event.preventDefault();
        learnCurrentWord(nextWord.dataset.wordId);
        return true;
      }
      if (document.querySelector('[data-route="practice"]')) {
        event.preventDefault();
        navigate("practice");
        return true;
      }
    }

    if (route === "practice") {
      if (document.querySelector('[data-action="start-sprint-stage"]')) {
        event.preventDefault();
        startSprintStage();
        return true;
      }
      const exerciseInputs = [...document.querySelectorAll(".core-exercise-answer")];
      if (exerciseInputs.length) {
        event.preventDefault();
        const firstBlank = exerciseInputs.find((item) => !item.disabled && !item.value.trim());
        if (firstBlank) {
          toast("Complete every unlocked answer first.", "✎");
          firstBlank.focus();
        } else completeCoreExercise();
        return true;
      }
      const task = currentTask();
      if (task) {
        event.preventDefault();
        if (task.status === "passed") advancePractice();
        else gradePractice();
        return true;
      }
      if (document.querySelector('[data-action="start-next-core-set"]')) {
        event.preventDefault();
        startNextCoreSet();
        return true;
      }
      if (document.querySelector('[data-route="home"]')) {
        event.preventDefault();
        navigate("home");
        return true;
      }
    }
    return false;
  }

  document.addEventListener("keydown", (event) => {
    const input = event.target;
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (input.classList?.contains("letter-cell")) {
      const cells = [...document.querySelectorAll(".letter-cell:not([disabled])")];
      const index = cells.indexOf(input);
      if (event.key === "Backspace" && !input.value && index > 0) cells[index - 1].focus();
      if (event.key === "ArrowLeft" && index > 0) cells[index - 1].focus();
      if (event.key === "ArrowRight" && index < cells.length - 1) cells[index + 1].focus();
    }
    handleEnterShortcut(event);
  });

  document.addEventListener("paste", (event) => {
    const input = event.target;
    if (!input.classList?.contains("letter-cell")) return;
    event.preventDefault();
    const letters = event.clipboardData.getData("text").replace(/[^a-z]/gi, "").toLowerCase();
    const cells = [...document.querySelectorAll(".letter-cell:not([disabled])")];
    let position = cells.indexOf(input);
    const changedIndices = [];
    for (const letter of letters) {
      if (!cells[position]) break;
      cells[position].value = letter;
      cells[position].classList.remove("is-error");
      changedIndices.push(Number(cells[position].dataset.index));
      position += 1;
    }
    const task = currentTask();
    const word = getWord(task?.wordId);
    if (task && word) {
      task.draft = collectPracticeAnswer(word).draft;
      task.errorIndices = (task.errorIndices || []).filter((index) => !changedIndices.includes(index));
    }
    (cells[position] || cells.at(-1))?.focus();
  });

  document.addEventListener("error", (event) => {
    if (event.target?.tagName === "IMG") replaceMissingImage(event.target);
  }, true);

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input.name === "dailyGoal") applyDailyGoal(input.value);
    else if (input.name === "practiceMode") applyPracticeMode(input.value);
    else if (input.id === "soundToggle") {
      state.settings.sound = input.checked;
      if (!input.checked) stopSpeech();
      saveState();
    }
    else if (input.id === "autoSoundToggle") { state.settings.autoSound = input.checked; saveState(); }
    else if (input.id === "englishToggle") { state.settings.showEnglish = input.checked; saveState(); }
    else if (input.id === "typoToggle") { state.settings.typoAssist = input.checked; saveState(); }
    else if (input.id === "importFile" && input.files?.[0]) {
      const file = input.files[0];
      input.value = "";
      importData(file);
    }
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });
  dialog.addEventListener("close", clearPkTimer);

  window.addEventListener("hashchange", () => {
    stopSpeech();
    const requested = window.location.hash.slice(1);
    route = ["home", "learn", "practice", "review", "books", "notebook", "parent", "checkup", "pk", "settings"].includes(requested) ? requested : "home";
    render();
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STATE_KEY || !event.newValue) return;
    try {
      const incoming = JSON.parse(event.newValue);
      if (shouldRejectStaleWrite(state, incoming)) {
        runtime.storageConflict = true;
        toast("另一个标签页更新了学习记录；请刷新本页后继续", "⚠️");
        render();
      }
    } catch (error) {
      console.warn("忽略无法解析的跨标签记录通知", error);
    }
  });
  window.addEventListener("pagehide", saveState);

  window.WordQuestTest = {
    hashString,
    seededShuffle,
    normalizeAnswer,
    isPracticeLetter,
    semanticAlternativesFor,
    spellingAnswersFor,
    canonicalWordId,
    lexemeIdForWord,
    lemmaIdForWord,
    sanitizeAttemptEvents,
    sanitizeRecognitionEvents,
    sanitizeCustomWordDraft,
    sanitizeCustomWords,
    sanitizeSavedWords,
    savedTrainingIds,
    practiceCueType,
    practiceGradeForTask,
    createAttemptEvent,
    selectAmericanVoice,
    speechVoiceLabel,
    buildStudySpeechSequence,
    spellingVariants,
    answerFormsFor,
    clueContainsAnswer,
    studyDefinitionFor,
    feedbackDefinitionFor,
    quizClueFor,
    createPortableRecord,
    portableStateSummary,
    importedRecordIsOlder,
    stateFromPortableRecord,
    normalizeExerciseAnswer,
    coreExerciseAnswerMatches,
    damerauDistanceOne,
    makeMask,
    canEnterPracticeAnswer,
    differingLetterIndices,
    dayDistance,
    dailyCompletionExists,
    recordCompletionState,
    sanitizeProgress,
    sanitizeProgressItem,
    nextReviewSchedule,
    initialScheduleNeeded,
    isDue,
    sanitizeToday,
    mergeState,
    shouldRejectStaleWrite,
    taskHasStarted,
    restoreInitialModesFromLedger,
    normalizeDailyGoal,
    sprintDayCount,
    normalizeSprintDay,
    sprintBatchInfo,
    evaluateSprintPhase,
    sanitizeSprintState,
    sprintStageIsComplete,
    progressForStudyView,
    shouldSyncSprintDateBeforeAdvance,
    filterDueIdsForBank,
    dailyNewLimit,
    buildDailyPlan,
    dailyPlanMetrics,
    ordinaryHomeAction,
    hasCompletedInitialStudy,
    learnAvailability,
    learningMetrics,
    missingAssetLabel,
    localWeekKey,
    weeklyCheckPlan,
    weeklyCheckOptions,
    shouldIgnoreGlobalEnter,
    taskCountsAsCleanInitial,
    resetTaskForMasteryRetry,
    sanitizeCoreExercises,
    bankKeys: Object.keys(BANK_META)
  };

  const missingBanks = Object.keys(BANK_META).filter((key) => !Array.isArray(window.WORD_BANKS?.[key]));
  if (!window.WORD_BANKS || !Object.keys(window.WORD_BANKS).length || missingBanks.length) {
    root.innerHTML = `<section class="view-page empty-state"><div><span class="empty-icon">⚠️</span><h1>词库没有加载成功</h1><p>请确认 assets/words.js、assets/cambridge-official.js、assets/movers-2025.js、assets/core2000.js、assets/core2000-answers.js 和图片文件夹都在网站目录中。</p><button class="btn btn-primary" type="button" data-action="reload-app">重新加载</button></div></section>`;
    return;
  }
  state = loadState();
  invalidateCustomCatalog();
  ensureToday();
  const requestedRoute = window.location.hash.slice(1);
  route = ["home", "learn", "practice", "review", "books", "notebook", "parent", "checkup", "pk", "settings"].includes(requestedRoute) ? requestedRoute : "home";
  if (!window.location.hash) window.history.replaceState(null, "", "#home");
  render();
})();
