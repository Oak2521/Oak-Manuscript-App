// Provider 适配层（方案 §11.4）。Auth/License/Sync 当前不发起网络请求；
// Evaluation 只返回固定 URL，由 main 在用户点击后校验白名单并交给系统浏览器。

"use strict";

const AuthProvider = {
  // 网站用户系统（Supabase）上线并合并后替换为真实实现（PKCE）
  status() {
    return { state: "coming_soon", loggedIn: false, message: "湖岸账号即将开放" };
  },
};

const SyncProvider = {
  // 占位：偏好只存于当前进程；未登录永不询问、永不发送（§8.5）
  _preference: "never_asked",
  getPreference() {
    return this._preference;
  },
  setPreference(value) {
    const allowed = ["never_asked", "off", "ask_each_time", "always"];
    if (allowed.includes(value)) this._preference = value;
    return this._preference;
  },
};

const LicenseProvider = {
  status() {
    return { tier: "local_free", locked: false, message: "本地免费模式；本地文件永不因授权而锁定" };
  },
};

const EvaluationProvider = {
  // 第一阶段：仅允许打开网站公开页面（外链白名单在 main 中强制）
  evaluationUrl() {
    return "https://oakbylake.com/free-manuscript-check/?utm_source=oak-manuscript-app&intent=evaluation";
  },
};

module.exports = { AuthProvider, SyncProvider, LicenseProvider, EvaluationProvider };
