import { test, expect } from "@playwright/test";
import { documentEnd, documentStart } from "./keyboard";

test("Typora 主题的水平分隔线映射高度、留白和颜色", async ({ page }) => {
  const source = "上方文字\n\n---\n\n下方文字";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "themed-rule.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.evaluate(async () => {
    const { typoraEditorCSS } = await import(
      /* @vite-ignore */ "/src/theme-css.ts"
    );
    const css = `#write{font-size:16px;line-height:1.6}
      hr{height:2px;padding:0;margin:16px 0;background-color:#e7e7e7;border:0 none}`;
    const style = document.createElement("style");
    style.textContent = css + "\n" + typoraEditorCSS(css);
    document.head.append(style);
  });
  const rule = page.locator(".cm-line.md-rule");
  await expect(rule).toHaveCount(1);
  await expect(rule).toHaveCSS("height", "34px");
  await expect
    .poll(() =>
      rule.evaluate((line) => getComputedStyle(line, "::after").borderTopColor),
    )
    .toBe("rgb(231, 231, 231)");
  await expect
    .poll(() => rule.evaluate((line) => getComputedStyle(line, "::after").top))
    .toBe("17px");
});

test("Typora 主题只为文档首个顶层列表增加上边距", async ({ page }) => {
  const source =
    "- 首个列表项\n- 第二个列表项\n\n正文\n\n- 后续列表\n  - 嵌套列表";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "root-list-margin.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.evaluate(async () => {
    const { typoraEditorCSS } = await import(
      /* @vite-ignore */ "/src/theme-css.ts"
    );
    const css = `#write{font-size:16px}
      #write > ul:first-child,#write > ol:first-child{margin-top:30px}`;
    const style = document.createElement("style");
    style.textContent = css + "\n" + typoraEditorCSS(css);
    document.head.append(style);
  });
  await page.locator(".cm-line").filter({ hasText: "正文" }).click();
  const first = page.locator(".cm-line.md-first-root-list");
  await expect(first).toHaveCount(1);
  await expect(first).toHaveCSS("padding-top", "30px");
  await expect(
    page.locator(".cm-line.md-list-line").filter({ hasText: "第二个列表项" }),
  ).toHaveCSS("padding-top", "0px");
  await expect(
    page.locator(".cm-line.md-list-line").filter({ hasText: "后续列表" }),
  ).toHaveCSS("padding-top", "0px");
  await expect(
    page.locator(".cm-line.md-list-line").filter({ hasText: "嵌套列表" }),
  ).toHaveCSS("padding-top", "0px");
});

test("前置文档属性使后续列表不再是主题 CSS 的首个子项", async ({ page }) => {
  const source = "---\ntitle: 文档属性\n---\n\n- 属性后的列表";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "front-matter-list.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  const list = page.getByText("属性后的列表");
  await expect(list).toBeVisible();
  await list.click();
  await expect(page.locator(".cm-line.md-first-root-list")).toHaveCount(0);
});

