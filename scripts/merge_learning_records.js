#!/usr/bin/env node

"use strict";

const path = require("node:path");
const { readRecord, stableStateHash, summarizeRecord } = require("./learning_record_utils");

function inspectRecords(filenames) {
  const records = filenames.map(readRecord);
  const stateHashes = records.map((record) => stableStateHash(record.state));
  const identical = stateHashes.every((hash) => hash === stateHashes[0]);
  return {
    mode: "read-only-conflict-inspection",
    safeToMerge: identical,
    identical,
    recommendation: identical
      ? "记录内容完全相同；保留任意一个原文件即可，不需要生成合并文件。"
      : "记录已经分叉。当前V1没有完整事件日志，禁止自动合并；请选择单一主记录或升级到事件日志后再解决冲突。",
    records: records.map((record, index) => ({
      file: path.basename(record.filename),
      stateHash: stateHashes[index],
      summary: summarizeRecord(record)
    }))
  };
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] !== "--inspect" || argv.length < 3) {
    throw new Error(
      "自动合并已停用：V1账本有损且无法可靠恢复多设备分叉。仅可运行 --inspect <记录1> <记录2> [更多记录] 做只读检查。"
    );
  }
  const report = inspectRecords(argv.slice(1));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.identical) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { inspectRecords, main };
