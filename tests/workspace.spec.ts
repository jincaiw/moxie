import { test, expect } from "@playwright/test";
import { documentEnd, shortcut } from "./keyboard";
import { Buffer } from "node:buffer";

test.beforeEach(async ({ page }) => {
  await page.context().addInitScript(() => {
    const state = window as unknown as {
      desktop: object;
      disk: { text: string; version: string; status: string };
      opened: string[];
      saves: object[];
    };
    state.disk = {
      text: "# 磁盘笔记\n\n原内容\n",
      version: "v1",
      status: "changed",
    };
    state.opened = [];
    state.saves = [];
    const tree = {
      path: "/notes",
      name: "写作项目",
      truncated: false,
      entries: [
        {
          path: "/notes/章节",
          name: "章节",
          kind: "directory",
          children: [
            { path: "/notes/章节/note.md", name: "note.md", kind: "file" },
          ],
        },
      ],
    };
    state.desktop = {
      folder: async () => tree,
      refreshFolder: async () => ({
        ...tree,
        entries: [
          ...tree.entries,
          { path: "/notes/new.md", name: "new.md", kind: "file" },
        ],
      }),
      searchFolder: async () => ({
        results: [
          {
            path: "/notes/folder-hit.md",
            name: "folder-hit.md",
            from: 0,
            excerpt: "needle 在文件夹文档中",
          },
        ],
        scanned: 1,
        skipped: 0,
        truncated: false,
      }),
      open: async () => ({
        path: "/notes/note.md",
        name: "note.md",
        ...state.disk,
      }),
      reopen: async (path: string) => {
        state.opened.push(path);
        return {
          path,
          name: "note.md",
          text: state.disk.text,
          version: state.disk.version,
        };
      },
      inspect: async (files: { path: string; version?: string }[]) =>
        files
          .filter((file) => file.version !== state.disk.version)
          .map((file) => ({ path: file.path, ...state.disk })),
      save: async (input: { path: string; text: string; saveAs: boolean }) => {
        state.saves.push(input);
        state.disk = { text: input.text, version: "saved", status: "changed" };
        return {
          path: input.saveAs ? "/notes/copy.md" : input.path,
          name: input.saveAs ? "copy.md" : "note.md",
          text: input.text,
          version: "saved",
        };
      },
      recent: async () => [],
      dirty: () => {},
      onAction: () => () => {},
    };
  });
});

test("跨文档搜索可按文档名排序并筛选已打开文档", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "zeta-search.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("needle 在 Zeta 文档中"),
  });
  await page.locator(".md-input").setInputFiles({
    name: "alpha-search.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("needle 在 Alpha 文档中"),
  });
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "搜索项目文件夹" }).click();
  await page.getByLabel("搜索文件夹与已打开文档").fill("needle");
  const resultNames = page.locator(".workspace-search-results button strong");
  await expect(resultNames).toHaveCount(3);
  await page.getByLabel("搜索结果排序").selectOption("name");
  await expect(resultNames).toHaveText([
    "alpha-search.md",
    "folder-hit.md",
    "zeta-search.md",
  ]);
  await page.getByLabel("范围").selectOption("opened");
  await expect(resultNames).toHaveCount(2);
  await page.getByLabel("范围").selectOption("folder");
  await expect(resultNames).toHaveText(["folder-hit.md"]);
});

