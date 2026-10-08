import { test, expect } from "@playwright/test";
import { documentEnd, shortcut } from "./keyboard";
import fs from "node:fs/promises";

test("首屏、表格、大纲、模式切换和主题无运行错误", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page).toHaveTitle("墨写 · Markdown 编辑器");
  await expect(page.locator(".md-h1")).toContainText("欢迎使用墨写");
  await expect(page.locator(".render-block table")).toBeVisible();
  await page.getByRole("tab", { name: "大纲" }).click();
  await expect(
    page.getByRole("button", { name: "从这里开始", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("# 欢迎使用墨写");
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await expect(page.locator(".render-block table")).toBeVisible();
  await page.getByRole("tab", { name: "文件", exact: true }).click();
  await page.getByRole("button", { name: "写作指南.md", exact: true }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.getByRole("button", { name: "欢迎使用.md", exact: true }).click();
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.getByRole("button", { name: "写作指南.md", exact: true }).click();
  await expect(page.locator(".katex-display")).toBeVisible();
  await page.getByRole("button", { name: "切换深色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});
test("编辑、撤销重做、切换文档和恢复不丢失内容", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建文件", exact: true }).click();
  const content = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await content.click();
  await page.keyboard.press(documentEnd);
  await page.keyboard.insertText("中文写作与恢复验证");
  await expect(content).toContainText("中文写作与恢复验证");
  await page.keyboard.press(shortcut("z"));
  await expect(content).not.toContainText("中文写作与恢复验证");
  await page.keyboard.press(shortcut("Shift+z"));
  await expect(content).toContainText("中文写作与恢复验证");
  await page.getByRole("button", { name: "欢迎使用.md", exact: true }).click();
  await page.getByRole("button", { name: "未命名.md", exact: true }).click();
  await expect(content).toContainText("中文写作与恢复验证");
  await content.click();
  await page.keyboard.press(shortcut("z"));
  await expect(content).not.toContainText("中文写作与恢复验证");
  await page.keyboard.press(shortcut("Shift+z"));
  await expect(content).toContainText("中文写作与恢复验证");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("moxie.recovery.v1")))
    .toContain("中文写作与恢复验证");
  await page.reload();
  await page.getByRole("button", { name: "未命名.md", exact: true }).click();
  await expect(content).toContainText("中文写作与恢复验证");
  await expect(page.locator(".recovery-banner")).toBeVisible();
});
test("Markdown 导入导出保留字节内容，HTML 清除活动脚本", async ({ page }) => {
  await page.goto("/");
  const text = "# 标题\r\n\r\n**内容**\r\n\r\n<script>alert(1)</script>\r\n";
  await page.locator("input.md-input").setInputFiles({
    name: "roundtrip.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  });
  await expect(page.locator(".document-title")).toContainText("roundtrip.md");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("menuitem", { name: "Markdown 文件", exact: true })
    .click();
  const download = await downloading;
  expect(await fs.readFile((await download.path())!, "utf8")).toBe(text);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await htmlDownload).path())!, "utf8");
  expect(html).toContain('<h1 id="标题">标题</h1>');
  expect(html).not.toContain("<script>");
});
test("查找替换、公式、设置和窄屏布局", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "写作指南.md", exact: true }).click();
  await expect(page.locator(".katex-display")).toBeVisible();
  await page.getByRole("button", { name: "查找与替换" }).click();
  await expect(page.locator(".cm-search")).toBeVisible();
  await page.getByRole("button", { name: "偏好设置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("正文字号").fill("20");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--editor-font",
      ),
    ),
  ).toBe("20px");
  await page.setViewportSize({ width: 390, height: 844 });
  const sidebarToggle = page.getByRole("button", { name: "切换侧栏" });
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");
  await sidebarToggle.click();
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "false");
  await sidebarToggle.focus();
  await page.keyboard.press("Enter");
  await expect(sidebarToggle).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
});
test("表格点击后可编辑原文，回到其他段落后恢复排版", async ({ page }) => {
  await page.goto("/");
  await page.locator(".render-block td").first().click();
  await expect(page.locator(".table-cell-input")).toBeVisible();
  await page.getByRole("button", { name: "编辑原文", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText(
    "| 保存文档 | Cmd + S |",
  );
  await page.getByRole("tab", { name: "大纲" }).click();
  await page.getByRole("button", { name: "从这里开始", exact: true }).click();
  await expect(page.locator(".render-block table")).toBeVisible();
});
