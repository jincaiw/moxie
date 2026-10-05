import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import { parseClipboardTable, parseTable } from "../src/table";
import { inlineMathMatches } from "../src/math";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
  "base64",
);

test("表格直接编辑、转义竖线、撤销重做与增删行列", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator(".editable-table td").first().click();
  const cell = page.getByRole("textbox", { name: "编辑第 2 行第 1 列" });
  await cell.fill("计划 | 已修改");
  await cell.press("Control+z");
  await expect(cell).toHaveValue("保存文档");
  await cell.press("Control+Shift+z");
  await expect(cell).toHaveValue("计划 | 已修改");
  await cell.press("Enter");
  await expect(page.locator(".editable-table td").first()).toHaveText(
    "计划 | 已修改",
  );
  await page.getByRole("button", { name: "添加行", exact: true }).click();
  await expect(page.locator(".editable-table tbody tr")).toHaveCount(4);
  await page.getByRole("button", { name: "添加列", exact: true }).click();
  await expect(page.locator(".editable-table th")).toHaveCount(3);
  await page.getByRole("button", { name: "删除列", exact: true }).click();
  await expect(page.locator(".editable-table th")).toHaveCount(2);
  await page.getByRole("button", { name: "删除行", exact: true }).click();
  await expect(page.locator(".editable-table tbody tr")).toHaveCount(3);
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("计划 \\| 已修改");
  const saved = await page.evaluate(
    () => document.querySelector(".cm-content")!.textContent!,
  );
  expect(saved).toContain("计划 \\| 已修改");
  expect(errors).toEqual([]);
});

test("行内公式扫描遵循转义、空白、相邻公式和双美元边界", () => {
  const matches = inlineMathMatches(
    "$unfinished $x$ and \\$literal; $a\\$b$ then \\\\$c$ $d$ $$block$$",
  );
  expect(matches.map(({ text }) => text)).toEqual(["x", "a\\$b", "c", "d"]);
});

test("从电子表格粘贴 TSV 会扩展表格并正确转义单元格", async ({ page }) => {
  await page.goto("/");
  await page.locator(".editable-table td").first().click();
  const input = page.getByRole("textbox", { name: "编辑第 2 行第 1 列" });
  await input.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "One\tTwo\tThree\nFour\tA | B\tSix\nSeven\tEight\tNine",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await expect(page.locator(".editable-table th")).toHaveCount(3);
  await expect(page.locator(".editable-table tbody tr")).toHaveCount(3);
  await expect(page.locator('.editable-table [data-cell="2:1"]')).toHaveText(
    "A | B",
  );
  await expect(page.locator('.editable-table [data-cell="3:2"]')).toHaveText(
    "Nine",
  );
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("A \\| B");
});

test("表格 Tab 到末尾会新建行，Shift+Tab 和方向键可导航单元格", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".editable-table td").first().click();
  let input = page.getByRole("textbox", { name: "编辑第 2 行第 1 列" });
  for (const name of [
    "编辑第 2 行第 2 列",
    "编辑第 3 行第 1 列",
    "编辑第 3 行第 2 列",
    "编辑第 4 行第 1 列",
    "编辑第 4 行第 2 列",
    "编辑第 5 行第 1 列",
  ]) {
    await input.press("Tab");
    input = page.getByRole("textbox", { name });
  }
  await expect(input).toBeFocused();
  await input.press("Shift+Tab");
  input = page.getByRole("textbox", { name: "编辑第 4 行第 2 列" });
  await expect(input).toBeFocused();
  await input.press("Enter");
  const cell = page.locator('.editable-table [data-cell="3:1"]');
  await cell.focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('.editable-table [data-cell="2:1"]')).toBeFocused();
});