test("超过 localStorage 容量的文档通过 IndexedDB 恢复并保留末尾输入", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const text = ("A".repeat(80) + "\n").repeat(19_000);
  await page.locator(".md-input").setInputFiles({
    name: "长文恢复.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  });
  await expect(page.locator(".document-title")).toContainText("长文恢复");
  await page.locator(".cm-content").click();
  await page.keyboard.press(documentEnd);
  await page.keyboard.insertText("恢复标记");
  await page.waitForFunction(
    async () => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("moxie.recovery.v1", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const snapshot = await new Promise<{
        docs?: { name: string; text: string }[];
      } | null>((resolve, reject) => {
        const request = database
          .transaction("snapshots")
          .objectStore("snapshots")
          .get("latest");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return snapshot?.docs?.some(
        (document) =>
          document.name === "长文恢复.md" && document.text.endsWith("恢复标记"),
      );
    },
    null,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);
  const stableRecovery = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("moxie.recovery.v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const snapshot = await new Promise<{
      docs?: { name: string; text: string }[];
    } | null>((resolve, reject) => {
      const request = database
        .transaction("snapshots")
        .objectStore("snapshots")
        .get("latest");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return snapshot?.docs?.some(
      (document) =>
        document.name === "长文恢复.md" && document.text.endsWith("恢复标记"),
    );
  });
  expect(stableRecovery).toBe(true);
  await page.reload();
  await expect(page.locator(".document-title")).toContainText("长文恢复");
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.press(documentEnd);
  await expect(editor).toContainText("恢复标记", { timeout: 30_000 });
  await page.keyboard.press(shortcut("s"));
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { saves: { text: string }[] }).saves.length,
      ),
    )
    .toBe(1);
  const saved = await page.evaluate(
    () => (window as unknown as { saves: { text: string }[] }).saves[0].text,
  );
  expect(saved).toMatch(/恢复标记$/);
});

test("目录展开、按需打开、刷新和关闭目录", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "文件夹 章节" }),
  ).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(
      () => (window as unknown as { opened: string[] }).opened,
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "文件夹 章节" }).click();
  await page.getByRole("button", { name: "打开 note.md", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("原内容");
  await page.getByRole("button", { name: "刷新文件夹" }).click();
  await expect(
    page.getByRole("button", { name: "打开 new.md", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "文件夹 章节" }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "关闭文件夹" }).click();
  await expect(page.getByRole("region", { name: "文件夹浏览" })).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("原内容");
});

test("文件侧栏支持方向键浏览与目录展开折叠", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  const folder = page.getByRole("button", { name: "文件夹 章节" });
  await expect(folder).toBeVisible();
  await folder.focus();
  await page.keyboard.press("ArrowRight");
  await expect(folder).toHaveAttribute("aria-expanded", "true");

  const note = page.getByRole("button", { name: "打开 note.md", exact: true });
  await expect(note).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(folder).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await expect(note).toHaveCount(0);
});

test("文件侧栏筛选支持显示隐藏文件和非 Markdown 文件", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as unknown as {
      desktop: {
        folder: (options?: {
          showHiddenFiles: boolean;
          showOtherFiles: boolean;
        }) => Promise<unknown>;
        refreshFolder: (
          root: string,
          version?: string,
          options?: {
            showHiddenFiles: boolean;
            showOtherFiles: boolean;
          },
        ) => Promise<unknown>;
        revealPath: (path: string) => Promise<boolean>;
      };
      folderOptions: { showHiddenFiles: boolean; showOtherFiles: boolean }[];
      revealed: string[];
    };
    state.folderOptions = [];
    state.revealed = [];
    const makeTree = (
      options = { showHiddenFiles: false, showOtherFiles: false },
    ) => {
      state.folderOptions.push(options);
      return {
        path: "/notes",
        name: "写作项目",
        truncated: false,
        version: `${options.showHiddenFiles}-${options.showOtherFiles}`,
        entries: [
          { path: "/notes/note.md", name: "note.md", kind: "file" },
          ...(options.showHiddenFiles
            ? [{ path: "/notes/.draft.md", name: ".draft.md", kind: "file" }]
            : []),
          ...(options.showOtherFiles
            ? [
                {
                  path: "/notes/diagram.png",
                  name: "diagram.png",
                  kind: "other",
                },
              ]
            : []),
        ],
      };
    };
    state.desktop.folder = async (options) => makeTree(options);
    state.desktop.refreshFolder = async (_root, _version, options) =>
      makeTree(options);
    state.desktop.revealPath = async (path) => {
      state.revealed.push(path);
      return true;
    };
  });

  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开 note.md" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开 .draft.md" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("显示隐藏文件").check();
  await page.getByLabel("显示非 Markdown 文件").check();
  await page.getByRole("button", { name: "完成" }).click();
  await expect(
    page.getByRole("button", { name: "打开 .draft.md" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "显示 diagram.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "显示 diagram.png" }).click();
  expect(await page.evaluate(() => (window as any).revealed)).toEqual([
    "/notes/diagram.png",
  ]);
  expect(
    await page.evaluate(() =>
      (window as unknown as { folderOptions: unknown[] }).folderOptions.at(-1),
    ),
  ).toEqual({
    showHiddenFiles: true,
    showOtherFiles: true,
    hiddenFilePatterns: "",
  });
});

test("文件侧栏可复制授权路径并请求系统显示文件夹", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as unknown as {
      desktop: {
        copyPath: (path: string) => Promise<boolean>;
        revealPath: (path: string) => Promise<boolean>;
      };
      pathActions: [string, string][];
    };
    state.pathActions = [];
    state.desktop.copyPath = async (path) => {
      state.pathActions.push(["copy", path]);
      return true;
    };
    state.desktop.revealPath = async (path) => {
      state.pathActions.push(["reveal", path]);
      return true;
    };
  });
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "复制文件夹路径" }).click();
  await expect(page.getByRole("status")).toContainText("已复制路径");
  await page.getByRole("button", { name: "在文件管理器中显示文件夹" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { pathActions: [string, string][] })
            .pathActions,
      ),
    )
    .toEqual([
      ["copy", "/notes"],
      ["reveal", "/notes"],
    ]);
});

