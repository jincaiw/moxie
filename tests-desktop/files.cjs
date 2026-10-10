const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs/promises");
const syncFS = require("node:fs");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const yaml = require("js-yaml");
const {
  UpdateController,
  describeUpdateError,
  supportsAutoUpdate,
} = require("../electron/updater.cjs");
const { mergeMacUpdateInfo } = require("../electron/update-info.cjs");
const {
  fetchThemeResource,
  isThemeResourceURL,
} = require("../electron/theme-gallery.cjs");
const { verifyThemeCatalog } = require("../scripts/verify-theme-catalog.cjs");
const {
  pandocFormats,
  pandocCandidates,
  exportWithPandoc,
  importReaders,
  importWithPandoc,
} = require("../electron/pandoc.cjs");
const { exportDocumentAsSVG } = require("../electron/image-export.cjs");
const harnessDirectories = [];
after(async () => {
  await Promise.all(
    harnessDirectories.map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

test("精选主题网络入口仅允许官方目录和版本化 Release 资源", () => {
  assert.equal(
    isThemeResourceURL(
      "https://raw.githubusercontent.com/jincaiw/moxie/main/public/theme-catalog-v1.json",
    ),
    true,
  );
  assert.equal(
    isThemeResourceURL(
      "https://github.com/jincaiw/moxie/releases/download/v0.16.78/theme-mist-blue.css",
    ),
    true,
  );
  for (const url of [
    "http://github.com/jincaiw/moxie/releases/download/v0.16.78/theme-mist-blue.css",
    "https://github.com/other/repo/releases/download/v0.16.78/theme-mist-blue.css",
    "https://github.com/jincaiw/moxie/releases/download/latest/theme-mist-blue.css",
    "https://github.com/jincaiw/moxie/releases/download/v0.16.78/anything.zip",
    "https://example.com/theme.css",
  ])
    assert.equal(isThemeResourceURL(url), false, url);
});

test("Pandoc 导出只开放固定格式，并从 PATH 查找可执行文件", () => {
  assert.deepEqual(Object.keys(pandocFormats).sort(), [
    "epub",
    "latex",
    "mediawiki",
    "odt",
    "rtf",
  ]);
  const candidates = pandocCandidates(
    { PATH: ["/custom/bin", "/usr/bin"].join(path.delimiter) },
    "linux",
  );
  assert.ok(candidates.includes(path.join("/custom/bin", "pandoc")));
  assert.ok(candidates.includes(path.join("/usr/bin", "pandoc")));
});

test("Pandoc 导出隔离远程图片并保留本地资源", async (t) => {
  if (process.platform === "win32")
    return t.skip("测试桩使用 POSIX 可执行脚本");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-pandoc-test-"));
  try {
    const executable = path.join(root, "pandoc");
    await fs.writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const output = args[args.indexOf("--output") + 1];
const latex = args.includes("--to=latex");
let html = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => html += chunk);
process.stdin.on("end", () => {
  const hasImage = fs.existsSync(path.join(process.cwd(), "media/image-1.png"));
  const containsImage = hasImage && html.includes('src="media/image-1.png"') && !html.includes("https://");
  fs.writeFileSync(output, Buffer.from(latex ? (containsImage ? "\\\\includegraphics{media/image-1.png}" : "missing-image") : "{\\\\rtf1\\\\ansi " + (containsImage ? "embedded-image" : "missing-image") + "}"));
});

`,
      { mode: 0o755 },
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
      "base64",
    );
    const result = await exportWithPandoc({
      html: `<html><body><h1>中文</h1><img alt="图标" src="data:image/png;base64,${png.toString("base64")}"><img alt="远程图" src="https://example.com/image.png"></body></html>`,
      format: "rtf",
      name: "测试.md",
      executable,
    });
    assert.equal(result.data.toString(), "{\\rtf1\\ansi embedded-image}");
    assert.deepEqual(result.assets, []);
    const latex = await exportWithPandoc({
      html: `<html><body><img alt="图标" src="data:image/png;base64,${png.toString("base64")}"><img alt="远程图" src="https://example.com/image.png"></body></html>`,
      format: "latex",
      name: "测试.md",
      executable,
      assetsDirectoryName: "测试.tex_assets",
    });
    assert.equal(
      latex.data.toString(),
      "\\includegraphics{测试.tex_assets/image-1.png}",
    );
    assert.equal(latex.assets.length, 1);
    assert.equal(latex.assets[0].name, "image-1.png");
    assert.deepEqual(latex.assets[0].data, png);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Pandoc 导入限制格式/大小与网络，并将图片嵌入未保存文档", async (t) => {
  if (process.platform === "win32")
    return t.skip("测试桩使用 POSIX 可执行脚本");
  assert.equal(importReaders.docx, "docx");
  assert.equal(importReaders.html, "html");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-import-test-"));
  try {
    const source = path.join(root, "source document.docx");
    const executable = path.join(root, "fake-pandoc");
    await fs.writeFile(source, "fake input");
    await fs.writeFile(path.join(root, "local.png"), "LOCALPNG");
    await fs.writeFile(
      executable,
      "#!/bin/sh\nmkdir -p media\nprintf 'PNGDATA' > media/image-1.png\nprintf '## Imported\\n\\n![image](media/image-1.png)\\n\\n![local](local.png)\\n'\n",
    );
    await fs.chmod(executable, 0o755);
    const imported = await importWithPandoc({ inputPath: source, executable });
    assert.equal(imported.name, "source document.md");
    assert.match(imported.text, /^## Imported/);
    assert.match(imported.text, /data:image\/png;base64,UE5HREFUQQ==/);
    assert.match(imported.text, /data:image\/png;base64,TE9DQUxQTkc=/);
    await assert.rejects(
      importWithPandoc({
        inputPath: path.join(root, "unsupported.bin"),
        executable,
      }),
      /不支持此导入格式/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("整篇长图按有界切片导出 SVG，失败或取消不留下半成品", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-image-export-"));
  const output = path.join(root, "document.svg");
  let dimensionsRead = false;
  let captures = 0;
  let destroyed = false;
  let unavailableImageText = "";
  class MockWindow {
    constructor(options) {
      assert.equal(options.show, false);
      this.webContents = {
        setWindowOpenHandler: () => undefined,
        session: { webRequest: { onBeforeRequest: () => undefined } },
        executeJavaScript: async (script) => {
          if (!dimensionsRead) {
            dimensionsRead = true;
            return vm.runInNewContext(script, {
              document: {
                fonts: { ready: Promise.resolve() },
                images: [
                  {
                    alt: "<缺失封面>",
                    decode: async () => {
                      throw Error("图片无法解码");
                    },
                    replaceWith: (element) => {
                      unavailableImageText = element.textContent;
                    },
                  },
                ],
                createElement: () => ({ style: {} }),
                documentElement: { scrollWidth: 2, scrollHeight: 3000 },
                body: { scrollWidth: 2, scrollHeight: 3000 },
              },
            });
          }
        },
        capturePage: async (_rect) => {
          captures++;
          return { toPNG: () => Buffer.from(`PNG${captures}`) };
        },
      };
    }
    async loadURL(url) {
      assert.match(url, /^data:text\/html;base64,/);
    }
    isDestroyed() {
      return destroyed;
    }
    destroy() {
      destroyed = true;
    }
  }
  try {
    const result = await exportDocumentAsSVG({
      html: "<html><body>document</body></html>",
      name: "document.md",
      BrowserWindow: MockWindow,
      dialog: { showSaveDialog: async () => ({ filePath: output }) },
      atomicWrite: require("../electron/files.cjs").atomicWrite,
    });
    assert.equal(result, output);
    assert.equal(captures, 2);
    assert.equal(destroyed, true);
    assert.equal(unavailableImageText, "图片不可用：<缺失封面>");
    const svg = await fs.readFile(output, "utf8");
    assert.match(svg, /width="2" height="3000"/);
    assert.equal((svg.match(/<image /g) || []).length, 2);
    assert.match(svg, /data:image\/png;base64,UE5HMQ==/);
    const canceled = await exportDocumentAsSVG({
      html: "<html></html>",
      name: "cancel.md",
      BrowserWindow: class {
        constructor() {
          throw Error("cancelled export must not create a window");
        }
      },
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      atomicWrite: require("../electron/files.cjs").atomicWrite,
    });
    assert.equal(canceled, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("发布前主题目录校验 CSS 摘要、预览资源和应用版本", () => {
  const packageVersion = require("../package.json").version;
  const catalog = JSON.parse(
    syncFS.readFileSync("public/theme-catalog-v1.json", "utf8"),
  );
  assert.equal(verifyThemeCatalog(catalog, packageVersion), true);
  const invalid = structuredClone(catalog);
  invalid.themes[0].sha256 = "0".repeat(64);
  assert.throws(
    () => verifyThemeCatalog(invalid, packageVersion),
    /大小或 SHA-256/,
  );
  assert.throws(
    () => verifyThemeCatalog(catalog, "0.16.77"),
    /高于当前应用版本/,
  );
});

test("精选主题下载限制重定向主机和响应大小", async () => {
  const url =
    "https://github.com/jincaiw/moxie/releases/download/v0.16.78/theme-mist-blue.css";
  const mockResponse = (body, finalURL) => {
    const response = new Response(body, {
      status: 200,
      headers: { "content-type": "text/css" },
    });
    Object.defineProperty(response, "url", { value: finalURL });
    return response;
  };
  const goodFetch = async () =>
    mockResponse(":root { --accent: #315f85; }", url);
  const response = await fetchThemeResource(url, goodFetch);
  assert.match(response, /--accent/);
  await assert.rejects(
    fetchThemeResource(url, async () =>
      mockResponse("ok", "https://example.com/theme.css"),
    ),
    /不受信任|最终地址无效/,
  );
  let redirectRequests = 0;
  await assert.rejects(
    fetchThemeResource(url, async () => {
      redirectRequests++;
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.com/theme.css" },
      });
    }),
    /不受信任/,
  );
  assert.equal(redirectRequests, 1);
  await assert.rejects(
    fetchThemeResource(url, async () =>
      mockResponse("x".repeat(256 * 1024 + 1), url),
    ),
    /超过 256 KB/,
  );
});
async function harness(userData) {
  if (!userData) {
    userData = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-main-test-"));
    harnessDirectories.push(userData);
  } else await fs.mkdir(userData, { recursive: true });
  const handlers = new Map(),
    events = new Map();
  const windows = [],
    externalUrls = [];
  let menuTemplate, dialogParent, clipboardContent;
  const mockUpdater = new EventEmitter();
  mockUpdater.checkForUpdates = async () => {};
  mockUpdater.downloadUpdate = async () => {};
  mockUpdater.quitAndInstall = () => {
    mockUpdater.installed = true;
  };
  let openResult = { canceled: true },
    saveResult = { canceled: true },
    messageResult = { response: 0 };
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.calls = [];
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.send = (channel, action) => {
        this.lastAction = action;
      };
      this.webContents.executeJavaScript = async (script) => {
        this.calls.push("waitForResources");
        this.readinessScript = script;
      };
      this.webContents.printToPDF = async (options) => {
        this.calls.push("printToPDF");
        this.printOptions = options;
        return Buffer.from("%PDF-test");
      };
      windows.push(this);
    }
    isDestroyed() {
      return Boolean(this.destroyed);
    }
    loadFile() {
      return Promise.resolve();
    }
    loadURL() {
      this.calls.push("loadURL");
      return Promise.resolve();
    }
    destroy() {
      this.destroyed = true;
    }
    setDocumentEdited() {}
    close() {
      this.closed = true;
    }
    static getAllWindows() {
      return windows;
    }
    static getFocusedWindow() {
      return windows.at(-1);
    }
  }
  const electron = {
    app: {
      isPackaged: true,
      getPath: () => userData,
      whenReady: () => Promise.resolve(),
      on: () => {},
      quit: () => {},
    },
    BrowserWindow: Window,
    Menu: {
      setApplicationMenu: (x) => {
        menuTemplate = x;
      },
      buildFromTemplate: (x) => x,
    },
    dialog: {
      showOpenDialog: async (parent) => {
        dialogParent = parent;
        return openResult;
      },
      showSaveDialog: async () => saveResult,
      showMessageBox: async () => messageResult,
    },
    ipcMain: {
      handle: (name, fn) => handlers.set(name, fn),
      on: (name, fn) => events.set(name, fn),
    },
    clipboard: {
      write: (value) => {
        clipboardContent = value;
      },
    },
    shell: {
      openExternal: async (url) => {
        externalUrls.push(url);
      },
    },
    nativeImage: {
      createFromDataURL: (dataURL) => ({
        isEmpty: () =>
          !/^data:image\/(?:avif|bmp|svg\+xml);base64,/.test(dataURL),
        getSize: () => ({ width: 1, height: 1 }),
        toPNG: () =>
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
            "base64",
          ),
      }),
    },
  };
  const source = await fs.readFile(
    path.join(__dirname, "../electron/main.cjs"),
    "utf8",
  );
  vm.runInNewContext(source, {
    require: (name) =>
      name === "electron"
        ? electron
        : name === "electron-updater"
          ? { autoUpdater: mockUpdater }
          : require(
              name.startsWith(".")
                ? path.join(__dirname, "../electron", name)
                : name,
            ),
    process: { env: {}, platform: "darwin" },
    __dirname: path.join(__dirname, "../electron"),
    Buffer,
    console,
  });
  await new Promise((r) => setTimeout(r, 20));
  const window = windows[0],
    event = {
      sender: window.webContents,
      senderFrame: window.webContents.mainFrame,
    };
  return {
    call: (name, input) => handlers.get(name)(event, input),
    callFor: (name, target, input) =>
      handlers.get(name)(
        {
          sender: target.webContents,
          senderFrame: target.webContents.mainFrame,
        },
        input,
      ),
    foreign: (name, input) =>
      handlers.get(name)({ sender: {}, senderFrame: {} }, input),
    open: (file) => {
      openResult = { canceled: false, filePaths: [file] };
    },
    save: (file) => {
      saveResult = { canceled: false, filePath: file };
    },
    response: (value) => {
      messageResult = { response: value };
    },
    window,
    windows,
    userData,
    waitForProfiles: async (count) => {
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          const ids = JSON.parse(
            await fs.readFile(path.join(userData, "windows.json"), "utf8"),
          );
          if (ids.length === count) return ids;
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error(`窗口会话数量未变为 ${count}`);
    },
    externalUrls,
    events,
    event,
    mockUpdater,
    menuTemplate,
    get clipboardContent() {
      return clipboardContent;
    },
    get dialogParent() {
      return dialogParent;
    },
  };
}
test("富文本剪贴板 IPC 同时写入 HTML 与纯文本并限制大小", async () => {
  const h = await harness();
  assert.equal(
    await h.call("clipboard:write-rich-text", {
      html: "<p><strong>加粗</strong></p>",
      text: "**加粗**",
    }),
    true,
  );
  assert.equal(h.clipboardContent.html, "<p><strong>加粗</strong></p>");
  assert.equal(h.clipboardContent.text, "**加粗**");
  await assert.rejects(
    h.call("clipboard:write-rich-text", {
      html: "x".repeat(5 * 1024 * 1024 + 1),
      text: "x",
    }),
    /5 MB 限制/,
  );
});
test("打开、原子保存、外部修改取消和明确覆盖", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-test-"));
  try {
    const file = path.join(root, "note.md");
    await fs.writeFile(file, "# 原文\r\n");
    const h = await harness();
    h.open(file);
    assert.equal((await h.call("file:open")).text, "# 原文\r\n");
    await h.call("file:save", {
      path: file,
      text: "# 修改\r\n",
      expected: "# 原文\r\n",
    });
    assert.equal(await fs.readFile(file, "utf8"), "# 修改\r\n");
    await fs.writeFile(file, "# 外部修改");
    assert.equal(
      await h.call("file:save", {
        path: file,
        text: "# 冲突",
        expected: "# 修改\r\n",
      }),
      null,
    );
    assert.equal(await fs.readFile(file, "utf8"), "# 外部修改");
    h.response(1);
    await h.call("file:save", {
      path: file,
      text: "# 冲突",
      expected: "# 修改\r\n",
    });
    assert.equal(await fs.readFile(file, "utf8"), "# 冲突");
    assert.deepEqual(await fs.readdir(root), ["note.md"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("PDF 导出等待图片与字体就绪后再生成并原子写入", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-pdf-test-"));
  try {
    const target = path.join(root, "output.pdf");
    const h = await harness();
    h.save(target);
    assert.equal(
      await h.call("file:export", {
        html: '<!doctype html><html><head><meta charset="utf-8"></head><body><img src="data:image/png;base64,AA=="><p>PDF</p></body></html>',
        name: "report.md",
        format: "pdf",
        pdf: { pageSize: "A4", margin: 20 },
      }),
      true,
    );
    const print = h.windows[1];
    assert.deepEqual(print.calls, [
      "loadURL",
      "waitForResources",
      "printToPDF",
    ]);
    assert.match(print.readinessScript, /document\.fonts/);
    assert.match(print.readinessScript, /image\.decode/);
    assert.match(print.readinessScript, /8000/);
    assert.equal(print.destroyed, true);
    assert.equal(await fs.readFile(target, "utf8"), "%PDF-test");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("DOCX 导出将 BMP 和 AVIF 图片转换为 Word 兼容的 PNG", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-docx-test-"));
  try {
    const target = path.join(root, "output.docx");
    const h = await harness();
    h.save(target);
    const avif = Buffer.alloc(24);
    avif.writeUInt32BE(24, 0);
    avif.write("ftyp", 4);
    avif.write("avif", 8);
    avif.write("mif1", 16);
    avif.write("avif", 20);
    const bmp = Buffer.from(
      "424d3a000000000000003600000028000000010000000100000001001800000000000400000000000000000000000000000000000000000000ff0000",
      "hex",
    );
    const svg = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
    );
    assert.equal(
      await h.call("file:export", {
        html: `<html><body><img alt="BMP" src="data:image/bmp;base64,${bmp.toString("base64")}"><img alt="AVIF" src=data:image/avif;base64,${avif.toString("base64")}><img alt="SVG" src="data:image/svg+xml;base64,${svg.toString("base64")}"></body></html>`,
        name: "report.md",
        format: "docx",
      }),
      true,
    );
    const JSZip = require("jszip");
    const archive = await JSZip.loadAsync(await fs.readFile(target));
    const imageEntries = Object.keys(archive.files).filter((name) =>
      /^word\/media\/image-/.test(name),
    );
    assert.ok(imageEntries.length > 0);
    assert.ok(imageEntries.every((name) => name.endsWith(".png")));
    const contentTypes = await archive
      .file("[Content_Types].xml")
      .async("string");
    assert.match(contentTypes, /Extension="png"/);
    assert.doesNotMatch(contentTypes, /Extension="bmp"/);
    for (const name of imageEntries)
      assert.deepEqual(
        await archive.file(name).async("nodebuffer"),
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
          "base64",
        ),
      );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("PDF 分页预览使用最终打印流程且不创建导出文件", async () => {
  const h = await harness();
  const bytes = await h.call("pdf:preview", {
    html: '<!doctype html><html><head><meta charset="utf-8"></head><body><p>预览</p></body></html>',
    pdf: {
      pageSize: "Letter",
      landscape: true,
      margin: 12,
      headerFooter: true,
    },
  });
  assert.equal(Object.prototype.toString.call(bytes), "[object Uint8Array]");
  assert.equal(Buffer.from(bytes).toString(), "%PDF-test");
  assert.deepEqual(h.windows[1].calls, [
    "loadURL",
    "waitForResources",
    "printToPDF",
  ]);
  assert.equal(h.windows[1].printOptions.generateDocumentOutline, true);
  assert.equal(h.windows[1].destroyed, true);
});
test("未知窗口被拒绝，未授权路径必须通过另存为对话框", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-test-"));
  try {
    const h = await harness(),
      file = path.join(root, "file.md");
    await fs.writeFile(file, "保留");
    await assert.rejects(
      () => h.foreign("file:save", { path: file, text: "覆盖" }),
      /拒绝未知窗口/,
    );
    assert.equal(await h.call("file:save", { path: file, text: "覆盖" }), null);
    assert.equal(await fs.readFile(file, "utf8"), "保留");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("关闭脏文档时取消有效，保留副本先通知渲染层", async () => {
  const h = await harness();
  h.events.get("document:dirty")(h.event, true);
  let prevented = false;
  h.window.emit("close", {
    preventDefault() {
      prevented = true;
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.ok(prevented);
  assert.equal(h.window.closed, undefined);
  h.response(2);
  h.window.emit("close", { preventDefault() {} });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.window.lastAction, "keep-close");
  assert.equal(h.window.closed, undefined);
  h.events.get("window:close-ready")(h.event);
  assert.equal(h.window.closed, true);
});
test("新建窗口独立恢复工作区和未保存状态，并在关闭时清理恢复项", async () => {
  const h = await harness();
  const fileMenu = h.menuTemplate.find((menu) => menu.label === "文件");
  fileMenu.submenu.find((item) => item.label === "新建窗口").click();
  assert.equal(h.windows.length, 2);
  const [first, second] = h.windows;
  assert.notEqual(
    first.options.webPreferences.partition,
    second.options.webPreferences.partition,
  );
  assert.match(
    second.options.webPreferences.partition,
    /^persist:moxie-workspace-[\da-f-]{36}$/i,
  );
  const profiles = await h.waitForProfiles(1);
  const restarted = await harness(h.userData);
  assert.equal(restarted.windows.length, 2);
  const restoredSecondary = restarted.windows[1];
  assert.equal(
    restoredSecondary.options.webPreferences.partition,
    second.options.webPreferences.partition,
  );

  h.events.get("document:dirty")(
    { sender: first.webContents, senderFrame: first.webContents.mainFrame },
    true,
  );
  h.events.get("document:dirty")(
    { sender: second.webContents, senderFrame: second.webContents.mainFrame },
    false,
  );
  let firstPrevented = false;
  first.emit("close", {
    preventDefault() {
      firstPrevented = true;
    },
  });
  let secondPrevented = false;
  second.emit("close", {
    preventDefault() {
      secondPrevented = true;
    },
  });
  assert.equal(firstPrevented, true);
  assert.equal(secondPrevented, false);

  h.mockUpdater.emit("update-available", { version: "0.16.62" });
  h.mockUpdater.emit("update-downloaded", { version: "0.16.62" });
  await assert.rejects(() => h.call("update:install"), /文档尚未保存/);
  h.events.get("document:dirty")(
    { sender: first.webContents, senderFrame: first.webContents.mainFrame },
    false,
  );
  await h.call("update:install");
  assert.equal(h.mockUpdater.installed, true);

  await h.callFor("file:open", second);
  assert.equal(h.dialogParent, second);

  restoredSecondary.emit("closed");
  assert.deepEqual(await restarted.waitForProfiles(0), []);
  assert.equal(profiles.length, 1);

  const restoredFileMenu = restarted.menuTemplate.find(
    (menu) => menu.label === "文件",
  );
  restoredFileMenu.submenu.find((item) => item.label === "新建窗口").click();
  const retainedWindow = restarted.windows[2];
  restarted.events.get("document:dirty")(
    {
      sender: retainedWindow.webContents,
      senderFrame: retainedWindow.webContents.mainFrame,
    },
    true,
  );
  retainedWindow.emit("closed");
  const retainedProfiles = await restarted.waitForProfiles(1);
  const afterRetainedClose = await harness(h.userData);
  assert.equal(afterRetainedClose.windows.length, 2);
  assert.equal(
    afterRetainedClose.windows[1].options.webPreferences.partition,
    `persist:moxie-workspace-${retainedProfiles[0]}`,
  );
});
const { FileStore } = require("../electron/files.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
  "base64",
);
const bmp = Buffer.from(
  "424d3a000000000000003600000028000000010000000100000001001800000000000400000000000000000000000000000000000000000000ff0000",
  "hex",
);
const avif = Buffer.alloc(24);
avif.writeUInt32BE(24, 0);
avif.write("ftyp", 4);
avif.write("avif", 8);
avif.write("mif1", 16);
avif.write("avif", 20);
test("图片资源写入、读取、非法格式、越界与符号链接检查", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-images-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-outside-"));
  try {
    const documentPath = path.join(root, "note.md");
    await fs.writeFile(documentPath, "# Note");
    const store = new FileStore();
    await store.read(documentPath);
    const stored = await store.storeImage({ documentPath, bytes: png });
    assert.match(stored.relativePath, /^note\.assets\/[\w-]+\.png$/);
    assert.equal(
      await store.readImage({
        documentPath,
        relativePath: stored.relativePath,
      }),
      "data:image/png;base64," + png.toString("base64"),
    );
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
    );
    for (const [bytes, extension, mime] of [
      [bmp, "bmp", "image/bmp"],
      [avif, "avif", "image/avif"],
      [svg, "svg", "image/svg+xml"],
    ]) {
      const storedImage = await store.storeImage({ documentPath, bytes });
      assert.match(
        storedImage.relativePath,
        new RegExp(`^note\\.assets/[\\w-]+\\.${extension}$`),
      );
      assert.equal(
        await store.readImage({
          documentPath,
          relativePath: storedImage.relativePath,
        }),
        `data:${mime};base64,${bytes.toString("base64")}`,
      );
    }
    const copied = await store.storeImage({
      documentPath,
      bytes: png,
      targetDirectory: "_media/month",
    });
    assert.match(copied.relativePath, /^_media\/month\/[\w-]+\.png$/);
    assert.equal(
      await store.readImage({
        documentPath,
        relativePath: copied.relativePath,
      }),
      "data:image/png;base64," + png.toString("base64"),
    );
    await assert.rejects(
      () =>
        store.storeImage({
          documentPath,
          bytes: Buffer.from("<script>bad</script>"),
        }),
      /格式无效/,
    );
    await assert.rejects(
      () => store.readImage({ documentPath, relativePath: "../outside.png" }),
      /已打开的文件夹内/,
    );
    await fs.writeFile(path.join(outside, "secret.png"), png);
    await fs.symlink(
      path.join(outside, "secret.png"),
      path.join(root, "linked.png"),
    );
    await assert.rejects(
      () => store.readImage({ documentPath, relativePath: "linked.png" }),
      /已打开文件夹之外/,
    );
    await fs.symlink(outside, path.join(root, "linked-directory"));
    await assert.rejects(
      () =>
        store.storeImage({
          documentPath,
          bytes: png,
          targetDirectory: "linked-directory/nested",
        }),
      /符号链接/,
    );
    await assert.rejects(
      () =>
        store.storeImage({
          documentPath,
          bytes: png,
          targetDirectory: "../../outside",
        }),
      /授权|文件夹内/,
    );
    const otherDoc = path.join(root, "other.md");
    await fs.writeFile(otherDoc, "");
    await store.read(otherDoc);
    await fs.symlink(outside, path.join(root, "other.assets"));
    await assert.rejects(
      () => store.storeImage({ documentPath: otherDoc, bytes: png }),
      /目录之外/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
test("自动保存不弹出路径或冲突对话框，不覆盖外部修改", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-auto-"));
  try {
    const store = new FileStore(),
      file = path.join(root, "note.md");
    await fs.writeFile(file, "initial");
    await store.read(file);
    let dialogs = 0;
    const dialog = async () => {
      dialogs++;
      return true;
    };
    await store.save(
      { path: file, text: "saved", expected: "initial", automatic: true },
      dialog,
      dialog,
    );
    assert.equal(await fs.readFile(file, "utf8"), "saved");
    await fs.writeFile(file, "external");
    await assert.rejects(
      () =>
        store.save(
          { path: file, text: "overwrite", expected: "saved", automatic: true },
          dialog,
          dialog,
        ),
      /自动保存已暂停/,
    );
    await assert.rejects(
      () => store.save({ text: "new", automatic: true }, dialog, dialog),
      /确认文件路径/,
    );
    assert.equal(dialogs, 0);
    assert.equal(await fs.readFile(file, "utf8"), "external");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("重启后保留最近文件与已选定文件权限", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-recent-"));
  try {
    const state = path.join(root, "state", "files.json"),
      file = path.join(root, "note.md");
    await fs.writeFile(file, "initial");
    const first = new FileStore(state);
    await first.init();
    await first.read(file);
    const restored = new FileStore(state);
    await restored.init();
    assert.deepEqual(restored.recent, [file]);
    await restored.save(
      { path: file, text: "restored", expected: "initial", automatic: true },
      async () => {
        throw Error("不应弹窗");
      },
      async () => {
        throw Error("不应弹窗");
      },
    );
    assert.equal(await fs.readFile(file, "utf8"), "restored");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("递归目录按需授权、刷新和符号链接隔离", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-tree-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-outside-"));
  try {
    await fs.mkdir(path.join(root, "章节"));
    await fs.mkdir(path.join(root, ".git"));
    await fs.writeFile(path.join(root, "章节", "笔记.md"), "# 子目录");
    await fs.writeFile(path.join(root, ".git", "隐藏.md"), "hidden");
    await fs.writeFile(path.join(root, "notes.txt"), "plain text");
    await fs.writeFile(path.join(outside, "private.md"), "private");
    await fs.symlink(outside, path.join(root, "link"));
    const h = await harness();
    await assert.rejects(h.call("folder:refresh", root), /请先选择/);
    h.open(root);
    const tree = await h.call("file:folder");
    assert.equal(tree.name, path.basename(root));
    assert.equal(tree.entries.length, 2);
    const note = tree.entries.find((entry) => entry.kind === "directory")
      .children[0];
    assert.ok(tree.entries.some((entry) => entry.name === "notes.txt"));
    assert.equal(note.name, "笔记.md");
    assert.equal((await h.call("file:recent")).length, 0);
    assert.equal((await h.call("file:reopen", note.path)).text, "# 子目录");
    await fs.writeFile(path.join(root, "new.markdown"), "new");
    assert.equal((await h.call("folder:refresh", tree.path)).entries.length, 3);
    await fs.rm(note.path);
    await fs.symlink(path.join(outside, "private.md"), note.path);
    await assert.rejects(h.call("file:reopen", note.path), /文件夹之外/);
    const result = await h.call("file:inspect", [{ path: note.path }]);
    assert.equal(result[0].status, "unavailable");
    assert.equal(result[0].text, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("文件夹搜索为 LF、CR 和 CRLF 文档生成单行摘录", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-search-eol-"));
  try {
    const store = new FileStore();
    await store.init();
    for (const [index, newline] of ["\n", "\r", "\r\n"].entries())
      await fs.writeFile(
        path.join(root, `note-${index}.md`),
        `前一行${newline}命中关键词的独立行${newline}后一行`,
      );
    const tree = await store.folder(root);
    const result = await store.searchFolder({
      root: tree.path,
      query: "关键词",
    });
    assert.equal(result.results.length, 3);
    assert.ok(
      result.results.every((item) => item.excerpt === "命中关键词的独立行"),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("版本检查识别修改、删除、重建且不会消费未处理事件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-inspect-"));
  try {
    const file = path.join(root, "note.md");
    await fs.writeFile(file, "old");
    const h = await harness();
    h.open(file);
    const disk = await h.call("file:open");
    const request = [{ path: file, version: disk.version }];
    assert.deepEqual(await h.call("file:inspect", request), []);
    await fs.writeFile(file, "changed");
    const changes = await h.call("file:inspect", request);
    assert.equal(changes[0].text, "changed");
    assert.deepEqual(await h.call("file:inspect", request), changes);
    assert.deepEqual(
      await h.call("file:inspect", [
        { path: file, version: changes[0].version },
      ]),
      [],
    );
    await fs.rm(file);
    assert.equal((await h.call("file:inspect", request))[0].status, "missing");
    await fs.writeFile(file, "rebuilt");
    assert.equal(
      (await h.call("file:inspect", [{ path: file, version: "missing" }]))[0]
        .text,
      "rebuilt",
    );
    await assert.rejects(h.foreign("file:inspect", request), /未知窗口/);
    await assert.rejects(
      h.call("file:inspect", [{ path: path.join(root, "secret.md") }]),
      /未获授权/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("文件夹授权重启恢复，目录版本随内容与时间信息变化更新", async () => {
  const { FileStore } = require("../electron/files.cjs");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-folder-session-"),
  );
  try {
    const state = path.join(root, ".state", "files.json");
    await fs.mkdir(path.join(root, "章节"));
    const file = path.join(root, "章节", "第一章.md");
    await fs.writeFile(file, "chapter");
    const store = new FileStore(state);
    await store.init();
    const tree = await store.folder(root);
    for (let index = 0; index < 11; index++) {
      const other = path.join(root, `.workspace-${index}`);
      await fs.mkdir(other);
      await store.folder(other);
    }
    await store.folder(tree.path);
    const reopened = new FileStore(state);
    await reopened.init();
    assert.equal(await reopened.folder(tree.path, true, tree.version), null);
    assert.equal((await reopened.read(file, true)).text, "chapter");
    await fs.writeFile(path.join(root, "第二章.md"), "new");
    const changed = await reopened.folder(tree.path, true, tree.version);
    assert.notEqual(changed.version, tree.version);
    assert.equal(changed.entries.length, 2);
    await fs.writeFile(path.join(root, "第二章.md"), "content change");
    const edited = await reopened.folder(tree.path, true, changed.version);
    assert.notEqual(edited.version, changed.version);
    assert.equal(await reopened.folder(tree.path, true, edited.version), null);
    await fs.rm(path.join(root, "第二章.md"));
    assert.equal(
      (await reopened.folder(tree.path, true, changed.version)).entries.length,
      1,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("目录规范路径与文件选择器路径别名共享授权且保留边界检查", async () => {
  const { FileStore } = require("../electron/files.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-path-identity-"));
  const alias = `${root}-alias`;
  try {
    await fs.mkdir(path.join(root, "章节"));
    const source = path.join(root, "章节", "source.md");
    await fs.writeFile(source, "source");
    await fs.writeFile(path.join(root, "章节", "target.md"), "# target");
    await fs.symlink(root, alias, "dir");
    const store = new FileStore(path.join(root, ".state", "files.json"));
    await store.init();
    const tree = await store.folder(root);
    const selectedAlias = path.join(alias, "章节", "source.md");
    assert.equal((await store.read(selectedAlias, true)).text, "source");
    const linked = await store.openLinked(selectedAlias, "target.md#part");
    assert.equal(linked.file.text, "# target");
    assert.equal(linked.anchor, "part");
    assert.equal(tree.path, await fs.realpath(alias));
  } finally {
    await fs.rm(alias, { force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("自动更新检查、下载进度、未保存拦截和安装流程", async () => {
  const updater = new EventEmitter();
  let dirty = true;
  let installed = false;
  updater.checkForUpdates = async () => {
    updater.emit("checking-for-update");
    updater.emit("update-available", { version: "0.17.0" });
  };
  updater.downloadUpdate = async () => {
    updater.emit("download-progress", { percent: 42 });
    updater.emit("update-downloaded", { version: "0.17.0" });
  };
  updater.quitAndInstall = () => {
    installed = true;
  };
  const statuses = [];
  const controller = new UpdateController({
    updater,
    supported: true,
    hasUnsavedChanges: () => dirty,
    onStatus: (status) => statuses.push(status),
  });
  assert.equal(updater.autoDownload, false);
  assert.deepEqual(await controller.check(), {
    status: "available",
    version: "0.17.0",
  });
  await controller.download();
  assert.ok(statuses.some((status) => status.percent === 42));
  assert.equal(controller.getStatus().status, "downloaded");
  assert.throws(() => controller.install(), /文档尚未保存/);
  assert.equal(controller.getStatus().status, "downloaded");
  dirty = false;
  controller.install();
  assert.equal(installed, true);
});

test("多窗口同时请求时合并自动更新检查与下载", async () => {
  const updater = new EventEmitter();
  let checks = 0;
  let downloads = 0;
  let finishCheck;
  let finishDownload;
  updater.checkForUpdates = () => {
    checks += 1;
    return new Promise((resolve) => {
      finishCheck = () => {
        updater.emit("update-available", { version: "0.17.0" });
        resolve();
      };
    });
  };
  updater.downloadUpdate = () => {
    downloads += 1;
    return new Promise((resolve) => {
      finishDownload = () => {
        updater.emit("update-downloaded", { version: "0.17.0" });
        resolve();
      };
    });
  };
  const controller = new UpdateController({
    updater,
    supported: true,
    hasUnsavedChanges: () => false,
  });

  const firstCheck = controller.check();
  const secondCheck = controller.check();
  assert.equal(checks, 1);
  finishCheck();
  assert.deepEqual(await firstCheck, await secondCheck);
  assert.equal(controller.getStatus().status, "available");

  const firstDownload = controller.download();
  const secondDownload = controller.download();
  assert.equal(downloads, 1);
  finishDownload();
  assert.deepEqual(await firstDownload, await secondDownload);
  assert.equal(controller.getStatus().status, "downloaded");
});

test("自动更新只对正式支持的安装格式启用", () => {
  assert.equal(
    supportsAutoUpdate({ isPackaged: true, platform: "darwin" }),
    true,
  );
  assert.equal(
    supportsAutoUpdate({ isPackaged: true, platform: "win32" }),
    true,
  );
  assert.equal(
    supportsAutoUpdate({ isPackaged: true, platform: "linux", env: {} }),
    false,
  );
  assert.equal(
    supportsAutoUpdate({
      isPackaged: true,
      platform: "linux",
      env: { APPIMAGE: "/opt/Moxie.AppImage" },
    }),
    true,
  );
  assert.equal(
    supportsAutoUpdate({ isPackaged: false, platform: "win32" }),
    false,
  );
  assert.match(
    describeUpdateError(Error("code signature invalid"), "darwin"),
    /macOS/,
  );
  assert.match(
    describeUpdateError(Error("certificate invalid"), "win32"),
    /官方发布页/,
  );
});

test("Windows 与 Linux 发布目标及平台图标已配置", () => {
  const config = require("../package.json");
  const build = config.build;
  assert.equal(build.win.target[0].target, "nsis");
  assert.equal(build.linux.target[0].target, "AppImage");
  assert.equal(config.desktopName, "moxie-editor");
  assert.equal(build.linux.syncDesktopName, true);
  assert.equal(syncFS.existsSync(build.win.icon), true);
  assert.equal(syncFS.existsSync(build.linux.icon), true);
});

test("macOS 发布只接受完整签名凭据，并验证签名与公证票据", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-macos-signing-"));
  harnessDirectories.push(root);
  const workflow = yaml.load(
    await fs.readFile(
      path.join(__dirname, "../.github/workflows/release.yml"),
      "utf8",
    ),
  );
  const steps = workflow.jobs.build.steps;
  const configure = steps.find(
    (step) => step.name === "Configure optional macOS signing credentials",
  );
  const verify = steps.find(
    (step) => step.name === "Verify macOS signature and notarization",
  );
  assert.equal(configure.run, "bash scripts/configure-macos-signing.sh");
  assert.ok(verify.run.includes("codesign --verify --deep --strict"));
  assert.ok(verify.run.includes("xcrun stapler validate"));
  assert.equal(spawnSync("bash", ["-n", "-c", verify.run]).status, 0);

  const script = path.join(__dirname, "../scripts/configure-macos-signing.sh");
  const envFile = path.join(root, "github-env");
  const run = (credentials) => {
    syncFS.writeFileSync(envFile, "");
    return spawnSync("bash", [script], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_ENV: envFile,
        MACOS_CERTIFICATE: "",
        MACOS_CERTIFICATE_PASSWORD: "",
        APPLE_ID: "",
        APPLE_APP_SPECIFIC_PASSWORD: "",
        APPLE_TEAM_ID: "",
        ...credentials,
      },
    });
  };

  const unsigned = run({});
  assert.equal(unsigned.status, 0, unsigned.stderr);
  assert.match(
    syncFS.readFileSync(envFile, "utf8"),
    /MACOS_SIGNING_ENABLED=false/,
  );

  const partial = run({ MACOS_CERTIFICATE: "base64-certificate" });
  assert.notEqual(partial.status, 0);
  assert.match(partial.stderr, /all five macOS signing secrets/);

  const signed = run({
    MACOS_CERTIFICATE: "base64-certificate",
    MACOS_CERTIFICATE_PASSWORD: "certificate-password",
    APPLE_ID: "developer@example.com",
    APPLE_APP_SPECIFIC_PASSWORD: "app-password",
    APPLE_TEAM_ID: "TEAM123456",
  });
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(
    syncFS.readFileSync(envFile, "utf8"),
    /MACOS_SIGNING_ENABLED=true/,
  );
});

test("arm64 与 x64 更新清单合并并拒绝缺失架构", () => {
  const metadata = (arch) => ({
    version: "0.17.0",
    path: `Moxie-0.17.0-${arch}.zip`,
    sha512: `${arch}-checksum`,
    files: [
      {
        url: "Moxie-0.17.0-x64.zip",
        sha512: `${arch}-x64-zip`,
        size: 100,
      },
      {
        url: "Moxie-0.17.0-arm64.zip",
        sha512: `${arch}-arm64-zip`,
        size: 90,
      },
      {
        url: "Moxie-0.17.0-x64.dmg",
        sha512: `${arch}-x64-dmg`,
        size: 110,
      },
      {
        url: "Moxie-0.17.0-arm64.dmg",
        sha512: `${arch}-arm64-dmg`,
        size: 95,
      },
    ],
  });
  const merged = mergeMacUpdateInfo(metadata("arm64"), metadata("x64"));
  assert.equal(merged.files.length, 4);
  assert.deepEqual(
    merged.files.map(({ url, sha512, size }) => [url, sha512, size]),
    [
      ["Moxie-0.17.0-arm64.zip", "arm64-arm64-zip", 90],
      ["Moxie-0.17.0-arm64.dmg", "arm64-arm64-dmg", 95],
      ["Moxie-0.17.0-x64.zip", "x64-x64-zip", 100],
      ["Moxie-0.17.0-x64.dmg", "x64-x64-dmg", 110],
    ],
  );
  assert.equal("path" in merged, false);
  const arm64OnlyMetadata = {
    ...metadata("arm64"),
    files: metadata("arm64").files.filter((file) =>
      file.url.includes("-arm64."),
    ),
  };
  assert.throws(
    () => mergeMacUpdateInfo(metadata("arm64"), arm64OnlyMetadata),
    /包含唯一且正确架构的 arm64 和 x64/,
  );
  assert.throws(
    () =>
      mergeMacUpdateInfo(metadata("arm64"), {
        ...metadata("x64"),
        version: "0.18.0",
      }),
    /版本必须一致/,
  );
});

test("链接打开关联文档及锚点，限制目录边界和协议", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-links-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-links-out-"));
  try {
    await fs.mkdir(path.join(root, "章节"));
    const source = path.join(root, "章节", "第一章.md"),
      target = path.join(root, "目标 文档.md");
    await fs.writeFile(source, "source");
    await fs.writeFile(target, "# 目标");
    await fs.writeFile(path.join(outside, "secret.md"), "private");
    const h = await harness();
    h.open(source);
    await h.call("file:open");
    await assert.rejects(
      h.call("link:open", { documentPath: source, href: "../目标%20文档.md" }),
      /文件夹内/,
    );
    h.open(root);
    await h.call("file:folder");
    await assert.rejects(
      h.call("link:open", {
        documentPath: source,
        href: "../%E0%A4%A.md",
      }),
      /无效的百分号编码/,
    );
    await assert.rejects(
      h.call("link:open", {
        documentPath: source,
        href: "../%E7%9B%AE%E6%A0%87%20%E6%96%87%E6%A1%A3.md#bad%",
      }),
      /无效的百分号编码/,
    );
    const result = await h.call("link:open", {
      documentPath: source,
      href: "../%E7%9B%AE%E6%A0%87%20%E6%96%87%E6%A1%A3.md#%E7%9B%AE%E6%A0%87",
    });
    assert.equal(result.file.path, await fs.realpath(target));
    assert.equal(result.anchor, "目标");
    await fs.symlink(
      path.join(outside, "secret.md"),
      path.join(root, "linked.md"),
    );
    await assert.rejects(
      h.call("link:open", { documentPath: source, href: "../linked.md" }),
      /文件夹内/,
    );
    for (const href of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "//example.com/x.md",
    ])
      await assert.rejects(h.call("link:open", { documentPath: source, href }));
    await h.call("link:open", { href: "https://example.com/docs" });
    await h.call("link:open", { href: "mailto:writer@example.com" });
    assert.deepEqual(h.externalUrls, [
      "https://example.com/docs",
      "mailto:writer@example.com",
    ]);
    await assert.rejects(
      h.foreign("link:open", { href: "https://example.com" }),
      /未知窗口/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("重启后仍阻止已授权目录文档被替换为外部符号链接", async () => {
  const { FileStore } = require("../electron/files.cjs");
  const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "moxie-restored-scope-"),
    ),
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-scope-out-"));
  try {
    const state = path.join(root, ".state", "files.json"),
      file = path.join(root, "note.md"),
      secret = path.join(outside, "secret.md");
    await fs.writeFile(file, "original");
    await fs.writeFile(secret, "private");
    const store = new FileStore(state);
    await store.folder(root);
    await fs.rm(file);
    await fs.symlink(secret, file);
    const restored = new FileStore(state);
    await restored.init();
    await assert.rejects(restored.read(file, true), /文件夹之外/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("目录文件操作限制授权范围、拒绝覆盖并安全撤销", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-file-ops-"));
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-file-ops-outside-"),
  );
  const trashed = [];
  try {
    const store = new FileStore(undefined, async (file) => {
      trashed.push(file);
    });
    const authorizedRoot = (await store.folder(root)).path;
    const original = path.join(authorizedRoot, "note.md");
    const destination = path.join(authorizedRoot, "nested");
    await fs.writeFile(original, "# note\n");
    await fs.mkdir(destination);
    await store.fileOperation({
      action: "new-file",
      root: authorizedRoot,
      target: authorizedRoot,
      name: "new.md",
    });
    await assert.rejects(
      store.fileOperation({
        action: "new-file",
        root: authorizedRoot,
        target: authorizedRoot,
        name: "new.md",
      }),
      /同名|EEXIST/,
    );
    await assert.rejects(
      store.fileOperation({
        action: "new-file",
        root: authorizedRoot,
        target: authorizedRoot,
        name: ".." + path.sep + "outside.md",
      }),
      /名称无效/,
    );
    await store.fileOperation({ action: "undo", root: authorizedRoot });
    await assert.rejects(fs.access(path.join(authorizedRoot, "new.md")));
    await store.fileOperation({
      action: "copy",
      root: authorizedRoot,
      target: original,
      name: "copy.md",
    });
    await assert.equal(
      await fs.readFile(path.join(authorizedRoot, "copy.md"), "utf8"),
      "# note\n",
    );
    await store.fileOperation({
      action: "rename",
      root: authorizedRoot,
      target: path.join(authorizedRoot, "copy.md"),
      name: "renamed.md",
    });
    await store.fileOperation({
      action: "move",
      root: authorizedRoot,
      target: path.join(authorizedRoot, "renamed.md"),
      directory: destination,
    });
    await assert.equal(
      await fs.readFile(path.join(destination, "renamed.md"), "utf8"),
      "# note\n",
    );
    await fs.writeFile(path.join(destination, "renamed.md"), "user edit\n");
    await assert.rejects(
      store.fileOperation({ action: "undo", root: authorizedRoot }),
      /内容已更改/,
    );
    await fs.writeFile(path.join(destination, "renamed.md"), "# note\n");
    await store.fileOperation({ action: "undo", root: authorizedRoot });
    await assert.equal(
      await fs.readFile(path.join(authorizedRoot, "renamed.md"), "utf8"),
      "# note\n",
    );
    await store.fileOperation({ action: "undo", root: authorizedRoot });
    await assert.equal(
      await fs.readFile(path.join(authorizedRoot, "copy.md"), "utf8"),
      "# note\n",
    );
    await store.fileOperation({ action: "undo", root: authorizedRoot });
    await assert.rejects(fs.access(path.join(authorizedRoot, "copy.md")));
    await store.fileOperation({
      action: "trash",
      root: authorizedRoot,
      target: original,
    });
    await assert.deepEqual(trashed, [original]);
    await assert.rejects(store.read(original, true), /授权|打开/);
    await fs.mkdir(path.join(authorizedRoot, "safe-target"));
    await fs.symlink(
      path.join(authorizedRoot, "safe-target"),
      path.join(authorizedRoot, "safe-alias"),
    );
    await assert.rejects(
      store.fileOperation({
        action: "new-file",
        root: authorizedRoot,
        target: path.join(authorizedRoot, "safe-alias"),
        name: "hidden.md",
      }),
      /符号链接/,
    );
    const link = path.join(authorizedRoot, "escape.md");
    await fs.symlink(path.join(outside, "secret.md"), link);
    await assert.rejects(
      store.fileOperation({
        action: "trash",
        root: authorizedRoot,
        target: link,
      }),
      /授权|符号链接|普通文件/,
    );
    await assert.rejects(
      store.fileOperation({
        action: "new-file",
        root: outside,
        target: outside,
        name: "bad.md",
      }),
      /授权/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("整目录复制、重命名、移动和撤销会同步文档授权路径", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-directory-ops-"));
  try {
    const store = new FileStore();
    const authorizedRoot = (await store.folder(root)).path;
    const source = path.join(authorizedRoot, "notes");
    const note = path.join(source, "nested", "note.md");
    await fs.mkdir(path.dirname(note), { recursive: true });
    await fs.writeFile(note, "# note\n");
    await store.folder(source);
    const copy = await store.fileOperation({
      action: "copy",
      root: authorizedRoot,
      target: source,
      name: "notes copy",
    });
    const copiedNote = path.join(copy.path, "nested", "note.md");
    assert.equal(await fs.readFile(copiedNote, "utf8"), "# note\n");
    assert.equal(
      await store.read(copiedNote, true).then((item) => item.text),
      "# note\n",
    );
    await store.fileOperation({ action: "undo", root: authorizedRoot });
    await assert.rejects(fs.access(copy.path));
    await assert.rejects(store.read(copiedNote, true));

    const renamed = await store.fileOperation({
      action: "rename",
      root: authorizedRoot,
      target: source,
      name: "renamed",
    });
    assert.equal(renamed.paths.length, 1);
    assert.equal(
      await fs.readFile(path.join(renamed.path, "nested", "note.md"), "utf8"),
      "# note\n",
    );
    await store.fileOperation({ action: "undo", root: authorizedRoot });
    assert.equal(await fs.readFile(note, "utf8"), "# note\n");

    const destination = path.join(authorizedRoot, "destination");
    await fs.mkdir(destination);
    const moved = await store.fileOperation({
      action: "move",
      root: authorizedRoot,
      target: source,
      directory: destination,
      name: "notes",
    });
    assert.equal(
      await fs.readFile(path.join(moved.path, "nested", "note.md"), "utf8"),
      "# note\n",
    );
    await store.fileOperation({ action: "undo", root: authorizedRoot });
    assert.equal(await fs.readFile(note, "utf8"), "# note\n");
    await assert.rejects(
      store.fileOperation({
        action: "copy",
        root: authorizedRoot,
        target: source,
        name: "destination",
      }),
      /同名/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("整目录操作拒绝符号链接且废纸篓撤销授权路径", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-directory-safe-"),
  );
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-directory-out-"),
  );
  const trashed = [];
  try {
    const store = new FileStore(undefined, async (file) => trashed.push(file));
    const authorizedRoot = (await store.folder(root)).path;
    const source = path.join(authorizedRoot, "notes");
    await fs.mkdir(source);
    const note = path.join(source, "note.md");
    await fs.writeFile(note, "hello");
    await store.folder(source);
    await fs.symlink(path.join(outside, "secret"), path.join(source, "escape"));
    await assert.rejects(
      store.fileOperation({
        action: "copy",
        root: authorizedRoot,
        target: source,
        name: "copy",
      }),
      /符号链接/,
    );
    await fs.rm(path.join(source, "escape"));
    await store.fileOperation({
      action: "trash",
      root: authorizedRoot,
      target: source,
    });
    assert.deepEqual(trashed, [source]);
    await assert.rejects(store.read(note, true), /授权|打开/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("文件夹显示筛选可显示隐藏项和其他文件但不授予其文档读取权限", async () => {
  const { FileStore } = require("../electron/files.cjs");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-folder-filters-"),
  );
  try {
    await fs.mkdir(path.join(root, ".drafts"));
    await fs.mkdir(path.join(root, "node_modules"));
    const markdown = path.join(root, "note.md");
    const hidden = path.join(root, ".drafts", "private.md");
    const image = path.join(root, "diagram.png");
    const dependency = path.join(root, "node_modules", "ignored.js");
    await Promise.all([
      fs.writeFile(markdown, "note"),
      fs.writeFile(hidden, "private"),
      fs.writeFile(image, "image"),
      fs.writeFile(dependency, "ignored"),
    ]);
    const store = new FileStore(path.join(root, ".state", "files.json"));
    const defaults = await store.folder(root);
    const authorizedRoot = defaults.path;
    const authorizedImage = path.join(authorizedRoot, "diagram.png");
    assert.deepEqual(
      defaults.entries.map((entry) => entry.name),
      ["note.md"],
    );

    const filtered = await store.folder(authorizedRoot, true, undefined, {
      showHiddenFiles: true,
      showOtherFiles: true,
    });
    assert.equal(
      filtered.entries.find((entry) => entry.name === ".drafts").kind,
      "directory",
    );
    assert.equal(
      filtered.entries.find((entry) => entry.name === "diagram.png").kind,
      "other",
    );
    assert.equal(
      filtered.entries.some((entry) => entry.name === "node_modules"),
      false,
    );
    await assert.rejects(
      store.authorizedPath(authorizedImage),
      /尚未由文件夹浏览器授权/,
    );
    assert.equal(
      await store.authorizedPath(authorizedImage, true),
      authorizedImage,
    );

    const hiddenOnly = await store.folder(authorizedRoot, true, undefined, {
      showHiddenFiles: true,
      showOtherFiles: false,
    });
    assert.equal(
      hiddenOnly.entries.some((entry) => entry.name === "diagram.png"),
      false,
    );
    await assert.rejects(
      store.authorizedPath(authorizedImage, true),
      /尚未由文件夹浏览器授权/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("自定义文件过滤与时间信息参与刷新和搜索且不改变已有授权", async () => {
  const { FileStore } = require("../electron/files.cjs");
  const { folderFilter } = require("../electron/folder-filter.cjs");
  assert.equal(
    folderFilter("notes/**/draft?.md")("notes/deep/draft1.md", "draft1.md"),
    true,
  );
  assert.equal(folderFilter("*.bak")("folder/note.md", "note.md"), false);
  assert.equal(folderFilter("a[b].md")("a[b].md", "a[b].md"), true);
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "moxie-rules-")),
  );
  try {
    await fs.mkdir(path.join(root, "drafts"));
    const note = path.join(root, "note.md"),
      draft = path.join(root, "drafts", "note.md");
    await fs.writeFile(note, "needle");
    await fs.writeFile(draft, "needle hidden");
    await fs.writeFile(path.join(root, "old.bak"), "backup");
    const store = new FileStore();
    await store.folder(root);
    const tree = await store.folder(root, true, undefined, {
      showOtherFiles: true,
      hiddenFilePatterns: "drafts/**\n*.bak",
    });
    assert.deepEqual(
      tree.entries.map((node) => node.name),
      ["note.md"],
    );
    assert.ok(tree.entries[0].modified > 0);
    assert.equal((await store.read(draft, true)).text, "needle hidden");
    const result = await store.searchFolder({
      root,
      query: "needle",
      options: { hiddenFilePatterns: "drafts/**" },
    });
    assert.deepEqual(
      result.results.map((node) => node.path),
      [note],
    );
    assert.equal(
      await store.folder(root, true, tree.version, {
        showOtherFiles: true,
        hiddenFilePatterns: "drafts/**\n*.bak",
      }),
      null,
    );
    await fs.utimes(note, new Date(), new Date(Date.now() + 10000));
    const refreshed = await store.folder(root, true, tree.version, {
      showOtherFiles: true,
      hiddenFilePatterns: "drafts/**\n*.bak",
    });
    assert.notEqual(refreshed.version, tree.version);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("关联文档缺失只提示，明确创建时不覆盖已有内容并隔离目录逃逸", async () => {
  const { FileStore } = require("../electron/files.cjs");
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "moxie-create-link-")),
  );
  const outside = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-create-link-out-"),
  );
  try {
    const source = path.join(root, "source.md"),
      target = path.join(root, "新文档.md");
    await fs.writeFile(source, "source");
    const store = new FileStore();
    await store.read(source);
    const prompt = await store.openLinked(source, "新文档.md#目标");
    assert.equal(prompt.missing, target);
    assert.equal(prompt.anchor, "目标");
    await assert.rejects(fs.stat(target), { code: "ENOENT" });
    const created = await store.openLinked(source, "新文档.md#目标", true);
    assert.equal(created.file.text, "");
    await fs.writeFile(target, "other writer");
    assert.equal(
      (await store.openLinked(source, "新文档.md", true)).file.text,
      "other writer",
    );
    await fs.symlink(outside, path.join(root, "escape"), "dir");
    for (const href of [
      "../outside.md",
      "escape/secret.md",
      "javascript:evil",
      "data.txt",
      "missing-parent/note.md",
    ])
      await assert.rejects(store.openLinked(source, href, true));
    assert.deepEqual(await fs.readdir(outside), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("已授权文件可在隔离窗口打开，初始文档只由该窗口读取一次", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-open-window-"));
  try {
    const file = path.join(root, "note.md");
    await fs.writeFile(file, "window contents");
    const h = await harness();
    h.open(file);
    const disk = await h.call("file:open");
    await assert.rejects(
      h.call("file:open-new-window", path.join(root, "other.md")),
      /打开文件|授权/,
    );
    assert.equal(await h.call("file:open-new-window", disk.path), true);
    const second = h.windows.at(-1);
    assert.ok(
      second.options.webPreferences.partition.startsWith(
        "persist:moxie-workspace-",
      ),
    );
    assert.equal(await h.call("file:initial"), null);
    assert.equal(
      (await h.callFor("file:initial", second)).text,
      "window contents",
    );
    assert.equal(await h.callFor("file:initial", second), null);
    await assert.rejects(
      h.foreign("file:open-new-window", disk.path),
      /未知窗口/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("路径复制与文件管理器显示只允许授权目录中的真实路径", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-reveal-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-reveal-out-"));
  try {
    await fs.writeFile(path.join(root, "notes.txt"), "plain text");
    await fs.writeFile(path.join(outside, "secret.md"), "secret");
    const store = new FileStore();
    const tree = await store.folder(root);
    const txt = path.join(tree.path, "notes.txt");
    assert.ok(tree.entries.some((entry) => entry.path === txt));
    assert.equal(await store.authorizedPath(tree.path), tree.path);
    assert.equal(await store.authorizedPath(txt), txt);
    await assert.rejects(
      store.authorizedPath(path.join(outside, "secret.md")),
      /已打开的文件夹/,
    );
    const link = path.join(tree.path, "external.md");
    await fs.symlink(path.join(outside, "secret.md"), link);
    await assert.rejects(store.authorizedPath(link), /授权|符号链接/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("最近文件夹固定清除与指定启动目录在历史淘汰后仍持久化", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-recent-folders-"),
  );
  try {
    const state = path.join(root, "state.json"),
      firstInput = path.join(root, "first");
    await fs.mkdir(firstInput);
    const store = new FileStore(state);
    await store.init();
    const first = (await store.folder(firstInput)).path;
    await store.setStartupFolder(first);
    await store.updateFolderHistory({ action: "pin", path: first });
    await store.updateFolderHistory({ action: "clear" });
    assert.equal(store.recentFolders()[0].pinned, true);
    await store.updateFolderHistory({ action: "remove", path: first });
    for (let index = 0; index < 15; index++) {
      const folder = path.join(root, String(index));
      await fs.mkdir(folder);
      await store.folder(folder);
    }
    assert.equal(store.recentFolders().length, 12);
    const restored = new FileStore(state);
    await restored.init();
    assert.equal(restored.startupFolder, first);
    assert.equal((await restored.reopenFolder(first)).path, first);
    await assert.rejects(restored.reopenFolder(root), /选择/);
    await assert.rejects(restored.setStartupFolder(root), /选择/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("仅已授权普通文档可以自动加载父目录，目录切换不扩展任意路径权限", async () => {
  const { FileStore } = require("../electron/files.cjs");
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "moxie-parent-folder-")),
  );
  try {
    const selected = path.join(root, "selected.md");
    const sibling = path.join(root, "sibling.md");
    await fs.writeFile(selected, "# selected");
    await fs.writeFile(sibling, "# sibling");
    const store = new FileStore(path.join(root, "state.json"));
    await store.init();
    await assert.rejects(store.folderForFile(selected), /选择该文档/);
    await assert.rejects(store.folderForFile("relative.md"), /选择该文档/);
    assert.equal(store.folders.size, 0);
    await store.read(selected);
    const tree = await store.folderForFile(selected);
    assert.equal(tree.path, root);
    assert.deepEqual(tree.entries.map((node) => node.name).sort(), [
      "selected.md",
      "sibling.md",
    ]);
    assert.equal((await store.reopenFolder(root)).path, root);
    store.authorized.add(root);
    await assert.rejects(store.folderForFile(root), /普通文件/);
    await assert.rejects(store.folderForFile(null), /选择该文档/);
    assert.equal((await store.read(selected, true)).text, "# selected");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