test("Typora 段落字体和直接子段落级联保留作用域与源码", async ({ page }) => {
  const source =
    "# 标题\n\n第一段\n软换行\n\n> 引用文字\n\n- 列表文字\n\n```text\n代码文字\n```\n\n结尾段落";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "paragraph-style.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const css = `#write{font-size:16px;line-height:1.5}
      #write > p{color:#8a2457;text-align:right}
      p{font-size:18px;line-height:1.8;color:#246890;letter-spacing:1px}
      @media(max-width:1000px){#write > p{font-size:20px;color:#245724}}
      .toolbar p{font-size:99px}`;
    const style = document.createElement("style");
    style.textContent = css + "\n" + typoraEditorCSS(css);
    document.head.append(style);
  });
  const paragraph = page.locator(".cm-line").filter({ hasText: "第一段" });
  await expect(paragraph).toHaveCSS("font-size", "18px");
  await expect(paragraph).toHaveCSS("line-height", "32.4px");
  await expect(paragraph).toHaveCSS("color", "rgb(138, 36, 87)");
  await expect(paragraph).toHaveCSS("text-align", "right");
  await expect(
    page.locator(".cm-line").filter({ hasText: "软换行" }),
  ).toHaveCSS("font-size", "18px");
  for (const text of ["引用文字", "列表文字"]) {
    const nested = page.locator(".cm-line").filter({ hasText: text });
    await expect(nested).toHaveCSS("font-size", "18px");
    await expect(nested).toHaveCSS("color", "rgb(36, 104, 144)");
    await expect(nested).not.toHaveCSS("text-align", "right");
  }
  await expect(page.locator(".md-h1")).not.toHaveCSS(
    "color",
    "rgb(138, 36, 87)",
  );
  await expect(page.locator(".md-code-preview")).not.toHaveCSS(
    "font-size",
    "18px",
  );
  await paragraph.click();
  await expect(page.locator(".cm-activeLine")).toContainText("第一段");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cm-activeLine")).toContainText("软换行");
  await page.screenshot({
    path: "/tmp/moxie-paragraph-typography-desktop.png",
  });
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(paragraph).toHaveCSS("font-size", "20px");
  await expect(paragraph).toHaveCSS("color", "rgb(36, 87, 36)");
  await page.screenshot({ path: "/tmp/moxie-paragraph-typography-narrow.png" });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(
    page.locator(".cm-line").filter({ hasText: "第一段" }),
  ).not.toHaveCSS("font-size", "20px");
  expect(
    await page
      .locator(".cm-line")
      .evaluateAll((lines) => lines.map((line) => line.textContent).join("\n")),
  ).toBe(source);
  expect(errors).toEqual([]);
});

test("主题长标题文档的文末光标保持在正文视口内", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "long-headings.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      Array.from(
        { length: 60 },
        (_, i) => `## 章节 ${i + 1}\n\n正文 ${i + 1}\n`,
      ).join("\n"),
    ),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(
      "#write{font-size:16px;line-height:1.6;max-width:860px;margin:0 auto;padding:30px;padding-bottom:100px}h2{font-size:1.75em;line-height:1.225;margin:1rem 0;border-bottom:1px solid #eee}p{margin:.8em 0}",
    );
    document.head.append(style);
  });
  await page.locator(".cm-content").click();
  await page.keyboard.press(documentEnd);
  const caretVisible = () =>
    page.locator(".cm-activeLine").evaluate((line) => {
      const bounds = line.getBoundingClientRect();
      const viewport = line.closest(".document-area")!.getBoundingClientRect();
      return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom;
    });
  await expect.poll(caretVisible).toBe(true);
  await page.screenshot({ path: "/tmp/moxie-heading-end-fixed.png" });
  await page.keyboard.press(documentStart);
  await expect.poll(caretVisible).toBe(true);
  await page.setViewportSize({ width: 760, height: 560 });
  await page.keyboard.press(documentEnd);
  await expect.poll(caretVisible).toBe(true);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press(documentEnd);
  try {
    await expect.poll(caretVisible).toBe(true);
  } catch (error) {
    const bounds = await page.locator(".cm-activeLine").evaluate((line) => {
      const area = line.closest<HTMLElement>(".document-area")!;
      return {
        line: line.getBoundingClientRect().toJSON(),
        area: area.getBoundingClientRect().toJSON(),
        scrollTop: area.scrollTop,
        scrollHeight: area.scrollHeight,
        clientHeight: area.clientHeight,
        content: line.textContent,
      };
    });
    throw new Error(
      `${String(error)}\nSource end bounds: ${JSON.stringify(bounds)}`,
    );
  }
  await page.screenshot({ path: "/tmp/moxie-heading-end-source-narrow.png" });
  expect(errors).toEqual([]);
});

