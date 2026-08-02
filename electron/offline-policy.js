"use strict";

// The default Electron session is deliberately offline. Future user-authorized
// network providers must use a separately scoped transport/session instead of
// weakening this process-wide baseline.
const OFFLINE_CHROMIUM_SWITCHES = Object.freeze([
  "disable-background-networking",
  "disable-component-update",
  "disable-default-apps",
  "disable-domain-reliability",
  "disable-sync",
  "metrics-recording-only",
  "no-first-run",
  "no-pings",
]);

const BLOCKED_NETWORK_PATTERNS = Object.freeze([
  "http://*/*",
  "https://*/*",
  "ws://*/*",
  "wss://*/*",
  "ftp://*/*",
]);

function applyOfflineChromiumPolicy(commandLine) {
  if (!commandLine || typeof commandLine.appendSwitch !== "function") {
    throw new Error("Electron commandLine 不可用，无法应用默认离线策略");
  }
  for (const name of OFFLINE_CHROMIUM_SWITCHES) commandLine.appendSwitch(name);
}

function installOfflineRequestBlocker(webRequest) {
  if (!webRequest || typeof webRequest.onBeforeRequest !== "function") {
    throw new Error("Electron webRequest 不可用，无法安装默认离线门禁");
  }
  webRequest.onBeforeRequest(
    { urls: [...BLOCKED_NETWORK_PATTERNS] },
    (_details, callback) => callback({ cancel: true }),
  );
}

module.exports = {
  BLOCKED_NETWORK_PATTERNS,
  OFFLINE_CHROMIUM_SWITCHES,
  applyOfflineChromiumPolicy,
  installOfflineRequestBlocker,
};
