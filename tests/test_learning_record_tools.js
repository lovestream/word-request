"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { auditRecord } = require("../scripts/audit_learning_record");
const { inspectRecords } = require("../scripts/merge_learning_records");

const fixture = path.join(__dirname, "fixtures", "v1-anonymized.wordquest.json");
const audit = auditRecord(fixture);

assert.equal(audit.readOnly, true);
assert.equal(audit.summary.progress.total, 6);
assert.deepEqual(audit.summary.progress.byBank, {
  core2000: 3,
  movers: 1,
  ket: 1,
  pet: 1
});
assert.equal(audit.summary.progress.pendingInitial, 2);
assert.equal(audit.summary.progress.dueAsOfSavedAt, 2);
assert.equal(audit.summary.stats.xp, 500, "visible ledger must not replace the opening XP balance");
assert.equal(audit.summary.stats.coins, 120, "visible ledger must not replace the opening coin balance");
assert.equal(audit.summary.retainedHistory.ledgerXp, 45);
assert.equal(audit.summary.attemptEvidence.events, 0);
assert.match(audit.warnings.join(" "), /尚无逐题 attemptEvents/);

const identical = inspectRecords([fixture, fixture]);
assert.equal(identical.identical, true);
assert.equal(identical.safeToMerge, true);
assert.equal(identical.records[0].summary.stats.xp, 500);
assert.equal(identical.records[1].summary.stats.coins, 120);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wordquest-record-test-"));
const divergentPath = path.join(temporaryDirectory, "divergent.wordquest.json");
const divergent = JSON.parse(fs.readFileSync(fixture, "utf8"));
divergent.state.savedAt += 1;
divergent.state.stats.xp += 10;
fs.writeFileSync(divergentPath, JSON.stringify(divergent), "utf8");

const conflict = inspectRecords([fixture, divergentPath]);
assert.equal(conflict.identical, false);
assert.equal(conflict.safeToMerge, false);
assert.match(conflict.recommendation, /禁止自动合并/);

const v2Path = path.join(temporaryDirectory, "v2.wordquest.json");
const v2 = JSON.parse(fs.readFileSync(fixture, "utf8"));
v2.formatVersion = 2;
v2.state.schemaVersion = 2;
v2.state.migratedFromSchema = 1;
v2.state.historyQuality = "mixed";
v2.state.recognitionEvents = [{ eventId: "recognition:test:1", correct: true }];
fs.writeFileSync(v2Path, JSON.stringify(v2), "utf8");
const v2Audit = auditRecord(v2Path);
assert.equal(v2Audit.summary.schemaVersion, 2);
assert.equal(v2Audit.summary.migratedFromSchema, 1);
assert.equal(v2Audit.summary.historyQuality, "mixed");
assert.equal(v2Audit.summary.recognitionEvidence.events, 1);

fs.rmSync(temporaryDirectory, { recursive: true, force: true });
console.log("learning record tools: ok");
