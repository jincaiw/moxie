import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const { FileStore } = createRequire(import.meta.url)("../electron/files.cjs");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=",
  "base64",
);

test("批量移动同一图片的编码别名只移动一次并更新全部引用", async ({ page }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-alias-move-"));
  try {
    const documentPath = path.join(root, "note.md");
    await fs.writeFile(documentPath, "# Note");
    await fs.writeFile(path.join(root, "a.png"), png);
    const store = new FileStore();
    await store.read(documentPath);
    const calls: string[] = [];
    await page.exposeFunction("resolveMigrationPath", (input: any) =>
      store.resolveImagePath({ ...input, documentPath }),
    );
    await page.exposeFunction("migrateImage", async (input: any) => {
      calls.push(input.sourcePath);
      return store.manageImage({ ...input, documentPath });
    });
    await page.goto("/");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const result = await page.evaluate(async () => {
      window.desktop = {
        resolveImagePath: (input: any) =>
          (window as any).resolveMigrationPath(input),
        manageImage: (input: any) => (window as any).migrateImage(input),
        dirty: () => {},
      } as any;
      const modulePath = "/src/assets.ts";
      const { manageLocalImages } = await import(/* @vite-ignore */ modulePath);
      return manageLocalImages(
        '![原图](a.png)\n\n![别名](%61.png)\n\n<img src="%61.png" alt="HTML">\n\n![引用][图]\n\n[图]: a.png\n\n![缺失](missing.png)\n\n`![示例](a.png)`',
        "/note.md",
        "_images",
        "move",
      );
    });
    expect(result.managed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.found).toBe(2);
    expect(calls).toEqual(["a.png"]);
    expect(result.text.match(/_images\/a.png/g)).toHaveLength(4);
    expect(result.text).toContain("![缺失](missing.png)");
    expect(result.text).toContain("`![示例](a.png)`");
    await expect(
      fs.readFile(path.join(root, "_images/a.png")),
    ).resolves.toEqual(png);
    await expect(fs.stat(path.join(root, "a.png"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    // Render the returned document through the real editor after releasing the
    // narrow disk bridge. This bridge is test-only, not Electron IPC validation.
    await page.evaluate(() => {
      delete window.desktop;
    });
    await page.reload();
    await page.locator(".md-input").setInputFiles({
      name: "moved.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(result.text),
    });
    await page.getByRole("button", { name: "源码", exact: true }).click();
    await expect(page.locator(".cm-content")).toContainText("_images/a.png");
    await page.screenshot({ path: "/tmp/moxie-image-migration-after.png" });
    expect(errors).toEqual([]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("词法和目录符号链接别名规范为同一图片并且只迁移一次", async ({ page }) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "moxie-image-path-alias-"),
  );
  try {
    const documentPath = path.join(root, "note.md");
    await fs.writeFile(documentPath, "# Note");
    await fs.writeFile(path.join(root, "a.png"), png);
    await fs.symlink(root, path.join(root, "linked"), "dir");
    const store = new FileStore();
    await store.read(documentPath);
    const resolved: string[] = [];
    const moved: string[] = [];
    await page.exposeFunction("resolveMigrationPath", async (input: any) => {
      const result = await store.resolveImagePath({ ...input, documentPath });
      resolved.push(input.relativePath);
      return result;
    });
    await page.exposeFunction("migrateImage", async (input: any) => {
      moved.push(input.sourcePath);
      return store.manageImage({ ...input, documentPath });
    });
    await page.goto("/");
    const result = await page.evaluate(async () => {
      window.desktop = {
        resolveImagePath: (input: any) =>
          (window as any).resolveMigrationPath(input),
        manageImage: (input: any) => (window as any).migrateImage(input),
        dirty: () => {},
      } as any;
      const { manageLocalImages } = await import(
        /* @vite-ignore */ "/src/assets.ts"
      );
      return manageLocalImages(
        "![one](a.png) ![two](./a.png) ![three](folder/../a.png) ![four](linked/a.png)",
        "/note.md",
        "_images",
        "move",
      );
    });
    expect(result.managed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.found).toBe(1);
    expect(resolved).toHaveLength(4);
    expect(moved).toEqual(["a.png"]);
    expect(result.text.match(/_images\/a.png/g)).toHaveLength(4);
    await expect(
      fs.readFile(path.join(root, "_images/a.png")),
    ).resolves.toEqual(png);
    await expect(fs.stat(path.join(root, "a.png"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("另存为重复图片和编码别名复用一份目标资源", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    let reads = 0,
      writes = 0;
    window.desktop = {
      dirty: () => {},
      readImage: async () => {
        reads++;
        return "data:image/png;base64,AQID";
      },
      storeImage: async () => ({ relativePath: `new.assets/${++writes}.png` }),
    } as any;
    const modulePath = "/src/assets.ts";
    const { rehomeImages } = await import(/* @vite-ignore */ modulePath);
    const text = await rehomeImages(
      '![一](a.png)\n\n![二](%61.png)\n\n<img src="a.png">',
      "/old/note.md",
      "/new/note.md",
    );
    return { text, reads, writes };
  });
  expect(result.reads).toBe(1);
  expect(result.writes).toBe(1);
  expect(result.text.match(/new.assets\/1.png/g)).toHaveLength(3);
});
