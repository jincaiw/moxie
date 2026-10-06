import { test, expect } from "@playwright/test";
import {
  documentStart,
  documentEnd,
  lineEndSelection,
  shortcut,
} from "./keyboard";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { validateThemeCatalog } from "../src/theme-gallery";
import {
  parseClipboardTable,
  parseTable,
  setTableColumnAlignment,
  tableColumnAlignment,
} from "../src/table";
import { inlineMathMatches } from "../src/math";
import { headings } from "../src/data";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
  "base64",
);

function themeCatalogFixture(css: string) {
  return {
    schemaVersion: 1,
    version: "1.0.0",
    generatedAt: "2026-10-06T00:00:00.000Z",
    themes: [
      {
        id: "mist-blue",
        name: "雾蓝",
        description: "清爽的冷色阅读界面。",
        author: "Moxie",
        license: "CC0-1.0",
        sourceUrl: "https://github.com/jincaiw/moxie",
        previewUrl:
          "https://github.com/jincaiw/moxie/releases/download/v0.16.78/theme-mist-blue.svg",
        version: "1.0.0",
        releaseVersion: "0.16.78",
        minimumAppVersion: "0.16.78",
        packageUrl:
          "https://github.com/jincaiw/moxie/releases/download/v0.16.78/theme-mist-blue.css",
        sha256: createHash("sha256").update(css).digest("hex"),
        size: Buffer.byteLength(css),
        appearance: "light",
      },
    ],
  };
}

async function mockThemeGallery(
  page: import("@playwright/test").Page,
  catalog: unknown,
  packageCSS: string,
) {
  await page.addInitScript(
    ({ catalogText, packageCSS }) => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("theme-catalog-v1.json"))
          return new Response(catalogText, { status: 200 });
        if (url.endsWith("theme-mist-blue.css"))
          return new Response(packageCSS, { status: 200 });
        return originalFetch(input, init);
      };
    },
    { catalogText: JSON.stringify(catalog), packageCSS },
  );
}

test("官方主题目录拒绝重复 ID、非官方地址和不支持的结构", () => {
  const valid = themeCatalogFixture(":root { --accent: #315f85; }");
  expect(() => validateThemeCatalog(valid)).not.toThrow();
  const external = structuredClone(valid);
  external.themes[0].packageUrl = "https://example.com/theme.css";
  expect(() => validateThemeCatalog(external)).toThrow("官方 Release");
  const duplicate = structuredClone(valid);
  duplicate.themes.push({ ...duplicate.themes[0] });
  expect(() => validateThemeCatalog(duplicate)).toThrow("无效或超出限制");
  const unknownSchema = { ...valid, schemaVersion: 2 };
  expect(() => validateThemeCatalog(unknownSchema)).toThrow("不受支持");
});

test("主题图库搜索、筛选、校验并将精选主题保存为本地主题", async ({ page }) => {
  const css = `:root[data-theme] { --bg: #f3f7fb; --text: #253241; --accent: #315f85; }`;
  await mockThemeGallery(page, themeCatalogFixture(css), css);
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByRole("button", { name: "浏览主题图库" }).click();
  const card = page.getByRole("button", { name: /雾蓝/ });
  await expect(card).toBeVisible();
  await page.getByLabel("搜索精选主题").fill("不存在");
  await expect(card).toHaveCount(0);
  await page.getByLabel("搜索精选主题").fill("雾蓝");
  await card.click();
  await expect(page.getByText("许可：CC0-1.0")).toBeVisible();
  await page.getByRole("button", { name: "确认安装并应用" }).click();
  await expect(page.getByLabel("本地主题")).toHaveValue("雾蓝");
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue("--bg").trim(),
        ),
    )
    .toBe("#f3f7fb");
  await expect(page.locator(".theme-css-editor [role='status']")).toContainText(
    "已安装并应用",
  );
});

test("精选主题完整性校验失败时不安装，并提供冲突提示", async ({ page }) => {
  const css = ":root { --accent: #315f85; }";
  const catalog = themeCatalogFixture(css);
  await mockThemeGallery(page, catalog, ":root { --accent: #ffffff; }");
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByRole("button", { name: "浏览主题图库" }).click();
  await page.getByRole("button", { name: /雾蓝/ }).click();
  await page.getByRole("button", { name: "确认安装并应用" }).click();
  await expect(page.getByRole("alert")).toContainText("完整性校验失败");
  await expect(page.getByLabel("本地主题")).toHaveValue("");

  await page.evaluate(() => {
    localStorage.setItem(
      "moxie.preferences.v2",
      JSON.stringify({
        theme: "light",
        savedThemes: [{ name: "雾蓝", css: ":root { --accent: #315f85; }" }],
        activeSavedTheme: "",
      }),
    );
  });
  await page.reload();
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByRole("button", { name: "浏览主题图库" }).click();
  await page.getByRole("button", { name: /雾蓝/ }).click();
  await page.getByRole("button", { name: "确认安装并应用" }).click();
  await expect(page.locator(".theme-css-editor [role='status']")).toContainText(
    "已有同名主题",
  );
  await expect(page.getByLabel("本地主题")).toHaveValue("");
});

test("图库版本更新必须明确确认，并保留来源版本", async ({ page }) => {
  const css = ":root { --accent: #426b91; }";
  const catalog = themeCatalogFixture(css);
  catalog.themes[0].version = "1.1.0";
  catalog.themes[0].releaseVersion = "0.16.79";
  catalog.themes[0].packageUrl =
    "https://github.com/jincaiw/moxie/releases/download/v0.16.79/theme-mist-blue.css";
  catalog.themes[0].previewUrl =
    "https://github.com/jincaiw/moxie/releases/download/v0.16.79/theme-mist-blue.svg";
  await mockThemeGallery(page, catalog, css);
  await page.addInitScript(() => {
    localStorage.setItem(
      "moxie.preferences.v2",
      JSON.stringify({
        savedThemes: [
          {
            name: "雾蓝",
            css: ":root { --accent: #315f85; }",
            gallery: { id: "mist-blue", version: "1.0.0" },
          },
        ],
        activeSavedTheme: "雾蓝",
      }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByRole("button", { name: "浏览主题图库" }).click();
  await page.getByRole("button", { name: /雾蓝/ }).click();
  await expect(page.getByText(/图库提供新版本 1\.1\.0/)).toBeVisible();
  const savedBefore = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("moxie.preferences.v2")!).savedThemes[0],
  );
  expect(savedBefore.gallery.version).toBe("1.0.0");
  await page.getByRole("button", { name: "确认更新并应用" }).click();
  await expect(page.locator(".theme-css-editor [role='status']")).toContainText(
    "已更新并应用",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("moxie.preferences.v2")!)
            .savedThemes[0].gallery.version,
      ),
    )
    .toBe("1.1.0");
});

