"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, ...relative.split("/")));
}

test("Git checkout preserves LF bytes for every repository text file", () => {
  const attributes = read(".gitattributes");
  const text = attributes.toString("utf8");
  const rules = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  assert.equal(attributes.includes(Buffer.from("\r\n")), false,
    ".gitattributes itself must use LF bytes");
  assert.ok(rules.includes("* text=auto eol=lf"),
    "all detected repository text must be checked out as LF");
  assert.equal(rules.includes("* text=auto"), false,
    "a global text rule without eol=lf permits Windows checkout drift");

  const strictInputs = [
    "config/provenance/cpython-3.13.14-win32-x64.json",
    "config/release-identity.json",
    "config/schemas/release-identity-v1.schema.json",
    "config/tool-manifests/app-resources-v1.json",
    "web/supabase/migrations-v1.json",
    "web/supabase/001_web_job_state.sql",
  ];
  for (const relative of strictInputs) {
    assert.equal(read(relative).includes(Buffer.from("\r\n")), false,
      `${relative} must retain canonical LF bytes after checkout`);
  }
});
