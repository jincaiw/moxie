const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  open: () => ipcRenderer.invoke("file:open"),
  importDocument: () => ipcRenderer.invoke("file:import"),
  folder: (options) => ipcRenderer.invoke("file:folder", options),
  refreshFolder: (root, version, options) =>
    ipcRenderer.invoke("folder:refresh", { path: root, version, options }),
  searchFolder: (root, query) =>
    ipcRenderer.invoke("folder:search", { root, query }),
  fileOperation: (input) => ipcRenderer.invoke("file:operation", input),
  copyPath: (input) => ipcRenderer.invoke("file:copy-path", input),
  revealPath: (input) => ipcRenderer.invoke("file:reveal", input),
  openLink: (input) => ipcRenderer.invoke("link:open", input),
  inspect: (files) => ipcRenderer.invoke("file:inspect", files),
  recent: () => ipcRenderer.invoke("file:recent"),
  reopen: (file) => ipcRenderer.invoke("file:reopen", file),
  save: (input) => ipcRenderer.invoke("file:save", input),
  storeImage: (input) => ipcRenderer.invoke("image:store", input),
  readImage: (input) => ipcRenderer.invoke("image:read", input),
  manageImage: (input) => ipcRenderer.invoke("image:manage", input),
  downloadRemoteImage: (input) =>
    ipcRenderer.invoke("image:download-remote", input),
  previewPDF: (input) => ipcRenderer.invoke("pdf:preview", input),
  export: (input) => ipcRenderer.invoke("file:export", input),
  exportImage: (input) => ipcRenderer.invoke("image:export", input),
  copyRichText: (input) =>
    ipcRenderer.invoke("clipboard:write-rich-text", input),
  getUpdateStatus: () => ipcRenderer.invoke("update:status"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  fetchThemeResource: (url) => ipcRenderer.invoke("theme:fetch", url),
  dirty: (value) => ipcRenderer.send("document:dirty", Boolean(value)),
  closeReady: () => ipcRenderer.send("window:close-ready"),
  onAction: (fn) => {
    const listener = (_event, action) => fn(action);
    ipcRenderer.on("menu:action", listener);
    return () => ipcRenderer.removeListener("menu:action", listener);
  },
  onUpdateStatus: (fn) => {
    const listener = (_event, status) => fn(status);
    ipcRenderer.on("update:status", listener);
    return () => ipcRenderer.removeListener("update:status", listener);
  },
});
