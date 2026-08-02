"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const MIGRATION_ROOT_RELATIVE = "web/supabase";
const MANIFEST_NAME = "migrations-v1.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FILENAME_PATTERN = /^([0-9]{3})_[a-z0-9_]+\.sql$/u;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label}必须是对象`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label}字段集合非法`);
  }
  return value;
}

function safeRegularFile(target, label) {
  const info = fs.lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1) {
    throw new Error(`${label}必须是非空、非链接、单链接常规文件`);
  }
  return info;
}

function readStrictJson(target) {
  const bytes = fs.readFileSync(target);
  const text = bytes.toString("utf8");
  if (Buffer.from(text, "utf8").compare(bytes) !== 0 || text.includes("\r")) {
    throw new Error("迁移 manifest 必须是 UTF-8/LF");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("迁移 manifest 不是有效 JSON");
  }
  if (canonicalBytes(value).compare(bytes) !== 0) throw new Error("迁移 manifest 不是 canonical JSON");
  return { bytes, value };
}

function verifyWebMigrationBundle(root = REPO_ROOT) {
  const projectRoot = path.resolve(root);
  const migrationRoot = path.join(projectRoot, ...MIGRATION_ROOT_RELATIVE.split("/"));
  const directoryInfo = fs.lstatSync(migrationRoot);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("迁移根目录不安全");
  }
  const manifestPath = path.join(migrationRoot, MANIFEST_NAME);
  safeRegularFile(manifestPath, "迁移 manifest");
  const { bytes: manifestBytes, value: manifest } = readStrictJson(manifestPath);
  exactKeys(manifest, ["schema_version", "bundle_type", "migrations"], "迁移 manifest");
  if (manifest.schema_version !== "1.0" ||
      manifest.bundle_type !== "oak_manuscript_supabase_migrations" ||
      !Array.isArray(manifest.migrations) || manifest.migrations.length < 1 ||
      manifest.migrations.length > 100) {
    throw new Error("迁移 manifest 身份或数量非法");
  }

  const diskSql = fs.readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".sql"))
    .map((entry) => {
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`迁移文件类型非法：${entry.name}`);
      return entry.name;
    })
    .sort();
  const verified = [];
  for (let index = 0; index < manifest.migrations.length; index += 1) {
    const entry = exactKeys(manifest.migrations[index],
      ["sequence", "filename", "size_bytes", "sha256"], `迁移 ${index + 1}`);
    const expectedSequence = index + 1;
    const match = typeof entry.filename === "string" ? FILENAME_PATTERN.exec(entry.filename) : null;
    if (entry.sequence !== expectedSequence || !match || Number(match[1]) !== expectedSequence ||
        !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 1 ||
        typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)) {
      throw new Error(`迁移 ${expectedSequence} 身份非法`);
    }
    const target = path.join(migrationRoot, entry.filename);
    const info = safeRegularFile(target, `迁移 ${entry.filename}`);
    const sqlBytes = fs.readFileSync(target);
    const sql = sqlBytes.toString("utf8");
    if (Buffer.from(sql, "utf8").compare(sqlBytes) !== 0 || sql.includes("\r") ||
        !/(?:^|\n)begin;\n/iu.test(sql) || !/\ncommit;\n$/iu.test(sql)) {
      throw new Error(`迁移 ${entry.filename} 不是完整 UTF-8/LF 事务`);
    }
    if (info.size !== entry.size_bytes || sha256(sqlBytes) !== entry.sha256) {
      throw new Error(`迁移 ${entry.filename} 与 manifest 不一致`);
    }
    verified.push(Object.freeze({ ...entry }));
  }
  if (diskSql.length !== verified.length ||
      diskSql.some((filename, index) => filename !== verified[index].filename)) {
    throw new Error("迁移目录含未锁定、缺失或乱序 SQL 文件");
  }
  return Object.freeze({
    ok: true,
    schema_version: "1.0",
    bundle_type: manifest.bundle_type,
    manifest_path: `${MIGRATION_ROOT_RELATIVE}/${MANIFEST_NAME}`,
    manifest_sha256: sha256(manifestBytes),
    migration_count: verified.length,
    migrations: Object.freeze(verified),
  });
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 0) throw new Error("迁移 bundle 验证器不接受参数");
  process.stdout.write(`${JSON.stringify(verifyWebMigrationBundle(), null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "迁移 bundle 验证失败"}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  MANIFEST_NAME,
  MIGRATION_ROOT_RELATIVE,
  canonicalBytes,
  verifyWebMigrationBundle,
};
