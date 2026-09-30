"use strict";

// 规则、状态、功能地图和交接归档是多家 AI 协作的入口；文件搬家后相对链接容易悄悄失效。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const FILES = Object.freeze([
  "AGENTS.md",
  "AI_HANDOFF.md",
  "README.md",
  "CONTRIBUTING.md",
  "docs/功能地图.md",
  "docs/history/交接历史-截至2026-09-30.md",
]);

test("入口文档中的相对链接都指向仓库里存在的文件", () => {
  const missing = [];
  for (const file of FILES) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const [, target] of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/gu)) {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) continue;
      const rel = decodeURIComponent(target);
      if (!fs.existsSync(path.join(ROOT, path.dirname(file), rel))) missing.push(`${file} → ${rel}`);
    }
  }
  assert.deepEqual(missing, [], `以下链接失效，请修正路径：\n${missing.join("\n")}`);
});