test("任务勾选写回 Markdown，格式快捷键与关闭文档提示", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "写作指南.md", exact: true }).click();
  const task = page.getByRole("checkbox", { name: "任务：记录一个新想法" });
  await task.check();
  await expect(task).toBeChecked();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText(
    "- [x] 记录一个新想法",
  );
  await page.getByRole("button", { name: "新建文件", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Control+b");
  await page.keyboard.insertText("强调段落");
  await expect(editor).toContainText("**强调段落**");
  await page
    .getByRole("tablist", { name: "打开的文档" })
    .getByRole("button", { name: "关闭 未命名.md", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "关闭文档" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toContainText("强调段落");
  await page
    .getByRole("tablist", { name: "打开的文档" })
    .getByRole("button", { name: "关闭 未命名.md", exact: true })
    .click();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "未命名.md", exact: true }),
  ).toHaveCount(0);
});

test("图片选择、剪贴板粘贴、拖入与公式导出", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const text = `# 图片与公式\n\n![引用式图片][pixel]\n\n[pixel]: data:image/png;base64,${png.toString("base64")}\n\n<img src="data:image/png;base64,${png.toString("base64")}" alt="HTML 图片">\n\n行内 $a^2+b^2=c^2$。\n\n$$\nE=mc^2\n$$\n\n`;
  await page.locator("input.md-input").setInputFiles({
    name: "media.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  });
  await expect(page.locator(".inline-formula")).toBeVisible();
  await expect(page.locator(".katex-display")).toBeVisible();
  await expect(page.getByRole("img", { name: "引用式图片" })).toBeVisible();
  await expect(page.getByRole("img", { name: "HTML 图片" })).toBeVisible();
  await page
    .locator("input[data-kind=image]")
    .setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "pixel.png" })).toBeVisible();
  expect(
    await page
      .getByRole("img", { name: "pixel.png" })
      .evaluate((img: HTMLImageElement) => img.naturalWidth),
  ).toBe(1);
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
    document.querySelector(".cm-content")!.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png.toString("base64"));
  await expect(page.getByRole("img", { name: "pasted.png" })).toBeVisible();
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    document.querySelector(".cm-content")!.dispatchEvent(
      new DragEvent("drop", {
        dataTransfer: transfer,
        clientX: 450,
        clientY: 350,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, png.toString("base64"));
  await expect(page.getByRole("img", { name: "dropped.png" })).toBeVisible();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain("data:image/png;base64,");
  expect(html).toContain("<math");
  expect(html).not.toContain("$$");
  expect(html).not.toContain("<script>");
  expect(errors).toEqual([]);
  const imagePreview = page.getByRole("button", {
    name: "编辑图片：pixel.png",
  });
  await imagePreview.evaluate((element: HTMLElement) =>
    element.focus({ focusVisible: true }),
  );
  await expect(imagePreview).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.locator(".cm-content")).toContainText("pixel.png");
});

test("设置持久化、专注模式和对话框键盘退出", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("正文字体").selectOption("serif");
  await page.getByLabel("正文宽度").fill("960");
  await page.getByLabel("外观").selectOption("sepia");
  await page.getByLabel("PDF 纸张").selectOption("Letter");
  await page.getByLabel("PDF 页面方向").selectOption("landscape");
  await page.getByLabel("PDF 页边距").fill("24");
  await page.getByLabel("PDF 页眉与页码").check();
  await expect(page.getByLabel("自动检查更新")).toBeChecked();
  await page.getByLabel("自动检查更新").uncheck();
  await page.getByLabel("打字机模式").check();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "偏好设置" }).click();
  await expect(page.getByLabel("正文字体")).toHaveValue("serif");
  await expect(page.getByLabel("正文宽度")).toHaveValue("960");
  await expect(page.getByLabel("外观")).toHaveValue("sepia");
  await expect(page.getByLabel("PDF 纸张")).toHaveValue("Letter");
  await expect(page.getByLabel("PDF 页面方向")).toHaveValue("landscape");
  await expect(page.getByLabel("PDF 页边距")).toHaveValue("24");
  await expect(page.getByLabel("PDF 页眉与页码")).toBeChecked();
  await expect(page.getByLabel("自动检查更新")).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "立即检查更新" }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText(/桌面版|桌面更新服务/);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
  ).toBe("#fbf5e9");
  await expect(page.getByLabel("打字机模式")).toBeChecked();
  await page.getByLabel("外观").selectOption("solarized-dark");
  await expect(page.locator("html")).toHaveAttribute(
    "data-theme",
    "solarized-dark",
  );
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--bg")
        .trim(),
    ),
  ).toBe("#002b36");
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    ),
  ).toBe("dark");
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "切换浅色主题" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "专注模式", exact: true }).click();
  await expect(page.locator(".sidebar")).toHaveCount(0);
  await page.getByRole("button", { name: "退出专注模式", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
});

