// 路径策略：集中解析应用资源路径与写入范围校验（方案 §12.2）。
// 打包后资源在 process.resourcesPath；开发期直接用仓库目录。

"use strict";

const path = require("path");
const fs = require("fs");
const { app } = require("electron");

function repoRoot() {
  // 开发期：electron . 的 appPath 即仓库根
  return app.getAppPath();
}

function resourcesRoot() {
  return app.isPackaged ? process.resourcesPath : repoRoot();
}

function pythonDir() {
  return path.join(resourcesRoot(), "python");
}

function configDir() {
  return path.join(resourcesRoot(), "config");
}

function samplesDir() {
  return path.join(resourcesRoot(), "samples");
}

function toolsDir() {
  return path.join(resourcesRoot(), "tools");
}

// sidecar Python：打包版优先用捆绑的嵌入式运行时，其次系统 python
function pythonExecutable() {
  const bundled = path.join(resourcesRoot(), "python-runtime", "python.exe");
  if (fs.existsSync(bundled)) return bundled;
  return "python";
}

// 校验目标路径位于 base 之内（防目录逃逸；解析真实路径后前缀比较）
function isWithin(base, candidate) {
  const resolvedBase = path.resolve(base) + path.sep;
  const resolved = path.resolve(candidate);
  return (resolved + path.sep).startsWith(resolvedBase) || resolved === path.resolve(base);
}

// 项目目录合法性：包含 project.json
function looksLikeProject(dir) {
  try {
    return fs.existsSync(path.join(dir, "project.json"));
  } catch {
    return false;
  }
}

module.exports = {
  repoRoot,
  resourcesRoot,
  pythonDir,
  configDir,
  samplesDir,
  toolsDir,
  pythonExecutable,
  isWithin,
  looksLikeProject,
};
