"use strict";

const { createFetchHandlerAdapter } = require("./fetch-adapter");
const { createStandardsUpdateHttpHandler } = require("./standards-update-http-handler");
const { StandardsUpdateService } = require("./standards-update-service");

function createStandardsUpdateFetchHandler({
  apiOrigin,
  releaseSource,
  requestIdFactory,
  clock,
  securityEventSink,
} = {}) {
  if (typeof securityEventSink !== "function") {
    throw new TypeError("生产标准更新运行时需要 securityEventSink");
  }
  const service = new StandardsUpdateService({ releaseSource });
  const nodeHandler = createStandardsUpdateHttpHandler({
    service,
    expectedOrigin: apiOrigin,
    securityEventSink,
    ...(requestIdFactory === undefined ? {} : { requestIdFactory }),
    ...(clock === undefined ? {} : { clock }),
  });
  return createFetchHandlerAdapter({ nodeHandler });
}

module.exports = { createStandardsUpdateFetchHandler };