test("主题包处理中禁用重复安装操作并显示进度", async ({ page }) => {
  const css = ":root { --accent: #426b91; }";
  await page.addInitScript(
    ({ catalogText, css }) => {
      const originalFetch = window.fetch.bind(window);
      (window as Window & { themeDownloadCount?: number }).themeDownloadCount =
        0;
      window.fetch = async (input, init) => {
        const url = String(input);
        if (url.endsWith("theme-catalog-v1.json"))
          return new Response(catalogText, { status: 200 });
        if (url.endsWith("theme-mist-blue.css")) {
          const scope = window as Window & {
            themeDownloadCount?: number;
          };
          scope.themeDownloadCount = (scope.themeDownloadCount || 0) + 1;
          await new Promise((resolve) => setTimeout(resolve, 300));
          return new Response(css, { status: 200 });
        }
        return originalFetch(input, init);
      };
    },
    { catalogText: JSON.stringify(themeCatalogFixture(css)), css },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByRole("button", { name: "浏览主题图库" }).click();
  await page.getByRole("button", { name: /雾蓝/ }).click();
  const install = page.getByRole("button", { name: "确认安装并应用" });
  await install.click();
  const progressButton = page.getByRole("button", {
    name: "正在下载并校验…",
  });
  await expect(progressButton).toBeDisabled();
  await expect(progressButton).toHaveAttribute("aria-busy", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { themeDownloadCount?: number })
            .themeDownloadCount,
      ),
    )
    .toBe(1);
  await expect(page.locator(".theme-css-editor [role='status']")).toContainText(
    "已安装并应用",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("moxie.preferences.v2")!).savedThemes
          .length,
    ),
  ).toBe(1);
});

