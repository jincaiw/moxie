const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  open: () => ipcRenderer.invoke("file:open"),
  folder: () => ipcRenderer.invoke("file:folder"),
  refreshFolder: (root, version) =>
    ipcRenderer.invoke("folder:refresh", { path: root, version }),
  searchFolder: (root, query) =>
    ipcRenderer.invoke("folder:search", { root, query }),
  openLink: (input) => ipcRenderer.invoke("link:open", input),
  inspect: (files) => ipcRenderer.invoke("file:inspect", files),
  recent: () => ipcRenderer.invoke("file:recent"),
  reopen: (file) => ipcRenderer.invoke("file:reopen", file),
  save: (input) => ipcRenderer.invoke("file:save", input),
  storeImage: (input) => ipcRenderer.invoke("image:store", input),
  readImage: (input) => ipcRenderer.invoke("image:read", input),
  previewPDF: (input) => ipcRenderer.invoke("pdf:preview", input),
  export: (input) => ipcRenderer.invoke("file:export", input),
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
