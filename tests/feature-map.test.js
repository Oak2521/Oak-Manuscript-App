"use strict";

// 功能地图（docs/功能地图.md）是多家 AI 协作时定位模块的依据；路径写错或文件被改名，地图就会悄悄失效。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const MAP = path.join(ROOT, "docs", "功能地图.md");
const looksLikePath = (s) => s.includes("/") || /\.(js|py|json|md|yml|html|css)$/u.test(s);

function readRows() {
  return fs.readFileSync(MAP, "utf8")
    .split(/\r?\n/u)
    .filter((line) => /^\|\s*MS-[\w-]+\s*\|/u.test(line))
    .map((line) => ({
      id: line.split("|")[1].trim(),
      paths: [...line.matchAll(/`([^`]+)`/gu)].map((m) => m[1]).filter(looksLikePath),
    }));
}

test("功能地图的编号不重复，且每一行都列出了代码位置", () => {
  const rows = readRows();
  assert.ok(rows.length >= 10, "功能地图行数过少，可能表格格式被改坏了");
  const ids = rows.map((r) => r.id);
  assert.deepEqual(ids, [...new Set(ids)], "编号重复");
  for (const row of rows) assert.ok(row.paths.length > 0, `${row.id} 没有列出任何路径`);
});

test("功能地图中列出的每个路径都真实存在", () => {
  const missing = [];
  for (const row of readRows()) {
    for (const p of row.paths) {
      if (!fs.existsSync(path.join(ROOT, p))) missing.push(`${row.id}: ${p}`);
    }
  }
  assert.deepEqual(missing, [], `功能地图中的路径不存在，请更新 docs/功能地图.md：\n${missing.join("\n")}`);
});
