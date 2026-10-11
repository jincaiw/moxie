import { test, expect } from "@playwright/test";

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
