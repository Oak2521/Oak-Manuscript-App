"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pathPolicy = require("../electron/path-policy");
const { BLOCKED_NETWORK_PATTERNS } = require("../electron/offline-policy");
const {
  PDF_REPORT_CSP,
  PDF_SESSION_PARTITION,
  createPdfPreview,
} = require("../electron/pdf-preview");

const TEST_OUTPUT_PARENT = path.resolve(__dirname, "../out/node-pdf-preview");

function makeProject(t) {
  fs.mkdirSync(TEST_OUTPUT_PARENT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TEST_OUTPUT_PARENT, "case-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  fs.mkdirSync(path.join(project, "exports"), { recursive: true });
  fs.writeFileSync(path.join(project, "project.json"), "{}\n");
  fs.writeFileSync(
    path.join(project, "exports", "report.html"),
    "<style>p{color:#234}</style><script>globalThis.reportScriptExecuted = true</script><p>report</p>\n",
  );
  return project;
}

test("PDF preview disables report JavaScript, denies navigation, and uses the guarded writer", async (t) => {
  const project = makeProject(t);
  const events = new Map();
  const callOrder = [];
  let instance;
  let requestFilter;
  let requestListener;
  let headersListener;
  let partitionCall;
  const pdfSession = {
    webRequest: {
      onBeforeRequest(filter, listener) {
        requestFilter = filter;
        requestListener = listener;
      },
      onHeadersReceived(listener) {
        headersListener = listener;
      },
    },
  };
  const session = {
    fromPartition(name, options) {
      partitionCall = { name, options };
      return pdfSession;
    },
  };

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.webContents = {
        setWindowOpenHandler: (handler) => {
          callOrder.push("window-open-handler");
          this.windowOpenHandler = handler;
        },
        on: (name, handler) => {
          callOrder.push(name);
          events.set(name, handler);
        },
        printToPDF: async (optionsForPrint) => {
          callOrder.push("print");
          this.printOptions = optionsForPrint;
          return Buffer.from("pdf-bytes");
        },
      };
      instance = this;
    }

    async loadFile(file) {
      callOrder.push("load");
      this.loadedFile = file;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const target = await createPdfPreview({
    BrowserWindow: FakeBrowserWindow,
    session,
    pathPolicy,
    project,
  });

  assert.equal(instance.options.show, false);
  assert.deepEqual(partitionCall, {
    name: PDF_SESSION_PARTITION,
    options: { cache: false },
  });
  assert.equal(instance.options.webPreferences.session, pdfSession);
  const { session: selectedSession, ...webPreferences } = instance.options.webPreferences;
  assert.equal(selectedSession, pdfSession);
  assert.deepEqual(webPreferences, {
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    javascript: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
  });
  assert.deepEqual(requestFilter, { urls: [...BLOCKED_NETWORK_PATTERNS] });
  let requestDecision;
  requestListener({ url: "https://example.invalid/report.css" }, (decision) => {
    requestDecision = decision;
  });
  assert.deepEqual(requestDecision, { cancel: true });

  let headerDecision;
  headersListener({ responseHeaders: { Existing: ["kept"] } }, (decision) => {
    headerDecision = decision;
  });
  assert.deepEqual(headerDecision.responseHeaders.Existing, ["kept"]);
  assert.deepEqual(headerDecision.responseHeaders["Content-Security-Policy"], [PDF_REPORT_CSP]);
  assert.match(PDF_REPORT_CSP, /style-src 'unsafe-inline'/);
  assert.match(PDF_REPORT_CSP, /script-src 'none'/);
  assert.match(PDF_REPORT_CSP, /connect-src 'none'/);
  assert.match(PDF_REPORT_CSP, /object-src 'none'/);
  assert.match(fs.readFileSync(instance.loadedFile, "utf8"), /<style>p\{color:#234\}<\/style>/);
  assert.deepEqual(instance.windowOpenHandler(), { action: "deny" });
  for (const eventName of ["will-navigate", "will-redirect"]) {
    let prevented = false;
    events.get(eventName)({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true, `${eventName} must be denied`);
  }
  assert.ok(callOrder.indexOf("window-open-handler") < callOrder.indexOf("load"));
  assert.ok(callOrder.indexOf("will-navigate") < callOrder.indexOf("load"));
  assert.deepEqual(instance.printOptions, { pageRanges: "1-16", printBackground: true });
  assert.equal(instance.destroyed, true);
  assert.equal(target, path.join(project, "exports", "report_preview.pdf"));
  assert.equal(fs.readFileSync(target, "utf8"), "pdf-bytes");
});
