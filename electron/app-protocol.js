"use strict";

const fs = require("fs");
const path = require("path");

const APP_SCHEME = "oak-manuscript";
const APP_HOST = "renderer";
const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;
const APP_ASSETS = Object.freeze(new Map([
  ["/index.html", Object.freeze({ file: "index.html", contentType: "text/html; charset=utf-8" })],
  ["/styles.css", Object.freeze({ file: "styles.css", contentType: "text/css; charset=utf-8" })],
  ["/p0-ui-model.js", Object.freeze({
    file: "p0-ui-model.js",
    contentType: "text/javascript; charset=utf-8",
  })],
  ["/app.js", Object.freeze({ file: "app.js", contentType: "text/javascript; charset=utf-8" })],
]));

function registerAppSchemeAsPrivileged(protocolApi) {
  if (!protocolApi || typeof protocolApi.registerSchemesAsPrivileged !== "function") {
    throw new Error("Electron protocol API 不可用，无法注册应用协议");
  }
  protocolApi.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  }]);
}

function resolveAppResource(requestUrl, rendererRoot) {
  if (typeof rendererRoot !== "string" || !path.isAbsolute(rendererRoot)) {
    throw new Error("应用渲染资源根必须是绝对路径");
  }
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    throw new Error("拒绝非法应用资源 URL");
  }
  if (parsed.protocol !== `${APP_SCHEME}:` || parsed.hostname !== APP_HOST ||
      parsed.username !== "" || parsed.password !== "" || parsed.port !== "" ||
      parsed.search !== "" || parsed.hash !== "") {
    throw new Error("拒绝不受支持的应用资源 URL");
  }
  const asset = APP_ASSETS.get(parsed.pathname);
  if (!asset) throw new Error("拒绝不受支持的应用资源路径");
  return {
    target: path.join(path.resolve(rendererRoot), asset.file),
    contentType: asset.contentType,
  };
}

function createAppProtocolHandler({
  rendererRoot,
  readFile = fs.promises.readFile,
  ResponseClass = globalThis.Response,
} = {}) {
  if (typeof readFile !== "function" || typeof ResponseClass !== "function") {
    throw new Error("应用协议读取器或 Response 实现不可用");
  }
  return async function appProtocolHandler(request) {
    try {
      const resource = resolveAppResource(request?.url, rendererRoot);
      const bytes = await readFile(resource.target);
      return new ResponseClass(bytes, {
        status: 200,
        headers: {
          "Content-Type": resource.contentType,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new ResponseClass("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  };
}

function installAppProtocol(protocolApi, rendererRoot) {
  if (!protocolApi || typeof protocolApi.handle !== "function") {
    throw new Error("Electron protocol API 不可用，无法安装应用协议");
  }
  const handler = createAppProtocolHandler({ rendererRoot });
  protocolApi.handle(APP_SCHEME, handler);
  return handler;
}

module.exports = {
  APP_ENTRY_URL,
  APP_HOST,
  APP_SCHEME,
  createAppProtocolHandler,
  installAppProtocol,
  registerAppSchemeAsPrivileged,
  resolveAppResource,
};
