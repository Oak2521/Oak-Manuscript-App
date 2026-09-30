"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// 所有工作流里的第三方 Action 都必须固定到 40 位提交 SHA：带写权限或密钥的工作流（如 claude.yml）
// 若引用可变标签，标签被移动或上游被入侵时，恶意代码就能拿到这些凭据。
const ROOT = path.resolve(__dirname, "..");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");

function unpinnedReferences(text) {
  return [...text.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gmu)]
    .map((match) => match[1])
    .filter((ref) => !ref.startsWith("./") && !/^[^@\s]+@[0-9a-f]{40}$/u.test(ref));
}

test("every workflow action reference is pinned to a full commit SHA", () => {
  const problems = [];
  for (const name of fs.readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/u.test(f))) {
    for (const ref of unpinnedReferences(fs.readFileSync(path.join(WORKFLOWS, name), "utf8"))) {
      problems.push(`${name}: ${ref}`);
    }
  }
  assert.deepEqual(problems, [], `以下 Action 未固定到提交 SHA：\n${problems.join("\n")}`);
});

test("the pin check rejects tags and branches", () => {
  assert.deepEqual(unpinnedReferences("      - uses: actions/checkout@v4\n      - uses: a/b@main\n"), ["actions/checkout@v4", "a/b@main"]);
  assert.deepEqual(unpinnedReferences(`      - uses: a/b@${"0".repeat(40)} # v1\n      - uses: ./local\n`), []);
});