test("文件侧栏支持拖放文档到文件夹执行移动", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as unknown as {
      desktop: {
        fileOperation: (input: {
          action: string;
          root: string;
          target?: string;
          directory?: string;
        }) => Promise<{ action: string; path: string; version?: string }>;
      };
      operations: { action: string; target?: string; directory?: string }[];
    };
    state.operations = [];
    state.desktop.fileOperation = async (input) => {
      state.operations.push(input);
      return {
        action: "move",
        path: "/notes/note.md",
        version: "v2",
      };
    };
  });
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "文件夹 章节" }).click();
  await page
    .getByRole("button", { name: "打开 note.md", exact: true })
    .dragTo(page.locator(".folder-browser > header"));
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { operations: unknown[] }).operations,
      ),
    )
    .toEqual([
      {
        action: "move",
        root: "/notes",
        target: "/notes/章节/note.md",
        directory: "/notes",
      },
    ]);
});

test("文档导入以未保存副本打开，不替换原文件", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as unknown as {
      desktop: {
        importDocument: () => Promise<{ name: string; text: string }>;
      };
      imports: number;
    };
    state.imports = 0;
    state.desktop.importDocument = async () => {
      state.imports++;
      return { name: "converted.md", text: "# Converted\n\nImported copy\n" };
    };
  });
  await page.getByRole("button", { name: "导入文档…", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText("converted.md");
  await expect(page.locator(".cm-content")).toContainText("Imported copy");
  await expect(page.getByRole("button", { name: /会话副本/ })).toBeVisible();
  expect(await page.evaluate(() => (window as any).imports)).toBe(1);
});

test("文件侧栏支持按类型排序并持久保存置顶文档", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "文件夹 章节" }).click();
  await page.getByRole("button", { name: "文件操作：note.md" }).click();
  await page.getByRole("button", { name: "置顶", exact: true }).click();
  await page.getByLabel("文件排序").selectOption("type");
  const prefs = await page.evaluate(() => ({
    sort: localStorage.getItem("moxie.folder-sort.v1"),
    pinned: JSON.parse(localStorage.getItem("moxie.folder-pinned.v1") || "[]"),
  }));
  expect(prefs).toEqual({ sort: "type", pinned: ["/notes/章节/note.md"] });
  await page.reload();
  await expect(page.getByLabel("文件排序")).toHaveValue("type");
  const folder = page.getByRole("button", { name: "文件夹 章节" });
  if ((await folder.getAttribute("aria-expanded")) !== "true")
    await folder.click();
  await page.getByRole("button", { name: "文件操作：note.md" }).click();
  await expect(page.getByRole("button", { name: "取消置顶" })).toBeVisible();
});

