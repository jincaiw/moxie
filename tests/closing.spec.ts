import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "moxie.recovery.v1",
      JSON.stringify([
        {
          id: "close-test",
          name: "退出测试.md",
          text: "# 保留内容\n\n尚未保存",
          dirty: true,
        },
      ]),
    );
    (window as any).closeResults = [];
    window.desktop = {
      recent: async () => [],
      dirty: () => {},
      save: async () => null,
      onAction: (callback) => {
        (window as any).nativeAction = callback;
        return () => {};
      },
      closeReady: (id) => (window as any).closeResults.push(["ready", id]),
      closeCancelled: (id) => (window as any).closeResults.push(["cancel", id]),
    } as any;
  });
  await page.goto("/");
  await expect(page.locator(".cm-content")).toContainText("尚未保存");
});

test("取消另存为会通知主进程并恢复交互，恢复副本成功后冻结直到退出取消", async ({
  page,
}) => {
  await page.evaluate(() => (window as any).nativeAction("close-request", 41));
  await expect
    .poll(() => page.evaluate(() => (window as any).closeResults))
    .toEqual([["cancel", 41]]);
  await expect(page.locator(".app")).not.toHaveAttribute("inert");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" continued");
  await expect(page.locator(".cm-content")).toContainText("continued");
  await page.evaluate(() => (window as any).nativeAction("keep-close", 42));
  await expect
    .poll(() => page.evaluate(() => (window as any).closeResults))
    .toEqual([
      ["cancel", 41],
      ["ready", 42],
    ]);
  await expect(page.locator(".app")).toHaveAttribute("inert", "");
  expect(
    await page.evaluate(() => localStorage.getItem("moxie.recovery.v1")),
  ).toContain("continued");
  await page.evaluate(() => (window as any).nativeAction("close-cancelled"));
  await expect(page.locator(".app")).not.toHaveAttribute("inert");
  await page.locator(".cm-content").click();
  await page.keyboard.type(" resumed");
  await expect(page.locator(".cm-content")).toContainText("resumed");
});

test("恢复副本两种存储都失败时禁止关闭并恢复编辑", async ({ page }) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "moxie.recovery.v1")
        throw new DOMException("full", "QuotaExceededError");
      return original.call(this, key, value);
    };
    indexedDB.open = () => {
      throw new DOMException("unavailable", "UnknownError");
    };
    (window as any).nativeAction("keep-close", 43);
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).closeResults))
    .toEqual([["cancel", 43]]);
  await expect(page.locator(".app")).not.toHaveAttribute("inert");
  await expect(page.locator(".cm-content")).toContainText("尚未保存");
});

test("恢复写入期间外部文档变化时不确认关闭，保留最新编辑", async ({ page }) => {
  await page.evaluate(async () => {
    const viewModule = "/node_modules/@codemirror/view/dist/index.js";
    const stateModule = "/node_modules/@codemirror/state/dist/index.js";
    const { EditorView } = await import(/* @vite-ignore */ viewModule);
    const { Transaction } = await import(/* @vite-ignore */ stateModule);
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor"));
    const original = Storage.prototype.setItem;
    let injected = false;
    Storage.prototype.setItem = function (key, value) {
      original.call(this, key, value);
      if (key !== "moxie.recovery.v1" || injected) return;
      injected = true;
      queueMicrotask(() => {
        view.dispatch({
          changes: { from: view.state.doc.length, insert: "\n外部新增内容" },
          annotations: Transaction.userEvent.of("input.external"),
        });
        window.dispatchEvent(new Event("beforeunload"));
      });
    };
    (window as any).nativeAction("keep-close", 44);
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).closeResults))
    .toEqual([["cancel", 44]]);
  await expect(page.locator(".app")).not.toHaveAttribute("inert");
  await expect(page.locator(".cm-content")).toContainText("外部新增内容");
});