test("Typora 代码主题区分行内与整块表面，复制、编辑和源码往返保留内容", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const code = 'const text = "<安全>";\nconsole.log(text);';
  const source = "行内 `sample`\n\n```js\n" + code + "\n```\n\n结尾";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "code-theme.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const css = `#write{font-size:16px}
      .md-fences,code{border:1px solid #ddd;background:#f8f8f8;border-radius:3px;padding:2px 4px;font-size:.9em}
      code{background:#f3f4f4;padding:0 2px}
      .md-fences{margin:15px 0;padding-top:8px;padding-bottom:6px}
      @media(max-width:1000px){#write .md-fences{font-size:1em}}
      .toolbar code{font-size:99px}`;
    const style = document.createElement("style");
    // Use the same original-plus-adapted cascade as an imported theme.
    style.textContent = css + "\n" + typoraEditorCSS(css);
    document.head.append(style);
  });
  const block = page.locator(".md-code-preview");
  const inline = page.locator(".md-inline-code");
  await expect(inline).toHaveCSS("background-color", "rgb(243, 244, 244)");
  await expect(inline).toHaveCSS("padding-left", "2px");
  await expect(block).toHaveCSS("background-color", "rgb(248, 248, 248)");
  await expect(block).toHaveCSS("font-size", "14.4px");
  await expect(block).toHaveCSS("margin-top", "15px");
  await expect(block.locator("pre")).toHaveCSS("padding-top", "32px");
  await expect(block.locator("pre")).toHaveCSS("padding-left", "4px");
  await expect(block.locator("code")).toHaveCSS("border-top-width", "0px");
  await expect(block.locator("code")).toHaveCSS("padding-left", "0px");
  await expect(block.locator("code")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(block.locator("code")).toHaveCSS("font-size", "14.4px");
  await expect(page.locator(".md-code-line .md-code-preview")).toHaveCount(0);
  await expect(block.locator(".md-code-token").first()).toBeVisible();
  await block.getByRole("button", { name: "复制代码" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
  await block.locator("pre").click();
  await expect(block).toHaveCount(0);
  await expect(page.locator(".md-code-line").first()).toContainText("```js");
  await page
    .getByRole("textbox", { name: "Markdown 编辑区" })
    .press(documentEnd);
  await expect(block).toBeVisible();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(block.locator("code")).toHaveCSS("font-size", "16px");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(block).toHaveCount(0);
  expect(
    await page
      .locator(".cm-line")
      .evaluateAll((lines) => lines.map((line) => line.textContent).join("\n")),
  ).toBe(source);
});

test("Typora 主题的正文与标题映射遵循媒体宽度，源码和工具栏保持原样", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "moxie.recovery.v1",
      JSON.stringify([
        {
          id: "theme",
          name: "theme.md",
          text: "# 一级标题\n\n## 二级标题\n\n正文 text",
          dirty: false,
        },
      ]),
    );
  });
  await page.goto("/");
  const toolbarFont = await page
    .locator(".toolbar")
    .evaluate((element) => getComputedStyle(element).fontSize);
  // The adapter relies on the browser CSS parser, so exercise it inside the page.
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const css =
      "html {font-size:16px} body{font-family:Georgia;line-height:1.6;color:rgb(51,51,51)} #write{max-width:860px;padding:30px} @media(min-width:1400px){#write{max-width:1024px}} h1,h2{font-weight:700;line-height:1.2} h1{font-size:2.25em;border-bottom:1px solid #eee} h2{font-size:1.75em}";
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(css);
    document.head.append(style);
    (window as any).adaptedTheme = style.textContent;
  });
  await expect(page.locator(".editor-host")).toHaveCSS("max-width", "1024px");
  await expect(page.locator(".cm-content")).toHaveCSS("font-family", "Georgia");
  await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "16px");
  await expect(page.locator(".md-h1")).toHaveCSS("font-size", "36px");
  await expect(page.locator(".md-h2")).toHaveCSS("font-size", "28px");
  await expect(page.locator(".toolbar")).toHaveCSS("font-size", toolbarFont);
  await page.setViewportSize({ width: 1200, height: 900 });
  await expect(page.locator(".editor-host")).toHaveCSS("max-width", "860px");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "18px");
});