test("图库撤回主题时提示原因并保留本地副本", async ({ page }) => {
  const catalog = themeCatalogFixture(":root { --accent: #315f85; }");
  catalog.themes = [];
  catalog.withdrawnThemes = [{ id: "mist-blue", reason: "作者请求撤回。" }];
  await mockThemeGallery(page, catalog, "");
  await page.addInitScript(() => {
    localStorage.setItem(
      "moxie.preferences.v2",
      JSON.stringify({
        savedThemes: [
          {
            name: "雾蓝",
            css: ":root { --accent: #315f85; }",
            gallery: { id: "mist-blue", version: "1.0.0" },
          },
        ],
        activeSavedTheme: "雾蓝",
      }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByRole("button", { name: "浏览主题图库" }).click();
  await expect(
    page.getByRole("region", { name: "精选主题图库" }).getByRole("status"),
  ).toContainText("作者请求撤回");
  await expect(page.getByLabel("本地主题")).toHaveValue("雾蓝");
});

test("主题图库离线时保留重试入口并可在恢复后重新加载", async ({ page }) => {
  const css = ":root { --accent: #315f85; }";
  const catalog = JSON.stringify(themeCatalogFixture(css));
  await page.addInitScript(
    ({ catalog, css }) => {
      let attempts = 0;
      window.fetch = async (input) => {
        const url = String(input);
        if (url.endsWith("theme-catalog-v1.json")) {
          attempts++;
          if (attempts === 1) throw new TypeError("Failed to fetch");
          return new Response(catalog, { status: 200 });
        }
        if (url.endsWith("theme-mist-blue.css"))
          return new Response(css, { status: 200 });
        throw new Error("fixture not found");
      };
    },
    { catalog, css },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page.getByRole("button", { name: "浏览主题图库" }).click();
  await expect(page.getByRole("alert")).toContainText("检查网络后重试");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByRole("button", { name: /雾蓝/ })).toBeVisible();
});

test("表格直接编辑、转义竖线、撤销重做与增删行列", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "表格编辑.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "| 项目 | 状态 |\n| --- | --- |\n| 计划 | 待办 |\n| 发布 | 完成 |\n| 校验 | 通过 |\n",
    ),
  });
  await page.locator(".editable-table td").first().click();
  const cell = page.getByRole("textbox", { name: "编辑第 2 行第 1 列" });
  await cell.fill("计划 | 已修改");
  await cell.press(shortcut("z"));
  await expect(cell).toHaveValue("计划");
  await cell.press(shortcut("Shift+z"));
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

test("表格单元格即时排版支持行内公式并保留代码与转义文本", async ({ page }) => {
  await page.goto("/");
  await page
    .locator(".cm-content")
    .fill(
      "| 公式 | 代码 | 转义 |\n| --- | --- | --- |\n| $x^2$ | `$literal$` | \\$literal |\n",
    );
  await page.locator(".cm-content").press(documentEnd);
  const cells = page.locator(".editable-table tbody td");
  await expect(cells.nth(0).locator(".inline-formula .katex")).toBeVisible();
  await expect(cells.nth(1).locator("code")).toHaveText("$literal$");
  await expect(cells.nth(1).locator(".inline-formula")).toHaveCount(0);
  await expect(cells.nth(2).locator(".inline-formula")).toHaveCount(0);
  await expect(cells.nth(2)).toContainText("$literal");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "table-math.md");
  }, "| 公式 | 代码 | 转义 |\n| --- | --- | --- |\n| $x^2$ | `$literal$` | \\$literal |\n");
  expect(html).toContain("<math");
  expect(html).toContain("<code>$literal$</code>");
  expect(html).toContain("<td>$literal</td>");
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
  await page.keyboard.press(documentEnd);
  await page.keyboard.press(shortcut("b"));
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

test("标签中键关闭会保留未保存修改确认", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建文件", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.type("未保存内容");

  const tab = page
    .getByRole("tablist", { name: "打开的文档" })
    .getByRole("tab", { name: "未命名.md" });
  await tab.click({ button: "middle" });
  await expect(page.getByRole("dialog", { name: "关闭文档" })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toContainText("未保存内容");

  await tab.click({ button: "middle" });
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(tab).toHaveCount(0);
});

test("标签分组可创建、筛选、移动文档并恢复显示", async ({ page }) => {
  await page.goto("/");
  let groupName = "研究";
  page.on("dialog", (dialog) => void dialog.accept(groupName));
  await page.getByRole("button", { name: "新建标签分组" }).click();
  const tabs = page.getByRole("tablist", { name: "打开的文档" });
  await expect(tabs.getByRole("tab", { name: "欢迎使用.md" })).toHaveCount(1);
  await expect(tabs.getByRole("tab", { name: "写作指南.md" })).toHaveCount(0);
  groupName = "计划";
  await page.getByRole("button", { name: "重命名分组 研究" }).click();
  await page.getByRole("button", { name: /全部 2/ }).click();
  await tabs.getByLabel("写作指南.md所属分组").selectOption("计划");
  await page.getByRole("button", { name: /计划 2/ }).click();
  await expect(tabs.getByRole("tab", { name: "欢迎使用.md" })).toHaveCount(1);
  await expect(tabs.getByRole("tab", { name: "写作指南.md" })).toHaveCount(1);
  await page.getByRole("button", { name: "移除分组 计划" }).click();
  await expect(tabs.getByRole("tab", { name: "欢迎使用.md" })).toHaveCount(1);
  await expect(tabs.getByRole("tab", { name: "写作指南.md" })).toHaveCount(1);
  await expect(tabs.getByLabel("欢迎使用.md所属分组")).toHaveValue("");
  await expect(tabs.getByLabel("写作指南.md所属分组")).toHaveValue("");
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

test("Typora 图片尺寸语法在即时预览和 HTML 导出中保留", async ({ page }) => {
  await page.goto("/");
  const source = `![尺寸示例](data:image/png;base64,${png.toString("base64")} =320x180)\n\n`;
  await page.locator("input.md-input").setInputFiles({
    name: "图片尺寸.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();

  const previewImage = page.locator(".image-preview img");
  await expect(previewImage).toHaveAttribute("width", "320");
  await expect(previewImage).toHaveAttribute("height", "180");
  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "image-size.md");
  }, source);
  expect(html).toContain('width="320" height="180"');
});

test("图片加载失败时状态消息会通知辅助技术", async ({ page }) => {
  await page.route("https://image.test/missing.png", (route) =>
    route.abort(),
  );
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "图片失败.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("![示例图片](https://image.test/missing.png)\n\n"),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();

  const status = page.locator(".image-status");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText("无法显示图片：示例图片");
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
  await page.getByLabel("系统拼写检查").check();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "spellcheck",
    "true",
  );
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
  await expect(page.getByLabel("系统拼写检查")).toBeChecked();
  await expect(page.locator(".cm-content")).toHaveAttribute(
    "spellcheck",
    "true",
  );
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

test("自动更新下载进度提供屏幕阅读器名称和百分比", async ({ page }) => {
  await page.addInitScript(() => {
    const status = { status: "downloading", percent: 42 } as const;
    window.desktop = {
      getUpdateStatus: async () => status,
      checkForUpdates: async () => status,
      downloadUpdate: async () => status,
      installUpdate: async () => status,
      onUpdateStatus: (listener) => {
        queueMicrotask(() => listener(status));
        return () => {};
      },
      onAction: () => () => {},
      recent: async () => [],
      dirty: () => {},
    } as unknown as NonNullable<typeof window.desktop>;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();

  const progress = page.getByRole("progressbar", {
    name: "软件更新下载进度",
  });
  await expect(progress).toHaveAttribute("aria-valuetext", "42%");
  await expect(progress).toHaveAttribute("value", "42");
});

test("窄屏工具栏将常用桌面操作收纳到可访问菜单", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const more = page.getByRole("button", { name: "更多工具" });
  await expect(more).toBeVisible();
  await more.click();
  const menu = page.getByRole("group", { name: "更多工具" });
  await expect(menu.getByRole("button", { name: "查找与替换" })).toBeVisible();
  await expect(
    menu.getByRole("button", { name: "搜索项目文件夹" }),
  ).toBeVisible();
  await expect(menu.getByRole("button", { name: "偏好设置" })).toBeVisible();

  await menu.getByRole("button", { name: "格式" }).click();
  await expect(page.getByRole("menuitem", { name: "粗体" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "粗体" })).toHaveCount(0);

  await more.click();
  await page
    .getByRole("group", { name: "更多工具" })
    .getByRole("button", { name: "偏好设置" })
    .click();
  const settings = page.locator("dialog.settings");
  await settings.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "完成", exact: true }),
  ).toBeVisible();
  const headerTop = await settings
    .locator("header")
    .evaluate((element) => element.getBoundingClientRect().top);
  const dialogTop = await settings.evaluate(
    (element) => element.getBoundingClientRect().top,
  );
  expect(headerTop).toBeGreaterThanOrEqual(dialogTop);
  expect(headerTop).toBeLessThan(dialogTop + 80);
});

test("即时排版隐藏水平线 Markdown 定界符", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".md-rule-text")).toHaveText("---");
  const color = await page
    .locator(".md-rule-text > span")
    .evaluate((element) => getComputedStyle(element).color);
  expect(color).toBe("rgba(0, 0, 0, 0)");
});

test("内置主题的文字与焦点色对比度达标", async ({ page }) => {
  await page.goto("/");
  for (const theme of [
    "light",
    "dark",
    "sepia",
    "solarized-light",
    "solarized-dark",
  ]) {
    await page.locator("html").evaluate((element, value) => {
      element.setAttribute("data-theme", value);
    }, theme);
    const contrast = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const channels = (color: string) => {
        let hex = color.trim().slice(1);
        if (hex.length === 3)
          hex = [...hex].map((value) => value + value).join("");
        return hex
          .match(/../g)!
          .map((value) => Number.parseInt(value, 16) / 255)
          .map((value) =>
            value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
          );
      };
      const luminance = (color: string) => {
        const [red, green, blue] = channels(color);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const surfaces = ["--bg", "--side", "--selected", "--code", "--panel"];
      const minimumRatio = (
        foregroundColor: string,
        backgroundTokens: string[],
      ) =>
        Math.min(
          ...backgroundTokens.map((surface) => {
            const foreground = luminance(foregroundColor);
            const background = luminance(style.getPropertyValue(surface));
            return (
              (Math.max(foreground, background) + 0.05) /
              (Math.min(foreground, background) + 0.05)
            );
          }),
        );
      return {
        muted: minimumRatio(style.getPropertyValue("--muted"), surfaces),
        accent: minimumRatio(style.getPropertyValue("--accent"), [
          "--bg",
          "--side",
          "--panel",
        ]),
        focus: minimumRatio(style.getPropertyValue("--focus"), [
          "--bg",
          "--side",
          "--selected",
        ]),
      };
    });
    expect(contrast.muted, `${theme} 次级文字对比度`).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast.accent, `${theme} 强调文字对比度`).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast.focus, `${theme} 焦点轮廓对比度`).toBeGreaterThanOrEqual(3);
  }
});

