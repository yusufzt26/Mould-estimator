const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("lic", { activate: (key) => ipcRenderer.invoke("activate", key) });