test("文件侧栏同步其他窗口对置顶文档的更改", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "文件夹 章节" }).click();
  const otherWindow = await page.context().newPage();
  await otherWindow.goto("/");
  await otherWindow
    .getByRole("button", { name: "打开文件夹", exact: true })
    .click();
  const otherFolder = otherWindow.getByRole("button", { name: "文件夹 章节" });
  if ((await otherFolder.getAttribute("aria-expanded")) !== "true")
    await otherFolder.click();
  await otherWindow.getByRole("button", { name: "文件操作：note.md" }).click();
  await otherWindow.getByRole("button", { name: "置顶", exact: true }).click();
  await page.getByRole("button", { name: "文件操作：note.md" }).click();
  await expect(page.getByRole("button", { name: "取消置顶" })).toBeVisible();
});

test("文件侧栏同步其他窗口的排序设置", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  const otherWindow = await page.context().newPage();
  await otherWindow.goto("/");
  await otherWindow
    .getByRole("button", { name: "打开文件夹", exact: true })
    .click();
  await otherWindow.getByLabel("文件排序").selectOption("type");
  await expect(page.getByLabel("文件排序")).toHaveValue("type");
});

test("目录侧栏提供重命名入口并将其作为目录操作提交", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as unknown as {
      desktop: {
        fileOperation: (input: {
          action: string;
          root: string;
          target?: string;
          name?: string;
        }) => Promise<unknown>;
      };
      operations: Record<string, unknown>[];
    };
    state.operations = [];
    state.desktop.fileOperation = async (input) => {
      state.operations.push(input);
      if (input.action === "undo")
        return {
          action: "undo",
          path: "/notes/新章节",
          from: "/notes/章节",
          kind: "directory",
          undid: "rename",
          paths: [],
        };
      return {
        action: "rename",
        path: "/notes/新章节",
        from: "/notes/章节",
        kind: "directory",
        paths: [],
      };
    };
  });
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "文件夹 章节" }).click();
  await page.getByRole("button", { name: "文件操作：note.md" }).click();
  await page.getByRole("button", { name: "置顶", exact: true }).click();
  await page.getByRole("button", { name: "文件操作：章节" }).click();
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "重命名文件夹" }),
  ).toBeVisible();
  await page.getByLabel("名称").fill("新章节");
  await page.getByRole("button", { name: "确定" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("moxie.folder-pinned.v1") || "[]"),
      ),
    )
    .toEqual(["/notes/新章节/note.md"]);
  await expect
    .poll(() => page.evaluate(() => (window as any).operations))
    .toEqual([
      {
        action: "rename",
        root: "/notes",
        target: "/notes/章节",
        name: "新章节",
        directory: undefined,
      },
    ]);
  await page.getByRole("button", { name: "撤销文件操作" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("moxie.folder-pinned.v1") || "[]"),
      ),
    )
    .toEqual(["/notes/章节/note.md"]);
});

test("长图导出将完整 HTML 和文档名交给桌面分页捕获", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as unknown as {
      desktop: {
        exportImage: (input: { html: string; name: string }) => Promise<string>;
      };
      imageExport: { html: string; name: string } | null;
    };
    state.imageExport = null;
    state.desktop.exportImage = async (input) => {
      state.imageExport = input;
      return "/tmp/欢迎使用.svg";
    };
  });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("menuitem", { name: "导出整篇长图（SVG）" }).click();
  await expect(page.getByRole("status")).toContainText("长图已导出");
  const result = await page.evaluate(
    () => (window as any).imageExport as { html: string; name: string },
  );
  expect(result.name).toBe("欢迎使用.md");
  expect(result.html).toContain("欢迎使用墨写");
});