test("浏览器 PDF 打印采用纸张方向和页边距设置", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __printed?: boolean;
      __printHtml?: string;
    };
    window.open = (() => {
      const doc = {
        readyState: "complete",
        write: (html: string) => {
          state.__printHtml = html;
        },
        close: () => {},
      };
      return {
        document: doc,
        print: () => {
          state.__printed = true;
        },
      } as unknown as Window;
    }) as typeof window.open;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("PDF 纸张").selectOption("Letter");
  await page.getByLabel("PDF 页面方向").selectOption("landscape");
  await page.getByLabel("PDF 页边距").fill("24");
  await page.getByLabel("PDF 页眉与页码").check();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("menuitem", { name: "PDF 文档", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __printed?: boolean }).__printed,
      ),
    )
    .toBe(true);
  const html = await page.evaluate(
    () =>
      (window as typeof window & { __printHtml?: string }).__printHtml ?? "",
  );
  expect(html).toContain("size: Letter landscape; margin: 24mm 24mm");
  expect(html).toContain('content: "欢迎使用.md"');
  expect(html).toContain('counter(page) " / " counter(pages)');
  expect(html).toContain("h1,h2,h3,h4,h5,h6{break-after:avoid");
  expect(html).toContain(
    "table,tr,img,svg,.mermaid-diagram,.moxie-toc,.footnotes",
  );
  expect(html).toContain("thead{display:table-header-group}");
  expect(html).toContain("p{orphans:3;widows:3}");
});

test("自定义主题 CSS 可导入、即时预览、持久保存并拒绝外部加载", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  const css = page.getByRole("textbox", { name: "自定义主题 CSS 内容" });
  await css.fill(":root { --bg: #123456; --accent: #ff00aa; }");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--bg")
          .trim(),
      ),
    )
    .toBe("#123456");
  await page.reload();
  await expect(page.locator(".app")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("选择主题 CSS 文件").setInputFiles({
    name: "custom.css",
    mimeType: "text/css",
    buffer: Buffer.from(":root { --accent: #ee1177; }"),
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      ),
    )
    .toBe("#ee1177");
  await css.fill('@import "https://example.invalid/theme.css";');
  await expect(page.getByRole("alert")).toContainText("不支持 @import");
  await css.fill(
    "body { background-image: u\\72l(https://example.invalid/a.png); }",
  );
  await expect(page.getByRole("alert")).toContainText("不支持外部资源");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      ),
    )
    .toBe("#557895");
  await page.getByRole("button", { name: "清除自定义样式" }).click();
  await expect(css).toHaveValue("");
});

test("自定义 CSS 可保存为具名本地主题并在重启后应用", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  const css = page.getByRole("textbox", { name: "自定义主题 CSS 内容" });
  await css.fill(":root { --bg: #123456; --accent: #ff00aa; }");
  await page.getByLabel("新主题名称").fill("深海");
  await page.getByRole("button", { name: "保存为本地主题" }).click();
  await expect(page.locator(".theme-css-editor [role='status']")).toContainText(
    "已保存",
  );
  await page.reload();
  await page.getByRole("button", { name: "偏好设置" }).click();
  await expect(page.getByLabel("本地主题")).toHaveValue(/.+/);
  await expect(page.locator(".app")).toHaveCSS(
    "background-color",
    "rgb(18, 52, 86)",
  );
  await page.getByRole("button", { name: "删除主题" }).click();
  await expect(page.getByLabel("本地主题")).toHaveValue("");
});

