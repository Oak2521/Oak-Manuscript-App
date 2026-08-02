// 由 Electron 主进程以固定参数启动本机 Chrome；Ace utilityProcess 仅通过
// 随机 loopback DevTools endpoint 连接，避免 utility 进程在 Windows job 中再派生浏览器。

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 10_000;
const SECURITY_ARGS = Object.freeze([
  "--disable-background-networking",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-domain-reliability",
  "--disable-extensions",
  "--disable-sync",
  "--host-resolver-rules=MAP * ~NOTFOUND",
  "--metrics-recording-only",
  "--no-first-run",
  "--no-pings",
  "--safebrowsing-disable-auto-update",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
]);

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function sanitizedChromeEnvironment(source = process.env) {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const upper = key.toUpperCase();
    if (upper.startsWith("NODE_") || upper.startsWith("ELECTRON_") ||
        upper.startsWith("PUPPETEER_") || upper.startsWith("CHROME_") ||
        upper.startsWith("OAK_") || upper.startsWith("ACE_") ||
        new Set(["NPM_CONFIG_NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES",
          "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "SSLKEYLOGFILE"]).has(upper)) continue;
    result[key] = value;
  }
  return result;
}

function parseEndpoint(text) {
  const lines = String(text).trim().split(/\r?\n/u);
  if (lines.length !== 2 || !/^[1-9][0-9]{0,4}$/u.test(lines[0]) ||
      !/^\/devtools\/browser\/[0-9A-Za-z-]{8,128}$/u.test(lines[1])) {
    throw new Error("Chrome DevToolsActivePort 格式非法");
  }
  const port = Number(lines[0]);
  if (!Number.isSafeInteger(port) || port > 65535) throw new Error("Chrome DevTools 端口非法");
  return `ws://127.0.0.1:${port}${lines[1]}`;
}

async function stopChild(child, timeoutMs = STOP_TIMEOUT_MS) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try { child.kill(); } catch { /* 后续超时仍会明确失败 */ }
  let timer = null;
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
  ]);
  if (timer !== null) clearTimeout(timer);
  if (!stopped) throw new Error("受控 Chrome 未在限定时间内退出");
}

function createChromeController({ spawnImpl = spawn } = {}) {
  if (typeof spawnImpl !== "function") throw new TypeError("Chrome spawn 控制器非法");
  return Object.freeze({
    async launch({ chrome, profile, environment = process.env } = {}) {
      if (typeof chrome !== "string" || !path.isAbsolute(chrome) ||
          typeof profile !== "string" || !path.isAbsolute(profile)) {
        throw new Error("Chrome 与 profile 必须是绝对路径");
      }
      const endpointFile = path.join(profile, "DevToolsActivePort");
      const args = [
        "--headless=new",
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        ...SECURITY_ARGS,
        "about:blank",
      ];
      const child = spawnImpl(chrome, args, {
        env: sanitizedChromeEnvironment(environment),
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      });
      if (!child || typeof child.once !== "function" || typeof child.kill !== "function") {
        throw new Error("Chrome 启动器未返回有效子进程");
      }
      const deadline = Date.now() + START_TIMEOUT_MS;
      try {
        while (Date.now() < deadline) {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw new Error("受控 Chrome 在 DevTools 就绪前退出");
          }
          const stat = fs.lstatSync(endpointFile, { throwIfNoEntry: false });
          if (stat) {
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 10 || stat.size > 1024) {
              throw new Error("Chrome DevToolsActivePort 文件不安全");
            }
            const real = fs.realpathSync.native(endpointFile);
            if (real !== endpointFile) throw new Error("Chrome DevToolsActivePort 经过链接重定向");
            return Object.freeze({
              endpoint: parseEndpoint(fs.readFileSync(endpointFile, "utf8")),
              async stop() { await stopChild(child); },
            });
          }
          await delay(50);
        }
        throw new Error(`受控 Chrome 启动超时（${START_TIMEOUT_MS} 毫秒）`);
      } catch (error) {
        await stopChild(child).catch(() => {});
        throw error;
      }
    },
  });
}

module.exports = {
  SECURITY_ARGS,
  createChromeController,
  parseEndpoint,
  sanitizedChromeEnvironment,
};