test("未编辑文档自动更新，有本地修改时保留并确认载入", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件 ⌘O" }).click();
  await page.evaluate(() => {
    const w = window as unknown as { disk: { text: string; version: string } };
    w.disk.text = "# 外部更新\n\n新的磁盘内容\n";
    w.disk.version = "v2";
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator(".cm-content")).toContainText("新的磁盘内容");
  await page.locator(".cm-content").click();
  await page.keyboard.press(documentEnd);
  await page.keyboard.type("我的修改");
  await page.evaluate(() => {
    const w = window as unknown as { disk: { text: string; version: string } };
    w.disk.text = "# 第三个版本\n";
    w.disk.version = "v3";
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator(".external-warning")).toContainText(
    "当前编辑已保留",
  );
  await expect(page.locator(".cm-content")).toContainText("我的修改");
  await page.getByRole("button", { name: "载入磁盘版本", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("我的修改");
  await page.getByRole("button", { name: "载入磁盘版本", exact: true }).click();
  await page.getByRole("button", { name: "替换当前编辑", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("第三个版本");
  await expect(page.locator(".external-warning")).toHaveCount(0);
});

test("磁盘删除后保留编辑并另存为，自动保存暂停", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件 ⌘O" }).click();
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("自动保存到原文件").check();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const w = window as unknown as {
      disk: { version: string; status: string };
    };
    w.disk.version = "missing";
    w.disk.status = "missing";
    window.dispatchEvent(new Event("focus"));
  });
  await expect(page.locator(".external-warning")).toContainText(
    "已删除或无法读取",
  );
  await page.locator(".cm-content").click();
  await page.keyboard.press(documentEnd);
  await page.keyboard.type("保留我");
  await page.waitForTimeout(1500);
  expect(
    await page.evaluate(
      () => (window as unknown as { saves: object[] }).saves.length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "另存为保留编辑" }).click();
  await expect(
    page.getByRole("button", { name: "copy.md", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("保留我");
  await expect(page.locator(".external-warning")).toHaveCount(0);
});

test("检查结果晚于手动保存时不会回滚已保存内容", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件 ⌘O" }).click();
  await expect(page.locator(".cm-content")).toContainText("原内容");
  await page.evaluate(() => {
    const w = window as unknown as {
      desktop: { inspect: (files: object[]) => Promise<object[]> };
      pendingCheck?: () => void;
      checking: boolean;
    };
    const original = w.desktop.inspect;
    let delayed = false;
    w.desktop.inspect = async (files) => {
      if (delayed) return original(files);
      delayed = true;
      w.checking = true;
      return new Promise((resolve) => {
        w.pendingCheck = () =>
          resolve([
            {
              path: "/notes/note.md",
              version: "old-result",
              status: "changed",
              text: "# 过期的检查结果\n",
            },
          ]);
      });
    };
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { checking: boolean }).checking,
      ),
    )
    .toBe(true);
  await page.keyboard.press(shortcut("s"));
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { saves: object[] }).saves.length,
      ),
    )
    .toBe(1);
  await page.evaluate(() =>
    (window as unknown as { pendingCheck: () => void }).pendingCheck(),
  );
  await page.waitForTimeout(100);
  await expect(page.locator(".cm-content")).toContainText("原内容");
  await expect(page.locator(".cm-content")).not.toContainText("过期的检查结果");
});

test("重启恢复文件夹、展开状态和上次活动文档", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "文件夹 章节" }).click();
  await page.getByRole("button", { name: "打开 note.md", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("moxie.recovery.v1")))
    .toContain("原内容");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "文件夹 章节" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".cm-content")).toContainText("原内容");
  await expect(
    page.getByRole("button", { name: "打开 note.md", exact: true }),
  ).toBeVisible();
});

