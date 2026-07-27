"use strict";

// Independent, repository-controlled trust contract for the legacy Windows
// toolset consumed by electron-builder 26.15.3.  Do not derive these hashes at
// runtime from node_modules or from downloaded archives.
const SOURCE_ARCHIVES = Object.freeze([
  Object.freeze({
    id: "nsis",
    name: "nsis-3.0.4.1.7z",
    sha256: "9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa",
  }),
  Object.freeze({
    id: "nsisResources",
    name: "nsis-resources-3.4.1.7z",
    sha256: "593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103",
  }),
  Object.freeze({
    id: "winCodeSign",
    name: "winCodeSign-2.6.0.7z",
    sha256: "cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4",
  }),
]);

const TARGET_ARCH = "x64";
const TOOLCHAIN_RELATIVE = "tools/electron-builder/win32-x64";
const LOCK_RELATIVE = "config/tool-manifests/electron-builder-win32-x64.json";

module.exports = {
  LOCK_RELATIVE,
  SOURCE_ARCHIVES,
  TARGET_ARCH,
  TOOLCHAIN_RELATIVE,
};
