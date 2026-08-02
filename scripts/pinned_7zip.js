"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// electron-winstaller is locked by package-lock.json. Pinning both the host
// executable and its load-time DLL prevents an altered local compressor from
// becoming part of either the import or release-build trust bootstrap.
const EXTRACTOR_FILES = Object.freeze([
  Object.freeze({
    relative: "node_modules/electron-winstaller/vendor/7z.exe",
    sha256: "c7245e21a7553d9e52d434002a401c77a7ca7d0f245f2311b0ddf16f8f946c6f",
  }),
  Object.freeze({
    relative: "node_modules/electron-winstaller/vendor/7z.dll",
    sha256: "9ed007aa82e440ceb39a6e105bb1d602a9bc59a4946267ba8de2f220aa15bc06",
  }),
]);

function sha256File(target) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(target));
  return hash.digest("hex");
}

function verifyPinnedExtractor(root, { hashFile = sha256File } = {}) {
  const projectRoot = path.resolve(root);
  for (const spec of EXTRACTOR_FILES) {
    const target = path.join(projectRoot, ...spec.relative.split("/"));
    const relative = path.relative(projectRoot, target);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`7z 解压器必须位于项目目录：${target}`);
    }
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.nlink !== 1) {
      throw new Error(`7z 解压器组件必须是非空、单链接普通文件：${spec.relative}`);
    }
    const actualHash = hashFile(target).toLowerCase();
    if (actualHash !== spec.sha256) {
      throw new Error(
        `7z 解压器组件 SHA256 不匹配：${spec.relative}；`
        + `预期 ${spec.sha256}，实际 ${actualHash}`,
      );
    }
  }
  return path.join(projectRoot, ...EXTRACTOR_FILES[0].relative.split("/"));
}

module.exports = {
  EXTRACTOR_FILES,
  verifyPinnedExtractor,
};