test("只有真实 write 选择器启用映射，正文容器字体可覆盖 html 基础字号", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const inactive = typoraEditorCSS("/* #write */ body{font-size:99px}");
    const blocked = typoraEditorCSS(
      "#write{background:url(https://example.com/x)}",
    );
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(
      "html{font-size:16px} #write{font-size:17px;font-family:Georgia;max-width:900px}",
    );
    document.head.append(style);
    return { inactive, blocked };
  });
  expect(result).toEqual({ inactive: "", blocked: "" });
  await expect(page.locator(".cm-editor")).toHaveCSS("font-size", "17px");
  await expect(page.locator(".cm-content")).toHaveCSS("font-family", "Georgia");
});

test("Typora 嵌套引用和列表段落选择器映射到对应编辑行", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "moxie.recovery.v1",
      JSON.stringify([
        {
          id: "nested-paragraphs",
          name: "nested-paragraphs.md",
          dirty: false,
          text: "> 引用段落\n> - 引用中的列表段落\n\n- 列表段落\n\n正文",
        },
      ]),
    );
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(`
      #write{font-size:16px}
      #write > blockquote > p{font-size:21px;color:rgb(120,20,40)}
      #write > ul > li > p{font-size:19px;color:rgb(20,80,120)}
      #write blockquote ul li p{font-size:23px;color:rgb(80,40,120)}
    `);
    document.head.append(style);
  });
  const quote = page.locator(".md-quote.md-paragraph:not(.md-list-line)");
  const list = page.locator(".md-list-line.md-paragraph:not(.md-quote)");
  const quotedList = page.locator(".md-quote.md-list-line.md-paragraph");
  await expect(quote).toHaveCSS("font-size", "21px");
  await expect(quote).toHaveCSS("color", "rgb(120, 20, 40)");
  await page.locator(".cm-line").filter({ hasText: "正文" }).click();
  await expect(list).toHaveCSS("font-size", "19px");
  await expect(list).toHaveCSS("color", "rgb(20, 80, 120)");
  await expect(quotedList).toHaveCSS("font-size", "23px");
  await expect(quotedList).toHaveCSS("color", "rgb(80, 40, 120)");
  await expect(page.locator(".cm-line.md-root-paragraph")).toHaveCSS(
    "font-size",
    "16px",
  );
});

test("Typora 引用与表格样式作用于正文，保留列对齐和表格工具", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "moxie.recovery.v1",
      JSON.stringify([
        {
          id: "blocks",
          name: "blocks.md",
          dirty: false,
          text: "# 标题\n\n> 引用第一行\n> 引用第二行\n\n| 左列 | 右列 |\n| :--- | ---: |\n| 一 | 二 |\n| 三 | 四 |\n\n正文",
        },
      ]),
    );
  });
  await page.goto("/");
  await expect(page.locator(".editable-table table")).toBeVisible();
  const toolFont = await page
    .locator(".table-tools button")
    .first()
    .evaluate((el) => getComputedStyle(el).fontSize);
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(`#write{max-width:860px}
      blockquote{border-left:4px solid #dfe2e5;padding:0 15px;color:#777777;margin:0.8em 0}
      table{font-size:16px} table th{font-weight:bold;padding:6px 13px;border:1px solid #dfe2e5}
      table td{padding:6px 13px;border:1px solid #dfe2e5}
      table tr:nth-child(2n){background-color:#f8f8f8}
      #write table td:last-child{color:rgb(120,20,40)}
      table button{font-size:99px} .toolbar{font-size:99px}`);
    document.head.append(style);
  });
  const quote = page.locator(".md-quote").first();
  await expect(quote).toHaveCSS("padding-left", "15px");
  await expect(quote).toHaveCSS("color", "rgb(119, 119, 119)");
  await expect(quote).toHaveCSS("border-left-color", "rgb(223, 226, 229)");
  await expect(quote).toHaveCSS("margin-top", "0px");
  await expect(page.locator(".editable-table th").first()).toHaveCSS(
    "font-weight",
    "700",
  );
  await expect(page.locator(".editable-table td").first()).toHaveCSS(
    "padding-left",
    "13px",
  );
  await expect(page.locator(".editable-table tbody tr").nth(1)).toHaveCSS(
    "background-color",
    "rgb(248, 248, 248)",
  );
  await expect(page.locator(".editable-table td").nth(1)).toHaveCSS(
    "text-align",
    "right",
  );
  await expect(page.locator(".editable-table td").nth(1)).toHaveCSS(
    "color",
    "rgb(120, 20, 40)",
  );
  await expect(page.locator(".table-tools button").first()).toHaveCSS(
    "font-size",
    toolFont,
  );
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".md-quote")).toHaveCount(0);
});