test("目录内容自动更新，关闭目录不被延迟刷新重新打开", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const w = window as unknown as {
      desktop: {
        folder: () => Promise<object>;
        refreshFolder: (
          root: string,
          version?: string,
        ) => Promise<object | null>;
      };
      revision: string;
      pendingRefresh?: () => void;
      delay: boolean;
    };
    w.revision = "v1";
    w.delay = false;
    const tree = () => ({
      path: "/notes",
      name: "写作项目",
      truncated: false,
      version: w.revision,
      entries:
        w.revision === "v1"
          ? []
          : [{ path: "/notes/new.md", name: "自动新增.md", kind: "file" }],
    });
    w.desktop.folder = async () => tree();
    w.desktop.refreshFolder = async (_root, version) => {
      if (w.delay)
        return new Promise((resolve) => {
          w.pendingRefresh = () => resolve(tree());
        });
      return version === w.revision ? null : tree();
    };
  });
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await expect(page.getByRole("region", { name: "文件夹浏览" })).toContainText(
    "没有可显示的文件",
  );
  await page.evaluate(() => {
    (window as unknown as { revision: string }).revision = "v2";
  });
  await expect(
    page.getByRole("button", { name: "打开 自动新增.md", exact: true }),
  ).toBeVisible({ timeout: 6000 });
  await page.evaluate(() => {
    (window as unknown as { delay: boolean }).delay = true;
  });
  await page.getByRole("button", { name: "刷新文件夹" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as unknown as { pendingRefresh?: () => void }).pendingRefresh,
        ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "关闭文件夹" }).click();
  await page.evaluate(() =>
    (window as unknown as { pendingRefresh: () => void }).pendingRefresh(),
  );
  await expect(page.getByRole("region", { name: "文件夹浏览" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("region", { name: "文件夹浏览" })).toHaveCount(0);
});

test("目录恢复失败时保留文档，重试后恢复目录", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.evaluate(() => localStorage.setItem("restore-fail", "yes"));
  await page.addInitScript(() => {
    if (!localStorage.getItem("restore-fail")) return;
    let fail = true;
    const w = window as unknown as {
      desktop: { refreshFolder: () => Promise<object> };
      allowRestore: () => void;
    };
    const original = w.desktop.refreshFolder;
    w.allowRestore = () => {
      fail = false;
    };
    w.desktop.refreshFolder = async () => {
      if (fail) throw Error("offline");
      return original();
    };
  });
  await page.reload();
  await expect(page.getByRole("region", { name: "文件夹浏览" })).toContainText(
    "暂时无法读取",
  );
  await expect(page.locator(".cm-content")).toContainText("欢迎使用墨写");
  await page.evaluate(() =>
    (window as unknown as { allowRestore: () => void }).allowRestore(),
  );
  await page.getByRole("button", { name: "重试读取文件夹" }).click();
  await expect(page.getByRole("button", { name: "文件夹 章节" })).toBeVisible();
});

test("文件侧栏可新建及重命名文档并拒绝覆盖同名目标", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as unknown as {
      desktop: {
        fileOperation: (input: {
          action: string;
          root: string;
          target?: string;
          name?: string;
        }) => Promise<{ action: string; path: string; version?: string }>;
      };
      operations: { action: string; target?: string; name?: string }[];
    };
    state.operations = [];
    state.desktop.fileOperation = async (input) => {
      state.operations.push(input);
      if (input.action === "rename")
        return {
          action: input.action,
          path: "/notes/章节/renamed.md",
          version: "v2",
        };
      if (input.action === "new-file")
        return { action: input.action, path: "/notes/新建.md" };
      throw new Error("unexpected operation");
    };
  });
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "新建文档", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "文件操作" });
  await dialog.getByLabel("名称").fill("新建.md");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              operations: { action: string; name?: string }[];
            }
          ).operations[0],
      ),
    )
    .toMatchObject({ action: "new-file", name: "新建.md" });
  await page.getByRole("button", { name: "文件夹 章节" }).click();
  await page.getByRole("button", { name: "打开 note.md", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(documentEnd);
  await page.keyboard.insertText("正在编辑");
  await page.getByRole("button", { name: "文件操作：note.md" }).click();
  await page.getByRole("button", { name: "重命名", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "文件操作" });
  await expect(rename.getByLabel("名称")).toHaveValue("note.md");
  await rename.getByLabel("名称").fill("renamed.md");
  await rename.getByRole("button", { name: "确定", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { saves: object[] }).saves.length,
      ),
    )
    .toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              operations: { action: string; target?: string; name?: string }[];
            }
          ).operations[1],
      ),
    )
    .toMatchObject({
      action: "rename",
      target: "/notes/章节/note.md",
      name: "renamed.md",
    });
});

