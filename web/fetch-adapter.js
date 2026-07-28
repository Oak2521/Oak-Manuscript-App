"use strict";

const { Readable } = require("node:stream");

function createCapturedResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    ended: false,
    writeHead(statusCode, headers) {
      if (this.statusCode !== null || !Number.isInteger(statusCode) || statusCode < 100 ||
          statusCode > 599 || !headers || typeof headers !== "object" || Array.isArray(headers)) {
        throw new TypeError("Node handler 返回了非法响应头");
      }
      this.statusCode = statusCode;
      this.headers = { ...headers };
    },
    end(value = Buffer.alloc(0)) {
      if (this.ended || this.statusCode === null) throw new TypeError("Node handler 响应顺序非法");
      this.body = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value), "utf8");
      this.ended = true;
    },
  };
}

function requestHeaders(request) {
  const headers = {};
  const rawHeaders = [];
  for (const [name, value] of request.headers.entries()) {
    const lower = name.toLowerCase();
    headers[lower] = value;
    rawHeaders.push(lower, value);
  }
  return { headers, rawHeaders };
}

function createNodeRequest(request) {
  const parsed = new URL(request.url);
  const body = request.body === null ? Readable.from([]) : Readable.fromWeb(request.body);
  const headerState = requestHeaders(request);
  body.method = request.method;
  body.url = `${parsed.pathname}${parsed.search}`;
  body.headers = headerState.headers;
  body.rawHeaders = headerState.rawHeaders;
  body.socket = Object.freeze({ encrypted: parsed.protocol === "https:" });
  return body;
}

function createFetchHandlerAdapter({ nodeHandler } = {}) {
  if (typeof nodeHandler !== "function") throw new TypeError("nodeHandler 必须是函数");

  return async function handleFetchRequest(request) {
    if (!(request instanceof Request) || request.bodyUsed) {
      throw new TypeError("需要未消费的标准 Request");
    }
    const nodeRequest = createNodeRequest(request);
    const captured = createCapturedResponse();
    await nodeHandler(nodeRequest, captured);
    if (!captured.ended || captured.statusCode === null || captured.headers === null) {
      throw new TypeError("Node handler 未完整结束响应");
    }
    return new Response(captured.body, {
      status: captured.statusCode,
      headers: captured.headers,
    });
  };
}

module.exports = {
  createFetchHandlerAdapter,
};