test("主题段落间距按连续空行成对保留，媒体级联和点击定位不改变原文", async ({
  page,
}) => {
  let source = "起始段。";
  for (let count = 1; count <= 5; count++)
    source += "\n".repeat(count + 1) + `${count} 个空行后的段落。`;
  source += "\n";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "paragraphs.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(
      "#write{font-size:20px;line-height:1.5} p{margin:10px 0 16px} @media(max-width:1000px){#write p{margin:4px 0 6px}}",
    );
    document.head.append(style);
  });
  const measure = () =>
    page.locator(".cm-line").evaluateAll((lines) => {
      const paragraphs = lines.filter((line) => line.textContent?.trim());
      return paragraphs
        .slice(1)
        .map(
          (line, index) =>
            Math.round(
              (line.getBoundingClientRect().top -
                paragraphs[index].getBoundingClientRect().bottom) *
                10,
            ) / 10,
        );
    });
  await expect.poll(measure).toEqual([16, 16, 62, 62, 108]);
  await page
    .locator(".cm-line")
    .filter({ hasText: "3 个空行后的段落" })
    .click();
  await expect(page.locator(".cm-activeLine")).toContainText(
    "3 个空行后的段落",
  );
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".cm-activeLine")).toHaveClass(/md-paragraph-gap/);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".cm-activeLine")).toContainText(
    "3 个空行后的段落",
  );
  await page.setViewportSize({ width: 900, height: 1000 });
  await expect.poll(measure).toEqual([6, 6, 42, 42, 78]);
  await page.screenshot({
    path: "/tmp/moxie-paragraph-evidence/browser-narrow.png",
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect(
    await page
      .locator(".cm-line")
      .evaluateAll((lines) => lines.map((line) => line.textContent).join("\n")),
  ).toBe(source);
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await expect.poll(measure).toEqual([6, 6, 42, 42, 78]);
  expect(errors).toEqual([]);
});

test("段落主题留白不作用于标题、列表、引用、公式和代码的空行", async ({
  page,
}) => {
  const source =
    "# 标题\n\n普通段落\n\n- 列表\n\n  列表续段\n\n> 引用\n>\n> 引用续段\n\n$$\nx^2\n$$\n\n后续段落\n\n```text\na\n\nb\n```\n\n结尾";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "blocks.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.evaluate(async () => {
    const modulePath = "/src/theme-css.ts";
    const { typoraEditorCSS } = await import(/* @vite-ignore */ modulePath);
    const style = document.createElement("style");
    style.textContent = typoraEditorCSS(
      "#write{font-size:16px;line-height:1.6} p{margin:.8em 0}",
    );
    document.head.append(style);
  });
  await expect(page.locator(".md-paragraph-gap")).toHaveCount(0);
  await expect(page.locator(".md-code-preview")).toBeVisible();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  expect(
    await page
      .locator(".cm-line")
      .evaluateAll((lines) => lines.map((line) => line.textContent).join("\n")),
  ).toBe(source);
});
