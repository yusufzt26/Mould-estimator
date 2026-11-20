// Mould Estimator for Windows. Checks the license key, starts the local server and opens the app window.
// It is a normal windowed program (no console window); data stays in %APPDATA%\Mould Estimator\data.
const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const license = require("./license.cjs");

app.setAppUserModelId("com.zoomtech.mouldestimator");
if (!app.requestSingleInstanceLock()) { app.quit(); return; }

const USER = app.getPath("userData");
const KEY_FILE = path.join(USER, "license.key");
process.env.MOULD_DATA_DIR = path.join(USER, "data");
const ICON = path.join(__dirname, "icon.png");
const CODE = license.machineCode();

let main = null, activation = null, lic = null;

function readKey() { try { return fs.readFileSync(KEY_FILE, "utf8"); } catch { return ""; } }

function showActivation(reason) {
  if (activation) { activation.focus(); return; }
  activation = new BrowserWindow({ width: 560, height: 600, resizable: false, title: "Activate Mould Estimator", icon: ICON, autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true } });
  activation.setMenu(null);
  activation.loadFile(path.join(__dirname, "activate.html"), { query: { code: CODE, reason: reason || "" } });
  activation.once("ready-to-show", () => activation.show());
  activation.on("closed", () => { activation = null; if (!main) app.quit(); });
}

ipcMain.handle("activate", (_e, text) => {
  const r = license.check(text, CODE);
  if (!r.ok) return { ok: false, why: r.why };
  fs.mkdirSync(USER, { recursive: true });
  fs.writeFileSync(KEY_FILE, String(text).replace(/\s+/g, ""));
  lic = r.rec;
  setTimeout(async () => { await openMain(); if (activation) activation.close(); }, 600);
  return { ok: true, name: r.rec.n };
});

function aboutBox() {
  dialog.showMessageBox(main, { type: "info", title: "About Mould Estimator", buttons: ["OK"],
    message: "Mould Estimator " + app.getVersion(),
    detail: "Licensed to: " + (lic && lic.n || "-") + "\nValid until: " + (lic && lic.x || "no end date") + "\nThis PC's code: " + CODE + "\n\nData folder: " + process.env.MOULD_DATA_DIR });
}

function menu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [{ label: "Open data folder", click: () => shell.openPath(process.env.MOULD_DATA_DIR) }, { type: "separator" }, { role: "quit", label: "Exit" }] },
    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "View", submenu: [{ role: "reload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Help", submenu: [{ label: "License and about", click: aboutBox }] },
  ]));
}

let serverPort = 0;
async function openMain() {
  if (main) return;
  if (!serverPort) {
    const { startServer } = require("./server.cjs");
    serverPort = await startServer(path.join(__dirname, "web"), 47811);
  }
  menu();
  main = new BrowserWindow({ width: 1400, height: 900, minWidth: 900, minHeight: 600, title: "Mould Estimator", icon: ICON, show: false,
    webPreferences: { contextIsolation: true, sandbox: true } });
  main.maximize();
  main.once("ready-to-show", () => main.show());
  const home = "http://127.0.0.1:" + serverPort + "/";
  // links to other sites open in the normal browser; pages of the app itself (print previews) stay inside
  main.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(home) || url.startsWith("blob:") || url === "about:blank") return { action: "allow" };
    if (/^https?:|^mailto:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  main.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(home)) { e.preventDefault(); if (/^https?:|^mailto:/.test(url)) shell.openExternal(url); } });
  main.on("closed", () => { main = null; app.quit(); });
  await main.loadURL(home);
}

app.on("second-instance", () => { const w = main || activation; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.on("window-all-closed", () => app.quit());

app.whenReady().then(() => {
  const saved = readKey();
  const r = saved ? license.check(saved, CODE) : null;
  if (r && r.ok) { lic = r.rec; openMain().catch(e => { dialog.showErrorBox("Mould Estimator", "The app could not start: " + e.message); app.quit(); }); }
  else showActivation(r ? r.why : "");
});
