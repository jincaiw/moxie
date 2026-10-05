import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { desktop: object; links: string[] };
    w.links = [];
    w.desktop = {
      recent: async () => [],
      dirty: () => {},
      onAction: () => () => {},
      openLink: async ({ href }: { href: string }) => {
        w.links.push(href);
        if (href.startsWith("child.md"))
          return {
            file: {
              path: "/project/child.md",
              name: "child.md",
              text: "# 子文档\n\n## 目标标题\n\n正文\n",
              version: "v1",
            },
            anchor: "目标标题",
          };
        return {};
      },
    };
  });
});

test("链接即时排版、引用链接、修饰键打开与普通点击编辑", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "链接.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# 链接\n\n[打开网站](https://example.com) 和 [**使用说明**][manual]\n\n<https://example.org>\n\n`[代码示例](https://code.example)`\n\n[manual]: https://example.com/manual\n\n",
    ),
  });
  const website = page.getByRole("link", { name: "打开网站", exact: true });
  await expect(website).toBeVisible();
  await expect(
    page.getByRole("link", { name: "使用说明", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "https://example.org", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "代码示例", exact: true }),
  ).toHaveCount(0);
  await website.click({ modifiers: ["Control"] });
  expect(
    await page.evaluate(() => (window as unknown as { links: string[] }).links),
  ).toEqual(["https://example.com"]);
  await website.click();
  await expect(page.locator(".cm-content")).toContainText(
    "[打开网站](https://example.com)",
  );
  await page.keyboard.press("Control+k");
  await page.keyboard.type("https://new.example/path");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText(
    "[打开网站](https://new.example/path)",
  );
  expect(errors).toEqual([]);
});

test("文内标题、重复标题和关联文档锚点跳转", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "跳转.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "[跳到标题](#目标标题)\n\n[第二个标题](#目标标题-1)\n\n[子文档](child.md#目标标题)\n\n## **目标标题**\n\n第一段\n\n## 目标标题\n\n第二段\n\n",
    ),
  });
  await page
    .getByRole("link", { name: "跳到标题", exact: true })
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".cm-activeLine")).toContainText("**目标标题**");
  await page
    .getByRole("link", { name: "第二个标题", exact: true })
    .click({ modifiers: ["Control"] });
  await expect(page.locator(".cm-activeLine")).toHaveText("## 目标标题");
  await page
    .getByRole("link", { name: "子文档", exact: true })
    .click({ modifiers: ["Control"] });
  await expect(
    page.getByRole("button", { name: "child.md", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".cm-activeLine")).toHaveText("## 目标标题");
});

test("拒绝危险协议且不改变文档", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "协议.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("[危险链接](javascript:alert%281%29)\n\n"),
  });
  await page
    .getByRole("link", { name: "危险链接", exact: true })
    .click({ modifiers: ["Control"] });
  await expect(page.getByRole("status")).toContainText("不支持此链接");
  expect(
    await page.evaluate(() => (window as unknown as { links: string[] }).links),
  ).toEqual([]);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText(
    "javascript:alert%281%29",
  );
});

test("HTML 导出的文内链接与重复标题锚点一致", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "锚点.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "[目录](#目标标题-1)\n\n## **目标标题**\n\n## 目标标题\n\n",
    ),
  });
  await page.evaluate(() => {
    delete window.desktop;
  });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain(`href="#${encodeURIComponent("目标标题-1")}"`);
  expect(html).toContain('id="目标标题"');
  expect(html).toContain('id="目标标题-1"');
  const preview = await page.context().newPage();
  await preview.setContent(html);
  await preview.getByRole("link", { name: "目录", exact: true }).click();
  await expect(preview.locator("h2:target")).toHaveAttribute(
    "id",
    "目标标题-1",
  );
  await preview.close();
});

test("编辑引用链接地址只影响当前链接，保留其他引用与定义", async ({ page }) => {
  await page.goto("/");
  await page
    .locator(".md-input")
    .setInputFiles({
      name: "引用编辑.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "[第一个][manual]\n\n[第二个][manual]\n\n[manual]: https://old.example/guide\n\n",
      ),
    });
  await page.getByRole("link", { name: "第一个", exact: true }).click();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("https://new.example/guide");
  await page.keyboard.press("Control+End");
  await expect(
    page.getByRole("link", { name: "第一个", exact: true }),
  ).toHaveAttribute("href", "https://new.example/guide");
  await expect(
    page.getByRole("link", { name: "第二个", exact: true }),
  ).toHaveAttribute("href", "https://old.example/guide");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("[第二个][manual]");
  await expect(page.locator(".cm-content")).toContainText(
    "[manual]: https://old.example/guide",
  );
});
