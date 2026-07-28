"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { canonicalJson } = require("../electron/standards-store");
const {
  MANIFEST_RELATIVE,
  RULEPACK_RELATIVE,
} = require("../scripts/standard_assets");

const {
  createStandardsPayloadValidator,
  strictJson,
  validateCapabilities,
} = require("../electron/standards-payload");

const ROOT = path.resolve(__dirname, "..");
const capabilityBytes = fs.readFileSync(path.join(ROOT, "config", "rule-capabilities.json"));
const manifest = JSON.parse(fs.readFileSync(
  path.join(ROOT, ...MANIFEST_RELATIVE.split("/")), "utf8",
));
const standardsBytes = fs.readFileSync(path.join(ROOT, "config", "standards.json"));
const rulepackBytes = fs.readFileSync(
  path.join(ROOT, ...RULEPACK_RELATIVE.split("/")),
);
const capabilities = validateCapabilities(capabilityBytes);
const validate = createStandardsPayloadValidator({ capabilityBytes });

function bytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function args(overrides = {}) {
  return {
    manifest: structuredClone(manifest),
    standardsBytes: Buffer.from(standardsBytes),
    rulepackBytes: Buffer.from(rulepackBytes),
    capabilitySetSha256: capabilities.sha256,
    ...overrides,
  };
}

test("runtime payload validator accepts the authenticated bundled payload", async () => {
  const result = await validate(args());
  assert.deepEqual(result, {
    ok: true,
    pack_name: "oak-rules",
    pack_version: "2.0.0",
    rule_count: 35,
    standard_count: 13,
  });
});

test("runtime payload validator accepts both legacy and resolver-backed citation mapping schemas", async () => {
  const legacyShape = strictJson(rulepackBytes, "fixture rulepack");
  delete legacyShape.citation_default_mapping.resolver;
  legacyShape.citation_default_mapping.version = "1.0.0";
  const legacyResult = await validate(args({ rulepackBytes: bytes(legacyShape) }));
  assert.equal(legacyResult.ok, true);

  const current = strictJson(rulepackBytes, "fixture rulepack");
  assert.equal(current.citation_default_mapping.version, "2.0.0");
  assert.equal(current.citation_default_mapping.resolver.version, "1.0.0");
  const currentResult = await validate(args({ rulepackBytes: bytes(current) }));
  assert.equal(currentResult.ok, true);
});

test("resolver-backed citation mapping rejects unsafe threshold values and ordering", async () => {
  const cases = [
    ["moderate unique count below one", { moderate_min_unique: 0 }],
    ["moderate unique count above strong", {
      moderate_min_unique: 4,
      strong_min_unique: 3,
    }],
    ["strong unique count above bound", { strong_min_unique: 1001 }],
    ["moderate coverage below one", { moderate_min_coverage_percent: 0 }],
    ["moderate coverage above strong", {
      moderate_min_coverage_percent: 90,
      strong_min_coverage_percent: 80,
    }],
    ["strong coverage above 100", { strong_min_coverage_percent: 101 }],
    ["non-integer threshold", { strong_min_unique: 2.5 }],
  ];
  for (const [label, changes] of cases) {
    const pack = strictJson(rulepackBytes, `fixture rulepack: ${label}`);
    Object.assign(pack.citation_default_mapping.resolver.thresholds, changes);
    await assert.rejects(
      validate(args({ rulepackBytes: bytes(pack) })),
      /citation resolver threshold|thresholds 次序或范围非法/,
      label,
    );
  }
});