test("打字机模式在方向键移动光标后继续居中当前行", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "moxie.preferences.v2",
      JSON.stringify({ typewriter: true }),
    );
  });
  await page.goto("/");
  const source = Array.from(
    { length: 120 },
    (_, index) => `第 ${index + 1} 行`,
  ).join("\n\n");
  await page.locator("input.md-input").setInputFiles({
    name: "打字机.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  const editor = page.getByRole("textbox", { name: "Markdown 编辑区" });
  await editor.click();
  await page.keyboard.press(documentStart);
  for (let index = 0; index < 80; index++)
    await page.keyboard.press("ArrowDown");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const cursor = document.querySelector(".cm-cursor");
        const viewport = document.querySelector(".document-area");
        if (!cursor || !viewport) return Infinity;
        const cursorRect = cursor.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        return Math.abs(
          cursorRect.top +
            cursorRect.height / 2 -
            (viewportRect.top + viewportRect.height / 2),
        );
      }),
    )
    .toBeLessThan(48);
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
    .toBe("#4f708e");
  await page.getByRole("button", { name: "清除自定义样式" }).click();
  await expect(css).toHaveValue("");
});

test("主题资源文件夹导入会内嵌本地资源并拒绝越界路径", async ({ page }) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-theme-"));
  const theme = path.join(folder, "主题");
  await fs.mkdir(path.join(theme, "assets"), { recursive: true });
  await fs.writeFile(
    path.join(theme, "theme.css"),
    'body { background-image: url("assets/tile.png"), url("assets/shape.svg"); } :root { --accent: #117799; }',
  );
  await fs.writeFile(path.join(theme, "assets", "tile.png"), png);
  await fs.writeFile(
    path.join(theme, "assets", "shape.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><foreignObject><iframe src="https://example.com"></iframe></foreignObject><path fill="#123456" d="M0 0h10v10z"/></svg>',
  );
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "偏好设置" }).click();
    await page.getByLabel("选择主题包文件夹").setInputFiles(theme);
    const css = page.getByRole("textbox", { name: "自定义主题 CSS 内容" });
    await expect(css).toContainText("data:image/png;base64,");
    await expect(css).toContainText(png.toString("base64"));
    await expect(css).toContainText("data:image/svg+xml;base64,");
    const embeddedSVG = await css.inputValue();
    const encodedSVG = /data:image\/svg\+xml;base64,([a-z\d+/=]+)/i.exec(
      embeddedSVG,
    )?.[1];
    expect(encodedSVG).toBeTruthy();
    const safeSVG = Buffer.from(encodedSVG!, "base64").toString("utf8");
    expect(safeSVG).toContain("<path");
    expect(safeSVG).not.toMatch(/<script|foreignObject|iframe|onload|https:/i);
    await page.getByLabel("新主题名称").fill("纸纹");
    await page.getByRole("button", { name: "保存为本地主题" }).click();
    await expect(
      page.locator(".theme-css-editor [role='status']"),
    ).toContainText("已保存");
    await page.reload();
    await page.getByRole("button", { name: "偏好设置" }).click();
    await expect(page.getByLabel("本地主题")).toHaveValue("纸纹");

    await fs.writeFile(
      path.join(theme, "theme.css"),
      "body { background-image: url(../../outside.png); }",
    );
    await page.getByLabel("选择主题包文件夹").setInputFiles(theme);
    await expect(
      page.locator(".theme-css-editor [role='status']"),
    ).toContainText("不能引用主题文件夹之外");

    await fs.writeFile(
      path.join(theme, "oversized.bin"),
      Buffer.alloc(97 * 1024),
    );
    await page.getByLabel("选择主题包文件夹").setInputFiles(theme);
    await expect(
      page.locator(".theme-css-editor [role='status']"),
    ).toContainText("不能超过 96 KB");
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("主题包可导入并持久保存超过旧限制的字体资源", async ({ page }) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-theme-font-"));
  const theme = path.join(folder, "主题");
  await fs.mkdir(path.join(theme, "assets"), { recursive: true });
  await fs.writeFile(
    path.join(theme, "theme.css"),
    '@font-face { font-family: "ThemeFont"; src: url("assets/theme.woff2"); }',
  );
  const font = Buffer.alloc(80 * 1024, 7);
  await fs.writeFile(path.join(theme, "assets", "theme.woff2"), font);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "偏好设置" }).click();
    const css = page.getByRole("textbox", { name: "自定义主题 CSS 内容" });
    await page.getByLabel("选择主题包文件夹").setInputFiles(theme);
    await expect(css).toContainText("data:font/woff2;base64,");
    const expandedCSS = await css.inputValue();
    expect(expandedCSS.length).toBeGreaterThan(65536);
    expect(expandedCSS.length).toBeLessThanOrEqual(128 * 1024);

    await page.getByLabel("新主题名称").fill("大字体主题");
    await page.getByRole("button", { name: "保存为本地主题" }).click();
    await expect(
      page.locator(".theme-css-editor [role='status']"),
    ).toContainText("已保存");
    await page.reload();
    await page.getByRole("button", { name: "偏好设置" }).click();
    await expect(page.getByLabel("本地主题")).toHaveValue("大字体主题");
    await expect(css).toHaveValue(expandedCSS);
  } finally {
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test("本地主题库总容量受限并在保存前告知", async ({ page }) => {
  await page.addInitScript(() => {
    const css = `/*${"x".repeat(128 * 1024 - 4)}*/`;
    const savedThemes = Array.from({ length: 12 }, (_, index) => ({
      name: `主题 ${index + 1}`,
      css,
    }));
    localStorage.setItem(
      "moxie.preferences.v2",
      JSON.stringify({ savedThemes }),
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "偏好设置" }).click();
  await page
    .getByRole("textbox", { name: "自定义主题 CSS 内容" })
    .fill(":root { --accent: #123456; }");
  await expect(page.getByRole("alert")).toContainText("不能超过 1.5 MB");
  await expect(
    page.getByRole("button", { name: "保存为本地主题" }),
  ).toBeDisabled();
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
  await page.locator(".cm-content").press(documentStart);
  const preview = page.locator(".html-block-preview");
  await expect(preview).toContainText("安全预览");
  await expect(preview.locator("script")).toHaveCount(0);
  await preview.click();
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.locator(".cm-content")).toContainText("window.__unsafe");
});

test("行内 HTML 预览可通过键盘聚焦并按空格编辑源码", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "inline-html-keyboard.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# 键盘预览\n\n前文 <span>行内 HTML</span> 后文"),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-content").press(documentStart);
  const preview = page.locator(".md-inline-html-preview");
  await expect(preview).toHaveAttribute("role", "button");
  await expect(preview).toHaveAttribute("tabindex", "0");
  await preview.focus();
  await preview.press("Space");
  await expect(page.locator(".cm-content")).toBeFocused();
  await expect(page.locator(".cm-content")).toContainText(
    "<span>行内 HTML</span>",
  );
});

