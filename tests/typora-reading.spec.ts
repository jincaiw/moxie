import { test, expect } from "@playwright/test";
import { documentEnd } from "./keyboard";

test("带 YAML 与目录的主题文档定位后，列表文字点击对应实际源码行", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("moxie.sidebar-mode.v1", "outline");
    localStorage.setItem(
      "moxie.recovery.v1",
      JSON.stringify([
        {
          id: "layout",
          name: "layout.md",
          dirty: false,
          text:
            "---\ntitle: 对照验收\nauthor: 本机样本\ntags: [Markdown, 写作]\n---\n\n[TOC]\n\n# 标题一\n\n普通段落第一行\n普通段落第二行\n\n第二个段落。\n\n## 列表与引用\n\n- 第一项\n- 第二项\n  - 嵌套子项\n\n1. 有序第一项\n2. 有序第二项\n\n> 引用\n\n## 后续\n\n" +
            "正文\n\n".repeat(50),
        },
      ]),
    );
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const css =
      "html{font-size:16px} body{font-family:Arial;color:#333;line-height:1.6} #write{max-width:860px;margin:0 auto;padding:30px;padding-bottom:100px} h1,h2{margin:1rem 0;font-weight:bold;line-height:1.4} h1{font-size:2.25em;line-height:1.2;border-bottom:1px solid #eee} h2{font-size:1.75em;line-height:1.225;border-bottom:1px solid #eee} ul,ol{padding-left:30px}";
    const style = document.createElement("style");
    style.textContent = css + "\n" + typoraEditorCSS(css);
    document.head.append(style);
  });
  await page
    .locator(".outline-navigation")
    .getByRole("button", { name: "列表与引用", exact: true })
    .click();
  const nested = page.locator(".cm-line").filter({ hasText: "嵌套子项" });
  await nested.click();
  await expect(page.locator(".cm-activeLine")).toContainText("  - 嵌套子项");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".cm-activeLine")).toContainText("- 第二项");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cm-activeLine")).toContainText("  - 嵌套子项");
});

test("列表主题缩进按混合层级累加，长行悬挂对齐且编辑保留原始空格", async ({
  page,
}) => {
  const source =
    "- 根项目\n\n  10) 子项目\n      - 深层项目\n        续行内容\n\n- " +
    "长项目内容".repeat(40) +
    "\n\n> - 引用项目\n\n- [x] 任务项目\n\n结尾";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "list-layout.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(
      "#write{font-size:16px} ul{padding-left:30px} ol{padding-left:40px} @media(max-width:1000px){ul{padding-left:24px}}",
    );
    document.head.append(style);
  });
  const line = (text: string) =>
    page.locator(".cm-line").filter({ hasText: text }).first();
  await expect(line("根项目")).toHaveCSS("padding-left", "30px");
  await expect(line("子项目")).toHaveCSS("padding-left", "70px");
  await expect(line("深层项目")).toHaveCSS("padding-left", "100px");
  await expect(line("续行内容")).toHaveCSS("padding-left", "100px");
  await expect(page.locator(".md-ordered-marker")).toHaveText("10)");
  const hanging = await line("长项目内容").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text: Node | null = null;
    while ((text = walker.nextNode()))
      if (text.textContent?.includes("长项目内容")) break;
    const range = document.createRange();
    range.selectNodeContents(text!);
    return {
      left: el.getBoundingClientRect().left,
      rects: Array.from(range.getClientRects()).map((r) => ({
        left: r.left,
        height: r.height,
      })),
    };
  });
  expect(hanging.rects.length).toBeGreaterThan(1);
  for (const rect of hanging.rects)
    expect(rect.left - hanging.left).toBeCloseTo(30, 0);
  await expect(page.getByRole("checkbox").last()).toBeChecked();
  await expect(line("引用项目").locator(".md-bullet-marker")).toHaveText("•");
  await line("子项目").click();
  await expect(page.locator(".cm-activeLine")).toContainText("  10) 子项目");
  await page
    .getByRole("textbox", { name: "Markdown 编辑区" })
    .press(documentEnd);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(line("深层项目")).toHaveCSS("padding-left", "88px");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect(
    await page
      .locator(".cm-line")
      .evaluateAll((lines) => lines.map((el) => el.textContent).join("\n")),
  ).toBe(source);
});

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