test("resolver style capability declarations must be nonempty, known, and style-applicable", async () => {
  const empty = strictJson(rulepackBytes, "fixture rulepack");
  empty.citation_default_mapping.resolver.style_capability_rules["gbt7714-2025"] = [];
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(empty) })),
    /capability rules 数量非法|能力规则不能为空/,
  );

  const unknown = strictJson(rulepackBytes, "fixture rulepack");
  unknown.citation_default_mapping.resolver.style_capability_rules["gbt7714-2025"] =
    ["REF-UNKNOWN-999"];
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(unknown) })),
    /能力规则未声明该体例/,
  );

  const wrongStyle = strictJson(rulepackBytes, "fixture rulepack");
  wrongStyle.citation_default_mapping.resolver.style_capability_rules["gbt7714-2025"] =
    ["REF-APA-001"];
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(wrongStyle) })),
    /能力规则未声明该体例/,
  );

  const extraStyle = strictJson(rulepackBytes, "fixture rulepack");
  extraStyle.citation_default_mapping.resolver.style_capability_rules.none = ["REF-001"];
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(extraStyle) })),
    /style_capability_rules 字段(?:集合非法|不符合 schema)/,
  );
});

test("runtime payload validator accepts a signed subset of implemented rules", async () => {
  const pack = strictJson(rulepackBytes, "fixture rulepack");
  const standards = strictJson(standardsBytes, "fixture standards");
  const removed = pack.rules.pop();
  for (const standard of standards.standards) {
    standard.rule_ids = standard.rule_ids.filter((id) => id !== removed.rule_id);
  }
  const result = await validate(args({ rulepackBytes: bytes(pack), standardsBytes: bytes(standards) }));
  assert.equal(result.rule_count, 34);
});

test("runtime payload validator rejects unknown executable rule capability", async () => {
  const pack = strictJson(rulepackBytes, "fixture rulepack");
  pack.rules[0].rule_id = "UNKNOWN-RULE-999";
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(pack) })),
    /不在 APP 能力表/,
  );
});

test("runtime payload validator rejects an auto-fix capability escalation", async () => {
  const pack = strictJson(rulepackBytes, "fixture rulepack");
  const rule = pack.rules.find((item) => item.auto_fixable === false);
  rule.auto_fixable = true;
  rule.fix_id = "FIX-ATTACKER-001";
  rule.confidence = "high";
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(pack) })),
    /与 APP 能力表不一致/,
  );
});

test("compiled auto-fix mapping cannot be reassigned through canonical capability data", () => {
  const document = strictJson(capabilityBytes, "fixture capabilities");
  document.capabilities.find((entry) => entry.rule_id === "DOCX-SPACE-001").fix_id =
    "FIX-TAB-001";
  assert.throws(
    () => validateCapabilities(canonicalBytes(document)),
    (error) => error.code === "STANDARD_CAPABILITY_INVALID" &&
      /编译实现不一致/.test(error.message),
  );
});

test("auto-fix rules cannot widen beyond the compiled file-format scope", async () => {
  const pack = strictJson(rulepackBytes, "fixture rulepack");
  pack.rules.find((entry) => entry.rule_id === "DOCX-SPACE-001").applies_to.formats =
    ["docx", "epub"];
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(pack) })),
    /文件格式范围超出本 APP 编译实现/,
  );
});

test("runtime payload validator rejects standards-to-rule mapping drift", async () => {
  const standards = strictJson(standardsBytes, "fixture standards");
  standards.standards.find((item) => item.rule_ids.length > 0).rule_ids.pop();
  await assert.rejects(
    validate(args({ standardsBytes: bytes(standards) })),
    /反向引用不一致/,
  );
});

test("runtime payload validator rejects incomplete default citation mapping", async () => {
  const pack = strictJson(rulepackBytes, "fixture rulepack");
  pack.citation_default_mapping.map[0].languages = ["zh"];
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(pack) })),
    /未覆盖 paper × mixed/,
  );
});

test("wildcard applicability cannot be combined with concrete values", async () => {
  const pack = strictJson(rulepackBytes, "fixture rulepack");
  pack.rules[0].applies_to.languages = ["*", "zh"];
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(pack) })),
    /\* 不得与具体值并列/,
  );
});

test("runtime payload validator rejects stale placeholders and unreviewed missing source", async () => {
  const standards = strictJson(standardsBytes, "fixture standards");
  standards.standards[0].summary = "占位：稍后补充";
  await assert.rejects(validate(args({ standardsBytes: bytes(standards) })), /仍含占位内容/);

  const second = strictJson(standardsBytes, "fixture standards");
  second.standards[0].status = "active";
  await assert.rejects(validate(args({ standardsBytes: bytes(second) })), /缺少外部官方来源/);
});

