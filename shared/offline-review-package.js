"use strict";
// S1 synchronous Node API; all schema and canonical rules live in the shared core.
const { createHash } = require("node:crypto");
const createCodec = require("./offline-review-core");
const codec = createCodec(value => createHash("sha256").update(value).digest("hex"));
module.exports = {
  LIMITS: codec.LIMITS,
  buildOfflineReviewPackage: codec.buildOfflineReviewPackage,
  parseOfflineReviewPackage: codec.parseOfflineReviewPackage,
  validateOfflineReviewPackage: codec.validateOfflineReviewPackage,
  serializeOfflineReviewPackage: value => Buffer.from(codec.serializeOfflineReviewPackage(value)),
};
