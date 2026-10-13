import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { documentEnd } from "./keyboard";

const { FileStore } = createRequire(import.meta.url)("../electron/files.cjs");
const source = "# 图片管理\n\n![a](a.png)\n\n![b](b.png)\n\n![c](c.png)\n";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
  "base64",
);

async function start(
  page: Page,
  documentPath: string,
  manage: (input: any) => Promise<any>,
  options: {
    source?: string;
    download?: (input: any) => Promise<any>;
    store?: (input: any) => Promise<any>;
  } = {},
) {
  await page.exposeFunction("testManageImage", manage);
  if (options.download)
    await page.exposeFunction("testDownloadImage", options.download);
  if (options.store) await page.exposeFunction("testStoreImage", options.store);
  await page.addInitScript(
    ({ documentPath, source, image, hasDownload, hasStore }) => {
      localStorage.setItem(
        "moxie.recovery.v1",
        JSON.stringify([
          {
            id: "managed",
            name: "managed.md",
            path: documentPath,
            text: source,
            diskText: source,
            dirty: false,
          },
        ]),
      );
      localStorage.setItem("moxie.active.v1", "managed");
      const state = window as any;
      state.closeResults = [];
      window.desktop = {
        recent: async () => [],
        dirty: () => {},
        readImage: async () => image,
        manageImage: (input: any) => state.testManageImage(input),
        downloadRemoteImage: hasDownload
          ? (input: any) => state.testDownloadImage(input)
          : undefined,
        storeImage: hasStore
          ? (input: any) => state.testStoreImage(input)
          : undefined,
        onAction: (callback: any) => {
          state.nativeAction = callback;
          return () => {};
        },
        closeReady: (id: number) => state.closeResults.push(["ready", id]),
        closeCancelled: (id: number) => state.closeResults.push(["cancel", id]),
      } as any;
    },
    {
      documentPath,
      source: options.source || source,
      hasDownload: Boolean(options.download),
      hasStore: Boolean(options.store),
      image: "data:image/png;base64," + png.toString("base64"),
    },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  if (options.source) return;
  await expect(page.locator(".cm-content")).toContainText("a.png");
  await page.evaluate(() => (window as any).nativeAction("move-local-images"));
  await page.getByRole("button", { name: "移动图片", exact: true }).click();
}

test("远程图片下载期间保留文档，编辑不被旧快照覆盖", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const remoteSource = "# 图片下载\n\n![远程](https://example.test/a.png)\n";
  const calls: any[] = [];
  try {
    await start(page, "/notes/managed.md", async () => ({}), {
      source: remoteSource,
      download: async (input) => {
        calls.push(input);
        await gate;
        return { relativePath: "_images/a.png" };
      },
    });
    await page.evaluate(() =>
      (window as any).nativeAction("download-remote-images"),
    );
    await expect.poll(() => calls.length).toBe(1);
    await page
      .getByRole("group", { name: "已打开文档" })
      .getByRole("button", { name: "关闭 managed.md", exact: true })
      .click();
    await expect(page.locator(".cm-content")).toContainText("example.test");
    await page.locator(".cm-content").click();
    await page.keyboard.press(documentEnd);
    await page.keyboard.insertText("\n保留下载期间的编辑");
    await page.evaluate(() => (window as any).nativeAction("keep-close", 703));
    await expect
      .poll(() => page.evaluate(() => (window as any).closeResults))
      .toEqual([["cancel", 703]]);
    release();
    await expect(page.locator(".cm-content")).toContainText(
      "保留下载期间的编辑",
    );
    await expect(page.locator(".cm-content")).toContainText("example.test");
    await expect(page.locator(".cm-content")).not.toContainText(
      "_images/a.png",
    );
    expect(calls).toHaveLength(1);
  } finally {
    release();
  }
});

