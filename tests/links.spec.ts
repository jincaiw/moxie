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
      "# 链接\n\n[打开网站](https://example.com) 和 [**使用说明**][manual]\n\n<https://example.org>\n\n裸链接 https://bare.example/path 和 www.example.net/guide\n\n括号网址 https://bare.example/guide_(v1), 后有标点。\n\n邮箱 writer@example.org\n\n`https://code.example/path` 和 `[代码示例](https://code.example)`\n\n[manual]: https://example.com/manual\n\n",
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
      name: "https://bare.example/guide_(v1)",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://bare.example/guide_(v1)");
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

test("引用链接标签按 CommonMark 折叠空白并保留标题与嵌套格式", async ({
  page,
}) => {
  const source =
    '[read **this**][A   Guide]\n\n[a guide]: <https://example.com/a_(b)> "A title"';
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "reference-link.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  const link = page.getByRole("link", { name: "read this", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.com/a_(b)");
  await expect(link).toHaveAttribute("title", /A title/);
  await expect(link.locator("strong")).toHaveText("this");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "reference-link.md");
  }, source);
  expect(html).toContain(
    '<a href="https://example.com/a_(b)" title="A title">read <strong>this</strong></a>',
  );
});

test("引用块和嵌套列表中的引用链接与导出保持一致", async ({ page }) => {
  const source =
    '> [引用块链接][guide]\n>\n> [guide]: <https://example.com/quote> "引用块标题"\n\n' +
    '- [列表链接][manual]\n\n  [manual]: https://example.com/list "列表标题"';
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "nested-reference-links.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });

  const quoteLink = page.getByRole("link", { name: "引用块链接", exact: true });
  const listLink = page.getByRole("link", { name: "列表链接", exact: true });
  await expect(quoteLink).toHaveAttribute("href", "https://example.com/quote");
  await expect(quoteLink).toHaveAttribute("title", /^引用块标题/);
  await expect(listLink).toHaveAttribute("href", "https://example.com/list");
  await expect(listLink).toHaveAttribute("title", /^列表标题/);

  const exportedTitles = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    const html = await module.exportHTML(markdown, "nested-reference-links.md");
    const exported = new DOMParser().parseFromString(html, "text/html");
    return [
      exported.querySelector('a[href="https://example.com/quote"]')?.title,
      exported.querySelector('a[href="https://example.com/list"]')?.title,
    ];
  }, source);
  expect(exportedTitles).toEqual(["引用块标题", "列表标题"]);
});

test("转义括号和管道符链接在即时预览与 HTML 导出中保持一致", async ({
  page,
}) => {
  const source =
    '[括号路径](https://example.org/a\\(b\\) "括号标题") 和 [管道路径](https://example.org/a\\|b)\n\n后续正文。';
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "escaped-link-destinations.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-line").last().click();

  const parenthesized = page.getByRole("link", {
    name: "括号路径",
    exact: true,
  });
  const piped = page.getByRole("link", { name: "管道路径", exact: true });
  await expect(parenthesized).toHaveAttribute(
    "href",
    "https://example.org/a(b)",
  );
  await expect(parenthesized).toHaveAttribute("title", /^括号标题/);
  await expect(piped).toHaveAttribute("href", "https://example.org/a%7Cb");

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "escaped-link-destinations.md");
  }, source);
  expect(html).toContain(
    '<a href="https://example.org/a(b)" title="括号标题">括号路径</a>',
  );
  expect(html).toContain('<a href="https://example.org/a%7Cb">管道路径</a>');
});

test("嵌套括号目标与转义引用标签在预览和导出中正确解析", async ({ page }) => {
  const source =
    '[嵌套括号](https://example.org/a_(b_(c))) 和 [转义标签][A \\[guide\\]]\n\n[a \\[Guide\\]]: https://example.org/guide "引用标题"\n\n后续正文。';
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "nested-link-destinations.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-line").last().click();

  await expect(
    page.getByRole("link", { name: "嵌套括号", exact: true }),
  ).toHaveAttribute("href", "https://example.org/a_(b_(c))");
  const reference = page.getByRole("link", {
    name: "转义标签",
    exact: true,
  });
  await expect(reference).toHaveAttribute("href", "https://example.org/guide");
  await expect(reference).toHaveAttribute("title", /^引用标题/);

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "nested-link-destinations.md");
  }, source);
  expect(html).toContain(
    '<a href="https://example.org/a_(b_(c))">嵌套括号</a>',
  );
  expect(html).toContain(
    '<a href="https://example.org/guide" title="引用标题">转义标签</a>',
  );
});