test("行内 HTML 中的 Moxie 格式与公式在预览和导出中一致", async ({ page }) => {
  await page.goto("/");
  const markdown =
    "# 格式一致性\n\n前文 <span>==高亮==、^上标^、~下标~ 和 $x+1$</span> 后文";
  await page.locator(".md-input").setInputFiles({
    name: "行内 HTML 格式.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(markdown),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-content").press(documentStart);
  const preview = page.locator(".md-inline-html-preview");
  await expect(preview.locator("mark")).toHaveText("高亮");
  await expect(preview.locator("sup")).toHaveText("上标");
  await expect(preview.locator("sub")).toHaveText("下标");
  await expect(preview.locator("math")).toHaveCount(1);

  const html = await page.evaluate(async (source) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(source, "inline-html-format.md");
  }, markdown);
  expect(html).toContain("<mark>高亮</mark>");
  expect(html).toContain("<sup>上标</sup>");
  expect(html).toContain("<sub>下标</sub>");
  expect(html.match(/<math/g)).toHaveLength(1);
});

test("列表与引用容器中的 HTML 区块保留 Markdown 上下文", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "nested-html.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "- 列表项\n\n  <div><strong>列表 HTML</strong></div>\n\n  列表后正文\n\n> 引用前正文\n>\n> <div><em>引用 HTML</em></div>\n>\n> 引用后正文",
    ),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-content").press(documentStart);
  const previews = page.locator(".html-block-preview");
  await expect(previews).toHaveCount(2);
  await expect(previews.nth(0)).toContainText("列表 HTML");
  await expect(previews.nth(1)).toContainText("引用 HTML");
  await expect(page.locator(".cm-content")).toContainText("列表后正文");
  await expect(page.locator(".cm-content")).toContainText("引用后正文");
  await previews.nth(0).click();
  await expect(page.locator(".cm-content")).toContainText(
    "<div><strong>列表 HTML",
  );
});

test("引用中的嵌套列表 HTML 区块保留容器和后续正文", async ({ page }) => {
  const source =
    "> - 外层项目\n>   - 内层项目\n>\n>     <div><strong>嵌套 HTML</strong><script>window.__nestedHtmlAttack = true</script></div>\n>\n>     HTML 后正文";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "nested-quote-list-html.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();

  const content = page.locator(".cm-content");
  await content.press(documentStart);
  const preview = page.locator(".html-block-preview");
  await expect(preview).toContainText("嵌套 HTML");
  await expect(preview.locator("script")).toHaveCount(0);
  await expect(content).toContainText("HTML 后正文");
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __nestedHtmlAttack?: boolean })
          .__nestedHtmlAttack,
    ),
  ).toBeUndefined();

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "nested-quote-list-html.md");
  }, source);
  expect(html).toContain("<blockquote>");
  expect(html).toContain("<ul>");
  expect(html).toContain("嵌套 HTML");
  expect(html).toContain("HTML 后正文");
  expect(html).not.toContain("<script>");

  await preview.click();
  await expect(content).toContainText(
    "<div><strong>嵌套 HTML</strong><script>window.__nestedHtmlAttack = true</script></div>",
  );
});

test("CommonMark 列表续段、嵌套任务和惰性引用在预览与导出中一致", async ({
  page,
}) => {
  const source =
    "1. 第一项\n   后续段落中的 **强调** 与 `代码`。\n\n2. 第二项\n   - [x] 嵌套任务\n\n> 引用首行\n延续引用行";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "commonmark-boundaries.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-content").press(documentStart);

  const content = page.locator(".cm-content");
  await expect(content.locator(".md-strong")).toHaveText("强调");
  await expect(content.locator(".md-inline-code")).toHaveText("代码");
  await expect(content.locator(".task-checkbox")).toBeChecked();
  await expect(content).toContainText("第一项");
  await expect(content).toContainText("后续段落");
  await expect(content).toContainText("延续引用行");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "commonmark-boundaries.md");
  }, source);
  expect(html).toContain("<ol>");
  expect(html).toContain('<input checked="" disabled="" type="checkbox">');
  expect(html).toContain("延续引用行");

  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(content).toContainText("后续段落中的 **强调** 与 `代码`");
  await expect(content).toContainText("延续引用行");
});

test("GFM 引用内嵌套任务和 CommonMark 硬换行在预览与导出中一致", async ({
  page,
}) => {
  const source =
    "> - [x] 已完成任务\n>   续行 **强调**\n>   - [ ] 待办\n\n硬换行前两空格  \n硬换行后。";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "gfm-nested-quote.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  const content = page.locator(".cm-content");
  await content.press(documentStart);

  const tasks = content.locator(".task-checkbox");
  await expect(tasks).toHaveCount(2);
  await expect(tasks.nth(0)).toBeChecked();
  await expect(tasks.nth(1)).not.toBeChecked();
  await expect(content.locator(".md-strong")).toHaveText("强调");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "gfm-nested-quote.md");
  }, source);
  expect(html).toContain("<blockquote>");
  expect(html).toContain('<input checked="" disabled="" type="checkbox">');
  expect(html).toContain('<input disabled="" type="checkbox">');
  expect(html).toMatch(/硬换行前两空格\s*<br\s*\/?>(?:\s*)硬换行后/);

  await tasks.nth(1).check();
  await expect(tasks.nth(1)).toBeChecked();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(content).toContainText("- [x] 待办");
});