test("文件树和列表按时间排序、分组及跨窗口同步，缺失时间保持末位", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as any;
    const tree = {
      path: "/notes",
      name: "项目",
      truncated: false,
      entries: [
        {
          path: "/notes/子目录",
          name: "子目录",
          kind: "directory",
          modified: 300,
          created: 1,
          children: [
            {
              path: "/notes/子目录/2.md",
              name: "2.md",
              kind: "file",
              modified: 200,
              created: 30,
            },
          ],
        },
        {
          path: "/notes/10.md",
          name: "10.md",
          kind: "file",
          modified: 100,
          created: 20,
        },
        { path: "/notes/无时间.md", name: "无时间.md", kind: "file" },
      ],
    };
    state.desktop.folder = async () => tree;
    state.desktop.refreshFolder = async () => tree;
  });
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByLabel("文件显示方式").selectOption("list");
  await page.getByLabel("按文件夹分组").uncheck();
  await page.getByLabel("文件排序").selectOption("modified");
  const rows = page.locator(".folder-browser .tree-row");
  await expect(rows).toHaveText(["10.md.", "2.md子目录", "无时间.md."]);
  await page.getByLabel("排序方向").selectOption("descending");
  await expect(rows).toHaveText(["2.md子目录", "10.md.", "无时间.md."]);
  await page.getByLabel("文件排序").selectOption("created");
  await expect(rows).toHaveText(["2.md子目录", "10.md.", "无时间.md."]);
  await page.getByLabel("文件排序").selectOption("name");
  await page.getByLabel("排序方向").selectOption("ascending");
  await expect(rows.first()).toContainText("2.md");
  await page.getByLabel("文件排序").selectOption("alphabet");
  await expect(rows.first()).toContainText("10.md");
  const other = await page.context().newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await expect(other.getByLabel("文件显示方式")).toHaveValue("list");
  await other.getByLabel("文件显示方式").selectOption("tree");
  await expect(page.getByLabel("文件显示方式")).toHaveValue("tree");
});

test("自定义侧栏规则随设置刷新并传递给项目搜索", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as any;
    state.filterSearchOptions = null;
    state.desktop.searchFolder = async (
      _root: string,
      _query: string,
      options: object,
    ) => {
      state.filterSearchOptions = options;
      return { results: [], scanned: 0, skipped: 0, truncated: false };
    };
    state.desktop.refreshFolder = async (
      _root: string,
      _version: string,
      options: any,
    ) => ({
      path: "/notes",
      name: "项目",
      truncated: false,
      entries: options?.hiddenFilePatterns
        ? []
        : [{ path: "/notes/new.md", name: "new.md", kind: "file" }],
    });
  });
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("隐藏文件规则").fill("*.bak\ndrafts/**");
  await page.getByRole("button", { name: "完成" }).click();
  await expect(page.locator(".folder-filter-summary")).toContainText(
    "已应用自定义规则",
  );
  await expect(page.locator(".tree-empty")).toContainText("没有可显示的文件");
  await page.getByRole("button", { name: "搜索项目文件夹" }).click();
  await page
    .getByRole("textbox", { name: "搜索文件夹与已打开文档" })
    .fill("needle");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as any).filterSearchOptions?.hiddenFilePatterns,
      ),
    )
    .toBe("*.bak\ndrafts/**");
});

