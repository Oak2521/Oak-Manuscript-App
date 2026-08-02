"use strict";

const fs = require("node:fs");
const { createPackage, getRawHeader } = require("@electron/asar");

function expectedArchiveSize(raw) {
  const base = 8 + raw.headerSize;
  let maximum = base;
  const visit = (node) => {
    if (!node || typeof node !== "object") throw new Error("ASAR test header node is invalid");
    if (node.files) {
      for (const child of Object.values(node.files)) visit(child);
      return;
    }
    if (node.unpacked === true || "link" in node) return;
    if (!Number.isSafeInteger(node.size) || node.size < 0 || !/^\d+$/u.test(node.offset)) {
      throw new Error("ASAR test file metadata is invalid");
    }
    maximum = Math.max(maximum, base + Number(node.offset) + node.size);
  };
  visit(raw.header);
  return maximum;
}

async function createStablePackage(source, destination) {
  // @electron/asar 4.0.1 returns the writable stream from out.end() instead of
  // awaiting its finish event. A test must not hand a partially flushed archive
  // to the production fail-closed reader and misclassify the writer race.
  await createPackage(source, destination);
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    try {
      const raw = getRawHeader(destination);
      const expected = expectedArchiveSize(raw);
      if (fs.statSync(destination).size === expected) {
        await new Promise((resolve) => setImmediate(resolve));
        if (fs.statSync(destination).size === expected) return destination;
      }
    } catch {
      // Header/payload can still be incomplete while the library-owned stream
      // is finishing. The bounded loop below yields without accepting it.
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`ASAR test fixture did not finish writing: ${destination}`);
}

module.exports = { createStablePackage };
