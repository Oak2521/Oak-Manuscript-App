"use strict";
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("oakReviewDesktop", Object.freeze({
  exportSyntheticReport: () => ipcRenderer.invoke("oak-review-s2:export-synthetic"),
}));
