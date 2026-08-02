"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(__dirname, "..");
const CLIENT_PAGE = path.join(ROOT, "web", "client", "index.html");
const OUTPUT_ROOT = path.join(ROOT, "out", "web-client-smoke");
const DEVICE = "device-10000000-0000-4000-8000-000000000001";
const DEVICE_TWO = "device-20000000-0000-4000-8000-000000000002";
const CHROME_CANDIDATES = process.platform === "win32" ? [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
] : process.platform === "darwin" ? [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
] : ["/usr/bin/google-chrome", "/usr/bin/chromium"];

function findChrome() {
  const executable = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("WEB-CLIENT-SMOKE: supported Chrome not found");
  return executable;
}

function fixtureScript() {
  return ({ deviceId, deviceTwo }) => {
    const entitlement = {
      entitlement_state: "active",
      not_before: "2026-07-01T00:00:00.000Z",
      valid_until: "2026-08-01T00:00:00.000Z",
      grace_until: "2026-08-08T00:00:00.000Z",
    };
    const activeDevice = {
      device_id: deviceId, device_state: "active",
      first_seen_at: "2026-07-20T00:00:00.000Z",
      last_seen_at: "2026-07-29T11:00:00.000Z", revoked_at: null,
    };
    const revokedDevice = {
      device_id: deviceTwo, device_state: "revoked",
      first_seen_at: "2026-07-10T00:00:00.000Z",
      last_seen_at: "2026-07-21T11:00:00.000Z",
      revoked_at: "2026-07-21T12:00:00.000Z",
    };
    window.oblAuth = {
      enabled: true,
      async getSession() { return { access_token: "anonymous-smoke-token" }; },
      client: { auth: { onAuthStateChange() {} } },
    };
    window.fetch = async function (requestPath, options) {
      if (requestPath === "/manuscript/api/v1/sync-records" && options.method === "GET") {
        return new Response(JSON.stringify({ schema_version: "1.0", items: [], truncated: false }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (requestPath === "/manuscript/api/v1/account/license" && options.method === "GET") {
        return new Response(JSON.stringify({
          schema_version: "1.0", account_type: "oak_manuscript_license_account",
          entitlement, devices: [activeDevice, revokedDevice], truncated: false,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (requestPath.endsWith("/revoke") && options.method === "POST") {
        return new Response(JSON.stringify({
          schema_version: "1.0", outcome: "revoked",
          device: {
            ...activeDevice, device_state: "revoked",
            last_seen_at: "2026-07-29T12:00:00.000Z",
            revoked_at: "2026-07-29T12:00:00.000Z",
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error("unexpected smoke request");
    };
    document.dispatchEvent(new Event("obl-auth-ready"));
  };
}

async function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: findChrome(), headless: true,
    args: ["--disable-background-networking", "--disable-extensions", "--disable-gpu", "--no-first-run"],
  });
  let forbiddenNetworkRequests = 0;
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (/^https?:/u.test(request.url())) {
        forbiddenNetworkRequests += 1;
        request.abort();
      } else request.continue();
    });
    await page.setViewport({ width: 1440, height: 1100, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(CLIENT_PAGE).href, { waitUntil: "load" });
    await page.evaluate(fixtureScript(), { deviceId: DEVICE, deviceTwo: DEVICE_TWO });
    await page.waitForFunction(() => {
      const panel = document.getElementById("license-account-panel");
      return panel && !panel.hidden && document.querySelectorAll(".license-device-item").length === 2;
    });
    const before = await page.evaluate((fullDeviceId) => ({
      status: document.getElementById("license-account-status").textContent,
      cards: document.querySelectorAll(".license-device-item").length,
      activeButtons: Array.from(document.querySelectorAll(".license-device-item button")).filter((button) => !button.disabled).length,
      leaksFullDeviceId: document.body.textContent.includes(fullDeviceId),
    }), DEVICE);
    if (!before.status.includes("Pro 订阅有效") || before.cards !== 2 || before.activeButtons !== 1 || before.leaksFullDeviceId) {
      throw new Error("WEB-CLIENT-SMOKE: initial account UI mismatch");
    }
    await page.screenshot({ path: path.join(OUTPUT_ROOT, "desktop.png"), fullPage: true });
    page.once("dialog", async (dialog) => dialog.accept());
    await page.click(".license-device-item button:not([disabled])");
    await page.waitForFunction(() => document.getElementById("license-account-status").textContent.includes("设备已撤销"));
    const after = await page.evaluate(() => ({
      status: document.getElementById("license-account-status").textContent,
      activeButtons: Array.from(document.querySelectorAll(".license-device-item button")).filter((button) => !button.disabled).length,
    }));
    if (after.activeButtons !== 0) throw new Error("WEB-CLIENT-SMOKE: revoked device remained actionable");
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await page.screenshot({ path: path.join(OUTPUT_ROOT, "mobile.png"), fullPage: true });
    if (forbiddenNetworkRequests !== 0) throw new Error("WEB-CLIENT-SMOKE: external network request attempted");
    process.stdout.write(JSON.stringify({
      ok: true,
      desktop: path.relative(ROOT, path.join(OUTPUT_ROOT, "desktop.png")).replaceAll(path.sep, "/"),
      mobile: path.relative(ROOT, path.join(OUTPUT_ROOT, "mobile.png")).replaceAll(path.sep, "/"),
      forbidden_network_requests: forbiddenNetworkRequests,
      before, after,
    }, null, 2) + "\nWEB-CLIENT-SMOKE: PASS\n");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write((error && error.stack ? error.stack : String(error)) + "\n");
  process.exitCode = 1;
});