test("多行链接目标与标题在即时预览和 HTML 导出中保持一致", async ({ page }) => {
  const source =
    '[多行链接](<https://example.org/a path>\n  "多行标题")\n\n后续正文。';
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "multiline-link.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-line").last().click();

  const link = page.getByRole("link", { name: "多行链接", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.org/a%20path");
  await expect(link).toHaveAttribute("title", /^多行标题/);

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "multiline-link.md");
  }, source);
  expect(html).toContain(
    '<a href="https://example.org/a%20path" title="多行标题">多行链接</a>',
  );
});

test("Unicode 与 URI 保留字符链接在即时预览和 HTML 导出中一致编码", async ({
  page,
}) => {
  const cases = [
    [
      "中文",
      "https://example.org/中文",
      "https://example.org/%E4%B8%AD%E6%96%87",
    ],
    [
      "方括号",
      String.raw`https://example.org/a\[b\]`,
      "https://example.org/a%5Bb%5D",
    ],
    ["花括号", "https://example.org/a{b}", "https://example.org/a%7Bb%7D"],
    ["插入符", "https://example.org/a^b", "https://example.org/a%5Eb"],
    [
      "反斜线",
      String.raw`https://example.org/a\\b`,
      "https://example.org/a%5Cb",
    ],
  ] as const;
  const source =
    cases
      .map(([label, destination]) => `[${label}](${destination})`)
      .join("\n\n") + "\n\n结束。";

  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "encoded-link-destinations.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await page.getByRole("button", { name: "即时排版", exact: true }).click();
  await page.locator(".cm-line").last().click();

  for (const [label, , href] of cases) {
    await expect(
      page.getByRole("link", { name: label, exact: true }),
    ).toHaveAttribute("href", href);
  }

  const html = await page.evaluate(async (markdown) => {
    const module = (await new Function(
      "return import('/src/export.ts')",
    )()) as { exportHTML: (source: string, name: string) => Promise<string> };
    return module.exportHTML(markdown, "encoded-link-destinations.md");
  }, source);
  for (const [label, , href] of cases) {
    expect(html).toContain(`<a href="${href}">${label}</a>`);
  }
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

test("Moxie 行内格式标题的锚点与导出一致", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "格式标题.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "[高亮](#重点内容)\n\n[下标](#h2o)\n\n[上标](#x2)\n\n[公式](#x1)\n\n## ==重点内容==\n\n## H~2~O\n\n## x^2^\n\n## $x+1$\n\n",
    ),
  });
  for (const [name, heading] of [
    ["高亮", "==重点内容=="],
    ["下标", "H~2~O"],
    ["上标", "x^2^"],
    ["公式", "$x+1$"],
  ]) {
    await page
      .getByRole("link", { name, exact: true })
      .click({ modifiers: [clickModifier] });
    await expect(page.locator(".cm-activeLine")).toContainText(heading);
  }
});

test("行内代码标题中的 Moxie 标记保持字面文本", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "代码标题.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "## `==literal==` 与 `$x+1$`\n\n## `代码` 与 MOXIECODESPAN0TOKEN\n\n",
    ),
  });
  await page.getByRole("tab", { name: "大纲", exact: true }).click();
  await expect(page.locator(".outline-row")).toHaveText([
    "==literal== 与 $x+1$",
    "代码 与 MOXIECODESPAN0TOKEN",
  ]);
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

test("无效百分号编码的标题链接显示提示且不改变文档", async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "无效标题链接.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("[无效锚点](#bad%)\n\n## 目标标题\n\n"),
  });
  await page
    .getByRole("link", { name: "无效锚点", exact: true })
    .click({ modifiers: [clickModifier] });
  await expect(page.getByRole("status")).toContainText(
    "标题链接包含无效的百分号编码",
  );
  await page.getByRole("button", { name: "源码", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("[无效锚点](#bad%)");
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
      "https://bare.example/path\n\nhttps://bare.example/guide_(v1), 后有标点。\n\nwww.example.net/guide\n\nwriter@example.org\n\n`https://code.example/path`",
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
  await expect(preview.locator("a")).toHaveCount(4);
  await expect(
    preview.getByRole("link", { name: "https://bare.example/path" }),
  ).toHaveAttribute("href", "https://bare.example/path");
  await expect(
    preview.getByRole("link", { name: "www.example.net/guide" }),
  ).toHaveAttribute("href", "http://www.example.net/guide");
  await expect(
    preview.getByRole("link", {
      name: "https://bare.example/guide_(v1)",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://bare.example/guide_(v1)");
  await expect(
    preview.getByRole("link", { name: "writer@example.org" }),
  ).toHaveAttribute("href", "mailto:writer@example.org");
  await expect(preview.locator("code")).toHaveText("https://code.example/path");
  await preview.close();
});
