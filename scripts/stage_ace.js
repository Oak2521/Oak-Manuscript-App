#!/usr/bin/env node
"use strict";

// 将 @daisy/ace-cli 及其 production dependency closure 阶段化到 tools/ace。
// 不从网络下载任何内容；所有输入都来自当前 npm install 的 node_modules。

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { compareUtf16 } = require("./deterministic_compare");

const ROOT_PACKAGE = "@daisy/ace-cli";
const ACE_LOCK_SCHEMA_VERSION = "1.0";
const ACE_LOCK_TYPE = "oak-ace-stage";
const ACE_LAUNCHER_SHA256 = "765c7c3792690a66dadfa2fcf4e0b17238f09c5f77679bb09938a861c993747e";
const FORBIDDEN_PACKAGES = new Set(["@daisy/ace", "electron"]);
const LICENSE_FILE_PATTERN = /^(license|licence|copying|notice)([._-]|$)/i;
const GENERATED_LICENSE_URLS = Object.freeze({
  "MIT": "https://spdx.org/licenses/MIT.html",
  "Apache-2.0": "https://www.apache.org/licenses/LICENSE-2.0",
  "CC-BY-3.0": "https://creativecommons.org/licenses/by/3.0/legalcode",
  "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/legalcode",
});
const SANDBOX_PATCH = Object.freeze({
  patch_id: "OAK-ACE-ISOLATION-002",
  package_name: "@daisy/ace-axe-runner-puppeteer",
  package_version: "1.4.6",
  relative_file: "lib/index.js",
  before_sha256: "681b52d047d5f6eebbfc62a925b7dc22b82589ab63b36a9ea602297f8cd86ea6",
  after_sha256: "025a0766beaa48e8eb48f640d2bacf72029a61486aec276a393450d406ac67cc",
  replacement_source: "scripts/patches/ace-axe-runner-puppeteer-1.4.6.js",
  sanitizer_package: "@xmldom/xmldom",
  sanitizer_version: "0.9.10",
});
const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".cache",
  ".local-chromium",
]);

function packageSegments(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.includes("..")) {
    throw new Error(`非法 npm 包名：${String(name)}`);
  }
  const segments = name.split("/");
  if (segments.some((segment) => !segment)) throw new Error(`非法 npm 包名：${name}`);
  return segments;
}

