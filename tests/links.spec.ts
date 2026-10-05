import { test, expect } from "@playwright/test";
import { documentEnd, shortcut, clickModifier } from "./keyboard";
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
      "# 链接\n\n[打开网站](https://example.com) 和 [**使用说明**][manual]\n\n<https://example.org>\n\n裸链接 https://bare.example/path 和 www.example.net/guide\n\n邮箱 writer@example.org\n\n`https://code.example/path` 和 `[代码示例](https://code.example)`\n\n[manual]: https://example.com/manual\n\n",
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
    page.getByRole("link", {
      name: "https://bare.example/path",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "www.example.net/guide",
      exact: true,
    }),
  ).toHaveAttribute("href", "http://www.example.net/guide");
  await expect(
    page.getByRole("link", { name: "writer@example.org", exact: true }),
  ).toHaveAttribute("href", "mailto:writer@example.org");
  await expect(
    page.getByRole("link", { name: "代码示例", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", {
      name: "https://code.example/path",
      exact: true,
    }),
  ).toHaveCount(0);
  await website.click({ modifiers: [clickModifier] });
  expect(
    await page.evaluate(() => (window as unknown as { links: string[] }).links),
  ).toEqual(["https://example.com"]);
  await website.click();
  await expect(page.locator(".cm-content")).toContainText(
    "[打开网站](https://example.com)",
  );
  await page.keyboard.press(shortcut("k"));
  await page.keyboard.type("https://new.example/path");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText(
    "[打开网站](https://new.example/path)",
  );
  expect(errors).toEqual([]);
});

test("行内公式不会改写 Markdown 链接目标", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "公式链接.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# 公式链接\n\n[公式 $x+1$ 与 `$code$` 和 \\$literal$](https://example.test/search?q=$query$)\n\n独立公式 $a^2+b^2$。",
    ),
  });

  const link = page.getByRole("link", { name: /公式/ });
  await expect(link).toHaveAttribute(
    "href",
    "https://example.test/search?q=$query$",
  );
  await page.locator(".cm-line").filter({ hasText: "公式链接" }).click();
  await expect(page.locator(".inline-formula")).toHaveCount(2);
  await expect(page.locator(".rendered-link .inline-formula")).toContainText(
    "x+1",
  );
  await expect(page.locator(".rendered-link code")).toHaveText("$code$");
  await expect(link).toContainText("$literal$");
  await expect(page.locator(".inline-formula").last()).toContainText("a2+b2");

  const html = await page.evaluate(async () => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(
      "[公式 $x+1$ 与 `$code$` 和 \\$literal$](https://example.test/search?q=$query$)\n\n独立公式 $a^2+b^2$。",
      "公式链接.md",
    );
  });
  expect(html).toContain('href="https://example.test/search?q=$query$"');
  expect(html).toContain("<code>$code$</code>");
  expect(html.match(/<math/g)).toHaveLength(2);
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
    .click({ modifiers: [clickModifier] });
  await expect(page.locator(".cm-activeLine")).toContainText("**目标标题**");
  await page
    .getByRole("link", { name: "第二个标题", exact: true })
    .click({ modifiers: [clickModifier] });
  await expect(page.locator(".cm-activeLine")).toHaveText("## 目标标题");
  await page
    .getByRole("link", { name: "子文档", exact: true })
    .click({ modifiers: [clickModifier] });
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
    .click({ modifiers: [clickModifier] });
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
  await page.locator(".md-input").setInputFiles({
    name: "引用编辑.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "[第一个][manual]\n\n[第二个][manual]\n\n[manual]: https://old.example/guide\n\n",
    ),
  });
  await page.getByRole("link", { name: "第一个", exact: true }).click();
  await page.keyboard.press(shortcut("k"));
  await page.keyboard.type("https://new.example/guide");
  await page.keyboard.press(documentEnd);
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

test("GFM 裸网址和邮箱在 HTML 导出中保留自动链接", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "gfm-autolinks.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "https://bare.example/path\n\nwww.example.net/guide\n\nwriter@example.org\n\n`https://code.example/path`",
    ),
  });
  await page.evaluate(() => {
    delete window.desktop;
  });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  const preview = await page.context().newPage();
  await preview.setContent(html);
  await expect(preview.locator("a")).toHaveCount(3);
  await expect(
    preview.getByRole("link", { name: "https://bare.example/path" }),
  ).toHaveAttribute("href", "https://bare.example/path");
  await expect(
    preview.getByRole("link", { name: "www.example.net/guide" }),
  ).toHaveAttribute("href", "http://www.example.net/guide");
  await expect(
    preview.getByRole("link", { name: "writer@example.org" }),
  ).toHaveAttribute("href", "mailto:writer@example.org");
  await expect(preview.locator("code")).toHaveText("https://code.example/path");
  await preview.close();
});
