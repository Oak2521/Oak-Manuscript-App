"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  OUTPUT_ROOT,
  parseArgs,
  validateOptions,
} = require("../scripts/run_lm_studio_compatibility");

const DIGEST = "a".repeat(64);
const ROOT = path.join(OUTPUT_ROOT, "llmster-0.0.20-1");
const EVIDENCE = path.join(ROOT, "compatibility-evidence.json");

function validInput() {
  return {
    baseUrl: "http://127.0.0.1:12400/v1",
    model: "oak-qwen3-4b",
    expectedVersion: "0.0.20+1",
    expectedBinarySha256: DIGEST,
    expectedModelSha256: DIGEST,
    expectedModelSize: 2_497_280_480,
    llmsterPath: path.join(ROOT, "runtime", "llmster.exe"),
    modelPath: path.join(ROOT, "models", "qwen3-4b-q4_k_m.gguf"),
    evidencePath: EVIDENCE,
  };
}

test("real LM Studio validation accepts only an explicit isolated loopback target", () => {
  const input = validInput();
  const options = validateOptions(input);
  assert.equal(options.baseUrl, "http://127.0.0.1:12400/v1");
  assert.equal(options.origin, "http://127.0.0.1:12400");
  assert.equal(options.expectedModelSize, 2_497_280_480);
  for (const baseUrl of [
    "http://localhost:12400/v1",
    "http://0.0.0.0:12400/v1",
    "https://127.0.0.1:12400/v1",
    "http://127.0.0.1:12400/api",
    "http://127.0.0.1:12400/v1?token=x",
  ]) assert.throws(() => validateOptions({ ...input, baseUrl }), /127\.0\.0\.1/u);
});

test("real LM Studio validation confines binary, model, and evidence to its output root", () => {
  const input = validInput();
  for (const key of ["llmsterPath", "modelPath", "evidencePath"]) {
    assert.throws(() => validateOptions({
      ...input,
      [key]: path.resolve(OUTPUT_ROOT, "..", "escape.bin"),
    }), /必须位于仓库/u);
  }
});

test("real LM Studio validation CLI is exact and rejects duplicate or missing arguments", () => {
  const input = validInput();
  const argv = [
    "--base-url", input.baseUrl,
    "--model", input.model,
    "--expected-version", input.expectedVersion,
    "--expected-binary-sha256", input.expectedBinarySha256,
    "--expected-model-sha256", input.expectedModelSha256,
    "--expected-model-size", String(input.expectedModelSize),
    "--llmster-path", input.llmsterPath,
    "--model-path", input.modelPath,
    "--evidence", input.evidencePath,
  ];
  assert.equal(parseArgs(argv).model, "oak-qwen3-4b");
  assert.throws(() => parseArgs(argv.slice(0, -1)), /参数非法|证据路径非法/u);
  assert.throws(() => parseArgs([...argv, "--model", "other"]), /参数非法/u);
  assert.throws(() => parseArgs([...argv, "--unknown", "value"]), /参数非法/u);
});