function isWithin(base, candidate) {
  const relative = path.relative(path.resolve(base), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function compareText(left, right) {
  return compareUtf16(left, right);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function packageDirectory(name, fromDirectory, projectRoot) {
  const segments = packageSegments(name);
  const root = path.resolve(projectRoot);
  let cursor = path.resolve(fromDirectory);
  while (isWithin(root, cursor)) {
    const candidate = path.join(cursor, "node_modules", ...segments);
    if (isFile(path.join(candidate, "package.json"))) {
      const real = fs.realpathSync(candidate);
      const sourceNodeModules = path.join(root, "node_modules");
      if (!isWithin(sourceNodeModules, real)) {
        throw new Error(`依赖解析逃逸 node_modules：${name} -> ${real}`);
      }
      return real;
    }
    if (cursor === root) break;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return null;
}

function dependencyRequests(manifest) {
  const requests = new Map();
  const add = (record, optional) => {
    for (const name of Object.keys(record || {})) {
      const current = requests.get(name);
      requests.set(name, { optional: Boolean(optional && (!current || current.optional)) });
    }
  };
  add(manifest.dependencies, false);
  add(manifest.optionalDependencies, true);
  for (const name of manifest.bundleDependencies || manifest.bundledDependencies || []) {
    requests.set(name, { optional: false });
  }
  for (const name of Object.keys(manifest.peerDependencies || {})) {
    const optional = Boolean(manifest.peerDependenciesMeta?.[name]?.optional);
    add({ [name]: manifest.peerDependencies[name] }, optional);
  }
  return requests;
}

function collectProductionClosure(projectRoot, rootPackage = ROOT_PACKAGE) {
  const root = path.resolve(projectRoot);
  const sourceNodeModules = path.join(root, "node_modules");
  const start = path.join(sourceNodeModules, ...packageSegments(rootPackage));
  if (!isFile(path.join(start, "package.json"))) {
    throw new Error(`缺少 ${rootPackage}；请先在项目中完成 npm install。`);
  }

  const queue = [fs.realpathSync(start)];
  const visited = new Map();
  while (queue.length) {
    const sourceDirectory = queue.shift();
    if (visited.has(sourceDirectory)) continue;
    const manifest = readJson(path.join(sourceDirectory, "package.json"));
    if (FORBIDDEN_PACKAGES.has(manifest.name)) {
      throw new Error(`生产依赖闭包意外包含禁止阶段化的包：${manifest.name}`);
    }
    const relativeSource = path.relative(sourceNodeModules, sourceDirectory);
    if (!relativeSource || relativeSource.startsWith("..") || path.isAbsolute(relativeSource)) {
      throw new Error(`包路径不在项目 node_modules 内：${sourceDirectory}`);
    }

    const requests = dependencyRequests(manifest);
    const resolvedDependencies = {};
    const missingOptionalDependencies = [];
    for (const [name, request] of Array.from(requests.entries()).sort()) {
      const resolved = packageDirectory(name, sourceDirectory, root);
      if (!resolved) {
        if (request.optional) {
          missingOptionalDependencies.push(name);
          continue;
        }
        throw new Error(`${manifest.name}@${manifest.version} 缺少生产依赖：${name}`);
      }
      const dependencyManifest = readJson(path.join(resolved, "package.json"));
      if (FORBIDDEN_PACKAGES.has(dependencyManifest.name)) {
        throw new Error(
          `${manifest.name}@${manifest.version} 的生产依赖包含禁止包：${dependencyManifest.name}`,
        );
      }
      resolvedDependencies[name] = {
        name: dependencyManifest.name,
        version: dependencyManifest.version,
        source_path: path.relative(sourceNodeModules, resolved).split(path.sep).join("/"),
      };
      queue.push(resolved);
    }
    visited.set(sourceDirectory, {
      sourceDirectory,
      relativeSource: relativeSource.split(path.sep).join("/"),
      manifest,
      resolvedDependencies,
      missingOptionalDependencies,
    });
  }
  return Array.from(visited.values()).sort((a, b) =>
    compareText(a.relativeSource, b.relativeSource),
  );
}

function copyPackage(source, destination) {
  const copied = [];
  function visit(currentSource, currentDestination, relative = "") {
    fs.mkdirSync(currentDestination, { recursive: true });
    for (const entry of fs.readdirSync(currentSource, { withFileTypes: true })
      .sort((a, b) => compareText(a.name, b.name))) {
      if (entry.isSymbolicLink()) {
        throw new Error(`npm 包含符号链接，拒绝阶段化：${path.join(currentSource, entry.name)}`);
      }
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childSource = path.join(currentSource, entry.name);
      const childDestination = path.join(currentDestination, entry.name);
      if (entry.isDirectory()) {
        visit(childSource, childDestination, childRelative);
      } else if (entry.isFile()) {
        fs.mkdirSync(path.dirname(childDestination), { recursive: true });
        fs.copyFileSync(childSource, childDestination);
        fs.chmodSync(childDestination, fs.statSync(childSource).mode);
        copied.push(childRelative);
      }
    }
  }
  visit(source, destination);
  return copied.sort();
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function aceLockRelative(version) {
  if (typeof version !== "string" || !/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(version)) {
    throw new Error(`Ace 版本不能用于固定 lock 路径：${String(version)}`);
  }
  return `config/tool-manifests/ace-${version}.json`;
}

function buildAceLock(manifest) {
  if (manifest?.schema_version !== "1.0" ||
      manifest?.root_package?.name !== ROOT_PACKAGE ||
      typeof manifest?.root_package?.version !== "string" ||
      manifest.root_package.version === "" || manifest?.entry !== "ace.js" ||
      !Array.isArray(manifest?.packages) || !Array.isArray(manifest?.patches) ||
      !Array.isArray(manifest?.files) ||
      manifest.package_count !== manifest.packages.length ||
      manifest.file_count !== manifest.files.length) {
    throw new Error("无法为不完整或结构非法的 Ace stage manifest 建立固定 lock");
  }
  const stageManifestText = canonicalJson(manifest);
  return {
    schema_version: ACE_LOCK_SCHEMA_VERSION,
    lock_type: ACE_LOCK_TYPE,
    tool: {
      name: manifest.root_package.name,
      version: manifest.root_package.version,
    },
    stage_manifest_sha256: sha256Text(stageManifestText),
    entry: manifest.entry,
    package_count: manifest.package_count,
    file_count: manifest.file_count,
    total_bytes: manifest.total_bytes,
    package_closure: manifest.packages.map((item) => ({
      name: item.name,
      version: item.version,
      path: item.path,
    })),
    patches: JSON.parse(JSON.stringify(manifest.patches)),
    files: JSON.parse(JSON.stringify(manifest.files)),
  };
}

function resolveAceLock(projectRoot, version) {
  const root = path.resolve(projectRoot);
  const relative = aceLockRelative(version);
  const target = path.resolve(root, ...relative.split("/"));
  if (!isWithin(root, target)) throw new Error(`Ace 固定 lock 逃逸项目目录：${target}`);
  return { relative, target };
}

function verifyAceStageLock(projectRoot, manifest, manifestTarget = null) {
  const expected = buildAceLock(manifest);
  const { relative, target } = resolveAceLock(projectRoot, expected.tool.version);
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    throw new Error(`Ace 受版本控制固定 lock 缺失或不安全：${relative}`);
  }
  let actual;
  const actualText = fs.readFileSync(target, "utf8");
  try {
    actual = JSON.parse(actualText);
  } catch (error) {
    throw new Error(`Ace 受版本控制固定 lock 无法解析：${relative}（${error.message}）`);
  }
  const expectedText = canonicalJson(expected);
  if (actualText !== expectedText || actual.schema_version !== ACE_LOCK_SCHEMA_VERSION ||
      actual.lock_type !== ACE_LOCK_TYPE) {
    throw new Error(
      `Ace 受版本控制固定 lock 与阶段化完整依赖闭包不一致：${relative}`
      + "；只有显式 --update-lock 才能更新",
    );
  }
  if (manifestTarget !== null) {
    const manifestStat = fs.lstatSync(manifestTarget, { throwIfNoEntry: false });
    if (!manifestStat || !manifestStat.isFile() || manifestStat.isSymbolicLink() ||
        manifestStat.size <= 0) {
      throw new Error(`Ace stage manifest 缺失或不安全：${manifestTarget}`);
    }
    const canonicalManifestText = canonicalJson(manifest);
    const manifestText = fs.readFileSync(manifestTarget, "utf8");
    if (manifestText !== canonicalManifestText ||
        sha256File(manifestTarget) !== actual.stage_manifest_sha256) {
      throw new Error(
        "Ace stage manifest 字节身份与固定 lock 不一致；必须保留规范 JSON 字节并显式 --update-lock",
      );
    }
  }
  return {
    lock: actual,
    lockTarget: target,
    lockRelative: relative,
    lockSha256: sha256File(target),
  };
}

function writeAceStageLock(projectRoot, manifest) {
  const lock = buildAceLock(manifest);
  const { relative, target } = resolveAceLock(projectRoot, lock.tool.version);
  const lockText = canonicalJson(lock);
  const lockSha256 = sha256Text(lockText);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staged = `${target}.stage-${process.pid}-${Date.now()}`;
  const backup = `${target}.previous-${process.pid}-${Date.now()}`;
  const hadTarget = fs.existsSync(target);
  let installed = false;
  fs.writeFileSync(staged, lockText, "utf8");
  try {
    if (hadTarget) fs.renameSync(target, backup);
    fs.renameSync(staged, target);
    installed = true;
  } catch (error) {
    if (installed && fs.existsSync(target)) fs.rmSync(target, { force: true });
    if (hadTarget && fs.existsSync(backup) && !fs.existsSync(target)) {
      fs.renameSync(backup, target);
    }
    throw error;
  } finally {
    if (fs.existsSync(staged)) fs.rmSync(staged, { force: true });
    if (installed && fs.existsSync(backup)) {
      try {
        fs.rmSync(backup, { force: true });
      } catch {
        // The new lock is already committed. A stale backup is safe and can be
        // removed later; never turn a successful identity update into rollback.
      }
    }
  }
  return { lock, lockTarget: target, lockRelative: relative, lockSha256 };
}

function canonicalTextFile(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

function nearestExistingAncestor(target) {
  let cursor = path.resolve(target);
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`无法找到输出目录的既存祖先：${target}`);
    cursor = parent;
  }
  return cursor;
}

function validateStageDestination(projectRoot, outDir) {
  const root = path.resolve(projectRoot);
  const destination = path.resolve(outDir);
  const rootStat = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!rootStat || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error(`项目根目录缺失、不安全或是重解析链接：${root}`);
  }
  const sourceNodeModules = path.join(root, "node_modules");
  if (destination === root || !isWithin(root, destination)) {
    throw new Error(`Ace 输出目录必须位于项目根目录内部且不能是项目根目录：${destination}`);
  }
  if (isWithin(sourceNodeModules, destination)) {
    throw new Error(`Ace 输出目录不得位于 node_modules 内部：${destination}`);
  }

  const existingAncestor = nearestExistingAncestor(destination);
  const canonicalRoot = fs.realpathSync(root);
  const canonicalAncestor = fs.realpathSync(existingAncestor);
  const unresolvedSuffix = path.relative(existingAncestor, destination);
  const canonicalDestination = path.resolve(canonicalAncestor, unresolvedSuffix);
  if (!isWithin(canonicalRoot, canonicalDestination) || canonicalDestination === canonicalRoot) {
    throw new Error(`Ace 输出目录经规范化后逃逸项目根目录：${destination}`);
  }
  const nodeModulesStat = fs.lstatSync(sourceNodeModules, { throwIfNoEntry: false });
  if (nodeModulesStat?.isDirectory()) {
    const canonicalNodeModules = fs.realpathSync(sourceNodeModules);
    if (isWithin(canonicalNodeModules, canonicalDestination)) {
      throw new Error(`Ace 输出目录经规范化后位于 node_modules 内部：${destination}`);
    }
  }
  const destinationStat = fs.lstatSync(destination, { throwIfNoEntry: false });
  if (destinationStat && (!destinationStat.isDirectory() || destinationStat.isSymbolicLink())) {
    throw new Error(`Ace 输出目标必须是普通目录或尚不存在：${destination}`);
  }
  return destination;
}

function safeLicenseNoticeName(name, version) {
  const safeName = name.replace(/^@/, "").replace(/\//g, "__").replace(/[^a-z0-9._-]/gi, "_");
  const safeVersion = version.replace(/[^a-z0-9._-]/gi, "_");
  if (!safeName || !safeVersion) throw new Error(`无法生成安全许可证通知文件名：${name}@${version}`);
  return `${safeName}@${safeVersion}.txt`;
}

function normalizeLicense(manifest) {
  const license = manifest.license;
  if (typeof license !== "string" || license.trim() === "" ||
      license.trim().toUpperCase() === "UNKNOWN") {
    throw new Error(`${manifest.name}@${manifest.version} 缺少可识别的 package.json license`);
  }
  return license.trim();
}

function metadataJson(value) {
  return JSON.stringify(value ?? null);
}

function generatedLicenseNotice(manifest, canonicalUrl) {
  return [
    "Oak Manuscript staged dependency license metadata notice",
    "",
    "This generated notice is used because the installed npm package did not include a license file.",
    "It is not an original license file and does not assert any copyright holder.",
    "Formal distribution requires a separate audit against the upstream package and canonical license.",
    "",
    `Package: ${manifest.name}`,
    `Version: ${manifest.version}`,
    `Declared license expression: ${manifest.license}`,
    `Author metadata (verbatim JSON): ${metadataJson(manifest.author)}`,
    `Repository metadata (verbatim JSON): ${metadataJson(manifest.repository)}`,
    `Homepage metadata (verbatim JSON): ${metadataJson(manifest.homepage)}`,
    `Canonical license reference: ${canonicalUrl}`,
    "Formal license audit required: true",
    "",
  ].join("\n");
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function writeThirdPartyNotices(stagedRoot, packageRecords, auditRecords) {
  const packages = packageRecords.map((item) => ({
    name: item.name,
    version: item.version,
    license: item.license,
    license_url: item.license_url,
    license_source: item.license_source,
    license_files: item.license_files,
    license_notice_files: item.license_notice_files,
    path: item.path,
  }));
  const notice = {
    schema_version: "1.0",
    formal_license_audit_required: auditRecords.length > 0,
    packages_requiring_formal_license_audit: auditRecords,
    packages,
  };
  fs.writeFileSync(
    path.join(stagedRoot, "THIRD_PARTY_NOTICES.json"),
    `${JSON.stringify(notice, null, 2)}\n`,
    "utf8",
  );

  const lines = [
    "# Third-party dependency notices",
    "",
    "This inventory is generated from the staged production dependency closure.",
    "It does not replace original upstream license files or a formal release audit.",
    "",
  ];
  if (auditRecords.length > 0) {
    lines.push(
      "## Formal-sale blocker",
      "",
      `${auditRecords.length} package record(s) lack an original license file in the installed npm package.`,
      "Generated metadata notices are sufficient for alpha traceability only; obtain and verify upstream license materials before a saleable release.",
      "",
    );
  }
  lines.push(
    "| Package | Version | Declared license | Source | Original license files | Generated notice files |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const item of packages) {
    lines.push(
      `| ${markdownCell(item.name)} | ${markdownCell(item.version)} | ${markdownCell(item.license)}`
      + ` | ${markdownCell(item.license_source)} | ${markdownCell(item.license_files.join(", "))}`
      + ` | ${markdownCell(item.license_notice_files.join(", "))} |`,
    );
  }
  lines.push("");
  fs.writeFileSync(path.join(stagedRoot, "THIRD_PARTY_NOTICES.md"), `${lines.join("\n")}\n`, "utf8");
  return notice;
}

function applySandboxPatch(stagedRoot, packageRecords) {
  const targetPackages = packageRecords.filter(
    (item) => item.name === SANDBOX_PATCH.package_name,
  );
  if (targetPackages.length !== 1) {
    throw new Error(
      `安全补丁目标包必须唯一：${SANDBOX_PATCH.package_name}`
      + `（实际 ${targetPackages.length} 个）`,
    );
  }
  const [targetPackage] = targetPackages;
  if (targetPackage.version !== SANDBOX_PATCH.package_version) {
    throw new Error(
      `安全补丁仅支持 ${SANDBOX_PATCH.package_name}@${SANDBOX_PATCH.package_version}`
      + `，实际为 ${targetPackage.version}`,
    );
  }
  const target = path.join(
    stagedRoot,
    ...targetPackage.path.split("/"),
    ...SANDBOX_PATCH.relative_file.split("/"),
  );
  if (!isFile(target)) {
    throw new Error(
      `安全补丁目标文件缺失：${targetPackage.path}/${SANDBOX_PATCH.relative_file}`,
    );
  }
  const sanitizerPackages = packageRecords.filter(
    (item) => item.name === SANDBOX_PATCH.sanitizer_package,
  );
  if (sanitizerPackages.length !== 1
      || sanitizerPackages[0].version !== SANDBOX_PATCH.sanitizer_version) {
    throw new Error(
      `受控替换要求唯一的 ${SANDBOX_PATCH.sanitizer_package}`
      + `@${SANDBOX_PATCH.sanitizer_version}，实际为 `
      + `${sanitizerPackages.map((item) => `${item.name}@${item.version}`).join(", ") || "缺失"}`,
    );
  }
  const [sanitizerPackage] = sanitizerPackages;
  const targetPackageJson = path.join(
    stagedRoot,
    ...targetPackage.path.split("/"),
    "package.json",
  );
  const targetManifest = readJson(targetPackageJson);
  targetManifest.dependencies = {
    ...(targetManifest.dependencies || {}),
    [SANDBOX_PATCH.sanitizer_package]: SANDBOX_PATCH.sanitizer_version,
  };
  fs.writeFileSync(targetPackageJson, `${JSON.stringify(targetManifest, null, 2)}\n`, "utf8");
  targetPackage.dependencies[SANDBOX_PATCH.sanitizer_package] = {
    name: sanitizerPackage.name,
    version: sanitizerPackage.version,
    source_path: sanitizerPackage.path.replace(/^node_modules\//, ""),
  };
  const beforeSha256 = sha256File(target);
  if (beforeSha256 !== SANDBOX_PATCH.before_sha256) {
    throw new Error(
      `安全补丁源哈希不匹配：期望 ${SANDBOX_PATCH.before_sha256}，实际 ${beforeSha256}`,
    );
  }
  const replacementSource = path.join(
    __dirname,
    ...SANDBOX_PATCH.replacement_source.replace(/^scripts\//, "").split("/"),
  );
  if (!isFile(replacementSource)) {
    throw new Error(`Ace 受控替换文件缺失：${SANDBOX_PATCH.replacement_source}`);
  }
  // Git may check tracked JavaScript out with CRLF on Windows. Pin and stage
  // canonical LF bytes so the controlled replacement hash is cross-platform.
  const replacement = canonicalTextFile(replacementSource);
  const replacementSha256 = sha256Text(replacement);
  if (replacementSha256 !== SANDBOX_PATCH.after_sha256) {
    throw new Error(
      `Ace 受控替换文件哈希不匹配：期望 ${SANDBOX_PATCH.after_sha256}`
      + `，实际 ${replacementSha256}`,
    );
  }
  fs.writeFileSync(target, replacement, "utf8");
  const afterSha256 = sha256File(target);
  if (afterSha256 !== SANDBOX_PATCH.after_sha256) {
    throw new Error(
      `安全补丁结果哈希不匹配：期望 ${SANDBOX_PATCH.after_sha256}，实际 ${afterSha256}`,
    );
  }
  return {
    patch_id: SANDBOX_PATCH.patch_id,
    target_package: targetPackage.name,
    target_version: targetPackage.version,
    target_file: `${targetPackage.path}/${SANDBOX_PATCH.relative_file}`,
    before_sha256: beforeSha256,
    after_sha256: afterSha256,
    controlled_replacement: SANDBOX_PATCH.replacement_source,
    sanitizer: {
      package_name: SANDBOX_PATCH.sanitizer_package,
      package_version: SANDBOX_PATCH.sanitizer_version,
    },
    effect: [
      "Windows/macOS 保持 Chromium sandbox；作者 XHTML 在 JavaScript 禁用状态下解析并剥离可执行节点/属性；",
      "仅放行 EPUB basedir 内 file: 与必要 data:/blob:/about: 请求；抑制 Chromium 后台联网。",
      "受控浏览器二进制与 OS 级网络隔离仍是正式发布阻断项。",
    ].join(""),
  };
}

function listFiles(root, excluded = new Set()) {
  const files = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => compareText(a.name, b.name))) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (excluded.has(relative)) continue;
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        files.push({ path: relative, size_bytes: stat.size, sha256: sha256File(full) });
      }
    }
  }
  visit(root);
  return files.sort((a, b) => compareText(a.path, b.path));
}

function replaceDirectoryAtomically(staged, destination, commit = null) {
  const backup = `${destination}.previous-${process.pid}-${Date.now()}`;
  const hadDestination = fs.existsSync(destination);
  let installed = false;
  let committed = false;
  try {
    if (hadDestination) fs.renameSync(destination, backup);
    fs.renameSync(staged, destination);
    installed = true;
    if (commit) commit();
    committed = true;
  } catch (error) {
    const rollbackErrors = [];
    if (installed && fs.existsSync(destination)) {
      try {
        fs.rmSync(destination, { recursive: true, force: true });
      } catch (rollbackError) {
        rollbackErrors.push(`无法移除未提交的新 stage：${rollbackError.message}`);
      }
    }
    if (hadDestination && fs.existsSync(backup) && !fs.existsSync(destination)) {
      try {
        fs.renameSync(backup, destination);
      } catch (rollbackError) {
        rollbackErrors.push(`无法恢复原 stage：${rollbackError.message}`);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new Error(`${error.message}；事务回滚失败：${rollbackErrors.join("；")}`);
    }
    throw error;
  } finally {
    if (fs.existsSync(staged)) fs.rmSync(staged, { recursive: true, force: true });
    // 目录和 lock 都提交后，旧目录仅是可清理备份。清理失败不得破坏
    // 已一致的新 stage/lock，也不得误删用于失败恢复的 backup。
    if (committed && fs.existsSync(backup)) {
      try {
        fs.rmSync(backup, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; a future stage may remove the stale backup.
      }
    }
  }
}

function stageAce({ projectRoot, outDir, rootPackage = ROOT_PACKAGE, updateLock = false }) {
  const root = path.resolve(projectRoot);
  const destination = validateStageDestination(root, outDir);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const staged = fs.mkdtempSync(
    path.join(path.dirname(destination), `.${path.basename(destination)}.stage-`),
  );
  try {
    const closure = collectProductionClosure(root, rootPackage);
    const packageRecords = [];
    const auditRecords = [];
    const generatedNotices = new Map();
    for (const item of closure) {
      const packageDestination = path.join(
        staged,
        "node_modules",
        ...item.relativeSource.split("/"),
      );
      const copied = copyPackage(item.sourceDirectory, packageDestination);
      const license = normalizeLicense(item.manifest);
      let licenseFiles = copied.filter((file) =>
        LICENSE_FILE_PATTERN.test(path.basename(file)),
      );
      const emptyLicense = licenseFiles.find((file) =>
        fs.statSync(path.join(packageDestination, ...file.split("/"))).size <= 0,
      );
      if (emptyLicense) {
        throw new Error(
          `${item.manifest.name}@${item.manifest.version} 的许可证文件为空：${emptyLicense}`,
        );
      }
      let licenseNoticeFiles = [];
      let licenseSource = "package-file";
      const licenseUrl = GENERATED_LICENSE_URLS[license] || null;
      if (licenseFiles.length === 0) {
        if (!licenseUrl) {
          throw new Error(
            `${item.manifest.name}@${item.manifest.version} 未附许可证文件，`
            + `且不支持为声明 ${license} 生成元数据通知`,
          );
        }
        const noticePath = `licenses/${safeLicenseNoticeName(
          item.manifest.name,
          item.manifest.version,
        )}`;
        const notice = generatedLicenseNotice(
          { ...item.manifest, license },
          licenseUrl,
        );
        const previous = generatedNotices.get(noticePath);
        if (previous !== undefined && previous !== notice) {
          throw new Error(`许可证通知文件名冲突且元数据不同：${noticePath}`);
        }
        if (previous === undefined) {
          fs.mkdirSync(path.dirname(path.join(staged, noticePath)), { recursive: true });
          fs.writeFileSync(path.join(staged, noticePath), notice, "utf8");
          generatedNotices.set(noticePath, notice);
        }
        licenseFiles = [];
        licenseNoticeFiles = [noticePath];
        licenseSource = "generated-metadata-notice";
        auditRecords.push({
          name: item.manifest.name,
          version: item.manifest.version,
          license,
          path: `node_modules/${item.relativeSource}`,
          license_notice: noticePath,
        });
      }
      packageRecords.push({
        name: item.manifest.name,
        version: item.manifest.version,
        license,
        license_url: licenseUrl,
        license_source: licenseSource,
        path: `node_modules/${item.relativeSource}`,
        license_files: licenseFiles,
        license_notice_files: licenseNoticeFiles,
        dependencies: item.resolvedDependencies,
        missing_optional_dependencies: item.missingOptionalDependencies,
      });
    }

    const launcher = [
      "#!/usr/bin/env node",
      '"use strict";',
      'require("./node_modules/@daisy/ace-cli/bin/ace.js");',
      "",
    ].join("\n");
    const launcherPath = path.join(staged, "ace.js");
    fs.writeFileSync(launcherPath, launcher, { encoding: "utf8", mode: 0o755 });
    const launcherHash = sha256File(launcherPath);
    if (launcherHash !== ACE_LAUNCHER_SHA256) {
      throw new Error(
        `Ace 固定启动器哈希不匹配：期望 ${ACE_LAUNCHER_SHA256}，实际 ${launcherHash}`,
      );
    }

    const sandboxPatch = applySandboxPatch(staged, packageRecords);
    const thirdPartyNotice = writeThirdPartyNotices(staged, packageRecords, auditRecords);
    const files = listFiles(staged, new Set(["manifest.json"]));
    const rootRecord = packageRecords.find((item) => item.name === rootPackage);
    if (!rootRecord) throw new Error(`阶段化结果缺少根包：${rootPackage}`);
    const manifest = {
      schema_version: "1.0",
      root_package: { name: rootPackage, version: rootRecord.version },
      entry: "ace.js",
      package_count: packageRecords.length,
      file_count: files.length,
      total_bytes: files.reduce((sum, file) => sum + file.size_bytes, 0),
      formal_license_audit_required: thirdPartyNotice.formal_license_audit_required,
      packages_requiring_formal_license_audit: auditRecords,
      third_party_notices: {
        markdown: "THIRD_PARTY_NOTICES.md",
        json: "THIRD_PARTY_NOTICES.json",
      },
      packages: packageRecords.sort((a, b) => compareText(
        `${a.name}@${a.version}:${a.path}`,
        `${b.name}@${b.version}:${b.path}`,
      )),
      patches: [sandboxPatch],
      files,
      excluded: [
        "@daisy/ace（聚合包，不在 ace-cli production closure 中）",
        "electron（使用宿主 Electron 的 Node 模式，不阶段化嵌套 Electron）",
        "Puppeteer 下载的浏览器缓存（运行时仅使用用户系统 Chrome）",
        "所有 devDependencies",
      ],
    };
    const stageManifestTarget = path.join(staged, "manifest.json");
    fs.writeFileSync(stageManifestTarget, canonicalJson(manifest), "utf8");
    if (!updateLock) verifyAceStageLock(root, manifest, stageManifestTarget);
    replaceDirectoryAtomically(
      staged,
      destination,
      updateLock ? () => writeAceStageLock(root, manifest) : null,
    );
    return manifest;
  } catch (error) {
    fs.rmSync(staged, { recursive: true, force: true });
    throw error;
  }
}

function parseArgs(argv) {
  const options = { updateLock: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--project-root" || flag === "--out") {
      if (!argv[index + 1]) throw new Error(`${flag} 缺少路径参数`);
      options[flag === "--project-root" ? "projectRoot" : "outDir"] = argv[index + 1];
      index += 1;
    } else if (flag === "--update-lock") {
      options.updateLock = true;
    } else {
      throw new Error(`未知参数：${flag}`);
    }
  }
  return options;
}

if (require.main === module) {
  try {
    const repo = path.resolve(__dirname, "..");
    const args = parseArgs(process.argv.slice(2));
    const manifest = stageAce({
      projectRoot: args.projectRoot ? path.resolve(args.projectRoot) : repo,
      outDir: args.outDir ? path.resolve(args.outDir) : path.join(repo, "tools", "ace"),
      updateLock: args.updateLock,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      package_count: manifest.package_count,
      file_count: manifest.file_count,
      total_bytes: manifest.total_bytes,
      root_package: manifest.root_package,
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Ace 阶段化失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ROOT_PACKAGE,
  ACE_LOCK_SCHEMA_VERSION,
  ACE_LOCK_TYPE,
  ACE_LAUNCHER_SHA256,
  SANDBOX_PATCH,
  aceLockRelative,
  applySandboxPatch,
  buildAceLock,
  collectProductionClosure,
  dependencyRequests,
  replaceDirectoryAtomically,
  stageAce,
  validateStageDestination,
  verifyAceStageLock,
  writeAceStageLock,
};