test("原始 HTML 区块在编辑器中净化预览并可回到源码", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "html-preview.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# HTML 安全预览\n\n<div>\n<strong>安全预览</strong>\n<script>window.__unsafe = true</script>\n</div>",
    ),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-content").press("Control+Home");
  const preview = page.locator(".html-block-preview");
  await expect(preview).toContainText("安全预览");
  await expect(preview.locator("script")).toHaveCount(0);
  await preview.click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.locator(".cm-content")).toContainText("window.__unsafe");
});

test("自动保存成功、外部冲突暂停、手动保存后恢复", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      desktop: object;
      calls: { text: string; automatic?: boolean }[];
      external: boolean;
    };
    state.calls = [];
    state.external = false;
    state.desktop = {
      open: async () => ({
        path: "/test/note.md",
        name: "note.md",
        text: "# 文档\n\n",
      }),
      recent: async () => [],
      dirty: () => {},
      onAction: () => () => {},
      save: async (input: { text: string; automatic?: boolean }) => {
        state.calls.push(input);
        if (input.automatic && state.external)
          throw Error("自动保存已暂停：文件已被其他程序修改");
        return { path: "/test/note.md", name: "note.md", text: input.text };
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开文件 ⌘O", exact: true }).click();
  await expect(page.locator(".document-title")).toContainText("note.md");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByLabel("自动保存到原文件").check();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("自动保存测试");
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(1);
  await expect(page.getByRole("button", { name: "已保存" })).toBeVisible();
  await page.evaluate(() => {
    (window as any).external = true;
  });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("冲突");
  await expect(page.locator(".save-warning")).toContainText("自动保存已暂停");
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(2);
  await page.getByRole("button", { name: "手动保存", exact: true }).click();
  await expect(page.locator(".save-warning")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).external = false;
  });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("恢复");
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(4);
});

test("表格解析保留转义和单元格原始位置", () => {
  const source = "| A | B |\n| --- | --- |\n| x\\|y | **值** |";
  const model = parseTable(source);
  expect(model.columns).toBe(2);
  expect(model.rows[1][0].text).toBe("x\\|y");
  const cell = model.rows[1][1];
  expect(source.slice(cell.from, cell.to)).toBe("**值**");
  expect(parseClipboardTable('One\t"Two\tcolumns"\r\nThree\tFour\r\n')).toEqual(
    [
      ["One", "Two\tcolumns"],
      ["Three", "Four"],
    ],
  );
});

test("另存为迁移真实图片并保留代码示例", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const calls: string[] = [];
    window.desktop = {
      readImage: async ({ relativePath }: { relativePath: string }) => {
        calls.push(relativePath);
        return "data:image/png;base64,AQID";
      },
      storeImage: async () => ({ relativePath: "新文档.assets/copied.png" }),
    } as unknown as NonNullable<typeof window.desktop>;
    // Vite loads the actual browser module, including its Markdown parser.
    // @ts-expect-error runtime URL is served by the development server
    const { rehomeImages } = await import("/src/assets.ts");
    const text =
      '[图]: old.assets/reference.png "引用图片"\n\n![引用图][图]\n\n![图片](old.assets/a.png)\n\n<img src="old.assets/html.png" alt="HTML 图片">\n\n`![例子](example.png)`\n\n```md\n![例子](code.png)\n```';
    return { text: await rehomeImages(text, "/old/a.md", "/new/b.md"), calls };
  });
  expect(result.calls).toEqual([
    "old.assets/reference.png",
    "old.assets/html.png",
    "old.assets/a.png",
  ]);
  expect(
    result.text.match(/%E6%96%B0%E6%96%87%E6%A1%A3.assets\/copied.png/g),
  ).toHaveLength(3);
  expect(result.text).toContain("`![例子](example.png)`");
  expect(result.text).toContain("![例子](code.png)");
});

test("多行引用与任务格式应用到整个选区并可切换取消", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "多行.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("第一行\n第二行\n"),
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: /^引用/ }).click();
  await expect(page.locator(".cm-content")).toContainText("> 第一行");
  await expect(page.locator(".cm-content")).toContainText("> 第二行");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: /^引用/ }).click();
  await expect(page.locator(".cm-content")).not.toContainText(">");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: /^任务列表/ }).click();
  await expect(page.locator(".cm-content")).toContainText("- [ ] 第一行");
  await expect(page.locator(".cm-content")).toContainText("- [ ] 第二行");
});