test("runtime payload validator rejects BOM and capability digest mismatch", async () => {
  await assert.rejects(
    validate(args({ rulepackBytes: Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), rulepackBytes]) })),
    /含 UTF-8 BOM/,
  );
  await assert.rejects(
    validate(args({ capabilitySetSha256: "0".repeat(64) })),
    /capability_set_sha256/,
  );
});

test("strict JSON gate rejects duplicate keys, excessive depth, wide arrays, and byte overflow", () => {
  assert.throws(
    () => strictJson(Buffer.from('{"a":1,"\\u0061":2}', "utf8"), "duplicate fixture"),
    /重复对象键/,
  );
  assert.throws(
    () => strictJson(
      Buffer.from(`${"[".repeat(65)}0${"]".repeat(65)}`, "utf8"),
      "deep fixture",
    ),
    /嵌套过深/,
  );
  assert.throws(
    () => strictJson(Buffer.from(`[${Array(2049).fill("0").join(",")}]`), "wide fixture"),
    /数组条目过多/,
  );
  assert.throws(
    () => strictJson(Buffer.alloc(65, 0x20), "large fixture", { maxBytes: 64 }),
    /大小非法/,
  );
});

test("payload text rejects unsafe Unicode scalars and controls but accepts valid astral text", async () => {
  const lone = strictJson(rulepackBytes, "fixture rulepack");
  lone.rules[0].title = "\uD800";
  await assert.rejects(validate(args({ rulepackBytes: bytes(lone) })), /title 非法/);

  const control = strictJson(rulepackBytes, "fixture rulepack");
  control.rules[0].title = "unsafe\u0001control";
  await assert.rejects(validate(args({ rulepackBytes: bytes(control) })), /title 非法/);

  const astral = strictJson(rulepackBytes, "fixture rulepack");
  astral.rules[0].title = "有效字符 😀";
  const result = await validate(args({ rulepackBytes: bytes(astral) }));
  assert.equal(result.ok, true);
});

test("calendar dates must be real, ordered, and no later than the authenticated release", async () => {
  const impossible = strictJson(rulepackBytes, "fixture rulepack");
  impossible.frozen_at = "2026-02-30";
  await assert.rejects(
    validate(args({ rulepackBytes: bytes(impossible) })),
    /不是有效公历日期/,
  );

  const future = strictJson(standardsBytes, "fixture standards");
  future.updated_at = "2026-07-28";
  await assert.rejects(
    validate(args({ standardsBytes: bytes(future) })),
    /晚于 2026-07-27/,
  );

  const unordered = strictJson(standardsBytes, "fixture standards");
  unordered.standards[0].change_history.push({
    changed_at: "2026-07-26",
    change_type: "audit",
    summary: "earlier entry appended later",
  });
  await assert.rejects(
    validate(args({ standardsBytes: bytes(unordered) })),
    /change_history 必须按日期升序排列/,
  );
});

test("official source URLs must use one canonical HTTPS spelling", async () => {
  const standards = strictJson(standardsBytes, "fixture standards");
  standards.standards.find((entry) => entry.official_source_url !== "").official_source_url =
    "https://APAStyle.apa.org:443/";
  await assert.rejects(
    validate(args({ standardsBytes: bytes(standards) })),
    /必须是规范、无凭据的 HTTPS URL/,
  );
});

test("runtime payload validator binds registry and pack versions to release version", async () => {
  const standards = strictJson(standardsBytes, "fixture standards");
  standards.registry_version = "1.0.1";
  await assert.rejects(validate(args({ standardsBytes: bytes(standards) })), /registry_version/);

  const pack = strictJson(rulepackBytes, "fixture rulepack");
  pack.pack_version = "1.0.1";
  await assert.rejects(validate(args({ rulepackBytes: bytes(pack) })), /名称\/版本/);
});
