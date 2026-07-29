"use strict";

const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createStandardsRevocationHttpHandler } = require("./standards-revocation-http-handler");
const { StandardsRevocationService } = require("./standards-revocation-service");

function createStandardsRevocationFetchHandler({
  apiOrigin,
  revocationSource,
  requestIdFactory,
  clock,
  securityEventSink,
} = {}) {
  if (typeof securityEventSink !== "function") {
    throw new TypeError("生产标准撤回运行时需要 securityEventSink");
  }
  const service = new StandardsRevocationService({ revocationSource });
  const nodeHandler = createStandardsRevocationHttpHandler({
    service,
    expectedOrigin: apiOrigin,
    securityEventSink,
    ...(requestIdFactory === undefined ? {} : { requestIdFactory }),
    ...(clock === undefined ? {} : { clock }),
  });
  return createFetchHandlerAdapter({ nodeHandler });
}

module.exports = { createStandardsRevocationFetchHandler };