test("任务和引用内列表继承主题缩进，切换任务及源码往返保持结构", async ({
  page,
}) => {
  const source =
    "- [x] 根任务" +
    "长任务内容".repeat(30) +
    "\n  - [ ] 子任务\n    任务续行\n\n> - 引用项目\n>   - [ ] 引用任务\n>     引用续行\n>\n> > 1) 深层编号\n\n1) [ ] 有序任务\n\n结尾";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "tasks.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(
      "#write{font-size:16px} ul{padding-left:30px} ol{padding-left:40px} blockquote{border-left:4px solid #dfe2e5;padding:0 15px}",
    );
    document.head.append(style);
  });
  const line = (text: string) =>
    page.locator(".cm-line").filter({ hasText: text }).first();
  for (const [text, padding] of [
    ["根任务", "30px"],
    ["子任务", "60px"],
    ["任务续行", "60px"],
    ["引用项目", "45px"],
    ["引用任务", "75px"],
    ["引用续行", "75px"],
    ["深层编号", "74px"],
    ["有序任务", "40px"],
  ])
    await expect(line(text)).toHaveCSS("padding-left", padding);
  const wrapping = await line("根任务").evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text: Node | null;
    while ((text = walker.nextNode())) {
      if (!text.textContent?.includes("根任务")) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      return Array.from(range.getClientRects()).map(
        (rect) => rect.left - el.getBoundingClientRect().left,
      );
    }
    return [];
  });
  expect(wrapping.length).toBeGreaterThan(1);
  for (const left of wrapping) expect(left).toBeCloseTo(30, 0);
  await expect(page.locator(".md-task-line .task-checkbox")).toHaveCount(4);
  await expect(line("有序任务").locator(".md-ordered-marker")).toHaveCount(0);
  await page
    .getByRole("checkbox", { name: "任务：引用任务", exact: true })
    .check();
  await expect(
    page.getByRole("checkbox", { name: "任务：引用任务", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("textbox", { name: "Markdown 编辑区" })
    .press("ControlOrMeta+z");
  await expect(
    page.getByRole("checkbox", { name: "任务：引用任务", exact: true }),
  ).not.toBeChecked();
  await page
    .getByRole("textbox", { name: "Markdown 编辑区" })
    .press("ControlOrMeta+Shift+z");
  await expect(
    page.getByRole("checkbox", { name: "任务：引用任务", exact: true }),
  ).toBeChecked();
  await line("引用项目").click();
  await expect(page.locator(".cm-activeLine")).toContainText("> - 引用项目");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect(
    await page
      .locator(".cm-line")
      .evaluateAll((lines) => lines.map((el) => el.textContent).join("\n")),
  ).toBe(source.replace(">   - [ ] 引用任务", ">   - [x] 引用任务"));
});

test("标题边框位于主题底部外间距之前，保留盒内测量和媒体级联", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "heading.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 标题\n\n正文\n\n结尾"),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(
      "#write{font-size:16px} h1{margin:16px 0 24px;padding-bottom:5px;border-bottom:2px solid #abcdef} @media(max-width:1000px){h1{margin-bottom:12px;border-bottom-color:#fedcba}}",
    );
    document.head.append(style);
  });
  const heading = page.locator(".md-h1");
  await expect(heading).toHaveCSS("padding-bottom", "29px");
  await expect(heading).toHaveCSS("margin-bottom", "0px");
  const border = () =>
    heading.evaluate((el) => {
      const style = getComputedStyle(el, "::after");
      return {
        bottom: style.bottom,
        width: style.borderBottomWidth,
        color: style.borderBottomColor,
      };
    });
  expect(await border()).toEqual({
    bottom: "22px",
    width: "2px",
    color: "rgb(171, 205, 239)",
  });
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(heading).toHaveCSS("padding-bottom", "17px");
  expect(await border()).toEqual({
    bottom: "10px",
    width: "2px",
    color: "rgb(254, 220, 186)",
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".md-h1")).toHaveCount(0);
});
