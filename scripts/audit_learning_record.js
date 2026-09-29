#!/usr/bin/env node

"use strict";

const path = require("node:path");
const { readRecord, summarizeRecord } = require("./learning_record_utils");

function auditRecord(filename) {
  const record = readRecord(filename);
  return {
    file: path.basename(filename),
    readOnly: true,
    summary: summarizeRecord(record),
    warnings: [
      "learned 是历史接触计数，不代表长期掌握",
      "correct/attempts 是旧版累计提交口径，不代表无提示首答正确率",
      ...(record.state.attemptEvents?.length
        ? ["attemptEvents 只记录升级后发生的真实提交，不反推或伪造旧历史"]
        : ["这份旧记录尚无逐题 attemptEvents，不能推断每题首答质量"]),
      ...(record.state.scoreLedger?.length >= 500
        ? ["scoreLedger 已达到500条保留上限，不能用于反推全部XP或金币"]
        : [])
    ]
  };
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 1) {
    throw new Error("用法: node scripts/audit_learning_record.js <record.wordquest.json>");
  }
  process.stdout.write(`${JSON.stringify(auditRecord(argv[0]), null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { auditRecord, main };
