(function (root) {
  "use strict";
  const core = root.createOakOfflineReviewCodec();
  async function digest(text) {
    if (!root.crypto || !root.crypto.subtle) throw new Error("Web Crypto unavailable");
    const bytes = await root.crypto.subtle.digest("SHA-256", core.encode(text));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  }
  async function verify(pkg) {
    core.validateStructure(pkg);
    core.assertPayloadHash(pkg, await digest(core.canonicalJson(pkg.payload)));
    return pkg;
  }
  root.OakOfflineReview = Object.freeze({
    LIMITS: core.LIMITS,
    async parseOfflineReviewPackage(bytes, expected = {}) {
      // Decode/copy/validate before awaiting digest so the caller cannot retarget the input.
      const pkg = core.readPackage(bytes, expected);
      return verify(pkg);
    },
    async serializeOfflineReviewPackage(pkg) {
      const snapshot = core.readPackage(core.encode(core.canonicalJson(pkg) + "\n"));
      await verify(snapshot);
      return core.encode(core.canonicalJson(snapshot) + "\n");
    },
  });
})(globalThis);