test("大纲识别 Setext 标题并正确跳过嵌套围栏内容", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "大纲.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "标题一\n====\n\n标题二\n----\n\n````md\n```\n# 代码中的标题\n````\n\n## 真正的标题 ##\n",
    ),
  });
  await expect(page.locator(".md-h1")).toContainText("标题一");
  await expect(
    page.locator(".md-h2").filter({ hasText: "标题二" }),
  ).toHaveCount(1);
  await page.getByRole("tab", { name: "大纲", exact: true }).click();
  await expect(page.locator(".outline-row")).toHaveText([
    "标题一",
    "标题二",
    "真正的标题",
  ]);
  await page.getByRole("button", { name: "真正的标题", exact: true }).click();
  await expect(page.locator(".cm-focused")).toBeVisible();
});

test("[TOC] 预览生成分级目录并定位到对应标题", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "目录.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("[TOC]\n\n# 第一章\n\n## 子章节\n\n正文\n"),
  });
  const toc = page.locator(".md-toc");
  await expect(toc).toBeVisible();
  await toc.locator("summary").click();
  const section = toc.getByRole("button", { name: "子章节", exact: true });
  await expect(section).toBeVisible();
  await section.click();
  await expect(page.locator(".cm-activeLine")).toContainText("子章节");
  await expect(toc).not.toHaveAttribute("open", "");
});

test("自动补全括号、引号与反引号，退格删除空配对", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "空白.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(""),
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.type("(");
  await expect(editor).toContainText("()");
  await page.keyboard.press("Backspace");
  await expect(editor).not.toContainText("(");
  await page.keyboard.type("[");
  await expect(editor).toContainText("[]");
  await page.keyboard.press("Backspace");
  await expect(editor).not.toContainText("[");
  await page.keyboard.type('"');
  await expect(editor).toContainText('""');
  await page.keyboard.press("Backspace");
  await page.keyboard.type("`");
  await expect(editor).toContainText("``");
});

test("回车延续列表、任务项和引用，并在空项中退出", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "回车.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("- 第一项"),
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("第二项");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- 第一项", "- 第二项"]);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("段落");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- 第一项", "- 第二项", "段落"]);

  await page.locator(".md-input").setInputFiles({
    name: "任务.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("- [ ] 待办"),
  });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("下一项");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- [ ] 待办", "- [ ] 下一项"]);

  await page.locator(".md-input").setInputFiles({
    name: "引用.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("> 引用"),
  });
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("续行");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["> 引用", "> 续行"]);
});

test("Typora 高亮语法即时预览、隔离代码并导出 HTML", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "高亮.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# 高亮\n\n普通 ==重点文字== 内容，行内代码 `==原样保留==`。\n\n```md\n==代码围栏也保留==\n```\n\n结尾。",
    ),
  });
  await expect(page.locator(".md-highlight")).toHaveText("重点文字");
  await expect(page.locator(".md-inline-code")).toHaveText("==原样保留==");
  await expect(page.locator(".md-code-preview code")).toHaveText(
    "==代码围栏也保留==",
  );
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain("<mark>重点文字</mark>");
  expect(html).toContain("<code>==原样保留==</code>");
  expect(html).toContain("==代码围栏也保留==");
});

test("转义的高亮定界符在预览与 HTML 导出中保持字面文本", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "转义高亮.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("\\==字面标记==，普通 ==高亮文字==。\n\n末尾。"),
  });
  await expect(page.locator(".md-highlight")).toHaveText("高亮文字");
  await expect(page.locator(".cm-content")).toContainText("==字面标记==");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain("==字面标记==");
  expect(html).not.toContain("<mark>字面标记</mark>");
  expect(html).toContain("<mark>高亮文字</mark>");
});