test("HTML 注释在即时预览中隐藏并可切回源码编辑", async ({ page }) => {
  const source =
    "段前 <!-- inline private note --> 段后。\n\n<!-- block private note\nsecond line -->\n\n> 引用前 <!-- quote private note --> 引用后\n\n- 列表前 <!-- list private note --> 列表后\n\n行内代码 `<!-- code example -->`。\n\n```html\n<!-- fenced code example -->\n```\n\n跨行行内注释 <!-- 注释开始\n[^hidden]: 注释中的脚注机密\n注释结束 --> 之后的正文引用[^hidden]。\n\n- 列表注释 <!-- 列表注释开始\n  [^list-hidden]: 列表伪脚注机密\n  --> 列表注释之后的引用[^list-hidden]。\n[^real]: 真实脚注内容\n\n真实脚注引用[^real]。\n\n> 引用注释 <!-- 引用注释开始\n> [^quote-hidden]: 引用伪脚注机密\n> --> 引用注释之后的引用[^quote-hidden]。\n\n文档结尾。";
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "html-comments.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  const content = page.locator(".cm-content");
  await content.press(documentEnd);

  await expect(content).toContainText("段前");
  await expect(content).toContainText("段后");
  await expect(content).not.toContainText("private note");
  await expect(content).toContainText("code example");
  await expect(content).toContainText("fenced code example");

  await content.press(documentStart);
  await expect(content).toContainText("inline private note");

  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(content).toContainText("inline private note");
  await expect(content).toContainText("block private note");
  await expect(content).toContainText("quote private note");
  await expect(content).toContainText("list private note");
  await expect(content).toContainText("fenced code example");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "html-comments.md");
  }, source);
  expect(html).not.toContain("private note");
  expect(html).not.toContain("注释中的脚注机密");
  expect(html).not.toContain("列表伪脚注机密");
  expect(html).not.toContain("引用伪脚注机密");
  expect(html).toContain("正文引用[^hidden]");
  expect(html).toContain("真实脚注内容");
  expect(html).toContain("真实脚注引用");
  expect(html).toContain("列表注释之后的引用[^list-hidden]");
  expect(html).toContain("引用注释之后的引用[^quote-hidden]");
  expect(html).toContain("code example");
  expect(html).toContain("fenced code example");
});

test("HTML 预览和导出清除畸形事件属性与危险链接", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __moxieAttack?: number }).__moxieAttack = 0;
  });
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "unsafe-html.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      '# 安全测试\n\n<div>\n<strong oNmouseover="window.__moxieAttack=1">危险文本</strong>\n<a href="javascript:window.__moxieAttack=3">危险链接</a>\n</div>',
    ),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-content").press(documentStart);
  const previews = page.locator(".html-block-preview");
  await expect(previews).toHaveCount(1);
  await expect(previews).toContainText("危险链接");
  await expect(previews.locator("[onmouseover]")).toHaveCount(0);
  await expect(previews.locator('[href^="javascript:"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as Window & { __moxieAttack?: number }).__moxieAttack,
    ),
  ).toBe(0);

  const html = await page.evaluate(async () => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(
      '# 安全测试\n\n<div>\n<strong oNmouseover="window.__moxieAttack=1">危险文本</strong>\n<a href="javascript:window.__moxieAttack=3">危险链接</a>\n</div>',
      "unsafe-html.md",
    );
  });
  expect(html).not.toMatch(/\bonmouseover\s*=/i);
  expect(html).not.toMatch(/javascript:/i);
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
  await page.keyboard.press(documentEnd);
  await page.keyboard.insertText("自动保存测试");
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(1);
  await expect(page.getByRole("button", { name: "已保存" })).toBeVisible();
  await page.evaluate(() => {
    (window as any).external = true;
  });
  await editor.click();
  await page.keyboard.press(documentEnd);
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
  await page.keyboard.press(documentEnd);
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
  expect(tableColumnAlignment("| :--- | ---: |", 0)).toBe("left");
  expect(tableColumnAlignment("| :--- | ---: |", 1)).toBe("right");
  expect(setTableColumnAlignment("| --- | ---: |", 2, 0, "center")).toBe(
    "| :---: | ---: |",
  );
});

test("表格列可对齐，增删结构时保留对齐标记", async ({ page }) => {
  await page.goto("/");
  const table = page.locator(".editable-table").first();
  await expect(table).toContainText("Cmd + S");
  const secondColumn = table.locator('[data-cell="1:1"]');
  await secondColumn.click();
  await table.getByRole("button", { name: "居中对齐列" }).click();
  await expect(table.locator('[data-cell="0:1"]')).toHaveCSS(
    "text-align",
    "center",
  );
  await table.getByRole("button", { name: "添加行" }).click();
  await table.getByRole("button", { name: "添加列" }).click();
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText(
    "| --- | :---: | --- |",
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
    // @ts-expect-error runtime URL is served by the development server
    const { markdownImage } = await import("/src/links.ts");
    const text =
      '[图]: old.assets/reference.png "引用图片"\n\n![引用图][图]\n\n![图片](old.assets/a.png)\n\n![括号](old.assets/image_(1).png)\n\n![转义括号](old.assets/image_\\(2\\).png)\n\n![空格](<old.assets/image 3.png>)\n\n<img src="old.assets/html.png" alt="HTML 图片">\n\n`![例子](example.png)`\n\n```md\n![例子](code.png)\n```\n\n![尺寸](old.assets/sized.png =320x180)';
    const parsed = [
      "![括号](old.assets/image_(1).png)",
      "![转义括号](old.assets/image_\\(2\\).png)",
      "![空格](<old.assets/image 3.png>)",
    ].map((raw) => markdownImage(raw, { toString: () => text } as any));
    return {
      text: await rehomeImages(text, "/old/a.md", "/new/b.md"),
      calls,
      parsed,
    };
  });
  expect(result.calls).toEqual([
    "old.assets/sized.png",
    "old.assets/html.png",
    "old.assets/image 3.png",
    "old.assets/image_(2).png",
    "old.assets/image_(1).png",
    "old.assets/a.png",
    "old.assets/reference.png",
  ]);
  expect(
    result.text.match(/%E6%96%B0%E6%96%87%E6%A1%A3.assets\/copied.png/g),
  ).toHaveLength(7);
  expect(result.text).toContain(
    "![尺寸](%E6%96%B0%E6%96%87%E6%A1%A3.assets/copied.png =320x180)",
  );
  expect(result.text).toContain(
    '[图]: %E6%96%B0%E6%96%87%E6%A1%A3.assets/copied.png "引用图片"',
  );
  expect(result.parsed).toEqual([
    { src: "old.assets/image_(1).png", alt: "括号" },
    { src: "old.assets/image_(2).png", alt: "转义括号" },
    { src: "old.assets/image 3.png", alt: "空格" },
  ]);
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
  await page.keyboard.press(shortcut("a"));
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: /^引用/ }).click();
  await expect(page.locator(".cm-content")).toContainText("> 第一行");
  await expect(page.locator(".cm-content")).toContainText("> 第二行");
  await page.keyboard.press(shortcut("a"));
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: /^引用/ }).click();
  await expect(page.locator(".cm-content")).not.toContainText(">");
  await page.keyboard.press(shortcut("a"));
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
      "标题一\n====\n\n标题二\n----\n\n````md\n```\n# 代码中的标题\n````\n\n## **真正的标题** `代码` ##\n",
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
    "真正的标题 代码",
  ]);
  await page
    .getByRole("button", { name: "真正的标题 代码", exact: true })
    .click();
  await expect(page.locator(".cm-focused")).toBeVisible();
});

