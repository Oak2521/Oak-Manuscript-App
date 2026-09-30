"use strict";
// Standalone S2 synthetic desktop slice. Does not load the main app or its userData.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { randomUUID } = require("node:crypto");
const codec = require("../shared/offline-review-package");
const { syntheticReport, SOURCE_IDENTITY } = require("../samples/offline-review-synthetic");
const ROOT = path.resolve(__dirname,"..");
const OUT = path.join(ROOT,"out");
const profileArg = process.argv.find(a=>a.startsWith("--review-profile="));
const PROFILE = profileArg ? path.resolve(profileArg.slice("--review-profile=".length)) : path.join(OUT,"offline-review-slice");
const relative = path.relative(OUT,PROFILE);
if(!relative || relative.startsWith("..") || path.isAbsolute(relative))throw Error("S2 profile must be inside repo/out");
// Reject pre-existing junction/symlink ancestors before creating a dev profile.
for(let current=PROFILE;current!==ROOT;current=path.dirname(current)) {
  if(fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())throw Error("S2 profile link rejected");
}
fs.mkdirSync(PROFILE,{recursive:true});
app.setPath("userData",PROFILE);
app.setPath("sessionData",PROFILE);
app.setPath("crashDumps",path.join(PROFILE,"crashes"));
app.commandLine.appendSwitch("disable-background-networking");
app.commandLine.appendSwitch("disable-extensions");
app.disableHardwareAcceleration();
const returnMode=process.argv.includes("--review-return");
const pagePath=path.join(ROOT,returnMode?"renderer/offline-review-return.html":"renderer/offline-review.html");
const pageURL=pathToFileURL(pagePath).href;
app.whenReady().then(async()=>{
  const win=new BrowserWindow({
    width:1000,height:900,show:!process.argv.includes("--hidden"),
    webPreferences:{preload:path.join(__dirname,"offline-review-slice-preload.js"),
      contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true},
  });
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  win.webContents.on("will-navigate",e=>e.preventDefault());
  const session=win.webContents.session;
  session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.setPermissionCheckHandler(()=>false);
  const allowed=new Set([
    pageURL,
    ...["renderer/offline-review.css","renderer/offline-review.js",
      "shared/offline-review-core.js","shared/offline-review-browser.js",
      "shared/offline-review-drafts.js"].map(f=>pathToFileURL(path.join(ROOT,f)).href),
    ...(returnMode?["renderer/offline-review-return.js","shared/offline-review-return.js"].map(f=>pathToFileURL(path.join(ROOT,f)).href):[]),
  ]);
  session.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!allowed.has(details.url)}));
  let exporting=false;
  ipcMain.handle("oak-review-s2:export-synthetic",async(event,...args)=>{
    if(args.length || event.sender!==win.webContents || event.senderFrame!==win.webContents.mainFrame ||
        event.senderFrame.url!==pageURL || exporting)throw Error("export request rejected");
    exporting=true;
    try {
      const bytes=codec.serializeOfflineReviewPackage(codec.buildOfflineReviewPackage(syntheticReport(),SOURCE_IDENTITY));
      const directory=path.join(PROFILE,"exports");
      if(fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink())throw Error("export link rejected");
      fs.mkdirSync(directory,{recursive:true});
      const filename="synthetic-review-"+randomUUID()+".json";
      const pending=path.join(directory,filename+".partial");
      const final=path.join(directory,filename);
      const fd=fs.openSync(pending,"wx",0o600);
      try {fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
      fs.renameSync(pending,final);
      return {filename};
    } finally {exporting=false;}
  });
  await win.loadFile(pagePath);
}).catch(error=>{console.error(error);app.exit(1);});
app.on("window-all-closed",()=>app.quit());
