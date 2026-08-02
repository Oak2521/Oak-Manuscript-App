// Python 核心统一返回值判定：退出码 1 是“有问题但结果有效”，退出码 2+ 是运行失败。

"use strict";

function coreInvocationError(json, stderr, exitCode) {
  const raw = json && typeof json === "object" ? json.error : null;
  const structured = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  const message = structured?.message
    || (typeof raw === "string" ? raw : null)
    || (json && typeof json === "object" && typeof json.message === "string" ? json.message : null)
    || stderr
    || `检查核心运行失败（退出码 ${exitCode}）`;
  const error = new Error(String(message));
  if (structured && typeof structured.code === "string") error.code = structured.code;
  if (structured && typeof structured.retryable === "boolean") error.retryable = structured.retryable;
  if (structured) {
    const details = structured.details && typeof structured.details === "object"
      && !Array.isArray(structured.details) ? { ...structured.details } : {};
    for (const [key, value] of Object.entries(structured)) {
      if (!["code", "message", "retryable", "details"].includes(key)) details[key] = value;
    }
    if (Object.keys(details).length) error.details = details;
  }
  error.coreExitCode = exitCode;
  return error;
}

function toFailureResponse(error) {
  const response = { ok: false, error: String((error && error.message) || error) };
  if (error && typeof error.code === "string") response.code = error.code;
  if (error && typeof error.retryable === "boolean") response.retryable = error.retryable;
  if (error && Object.hasOwn(error, "details")) response.details = error.details;
  return response;
}

async function readCoreResult(resultPromise, { allowJsonFailureExitCodes = [] } = {}) {
  const { code, json, stderr } = await resultPromise;
  if (json === null || json === undefined) throw new Error(stderr || "核心无输出");

  const failedJson = json && typeof json === "object" && json.ok === false
    && !allowJsonFailureExitCodes.includes(code);
  // AD-002：0=成功，1=发现未处理问题但仍有有效 JSON，2=运行错误。
  const failedExit = !Number.isInteger(code) || (code !== 0 && code !== 1);
  if (failedJson || failedExit) {
    throw coreInvocationError(json, stderr, code);
  }
  return json;
}

function readCoreCommandResult(command, resultPromise) {
  // verify 的 exit 1 + ok:false 是完整性问题的有效业务结果；SHA 异常走 exit 2。
  const allowJsonFailureExitCodes = command === "verify" ? [1] : [];
  return readCoreResult(resultPromise, { allowJsonFailureExitCodes });
}

module.exports = { readCoreResult, readCoreCommandResult, toFailureResponse };