test("粘贴图片写入期间拒绝关闭和退出，完成后插入内容并释放保护", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: any[] = [];
  try {
    await start(page, "/notes/managed.md", async () => ({}), {
      source: "# 粘贴图片\n",
      store: async (input) => {
        calls.push(input);
        await gate;
        return { relativePath: "_images/pasted.png" };
      },
    });
    await page.locator(".cm-content").click();
    await page.evaluate(() => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([new Uint8Array([1, 2, 3])], "pasted.png", {
          type: "image/png",
        }),
      );
      document.querySelector(".cm-content")!.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: transfer,
        }),
      );
    });
    await expect.poll(() => calls.length).toBe(1);
    await page
      .getByRole("group", { name: "已打开文档" })
      .getByRole("button", { name: "关闭 managed.md", exact: true })
      .click();
    await expect(page.locator(".cm-content")).toContainText("粘贴图片");
    await page.evaluate(() => (window as any).nativeAction("keep-close", 704));
    await expect
      .poll(() => page.evaluate(() => (window as any).closeResults))
      .toEqual([["cancel", 704]]);
    release();
    await expect(page.locator(".cm-content")).toContainText(
      "_images/pasted.png",
    );
    await page.evaluate(() => (window as any).nativeAction("keep-close", 705));
    await expect
      .poll(() => page.evaluate(() => (window as any).closeResults))
      .toEqual([
        ["cancel", 704],
        ["ready", 705],
      ]);
    expect(calls).toHaveLength(1);
  } finally {
    release();
  }
});

test("图片操作期间禁止重复管理、关闭该文档或退出，完成后可以退出", async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  await start(page, "/notes/managed.md", async (input) => {
    calls.push(input.sourcePath);
    if (calls.length === 1) await gate;
    return { relativePath: input.targetPath };
  });
  try {
    await expect.poll(() => calls.length).toBe(1);
    await page.evaluate(() => (window as any).nativeAction("keep-close", 701));
    await expect
      .poll(() => page.evaluate(() => (window as any).closeResults))
      .toEqual([["cancel", 701]]);
    await expect(page.locator(".app")).not.toHaveAttribute("inert");
    await page.evaluate(() =>
      (window as any).nativeAction("move-local-images"),
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("group", { name: "已打开文档" })
      .getByRole("button", { name: "关闭 managed.md", exact: true })
      .click();
    await expect(page.locator(".cm-content")).toContainText("a.png");
    release();
    await expect(page.locator(".cm-content")).toContainText("_images/c.png");
    expect(calls).toEqual(["a.png", "b.png", "c.png"]);
    await page.evaluate(() => (window as any).nativeAction("keep-close", 702));
    await expect
      .poll(() => page.evaluate(() => (window as any).closeResults))
      .toEqual([
        ["cancel", 701],
        ["ready", 702],
      ]);
  } finally {
    release();
  }
});

test("移动期间编辑后逐张撤销，单张冲突不阻断其他图片恢复", async ({ page }) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-image-rollback-"),
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const documentPath = path.join(root, "managed.md");
    await fs.writeFile(documentPath, source);
    for (const name of ["a.png", "b.png", "c.png"])
      await fs.writeFile(path.join(root, name), png);
    const store = new FileStore();
    await store.read(documentPath);
    const calls: string[] = [];
    await start(page, documentPath, async (input) => {
      calls.push(input.sourcePath);
      const result = await store.manageImage(input);
      if (input.sourcePath === "c.png") await gate;
      return result;
    });
    await expect.poll(() => calls.length).toBe(3);
    const sentinel = Buffer.from("external replacement must survive");
    await fs.writeFile(path.join(root, "c.png"), sentinel);
    await page.locator(".cm-content").click();
    await page.keyboard.press(documentEnd);
    await page.keyboard.insertText("\n保留新的编辑");
    release();
    await expect.poll(() => calls.length).toBe(6);
    expect(calls.slice(3)).toEqual([
      "_images/c.png",
      "_images/b.png",
      "_images/a.png",
    ]);
    await expect(fs.readFile(path.join(root, "a.png"))).resolves.toEqual(png);
    await expect(fs.readFile(path.join(root, "b.png"))).resolves.toEqual(png);
    await expect(fs.readFile(path.join(root, "c.png"))).resolves.toEqual(
      sentinel,
    );
    await expect(
      fs.readFile(path.join(root, "_images/c.png")),
    ).resolves.toEqual(png);
    await expect(page.locator(".cm-content")).toContainText("保留新的编辑");
    await expect(page.locator(".cm-content")).not.toContainText("_images/");
    await expect(page.getByText(/1 张图片未能撤销/)).toContainText(
      "_images/c.png",
    );
    const recovery = page.getByRole("dialog", { name: "图片恢复需要处理" });
    await expect(recovery).toContainText("_images/c.png → c.png");
    await expect(recovery.locator("li")).toHaveCount(1);
    await page.screenshot({ path: "/tmp/moxie-image-rollback-conflict.png" });
    await recovery.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(recovery).toHaveCount(0);
  } finally {
    release();
    await fs.rm(root, { recursive: true, force: true });
  }
});
