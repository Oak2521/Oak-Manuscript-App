"use strict";
const http = require("node:http");
const TOKEN = /^[A-Za-z0-9_-]{43,128}$/u;
class LoopbackAuthListener {
  constructor({ pathNonce, expectedState, onCallback, onReject = () => {}, timeoutMs = 600000, httpImpl = http } = {}) {
    if (!TOKEN.test(pathNonce || "") || !TOKEN.test(expectedState || "") || typeof onCallback !== "function" || typeof onReject !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 600000) throw new TypeError("回环登录监听参数非法");
    this.pathNonce = pathNonce; this.expectedState = expectedState; this.onCallback = onCallback; this.onReject = onReject; this.timeoutMs = timeoutMs; this.http = httpImpl; this.server = null; this.timer = null; this.active = false; this.redirectUri = null;
  }
  async start() {
    if (this.active) throw new Error("回环登录监听已启动");
    this.server = this.http.createServer((req, res) => void this._request(req, res));
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve); });
    const address = this.server.address(); if (!address || address.address !== "127.0.0.1" || address.port < 1024 || address.port > 65535) { this.close(); throw new Error("回环登录监听未绑定安全地址"); }
    this.redirectUri = `http://127.0.0.1:${address.port}/application-login/callback/${this.pathNonce}`; this.active = true;
    this.timer = setTimeout(() => { this.close(); void this.onReject(new Error("账号回调监听已过期")); }, this.timeoutMs); this.timer.unref?.();
    return Object.freeze({ redirectUri: this.redirectUri });
  }
  async _request(req, res) {
    try {
      if (!this.active || req.method !== "GET") throw new Error("账号回调方法非法");
      const parsed = new URL(req.url, this.redirectUri); const expected = new URL(this.redirectUri);
      if (parsed.pathname !== expected.pathname || [...parsed.searchParams.keys()].sort().join("\0") !== ["code", "state"].sort().join("\0") || parsed.searchParams.getAll("code").length !== 1 || parsed.searchParams.getAll("state").length !== 1) throw new Error("账号回调路径或参数非法");
      const code = parsed.searchParams.get("code"); const state = parsed.searchParams.get("state"); if (!TOKEN.test(code || "") || !TOKEN.test(state || "") || state !== this.expectedState) throw new Error("账号回调参数非法");
      const redirectUri = this.redirectUri; this.close(); await this.onCallback({ code, state, redirectUri });
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); res.end("湖岸账号登录已完成，可以关闭此页面。");
    } catch (error) { this.close(); await this.onReject(error); res.writeHead(400, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); res.end("登录回调无效，请返回应用重试。"); }
  }
  close() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.active = false; const server = this.server; this.server = null; if (server) server.close(); }
}
module.exports = { LoopbackAuthListener };
