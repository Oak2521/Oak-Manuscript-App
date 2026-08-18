"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  CONTRACT_ROOT,
  verifyFrozenOakAccountContract,
} = require("../scripts/verify_oak_account_contract");

const FROZEN_COMMIT = "6aea9986539a0f55b2961426fa08e486a9e30b19";
const MACHINE_CONTRACT_SHA256 = "582ffbf5bc7d9c5d4028ac2dfd3c8d4013c72cb7eb1b4c12e0919c5eaa6eae2c";

test("frozen Oak Account contract verifies exact provenance and all consumer vectors", () => {
  const result = verifyFrozenOakAccountContract();
  assert.deepEqual(result, {
    ok: true,
    schemaVersion: "oak-desktop-application-login/1.0",
    sourceCommit: FROZEN_COMMIT,
    machineContractSha256: MACHINE_CONTRACT_SHA256,
    verifiedFiles: 16,
    validFixtures: 6,
    negativeVectors: 20,
    consumerChecklistItems: 16,
  });
});

test("contract verification fails closed when a frozen byte changes", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "oak-account-contract-"));
  try {
    fs.cpSync(CONTRACT_ROOT, temporary, { recursive: true });
    const target = path.join(temporary, "oak-desktop-application-login.v1.json");
    fs.appendFileSync(target, " ", "utf8");
    assert.throws(
      () => verifyFrozenOakAccountContract({ contractRoot: temporary }),
      /SHA-256|字节|摘要/,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("contract verification rejects an unknown contract major before runtime use", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "oak-account-major-"));
  try {
    fs.cpSync(CONTRACT_ROOT, temporary, { recursive: true });
    const target = path.join(temporary, "oak-desktop-application-login.v1.json");
    const contract = JSON.parse(fs.readFileSync(target, "utf8"));
    contract.schema_version = "oak-desktop-application-login/2.0";
    fs.writeFileSync(target, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
    assert.throws(
      () => verifyFrozenOakAccountContract({ contractRoot: temporary, verifyHashes: false }),
      /major|版本|1\.0/iu,
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
