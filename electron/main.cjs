const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  clipboard,
  shell,
  nativeImage,
} = require("electron");
const fs = require("node:fs/promises");
const { URL } = require("node:url");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { FileStore, atomicWrite, validateText } = require("./files.cjs");
const {
  pandocFormats,
  findPandoc,
  exportWithPandoc,
  importWithPandoc,
} = require("./pandoc.cjs");
const { autoUpdater } = require("electron-updater");
const { exportDocumentAsSVG } = require("./image-export.cjs");
const { UpdateController, supportsAutoUpdate } = require("./updater.cjs");
const { fetchThemeResource } = require("./theme-gallery.cjs");
let store,
  updates,
  windowSequence = 0,
  windowProfileFile,
  windowProfileWrites = Promise.resolve(),
  isQuitting = false;

function writerCompatibleImages(html) {
  return html.replace(
    /(\bsrc\s*=\s*)(["']?)((?:data:image\/(?:avif|bmp|svg\+xml);base64,)[A-Za-z\d+/=]+)\2/gi,
    (_match, attribute, quote, source) => {
      const image = nativeImage.createFromDataURL(source);
      const { width, height } = image.getSize();
      if (image.isEmpty() || width <= 0 || height <= 0)
        throw Error("无法解码 BMP/AVIF/SVG 图片，导出已取消");
      return `${attribute}${quote}data:image/png;base64,${image.toPNG().toString("base64")}${quote}`;
    },
  );
}
async function reservePandocAssetsDirectory(outputPath) {
  const parent = path.dirname(outputPath);
  const base = `${path.basename(outputPath)}_assets`;
  for (let index = 1; index < 1000; index++) {
    const name = index === 1 ? base : `${base}-${index}`;
    const directory = path.join(parent, name);
    try {
      await fs.mkdir(directory);
      return { name, directory };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  throw Error("无法为导出图片创建资源目录");
}
const windowStates = new Map();
const windowProfiles = new Set();
const isDev = process.env.MOXIE_DEV === "1";
async function loadWindowProfiles() {
  if (!windowProfileFile) return;
  try {
    const value = JSON.parse(await fs.readFile(windowProfileFile, "utf8"));
    if (!Array.isArray(value)) return;
    for (const id of value) {
      if (typeof id === "string" && /^[\da-f-]{36}$/i.test(id)) {
        windowProfiles.add(id);
        if (windowProfiles.size >= 16) break;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") console.error("读取窗口会话失败", error);
  }
}
function saveWindowProfiles() {
  if (!windowProfileFile) return Promise.resolve();
  const contents = JSON.stringify([...windowProfiles]);
  windowProfileWrites = windowProfileWrites
    .catch(() => {})
    .then(() => atomicWrite(windowProfileFile, contents));
  return windowProfileWrites;
}
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
      generateDocumentOutline: true,
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
  handle("theme:fetch", (url) => fetchThemeResource(url));
  handle("clipboard:write-rich-text", (input) => {
    if (
      !input ||
      typeof input.html !== "string" ||
      typeof input.text !== "string" ||
      input.html.length > 5 * 1024 * 1024 ||
      input.text.length > 5 * 1024 * 1024
    )
      throw Error("复制内容无效或超出 5 MB 限制");
    clipboard.write({ html: input.html, text: input.text });
    return true;
  });
  handle("file:open", async (_input, { window }) => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [
        { name: "Markdown 文档", extensions: ["md", "markdown", "txt"] },
      ],
    });
    return result.canceled ? null : store.read(result.filePaths[0]);
  });
  handle("file:import", async (_input, { window }) => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openFile"],
      filters: [
        {
          name: "可导入的文档",
          extensions: [
            "docx",
            "html",
            "htm",
            "rtf",
            "epub",
            "odt",
            "tex",
            "latex",
            "mediawiki",
          ],
        },
      ],
    });
    if (result.canceled) return null;
    return importWithPandoc({ inputPath: result.filePaths[0] });
  });
  handle("file:folder", async (options, { window }) => {
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
    });
    if (result.canceled) return null;
    return store.folder(result.filePaths[0], false, undefined, options);
  });
  handle("folder:refresh", (input) =>
    store.folder(
      typeof input === "string" ? input : input.path,
      true,
      input.version,
      input.options,
    ),
  );
  handle("folder:search", (input) => store.searchFolder(input));
  handle("folder:startup", (root) => store.setStartupFolder(root));
  handle("folder:recent", () => store.recentFolders());
  handle("folder:history", (input) => store.updateFolderHistory(input));
  handle("folder:reopen", (input) =>
    store.reopenFolder(input.path, input.options),
  );
  handle("file:operation", async (input, { window }) => {
    if (input?.action !== "move" || input.directory)
      return store.fileOperation(input);
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      defaultPath: input.root,
      buttonLabel: "移动到此处",
    });
    if (result.canceled) return null;
    return store.fileOperation({ ...input, directory: result.filePaths[0] });
  });
  handle("file:copy-path", async (input) => {
    const authorized = await store.authorizedPath(input, true);
    clipboard.writeText(authorized);
    return true;
  });
  handle("file:make-link", (input) =>
    store.makeLink(input.documentPath, input.target, input.label),
  );
  handle("file:drag-out", async (input, { window }) => {
    const file = await store.authorizedPath(input);
    const icon = await app.getFileIcon(file);
    if (window.isDestroyed()) return false;
    window.webContents.startDrag({ file, icon });
    return true;
  });
  handle("file:drop-cancel", (input, state) => {
    const job = state.copyJob;
    if (!job || job.id !== input?.id || job.finishing) return false;
    job.controller.abort();
    return true;
  });
  handle("file:drop-copy", async (input, state) => {
    const { window } = state;
    if (state.copyJob) throw Error("正在处理上一批拖入项目，请稍候");
    if (
      input?.id !== undefined &&
      (typeof input.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          input.id,
        ))
    )
      throw Error("复制任务标识无效");
    if (
      !Array.isArray(input?.paths) ||
      !input.paths.length ||
      input.paths.length > 20 ||
      input.paths.some(
        (value) => typeof value !== "string" || !path.isAbsolute(value),
      )
    )
      throw Error("拖入的文件无效，一次最多 20 项");
    if (!store.folders.has(input.root)) throw Error("请先打开目标文件夹");
    const destination = await store.authorizedPath(
      input.directory || input.root,
    );
    const relative = path.relative(input.root, destination);
    if (
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative) ||
      !(await fs.stat(destination)).isDirectory()
    )
      throw Error("请选择已打开文件夹内的目标目录");
    if (state.copyJob) throw Error("正在处理上一批拖入项目，请稍候");
    let finishJob;
    const job = {
      id: input.id || randomUUID(),
      controller: new AbortController(),
      finishing: false,
      phase: "confirming",
      done: new Promise((resolve) => {
        finishJob = resolve;
      }),
    };
    state.copyJob = job;
    try {
      const confirmation = await dialog.showMessageBox(window, {
        type: "question",
        message: "复制拖入的文件或文件夹？",
        detail: `目标：${destination}\n\n${input.paths.map((value) => path.basename(value)).join("\n")}\n\n保留原文件；遇到同名项目会停止，不覆盖已有内容。`,
        buttons: ["复制", "取消"],
        defaultId: 0,
        cancelId: 1,
      });
      if (confirmation.response !== 0) return null;
      return await store.importDropped(input, {
        signal: job.controller.signal,
        onProgress: (progress) => {
          job.phase = progress.phase;
          if (progress.phase === "finishing" || progress.phase === "cleanup")
            job.finishing = true;
          if (!window.isDestroyed()) {
            try {
              window.webContents.send("file:drop-progress", {
                ...progress,
                id: job.id,
              });
            } catch {}
          }
        },
      });
    } catch (error) {
      if (error.code === "COPY_CANCELLED")
        return { paths: [], cancelled: true };
      throw error;
    } finally {
      if (state.copyJob === job) delete state.copyJob;
      finishJob();
    }
  });
  handle("file:reveal", async (input) => {
    const authorized = await store.authorizedPath(input, true);
    shell.showItemInFolder(authorized);
    return true;
  });
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
    const result = await store.openLinked(
      input.documentPath,
      input.href,
      input.create === true,
    );
    if (result.folder) await store.folder(result.folder);
    if (result.reveal) shell.showItemInFolder(result.reveal);
    return result;
  });
  handle("file:inspect", (files) => store.inspect(files));
  handle("file:recent", () =>
    store.recent.map((file) => ({ path: file, name: path.basename(file) })),
  );
  handle("file:reopen", (file) => store.read(file, true));
  handle("file:open-new-window", async (file) => {
    const opened = await store.read(file, true);
    const target = createWindow(false, undefined, opened);
    return Boolean(target);
  });
  handle("file:initial", (_input, state) => {
    const file = state.initialFile || null;
    state.initialFile = null;
    return file;
  });
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
  handle("image:manage", (input) => store.manageImage(input));
  handle("image:download-remote", (input) => store.downloadRemoteImage(input));
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
    const pandocDefinition = Object.hasOwn(pandocFormats, input.format)
      ? pandocFormats[input.format]
      : null;
    if (!["html", "pdf", "docx"].includes(input.format) && !pandocDefinition)
      throw Error("不支持的导出格式");
    const pandocBinary = pandocDefinition ? await findPandoc() : null;
    if (pandocDefinition && !pandocBinary)
      throw Error(
        "此格式需要安装 Pandoc 并确保命令可用。安装说明：https://pandoc.org/installing.html",
      );
    const extension = pandocDefinition?.extension ?? input.format;
    const result = await dialog.showSaveDialog(window, {
      defaultPath:
        path.basename(String(input.name)).replace(/\.(md|markdown)$/i, "") +
        "." +
        extension,
      filters: [
        {
          name:
            pandocDefinition?.label ??
            (input.format === "docx"
              ? "Word 文档"
              : input.format.toUpperCase()),
          extensions: [extension],
        },
      ],
    });
    if (result.canceled) return false;
    if (pandocDefinition) {
      const assetsDirectory = pandocDefinition.companionAssets
        ? await reservePandocAssetsDirectory(result.filePath)
        : null;
      try {
        const output = await exportWithPandoc({
          html: writerCompatibleImages(input.html),
          format: input.format,
          name: input.name,
          executable: pandocBinary,
          assetsDirectoryName: assetsDirectory?.name,
        });
        for (const asset of output.assets)
          await fs.writeFile(
            path.join(assetsDirectory.directory, asset.name),
            asset.data,
            { flag: "wx", mode: 0o600 },
          );
        await atomicWrite(result.filePath, output.data);
        if (!output.assets.length && assetsDirectory)
          await fs.rmdir(assetsDirectory.directory);
      } catch (error) {
        if (assetsDirectory)
          await fs.rm(assetsDirectory.directory, {
            recursive: true,
            force: true,
          });
        throw error;
      }
      return true;
    }
    if (input.format === "docx") {
      const htmlToDocx = require("html-to-docx");
      const buffer = await htmlToDocx(
        writerCompatibleImages(input.html),
        null,
        {
          title: path
            .basename(String(input.name))
            .replace(/\.(md|markdown)$/i, ""),
          creator: "墨写 Moxie",
          lang: "zh-CN",
          font: "Arial",
          fontSize: 24,
          pageSize: { width: 11906, height: 16838 },
          margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      );
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
  handle("image:export", (input, { window }) =>
    exportDocumentAsSVG({
      html: input?.html,
      name: input?.name,
      parent: window,
      BrowserWindow,
      dialog,
      atomicWrite,
    }),
  );
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
function createWindow(primary = false, restoredProfile, initialFile) {
  if (!primary && !restoredProfile && windowProfiles.size >= 16) {
    const options = {
      type: "info",
      message: "最多可保存 16 个额外窗口工作区。",
    };
    const owner = BrowserWindow.getFocusedWindow?.();
    void (owner
      ? dialog.showMessageBox(owner, options)
      : dialog.showMessageBox(options));
    return null;
  }
  const id = ++windowSequence;
  const profileId = primary ? undefined : restoredProfile || randomUUID();
  const state = {
    dirty: false,
    allowClose: false,
    askingClose: false,
    profileId,
    initialFile,
  };
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
        partition: `persist:moxie-workspace-${profileId}`,
      }),
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  state.window = window;
  // BrowserWindow.webContents cannot be read after the window is destroyed.
  const contents = window.webContents;
  windowStates.set(contents, state);
  if (profileId && !restoredProfile) {
    windowProfiles.add(profileId);
    void saveWindowProfiles().catch((error) =>
      console.error("保存窗口会话失败", error),
    );
  }
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  contents.once("did-finish-load", () => {
    if (!contents.isDestroyed())
      contents.send("update:status", updates.getStatus());
  });
  contents.on("will-navigate", (event, url) => {
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
    const job = state.copyJob;
    if (job && job.phase !== "finishing") {
      event.preventDefault();
      job.controller.abort();
      if (!job.closeRequested) {
        job.closeRequested = true;
        void job.done.then(() => {
          if (!window.isDestroyed()) {
            if (isQuitting) app.quit();
            else window.close();
          }
        });
      }
      return;
    }
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
  window.on("closed", () => {
    state.copyJob?.controller.abort();
    windowStates.delete(contents);
    if (
      state.profileId &&
      !state.dirty &&
      windowStates.size > 0 &&
      !isQuitting
    ) {
      windowProfiles.delete(state.profileId);
      void saveWindowProfiles().catch((error) =>
        console.error("清理窗口会话失败", error),
      );
    }
  });
  if (isDev) void window.loadURL("http://127.0.0.1:5173");
  else void window.loadFile(path.join(__dirname, "../dist/index.html"));
  return window;
}
function restoreWindows() {
  createWindow(true);
  for (const profileId of windowProfiles) createWindow(false, profileId);
}
function setupUpdater() {
  updates = new UpdateController({
    updater: autoUpdater,
    supported: supportsAutoUpdate({
      isPackaged: app.isPackaged,
      platform: process.platform,
      env: process.env,
    }),
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
          command("导入文档…", "import"),
          command(
            "快速打开…",
            "quick-open",
            process.platform === "darwin" ? "CmdOrCtrl+Shift+O" : "Ctrl+P",
          ),
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
          command("复制为 HTML", "copy-as-html"),
          command("复制 HTML 代码", "copy-as-html-code"),
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
          command("下载文档中的远程图片", "download-remote-images"),
          command("复制本地图片到文件夹…", "copy-local-images"),
          command("移动本地图片到文件夹…", "move-local-images"),
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
  if (app.getPath)
    windowProfileFile = path.join(app.getPath("userData"), "windows.json");
  store = new FileStore(
    app.getPath ? path.join(app.getPath("userData"), "files.json") : undefined,
    (file) => shell.trashItem(file),
  );
  await store.init();
  await loadWindowProfiles();
  setupUpdater();
  setupIPC();
  restoreWindows();
  createMenu();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) restoreWindows();
  });
});
app.on("before-quit", () => {
  isQuitting = true;
  void saveWindowProfiles();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
