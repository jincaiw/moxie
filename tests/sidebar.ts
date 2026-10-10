import type { Page } from "@playwright/test";

export async function openSidebarFolderMenu(page: Page) {
  if (!(await page.locator("#sidebar-folder-menu").isVisible()))
    await page.getByRole("button", { name: "文件夹菜单", exact: true }).click();
}

export async function openSidebarFolder(page: Page) {
  await openSidebarFolderMenu(page);
  await page.getByRole("button", { name: "打开文件夹", exact: true }).click();
}

export async function selectSidebarMode(
  page: Page,
  name: "文件" | "大纲" | "已打开",
  search = true,
) {
  if ((await page.locator("#sidebar-mode-caption").textContent()) !== name) {
    await page.getByRole("button", { name: "切换侧栏导航模式" }).click();
    await page.getByRole("tab", { name, exact: true }).click();
  }
  if (
    name === "大纲" &&
    search &&
    !(await page.locator(".outline-search").isVisible())
  )
    await page
      .getByRole("button", { name: "搜索大纲标题", exact: true })
      .click();
}

export async function clickSidebarFolderAction(page: Page, name: string) {
  await openSidebarFolderMenu(page);
  const action = page.getByRole("button", { name, exact: true });
  if (!(await action.isVisible())) {
    const options = page.locator(".folder-options");
    if ((await options.getAttribute("open")) === null)
      await options.locator(":scope > summary").click();
  }
  await action.click();
}
