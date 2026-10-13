import { test, expect } from "@playwright/test";
import { selectSidebarMode } from "./sidebar";

const source =
  "# Match parent\n\n## hidden child\n\n# Match other\n\n## Match child of other\n";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator(".md-input").setInputFiles({
    name: "outline-search.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(source),
  });
  await selectSidebarMode(page, "大纲");
});

test("筛选大纲按匹配列表导航，不折叠或误跳其他分支", async ({ page }) => {
  await page
    .getByRole("button", { name: "折叠 Match parent", exact: true })
    .click();
  const search = page.getByRole("searchbox", { name: "搜索大纲标题" });
  await search.fill("Match");
  const rows = page.locator(".outline-row");
  await expect(rows).toHaveText([
    "Match parent",
    "Match other",
    "Match child of other",
  ]);
  await expect(page.locator(".outline-toggle")).toHaveCount(0);
  await rows.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(rows.last()).toBeFocused();
  await search.fill("");
  await expect(
    page.getByRole("button", { name: "展开 Match parent", exact: true }),
  ).toBeVisible();
  await expect(rows).toHaveText([
    "Match parent",
    "Match other",
    "Match child of other",
  ]);
  await page
    .getByRole("button", { name: "展开 Match parent", exact: true })
    .click();
  await expect(rows).toHaveCount(4);
});

test("搜索键盘进入结果和跳转，组合输入与空态保留搜索焦点", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await expect(page).toHaveTitle(/墨写/);
  await expect(page).toHaveURL("http://127.0.0.1:5173/");
  const search = page.getByRole("searchbox", { name: "搜索大纲标题" });
  await search.fill("Match");
  await search.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        isComposing: true,
        bubbles: true,
      }),
    );
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        isComposing: true,
        bubbles: true,
      }),
    );
  });
  await expect(search).toHaveValue("Match");
  await expect(search).toBeFocused();
  await search.press("ArrowUp");
  await expect(page.locator(".outline-row").last()).toBeFocused();
  await search.focus();
  await search.press("ArrowDown");
  await expect(page.locator(".outline-row").first()).toBeFocused();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-focused")).toBeVisible();
  await expect(
    page.locator('.outline-row[aria-current="location"]'),
  ).toHaveText("Match child of other");
  await search.fill("Match other");
  await search.press("Enter");
  await expect(page.locator(".cm-focused")).toBeVisible();
  await expect(
    page.locator('.outline-row[aria-current="location"]'),
  ).toHaveText("Match other");
  await page.screenshot({ path: "/tmp/moxie-outline-search-desktop.png" });
  await search.fill("nothing-matches");
  await expect(
    page.getByRole("status").filter({ hasText: "没有匹配的标题" }),
  ).toBeVisible();
  await search.press("ArrowDown");
  await expect(search).toBeFocused();
  await search.press("Enter");
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(search).toHaveValue("");
  await search.press("Escape");
  await expect(search).toBeHidden();
  await expect(
    page.getByRole("button", { name: "搜索大纲标题", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 900, height: 600 });
  await page.getByRole("button", { name: "搜索大纲标题", exact: true }).click();
  await search.fill("Match");
  await search.press("ArrowDown");
  await expect(page.locator(".outline-row").first()).toBeFocused();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/moxie-outline-search-narrow.png" });
  expect(errors).toEqual([]);
});
