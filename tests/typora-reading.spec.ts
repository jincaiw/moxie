import { test, expect } from "@playwright/test";
import { documentEnd } from "./keyboard";

test("YAML 阅读态保留原始字段、注释和安全文本，首段沿用正文大小", async ({
  page,
}) => {
  const source =
    '\uFEFF---\r\ntitle: "<img src=x onerror=alert(1)>"\r\n# 原始注释\r\ncustom: [一, 二]\r\n...\r\n\r\n# 标题\r\n\r\n首段第一行\r\n首段第二行\r\n\r\n结尾';
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "yaml.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  const preview = page.locator(".md-metadata-source");
  await expect(preview).toContainText("# 原始注释");
  await expect(preview).toContainText("custom: [一, 二]");
  await expect(preview).toContainText("<img src=x onerror=alert(1)>");
  await expect(preview.locator("img")).toHaveCount(0);
  expect(await preview.textContent()).not.toMatch(/---|\.\.\./);
  const lines = await page.locator(".cm-line").evaluateAll((elements) =>
    elements
      .filter((el) => el.textContent?.includes("首段"))
      .map((el) => ({
        font: getComputedStyle(el).fontSize,
        color: getComputedStyle(el).color,
      })),
  );
  expect(lines).toHaveLength(2);
  expect(lines[0]).toEqual(lines[1]);
  await page.getByRole("button", { name: "展开文档属性源码" }).click();
  await expect(preview).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Markdown 编辑区" }),
  ).toContainText("# 原始注释");
});

test("无序列表按嵌套层级显示圆点，编辑标记和源码往返不改变内容", async ({
  page,
}) => {
  const source =
    "# 列表\n\n- 第一项\n  + 嵌套项\n    * 深层项\n\n1. 有序项\n\n- [x] 任务项\n\n结尾";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "list.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await expect(page.locator(".md-bullet-marker")).toHaveText(["•", "◦", "▪"]);
  await expect(page.getByRole("checkbox").last()).toBeChecked();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".md-bullet-marker")).toHaveCount(0);
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await expect(editor).toContainText("+ 嵌套项");
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  // Selecting a list line restores its original editable marker.
  await page.locator(".cm-line").filter({ hasText: "第一项" }).click();
  await expect(page.locator(".cm-activeLine")).toContainText("- 第一项");
  await editor.press(documentEnd);
  await expect(page.locator(".md-bullet-marker")).toHaveText(["•", "◦", "▪"]);
  expect(errors).toEqual([]);
});

test("目录默认展开且可用键盘定位，标题编辑后更新并保留折叠选择", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "toc.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("[TOC]\n\n# 第一章\n\n## 子章节\n\n结尾"),
  });
  const toc = page.locator(".md-toc");
  await expect(toc).toHaveAttribute("open", "");
  const link = toc.getByRole("button", { name: "子章节", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-activeLine")).toContainText("子章节");
  await page.keyboard.press("End");
  await page.keyboard.type("更新");
  await expect(
    toc.getByRole("button", { name: "子章节更新", exact: true }),
  ).toBeVisible();
  await toc.locator("summary").click();
  await expect(toc).not.toHaveAttribute("open", "");
  await page
    .getByRole("textbox", { name: "Markdown 编辑区" })
    .press(documentEnd);
  await page.keyboard.type("正文增加");
  await expect(toc).not.toHaveAttribute("open", "");
  await toc.locator("summary").click();
  await toc.getByRole("button", { name: "子章节更新", exact: true }).click();
  await expect(page.locator(".cm-activeLine")).toContainText("子章节更新");
});

test("嵌套引用保留各层边框和缩进，主题内边距按层递增", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "quote.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("> 外层\n>\n> > 内层\n> >\n> > > 深层\n\n结尾"),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(
      "#write{max-width:860px} blockquote{border-left:4px solid #dfe2e5;padding:0 15px;color:#777}",
    );
    document.head.append(style);
  });
  await expect(
    page.locator('.md-quote[data-quote-depth="1"]').first(),
  ).toHaveCSS("padding-left", "15px");
  await expect(
    page.locator('.md-quote[data-quote-depth="2"]').first(),
  ).toHaveCSS("padding-left", "34px");
  const deepest = page.locator('.md-quote[data-quote-depth="3"]').first();
  await expect(deepest).toHaveCSS("padding-left", "53px");
  const border = await deepest.evaluate((el) => ({
    width: getComputedStyle(el, "::before").width,
    background: getComputedStyle(el, "::before").backgroundImage,
  }));
  expect(border.width).toBe("38px");
  expect(border.background).toContain("rgb(223, 226, 229)");
});
