"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  OUTPUT_ROOT,
  canonical,
  evaluateSuggestionQuality,
  parseArgs,
  readValidationFixture,
  syntheticContext,
  validateOptions,
} = require("../scripts/run_ollama_compatibility");

const DIGEST = "a".repeat(64);
const EVIDENCE = path.join(OUTPUT_ROOT, "v0.32.5", "evidence.json");

test("real Ollama validation accepts only an explicit isolated loopback target", () => {
  const input = {
    baseUrl: "http://127.0.0.1:11435/v1",
    model: "qwen3:4b",
    expectedVersion: "0.32.5",
    expectedModelDigest: DIGEST,
    evidencePath: EVIDENCE,
  };
  const options = validateOptions(input);
  assert.equal(options.baseUrl, "http://127.0.0.1:11435/v1");
  assert.equal(options.origin, "http://127.0.0.1:11435");
  for (const baseUrl of [
    "http://localhost:11435/v1",
    "http://0.0.0.0:11435/v1",
    "https://127.0.0.1:11435/v1",
    "http://127.0.0.1:11435/api",
    "http://127.0.0.1:11435/v1?token=x",
  ]) assert.throws(() => validateOptions({ ...input, baseUrl }), /127\.0\.0\.1/u);
  assert.throws(() => validateOptions({
    ...input, evidencePath: path.resolve(OUTPUT_ROOT, "..", "escape.json"),
  }), /证据必须写入/u);
});

test("real Ollama validation CLI is exact and rejects duplicate or missing arguments", () => {
  const argv = [
    "--base-url", "http://127.0.0.1:11435/v1",
    "--model", "qwen3:4b",
    "--expected-version", "0.32.5",
    "--expected-model-digest", DIGEST,
    "--evidence", EVIDENCE,
  ];
  assert.equal(parseArgs(argv).model, "qwen3:4b");
  assert.throws(() => parseArgs(argv.slice(0, -1)), /参数非法|证据路径非法/u);
  assert.throws(() => parseArgs([...argv, "--model", "other"]), /参数非法/u);
  assert.throws(() => parseArgs([...argv, "--unknown", "value"]), /参数非法/u);
});

test("real Ollama fixture is bound to the tracked application and exact current spacing rule", () => {
  const fixture = readValidationFixture();
  const context = syntheticContext();
  assert.equal(fixture.appVersion, "0.1.0-alpha.57");
  assert.equal(fixture.rulePackVersion, "2.0.0");
  assert.equal(fixture.rule.ruleId, "DOCX-SPACE-001");
  assert.equal(fixture.rule.fixId, "FIX-SPACE-001");
  assert.equal(context.request_content.rule_id, fixture.rule.ruleId);
  assert.equal(context.request_content.explanation, fixture.rule.explanation);
  assert.deepEqual(context.request_content.standard_refs, ["OAK-DOCX-STYLE-001"]);
});

test("suggestion quality rubric is bounded and checks correction without persisting text", () => {
  const accepted = evaluateSuggestionQuality("问题是连续空格，建议将“湖岸  稿件”合并为“湖岸 稿件”（一个空格），原意不变。");
  assert.equal(accepted.pass, true);
  assert.equal(accepted.checks.proposes_rule_aligned_correction, true);
  assert.equal(evaluateSuggestionQuality("建议删除多余空格，保留一个空格。").pass, true);
  assert.equal(typeof accepted.sha256, "string");
  assert.equal(Object.hasOwn(accepted, "text"), false);
  assert.equal(evaluateSuggestionQuality("建议调整格式。").pass, false);
  assert.equal(evaluateSuggestionQuality("建议删除所有空格。").pass, false);
  assert.equal(evaluateSuggestionQuality("我已经合并空格，结果为湖岸 稿件。").pass, false);
});

test("canonical evidence serialization is key-order stable", () => {
  assert.equal(canonical({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
});