test("转义的上下标定界符不会与后续格式错误配对", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "转义上下标.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("\\^字面上标^ 和 ^2^；\\~字面下标~ 和 ~2~。\n\n末尾。"),
  });
  await expect(page.locator(".cm-content sup")).toHaveText("2");
  await expect(page.locator(".cm-content sub")).toHaveText("2");
  await expect(page.locator(".cm-content")).toContainText("^字面上标^");
  await expect(page.locator(".cm-content")).toContainText("~字面下标~");
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain("^字面上标^");
  expect(html).toContain("~字面下标~");
  expect(html).toContain("<sup>2</sup>");
  expect(html).toContain("<sub>2</sub>");
});

test("高亮快捷键与格式菜单可应用和取消", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "高亮操作.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("待标记"),
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Control+Shift+h");
  await expect(editor).toContainText("==待标记==");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: /高亮/ }).click();
  await expect(editor).toContainText("待标记");
  await expect(editor).not.toContainText("==待标记==");
});

test("格式菜单可为选中文本添加并移除上下标", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "格式菜单.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("H2O 与 x2"),
  });
  const editor = page.locator(".cm-content");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: "下标", exact: true }).click();
  await expect(editor).toContainText("H~2~O");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: "下标", exact: true }).click();
  await expect(editor).toContainText("H2O");

  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: "上标", exact: true }).click();
  await expect(editor).toContainText("x^2^");
});

test("上标下标即时预览、兼容删除线并隔离代码导出", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "上下标.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "水 H~2~O 与 x^2^，删除线 ~~旧字~~；行内代码 `x^2^ ~2~`。\n\n```md\n^代码^ ~代码~\n```\n\n结束。",
    ),
  });
  await expect(page.locator(".cm-content sub")).toHaveText("2");
  await expect(page.locator(".cm-content sup")).toHaveText("2");
  await expect(page.locator(".md-strike")).toContainText("旧字");
  await expect(page.locator(".md-inline-code")).toHaveText("x^2^ ~2~");
  await expect(page.locator(".md-code-preview code")).toHaveText(
    "^代码^ ~代码~",
  );
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain("H<sub>2</sub>O");
  expect(html).toContain("x<sup>2</sup>");
  expect(html).toContain("<del>旧字</del>");
  expect(html).toContain("<code>x^2^ ~2~</code>");
  expect(html).toContain("^代码^ ~代码~");
});

test("脚注重复引用、大小写标签、多行内容与围栏隔离正确导出", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "脚注导出.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "正文[^Note]，再次引用[^note]。\n\n[^note]: 注释首行\n  后续**加粗**。\n\n```md\n[^fake]\n[^fake]: 围栏中的定义\n```\n\n末尾。",
    ),
  });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain('id="fnref-1-1"');
  expect(html).toContain('id="fnref-1-2"');
  expect(html).toContain('id="fn-1"');
  expect(html).toContain("注释首行");
  expect(html).toContain("后续<strong>加粗</strong>");
  expect(html).toContain('aria-label="返回正文引用"');
  expect(html).toContain("[^fake]: 围栏中的定义");
  expect(html).not.toContain('id="fn-2"');
});

test("HTML 块中的脚注样式文本不会被提取为 Markdown 脚注", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "HTML块脚注边界.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      '<div class="literal">\n[^fake]: HTML 块中的普通文本\n</div>\n\n正文[^real]。\n\n[^real]: 真正的脚注',
    ),
  });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain("[^fake]: HTML 块中的普通文本");
  expect(html).toContain("真正的脚注");
  expect(html).not.toContain('id="fn-2"');
});

test("脚注标记可通过鼠标或键盘跳转到定义", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "脚注跳转.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "```md\n[^Some   Note]: 错误围栏目标\n```\n\n正文[^Some   Note]。\n\n[^some note]: 正确跳转目标",
    ),
  });
  const marker = page.getByRole("link", {
    name: "跳转到脚注 Some   Note",
  });
  await expect(marker).toBeVisible();
  await marker.focus();
  await expect(marker).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toContainText(
    "[^some note]: 正确跳转目标",
  );
  await expect(
    page.locator(".cm-line").filter({ hasText: "正确跳转目标" }),
  ).toHaveClass(/cm-activeLine/);
  await marker.click();
});

