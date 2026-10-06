const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  shell,
} = require("electron");
const fs = require("node:fs/promises");
const { URL } = require("node:url");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { FileStore, atomicWrite, validateText } = require("./files.cjs");
const { autoUpdater } = require("electron-updater");
const { UpdateController } = require("./updater.cjs");
let store,
  updates,
  windowSequence = 0;
const windowSessionScope = randomUUID();
const windowStates = new Map();
const isDev = process.env.MOXIE_DEV === "1";
function action(name, target) {
  const window =
    target ||
    BrowserWindow.getFocusedWindow?.() ||
    [...windowStates.values()].at(-1)?.window;
  if (window && !window.isDestroyed?.())
    window.webContents.send("menu:action", name);
}
function verify(event) {
  const state = windowStates.get(event.sender);
  if (!state || event.senderFrame !== event.sender.mainFrame)
    throw Error("拒绝未知窗口的请求");
  return state;
}
function pdfOptions(input) {
  const pdf = input && typeof input === "object" ? input : {};
  const pageSize = ["A4", "Letter", "Legal"].includes(pdf.pageSize)
    ? pdf.pageSize
    : "A4";
  const landscape = pdf.landscape === true;
  const headerFooter = pdf.headerFooter === true;
  const margin = Number.isFinite(pdf.margin)
    ? Math.min(40, Math.max(5, pdf.margin))
    : 20;
  return { pageSize, landscape, headerFooter, margin };
}
async function renderPDF(html, settings) {
  const { pageSize, landscape, headerFooter, margin } = pdfOptions(settings);
  const printStyle = `<style>@page { size: ${pageSize} ${landscape ? "landscape" : "portrait"}; margin: ${margin}mm; }</style>`;
  const printHTML = html.includes("</head>")
    ? html.replace("</head>", `${printStyle}</head>`)
    : html.replace("</html>", `${printStyle}</html>`);
  const print = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await print.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(printHTML),
    );
    await print.webContents.executeJavaScript(`Promise.race([
      Promise.all([
        document.fonts?.ready.catch(() => {}),
        ...Array.from(document.images, image => image.decode().catch(() => {})),
      ]),
      new Promise(resolve => setTimeout(resolve, 8000)),
    ])`);
    return await print.webContents.printToPDF({
      printBackground: true,
      pageSize,
      landscape,
      displayHeaderFooter: headerFooter,
      headerTemplate: headerFooter
        ? '<div style="width:100%;font:9px sans-serif;color:#666;text-align:center"><span class="title"></span></div>'
        : undefined,
      footerTemplate: headerFooter
        ? '<div style="width:100%;font:9px sans-serif;color:#666;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
        : undefined,
      margins: {
        top: Math.max(margin, headerFooter ? 12 : margin) / 25.4,
        bottom: Math.max(margin, headerFooter ? 12 : margin) / 25.4,
        left: margin / 25.4,
        right: margin / 25.4,
      },
    });
  } finally {
    print.destroy();
  }
}
function setupIPC() {
  const handle = (name, handler) =>
    ipcMain.handle(name, async (event, input) => {
      const state = verify(event);
      return handler(input, state);
    });
  handle("update:status", () => updates.getStatus());
  handle("update:check", () => updates.check());
  handle("update:download", () => updates.download());
  handle("update:install", () => updates.install());
  handle("file:open", async (_input, { window }) => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [
        { name: "Markdown 文档", extensions: ["md", "markdown", "txt"] },
      ],
    });
    return result.canceled ? null : store.read(result.filePaths[0]);
  });
  handle("file:folder", async (_input, { window }) => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    return store.folder(result.filePaths[0]);
  });
  handle("folder:refresh", (input) =>
    store.folder(
      typeof input === "string" ? input : input.path,
      true,
      input.version,
    ),
  );
  handle("folder:search", (input) => store.searchFolder(input));
  handle("link:open", async (input) => {
    if (typeof input?.href !== "string" || input.href.length > 8192)
      throw Error("链接无效");
    if (/^(https?:|mailto:)/i.test(input.href)) {
      const url = new URL(input.href);
      if (!["https:", "http:", "mailto:"].includes(url.protocol))
        throw Error("链接无效");
      await shell.openExternal(url.href);
      return {};
    }
    return store.openLinked(input.documentPath, input.href);
  });
  handle("file:inspect", (files) => store.inspect(files));
  handle("file:recent", () =>
    store.recent.map((file) => ({ path: file, name: path.basename(file) })),
  );
  handle("file:reopen", (file) => store.read(file, true));
  handle("file:save", (input, { window }) =>
    store.save(
      input,
      async (defaultPath) => {
        const result = await dialog.showSaveDialog(window, {
          defaultPath,
          filters: [{ name: "Markdown 文档", extensions: ["md"] }],
        });
        return result.canceled ? null : result.filePath;
      },
      async () => {
        const result = await dialog.showMessageBox(window, {
          type: "warning",
          message: "文件已被其他程序修改或删除",
          detail: "覆盖将替换磁盘上的版本。可取消并使用“另存为”保留两个版本。",
          buttons: ["取消", "覆盖"],
          defaultId: 0,
          cancelId: 0,
        });
        return result.response === 1;
      },
    ),
  );
  handle("image:store", (input) => store.storeImage(input));
  handle("image:read", (input) => store.readImage(input));
  handle("pdf:preview", async (input) => {
    validateText(input.html);
    const html = input.html.replace(
      '<meta charset="utf-8">',
      '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: https:; style-src \'unsafe-inline\'; font-src data:;">',
    );
    const buffer = await renderPDF(html, input.pdf);
    return new Uint8Array(buffer);
  });
  handle("file:export", async (input, { window }) => {
    validateText(input.html);
    if (!["html", "pdf", "docx"].includes(input.format))
      throw Error("不支持的导出格式");
    const extension = input.format === "docx" ? "docx" : input.format;
    const result = await dialog.showSaveDialog(window, {
      defaultPath:
        path.basename(String(input.name)).replace(/\.(md|markdown)$/i, "") +
        "." +
        extension,
      filters: [
        {
          name:
            input.format === "docx" ? "Word 文档" : input.format.toUpperCase(),
          extensions: [extension],
        },
      ],
    });
    if (result.canceled) return false;
    if (input.format === "docx") {
      const htmlToDocx = require("html-to-docx");
      const buffer = await htmlToDocx(input.html, null, {
        title: path
          .basename(String(input.name))
          .replace(/\.(md|markdown)$/i, ""),
        creator: "墨写 Moxie",
        lang: "zh-CN",
        font: "Arial",
        fontSize: 24,
        pageSize: { width: 11906, height: 16838 },
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      });
      await atomicWrite(result.filePath, buffer);
      return true;
    }
    const html = input.html.replace(
      '<meta charset="utf-8">',
      '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: https:; style-src \'unsafe-inline\'; font-src data:;">',
    );
    if (input.format === "html") {
      await atomicWrite(result.filePath, html);
      return true;
    }
    const buffer = await renderPDF(html, input.pdf);
    await atomicWrite(result.filePath, buffer);
    return true;
  });
  ipcMain.on("document:dirty", (event, value) => {
    const state = verify(event);
    state.dirty = Boolean(value);
    state.window.setDocumentEdited(state.dirty);
  });
  ipcMain.on("window:close-ready", (event) => {
    const state = verify(event);
    state.allowClose = true;
    state.window.close();
  });
}
function createWindow(primary = false) {
  const id = ++windowSequence;
  const state = { dirty: false, allowClose: false, askingClose: false };
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    title: "墨写",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 17, y: 13 },
    backgroundColor: "#ffffff",
    webPreferences: {
      ...(!primary && {
        partition: `moxie-workspace-${windowSessionScope}-${id}`,
      }),
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  state.window = window;
  windowStates.set(window.webContents, state);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.once("did-finish-load", () => {
    window.webContents.send("update:status", updates.getStatus());
  });
  window.webContents.on("will-navigate", (event, url) => {
    const expected = isDev
      ? "http://127.0.0.1:5173/"
      : require("node:url").pathToFileURL(
          path.join(__dirname, "../dist/index.html"),
        ).href;
    if (url !== expected) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  window.on("close", (event) => {
    if (!state.dirty || state.allowClose) return;
    event.preventDefault();
    if (state.askingClose) return;
    state.askingClose = true;
    void dialog
      .showMessageBox(window, {
        type: "question",
        message: "还有未保存的文档",
        detail: "保存到文件，或保留恢复副本后关闭。",
        buttons: ["取消", "保存全部", "保留恢复副本并关闭"],
        defaultId: 1,
        cancelId: 0,
      })
      .then((result) => {
        if (result.response === 1) action("close-request", window);
        if (result.response === 2) action("keep-close", window);
      })
      .finally(() => {
        state.askingClose = false;
      });
  });
  window.on("closed", () => windowStates.delete(window.webContents));
  if (isDev) void window.loadURL("http://127.0.0.1:5173");
  else void window.loadFile(path.join(__dirname, "../dist/index.html"));
  return window;
}
function setupUpdater() {
  updates = new UpdateController({
    updater: autoUpdater,
    supported: app.isPackaged && process.platform === "darwin",
    hasUnsavedChanges: () =>
      [...windowStates.values()].some((state) => state.dirty),
    onStatus: (status) => {
      for (const state of windowStates.values())
        if (!state.window.isDestroyed())
          state.window.webContents.send("update:status", status);
    },
  });
}
function createMenu() {
  const command = (label, name, accelerator) => ({
    label,
    accelerator,
    click: () => action(name),
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin"
        ? [
            {
              label: "墨写",
              submenu: [
                { role: "about" },
                command("偏好设置…", "settings", "CmdOrCtrl+,"),
                { type: "separator" },
                { role: "hide" },
                { role: "hideOthers" },
                { role: "unhide" },
                { type: "separator" },
                { role: "quit" },
              ],
            },
          ]
        : []),
      {
        label: "文件",
        submenu: [
          command("新建", "new", "CmdOrCtrl+N"),
          {
            label: "新建窗口",
            accelerator: "CmdOrCtrl+Shift+N",
            click: () => createWindow(),
          },
          command("打开…", "open", "CmdOrCtrl+O"),
          command("打开文件夹…", "folder"),
          { type: "separator" },
          command("保存", "save", "CmdOrCtrl+S"),
          command("另存为…", "saveAs", "CmdOrCtrl+Shift+S"),
          command("导出…", "export"),
          command("关闭当前文档", "close-document", "CmdOrCtrl+W"),
          { type: "separator" },
          { role: "close", accelerator: "CmdOrCtrl+Shift+W" },
        ],
      },
      {
        label: "编辑",
        submenu: [
          command("撤销", "undo", "CmdOrCtrl+Z"),
          command("重做", "redo", "CmdOrCtrl+Shift+Z"),
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
          { type: "separator" },
          command("查找与替换", "find", "CmdOrCtrl+F"),
        ],
      },
      {
        label: "格式",
        submenu: [
          command("粗体", "format-bold", "CmdOrCtrl+B"),
          command("斜体", "format-italic", "CmdOrCtrl+I"),
          command("链接", "format-link", "CmdOrCtrl+K"),
          command("标题", "format-heading"),
          command("引用", "format-quote"),
          command("任务列表", "format-task"),
          command("表格", "format-table"),
          command("插入图片…", "image"),
        ],
      },
      {
        label: "视图",
        submenu: [
          command("切换源码模式", "source", "CmdOrCtrl+/"),
          command("专注模式", "focus", "CmdOrCtrl+Shift+F"),
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "窗口",
        role: "window",
        submenu: [
          { label: "新建窗口", click: () => createWindow() },
          { role: "minimize" },
          { role: "zoom" },
        ],
      },
    ]),
  );
}
app.whenReady().then(async () => {
  store = new FileStore(
    app.getPath ? path.join(app.getPath("userData"), "files.json") : undefined,
  );
  await store.init();
  setupUpdater();
  setupIPC();
  createWindow(true);
  createMenu();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true);
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