test("文件菜单在新窗口打开前保存当前未保存内容", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const state = window as any;
    state.newWindows = [];
    state.desktop.openInNewWindow = async (path: string) => {
      state.newWindows.push({ path, text: state.disk.text });
      return true;
    };
  });
  await page.keyboard.press(shortcut("o"));
  const content = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await content.press(documentEnd);
  await page.keyboard.insertText("新窗口前保存");
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
  await page.getByRole("button", { name: "文件操作：new.md" }).click();
  await page.getByRole("button", { name: "在新窗口打开", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).newWindows.length))
    .toBe(1);
  // A different file opens directly; the active dirty document remains untouched.
  expect(await page.evaluate(() => (window as any).saves.length)).toBe(0);
  await expect(content).toContainText("新窗口前保存");
  await page.evaluate(() => {
    const state = window as any;
    state.desktop.refreshFolder = async () => ({
      path: "/notes",
      name: "项目",
      truncated: false,
      entries: [{ path: "/notes/note.md", name: "note.md", kind: "file" }],
    });
  });
  await page.getByRole("button", { name: "刷新文件夹" }).click();
  await page.getByRole("button", { name: "打开 note.md" }).focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("button", { name: "在新窗口打开", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).newWindows.length))
    .toBe(2);
  expect(
    await page.evaluate(() => (window as any).newWindows[1].text),
  ).toContain("新窗口前保存");
  expect(await page.evaluate(() => (window as any).saves.length)).toBe(1);
});

test("新窗口初始文档在恢复完成后打开并替换未修改的示例", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).desktop.initialFile = async () => ({
      path: "/notes/initial.md",
      name: "initial.md",
      text: "新窗口初始内容",
      version: "initial",
    });
  });
  await page.goto("/");
  await expect(page.locator(".document-title")).toContainText("initial");
  await expect(page.locator(".cm-content")).toContainText("新窗口初始内容");
  await expect(page.locator(".document-tabs")).toHaveCount(0);
});

test("最近文件夹支持固定清除移除，启动偏好可关闭或指定目录", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let folders = [{ path: "/notes", name: "最近项目", pinned: false }];
    Object.assign(window.desktop!, {
      recentFolders: async () => folders,
      updateFolderHistory: async ({
        action,
        path,
      }: {
        action: string;
        path?: string;
      }) => {
        if (action === "pin" || action === "unpin")
          folders = folders.map((folder) => ({
            ...folder,
            pinned: folder.path === path ? action === "pin" : folder.pinned,
          }));
        if (action === "clear")
          folders = folders.filter((folder) => folder.pinned);
        if (action === "remove")
          folders = folders.filter((folder) => folder.path !== path);
        return folders;
      },
      reopenFolder: async (path: string) => ({
        path,
        name: "最近项目",
        entries: [],
        truncated: false,
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  const recent = page.getByRole("region", { name: "最近文件夹" });
  await recent
    .getByRole("button", { name: "固定文件夹 最近项目", exact: true })
    .click();
  await expect(
    recent.getByRole("button", { name: "取消固定文件夹 最近项目" }),
  ).toHaveAttribute("aria-pressed", "true");
  await recent.getByRole("button", { name: "清除最近" }).click();
  await expect(recent).toContainText("最近项目");
  await recent.getByRole("button", { name: /最近项目 \/notes/ }).click();
  await expect(page.getByRole("region", { name: "文件夹浏览" })).toBeVisible();
  await recent.getByRole("button", { name: "移除最近文件夹 最近项目" }).click();
  await expect(recent).toHaveCount(0);
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("启动时打开文件夹").selectOption("none");
  await page.reload();
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await expect(page.getByRole("region", { name: "文件夹浏览" })).toHaveCount(0);
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("启动时打开文件夹").selectOption("default");
  await page.getByRole("button", { name: "选择启动文件夹" }).click();
  await page.reload();
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await expect(page.getByRole("region", { name: "文件夹浏览" })).toContainText(
    "写作项目",
  );
});