test("即时排版代码块显示语言并可复制代码", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "代码.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "```ts\nconst answer = 42;\nconsole.log(answer);\n```\n\n正文",
    ),
  });
  await expect(page.locator(".cm-content")).toContainText("const answer = 42;");
  await page.locator(".cm-line").filter({ hasText: "正文" }).click();
  const block = page.locator(".md-code-preview");
  await expect(block).toBeVisible();
  await expect(block.locator(".md-code-language")).toHaveText("ts");
  await expect(block.locator("code")).toHaveText(
    "const answer = 42;\nconsole.log(answer);",
  );
  await expect(
    block.locator("code .md-code-token").filter({ hasText: "const" }),
  ).toHaveCount(1);
  await block.getByRole("button", { name: "复制代码" }).click();
  await expect(block.getByRole("button", { name: "复制代码" })).toHaveText(
    "已复制",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "const answer = 42;\nconsole.log(answer);",
  );
  await block.locator("pre").click();
  await expect(page.locator(".cm-content")).toContainText("```ts");
});

test("字数统计展示字数、字符、段落与预计阅读时间", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "统计.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("你好 world"),
  });
  await page.getByRole("button", { name: "字数统计" }).click();
  const dialog = page.getByRole("dialog", { name: "字数统计" });
  await expect(dialog).toBeVisible();
  const rows = dialog.locator(".document-stats > div");
  await expect(rows.nth(0)).toContainText("2");
  await expect(rows.nth(1)).toContainText("7");
  await expect(rows.nth(2)).toContainText("8");
  await expect(rows.nth(3)).toContainText("1");
  await expect(rows.nth(4)).toContainText("1");
  await expect(rows.nth(5)).toContainText("1 分钟");
});

test("字数统计分批处理时仍以换行隔开词语", async ({ page }) => {
  await page.goto("/");
  const text = Array.from({ length: 257 }, () => "hello").join("\n");
  await page.locator(".md-input").setInputFiles({
    name: "多行统计.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  });
  await page.getByRole("button", { name: "字数统计" }).click();
  const rows = page
    .getByRole("dialog", { name: "字数统计" })
    .locator(".document-stats > div");
  await expect(rows.nth(0)).toContainText("257");
  await expect(rows.nth(1)).toContainText("1,285");
  await expect(rows.nth(3)).toContainText("257");
});

test("无序和有序列表支持多行切换、缩进保留与取消", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "列表.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Alpha\n  Beta\nGamma"),
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "格式" }).click();
  await page.getByRole("menuitem", { name: /有序列表/ }).click();
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["1. Alpha", "  2. Beta", "3. Gamma"]);

  await editor.click();
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "格式" }).click();
  await page.getByRole("menuitem", { name: /无序列表/ }).click();
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- Alpha", "  - Beta", "- Gamma"]);

  await editor.click();
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "格式" }).click();
  await page.getByRole("menuitem", { name: /无序列表/ }).click();
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["Alpha", "  Beta", "Gamma"]);

  await page.locator(".md-input").setInputFiles({
    name: "快捷键.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("Bullets\nNumbers"),
  });
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+Shift+8");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- Bullets", "- Numbers"]);
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+Shift+7");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["1. Bullets", "2. Numbers"]);
});

test("Tab 与 Shift+Tab 调整列表项层级并保留任务标记", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "缩进.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("- parent\n- child\n- [ ] task"),
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- parent", "  - child", "- [ ] task"]);

  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- parent", "- child", "- [ ] task"]);

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- parent", "- child", "  - [ ] task"]);
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- parent", "- child", "- [ ] task"]);
});

test("Tab 缩进列表项时同步缩进续行，Shift+Tab 可完整还原", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "列表续行.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("- 项目\n  续行\n- 下一项"),
  });
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Tab");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["  - 项目", "    续行", "- 下一项"]);
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- 项目", "  续行", "- 下一项"]);
});