test("CommonMark 大纲识别引用块和列表中的 ATX/Setext 标题并跳过容器围栏", () => {
  const source =
    "> ## 引用标题\n>\n> 引用 Setext\n> ---\n\n- # 列表标题\n\n- 列表 Setext\n  ===\n\n> ````md\n> # 围栏中的标题\n> ```\n> ````\n";
  expect(headings(source).map(({ level, title }) => [level, title])).toEqual([
    [2, "引用标题"],
    [2, "引用 Setext"],
    [1, "列表标题"],
    [1, "列表 Setext"],
  ]);
  const tabSeparated =
    ">\t# 制表符引用标题\n\n> -\t## 制表符列表标题\n\n\t# 缩进代码中的假标题";
  expect(
    headings(tabSeparated).map(({ level, title }) => [level, title]),
  ).toEqual([
    [1, "制表符引用标题"],
    [2, "制表符列表标题"],
  ]);
});

test("HTML h1-h6 标题加入导航并跳过代码围栏", () => {
  const source =
    '<h2 id="custom"><em>HTML</em> &amp; 标题</h2>\n\n<h3>\n多行 HTML 标题\n</h3>\n\n<h4>前半标题<br>后半标题</h4>\n\n<h5>可见<!-- 注释 --><script>隐藏脚本</script><style>.hidden {}</style>标题</h5>\n\n```html\n<h1>代码示例</h1>\n```\n';
  expect(headings(source).map(({ level, title }) => [level, title])).toEqual([
    [2, "HTML & 标题"],
    [3, "多行 HTML 标题"],
    [4, "前半标题 后半标题"],
    [5, "可见标题"],
  ]);
  expect(headings("#title\n# title\n").map(({ title }) => title)).toEqual([
    "title",
  ]);
  expect(
    headings("<h2>未闭合标题\n\n# 有效 Markdown 标题\n").map(
      ({ title }) => title,
    ),
  ).toEqual(["有效 Markdown 标题"]);
});

test("[TOC] 预览生成分级目录并定位到对应标题", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "目录.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "[TOC]\n\n# 第一章\n\n## **子章节** `代码`\n\n<h2>\n<em>HTML</em> &amp; 标题\n</h2>\n\n正文\n",
    ),
  });
  const toc = page.locator(".md-toc");
  await expect(toc).toBeVisible();
  await toc.locator("summary").click();
  const section = toc.getByRole("button", {
    name: "子章节 代码",
    exact: true,
  });
  await expect(section).toBeVisible();
  const htmlHeading = toc.getByRole("button", {
    name: "HTML & 标题",
    exact: true,
  });
  await expect(htmlHeading).toBeVisible();
  await section.click();
  await expect(page.locator(".cm-activeLine")).toContainText("子章节");
  await toc.locator("summary").click();
  await htmlHeading.click();
  await expect(page.locator(".cm-activeLine")).toContainText("<h2>");
  await expect(toc).not.toHaveAttribute("open", "");

  const html = await page.evaluate(async () => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(
      "[TOC]\n\n# 第一章\n\n## **子章节** `代码`\n\n<h2>\n<em>HTML</em> &amp; 标题\n</h2>",
      "目录.md",
    );
  });
  expect(html).toContain('href="#html-标题"');
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
  await page.keyboard.press(documentEnd);
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
  await page.keyboard.press(documentEnd);
  await page.keyboard.press("Enter");
  await page.keyboard.type("下一项");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- [ ] 待办", "- [ ] 下一项"]);

  await page.locator(".md-input").setInputFiles({
    name: "有序列表续行.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("4. 第四项\n5. 第五项"),
  });
  await editor.click();
  await page.keyboard.press(documentEnd);
  await page.keyboard.press("Enter");
  await page.keyboard.type("第六项");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["4. 第四项", "5. 第五项", "6. 第六项"]);

  await page.locator(".md-input").setInputFiles({
    name: "已完成任务后新建.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("- [x] 已完成"),
  });
  await editor.click();
  await page.keyboard.press(documentEnd);
  await page.keyboard.press("Enter");
  await page.keyboard.type("新任务");
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- [x] 已完成", "- [ ] 新任务"]);

  await page.locator(".md-input").setInputFiles({
    name: "引用.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("> 引用"),
  });
  await editor.click();
  await page.keyboard.press(documentEnd);
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
  await page.keyboard.press(documentStart);
  await page.keyboard.press(lineEndSelection);
  await page.keyboard.press(shortcut("Shift+h"));
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
  await page.keyboard.press(documentStart);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: "下标", exact: true }).click();
  await expect(editor).toContainText("H~2~O");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: "下标", exact: true }).click();
  await expect(editor).toContainText("H2O");

  await editor.click();
  await page.keyboard.press(documentEnd);
  await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: "上标", exact: true }).click();
  await expect(editor).toContainText("x^2^");
});

