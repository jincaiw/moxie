const { contextBridge, ipcRenderer, webUtils } = require("electron");
contextBridge.exposeInMainWorld("desktop", {
  cancelDroppedCopy: (id) => ipcRenderer.invoke("file:drop-cancel", { id }),
  onDroppedCopyProgress: (fn) => {
    const listener = (_event, progress) => fn(progress);
    ipcRenderer.on("file:drop-progress", listener);
    return () => ipcRenderer.removeListener("file:drop-progress", listener);
  },
  makeFileLink: (documentPath, target, label) =>
    ipcRenderer.invoke("file:make-link", { documentPath, target, label }),
  dragFileOut: (target) => ipcRenderer.invoke("file:drag-out", target),
  copyDroppedFiles: (root, directory, files, options, id) => {
    if (!Array.isArray(files) || files.length > 20)
      return Promise.reject(Error("一次最多拖入 20 项"));
    const paths = files.map((file) => webUtils.getPathForFile(file));
    if (paths.some((value) => !value))
      return Promise.reject(Error("请从系统文件管理器拖入实际文件或文件夹"));
    return ipcRenderer.invoke("file:drop-copy", {
      root,
      directory,
      paths,
      options,
      id,
    });
  },
  open: () => ipcRenderer.invoke("file:open"),
  importDocument: () => ipcRenderer.invoke("file:import"),
  folder: (options) => ipcRenderer.invoke("file:folder", options),
  setStartupFolder: (root) => ipcRenderer.invoke("folder:startup", root),
  recentFolders: () => ipcRenderer.invoke("folder:recent"),
  updateFolderHistory: (input) => ipcRenderer.invoke("folder:history", input),
  folderForFile: (path, options) =>
    ipcRenderer.invoke("folder:for-file", { path, options }),
  reopenFolder: (path, options) =>
    ipcRenderer.invoke("folder:reopen", { path, options }),
  refreshFolder: (root, version, options) =>
    ipcRenderer.invoke("folder:refresh", { path: root, version, options }),
  searchFolder: (root, query, options) =>
    ipcRenderer.invoke("folder:search", { root, query, options }),
  fileOperation: (input) => ipcRenderer.invoke("file:operation", input),
  copyPath: (input) => ipcRenderer.invoke("file:copy-path", input),
  revealPath: (input) => ipcRenderer.invoke("file:reveal", input),
  openLink: (input) => ipcRenderer.invoke("link:open", input),
  openInNewWindow: (file) => ipcRenderer.invoke("file:open-new-window", file),
  initialFile: () => ipcRenderer.invoke("file:initial"),
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
  getOutlinePreference: () => ipcRenderer.invoke("preferences:outline-read"),
  setOutlinePreference: (value) =>
    ipcRenderer.invoke("preferences:outline-write", value),
  onOutlinePreference: (fn) => {
    const listener = (_event, value) => fn(value);
    ipcRenderer.on("preferences:outline-changed", listener);
    return () =>
      ipcRenderer.removeListener("preferences:outline-changed", listener);
  },
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
