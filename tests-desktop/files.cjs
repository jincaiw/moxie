const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { UpdateController } = require("../electron/updater.cjs");
const { mergeMacUpdateInfo } = require("../electron/update-info.cjs");
async function harness() {
  const handlers = new Map(),
    events = new Map();
  const windows = [],
    externalUrls = [];
  let menuTemplate, dialogParent;
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
      this.webContents.printToPDF = async () => {
        this.calls.push("printToPDF");
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
    shell: {
      openExternal: async (url) => {
        externalUrls.push(url);
      },
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
  await new Promise((r) => setImmediate(r));
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
    externalUrls,
    events,
    event,
    mockUpdater,
    menuTemplate,
    get dialogParent() {
      return dialogParent;
    },
  };
}
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
test("新建窗口隔离工作区存储和未保存关闭状态", async () => {
  const h = await harness();
  const fileMenu = h.menuTemplate.find((menu) => menu.label === "文件");
  fileMenu.submenu.find((item) => item.label === "新建窗口").click();
  assert.equal(h.windows.length, 2);
  const [first, second] = h.windows;
  assert.notEqual(
    first.options.webPreferences.partition,
    second.options.webPreferences.partition,
  );
  assert.match(second.options.webPreferences.partition, /^moxie-workspace-/);
  assert.equal(
    second.options.webPreferences.partition.startsWith("persist:"),
    false,
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
});
const { FileStore } = require("../electron/files.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
  "base64",
);
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
    await fs.writeFile(path.join(root, "ignore.txt"), "ignore");
    await fs.writeFile(path.join(outside, "private.md"), "private");
    await fs.symlink(outside, path.join(root, "link"));
    const h = await harness();
    await assert.rejects(h.call("folder:refresh", root), /请先选择/);
    h.open(root);
    const tree = await h.call("file:folder");
    assert.equal(tree.name, path.basename(root));
    assert.equal(tree.entries.length, 1);
    const note = tree.entries[0].children[0];
    assert.equal(note.name, "笔记.md");
    assert.equal((await h.call("file:recent")).length, 0);
    assert.equal((await h.call("file:reopen", note.path)).text, "# 子目录");
    await fs.writeFile(path.join(root, "new.markdown"), "new");
    assert.equal((await h.call("folder:refresh", tree.path)).entries.length, 2);
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

test("文件夹授权重启恢复，目录版本只在内容变化时更新", async () => {
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
    assert.equal(await reopened.folder(tree.path, true, changed.version), null);
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