test("格式菜单插入脚注引用和定义并聚焦注释正文", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "插入脚注.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("这里有说明"),
  });
  const editor = page.locator(".cm-content");
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await editor.click();
  await page.keyboard.press(documentStart);
  for (let index = 0; index < 3; index++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("button", { name: "格式", exact: true }).click();
  await page.getByRole("menuitem", { name: "插入脚注", exact: true }).click();
  await expect(editor).toContainText("这里有说明[^note-1]");
  await expect(editor).toContainText("[^note-1]: ");
  await page.keyboard.type("补充解释");
  await expect(editor).toContainText("[^note-1]: 补充解释");
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

test("多行行内代码中的脚注样式行保留为代码文本", async ({ page }) => {
  const source =
    "行内代码 `第一行\n[^fake]: 代码里的伪脚注\n最后一行` 仍在正文。\n\n正文[^real]。\n\n[^real]: 真正的脚注";
  await page.goto("/");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "multiline-code-footnote-boundary.md");
  }, source);

  expect(html).toContain("[^fake]: 代码里的伪脚注");
  expect(html).toContain("真正的脚注");
  expect(html).toContain('id="fn-1"');
  expect(html).not.toContain('id="fn-2"');
});

test("未闭合反引号不会吞掉后续真实脚注", async ({ page }) => {
  const source =
    "未闭合代码符号 ` 后继续正文[^real]。\n\n[^real]: 应正常保留的脚注";
  await page.goto("/");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "unclosed-code-footnote-boundary.md");
  }, source);

  expect(html).toContain("应正常保留的脚注");
  expect(html).toContain('id="fn-1"');
});

test("HTML 块中的脚注样式文本不会被提取为 Markdown 脚注", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "HTML块脚注边界.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      '<div class="literal">\n[^fake]: HTML 块中的普通文本\n</div>\n\n- <div class="literal">\n  [^list-fake]: 列表 HTML 块中的普通文本\n  </div>\n\n> <div class="literal">\n> [^quote-fake]: 引用 HTML 块中的普通文本\n> </div>\n\n正文[^real]。\n\n[^real]: 真正的脚注',
    ),
  });
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "HTML 网页", exact: true }).click();
  const html = await fs.readFile((await (await downloading).path())!, "utf8");
  expect(html).toContain("[^fake]: HTML 块中的普通文本");
  expect(html).toContain("[^list-fake]: 列表 HTML 块中的普通文本");
  expect(html).toContain("[^quote-fake]: 引用 HTML 块中的普通文本");
  expect(html).toContain("真正的脚注");
  expect(html).not.toContain('id="fn-2"');
});

test("行内 script/style 原始文本中的脚注样式行不会被提取", async ({ page }) => {
  const source =
    "正文 <script>\n[^script-fake]: script 私密文本\n</script> 结束。脚本引用[^script-fake]。\n\n正文 <style>\n[^style-fake]: style 私密文本\n</style> 结束。样式引用[^style-fake]。\n\n正文 <xmp>\n[^xmp-fake]: xmp 隐藏文本\n</xmp> 结束。旧标签引用[^xmp-fake]。\n\n正文 <iframe>\n[^iframe-fake]: iframe 隐藏文本\n</iframe> 结束。嵌入引用[^iframe-fake]。\n\n引用[^real]。\n\n[^real]: 真正的脚注";
  await page.goto("/");
  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "inline-raw-html-footnote-boundary.md");
  }, source);

  expect(html).not.toContain("script 私密文本");
  expect(html).toContain("样式引用[^style-fake]");
  expect(html).not.toContain("xmp 隐藏文本");
  expect(html).not.toContain("iframe 隐藏文本");
  expect(html).toContain("真正的脚注");
  expect(html).toContain('id="fn-1"');
  expect(html).not.toContain('id="fn-2"');
});

test("引用内嵌套列表的 HTML 块不会把脚注样式文本提取为定义", async ({
  page,
}) => {
  const source =
    '> - 外层项目\n>   - 内层项目\n>\n>     <div class="literal">\n>     [^fake]: HTML 中的普通文本\n>     </div>\n\n正文[^real]。\n\n[^real]: 真正的脚注';
  await page.goto("/");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "nested-html-footnote-boundary.md");
  }, source);

  expect(html).toContain("[^fake]: HTML 中的普通文本");
  expect(html).toContain("真正的脚注");
  expect(html).toContain('id="fn-1"');
  expect(html).not.toContain('id="fn-2"');
});

test("GFM 列表中的围栏代码与缩进代码保留脚注样式文本", async ({ page }) => {
  const source =
    "- 围栏代码：\n\n  ```md\n  [^fenced]: 这不是脚注定义\n  ```\n\n- 缩进代码：\n\n      [^indented]: 这也不是脚注定义\n\n正文[^real]。\n\n[^real]: 真实脚注内容";
  await page.goto("/");
  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "nested-code-footnote-boundary.md");
  }, source);

  expect(html).toContain("[^fenced]: 这不是脚注定义");
  expect(html).toContain("[^indented]: 这也不是脚注定义");
  expect(html).toContain("真实脚注内容");
  expect(html).toContain('id="fn-1"');
  expect(html).not.toContain('id="fn-2"');
});

test("列表项同一行开启的围栏代码保留脚注样式文本", async ({ page }) => {
  const source =
    "- ```md\n  [^fake]: 列表围栏中的伪脚注\n  ```\n\n正文[^real]。\n\n[^real]: 真正的脚注";
  await page.goto("/");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (text: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "list-fence-footnote-boundary.md");
  }, source);

  expect(html).toContain("列表围栏中的伪脚注");
  expect(html).toContain("真正的脚注");
  expect(html).toContain('id="fn-1"');
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
  await page.keyboard.press(shortcut("a"));
  await page.getByRole("button", { name: "格式" }).click();
  await page.getByRole("menuitem", { name: /有序列表/ }).click();
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["1. Alpha", "  2. Beta", "3. Gamma"]);

  await editor.click();
  await page.keyboard.press(shortcut("a"));
  await page.getByRole("button", { name: "格式" }).click();
  await page.getByRole("menuitem", { name: /无序列表/ }).click();
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- Alpha", "  - Beta", "- Gamma"]);

  await editor.click();
  await page.keyboard.press(shortcut("a"));
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
  await page.keyboard.press(shortcut("a"));
  await page.keyboard.press(shortcut("Shift+8"));
  await expect
    .poll(() => editor.locator(".cm-line").allInnerTexts())
    .toEqual(["- Bullets", "- Numbers"]);
  await page.keyboard.press(shortcut("a"));
  await page.keyboard.press(shortcut("Shift+7"));
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
  await page.keyboard.press(documentStart);
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
  await page.keyboard.press(documentStart);
  await page.keyboard.press(lineEndSelection);
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
