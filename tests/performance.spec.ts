import { expect, test } from "@playwright/test";

const sizes = [1, 5, 10];

test.skip(!process.env.MOXIE_PERF, "仅通过 npm run benchmark:long-doc 执行");

for (const sizeMB of sizes) {
  test(`${sizeMB} MB 文档打开、输入与滚动基准`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.goto("/");

    const line =
      "# 长文性能基准\n\n普通中文段落，用于测量 Markdown 文档编辑与滚动性能。\n\n";
    const targetBytes = sizeMB * 1024 * 1024;
    const lineBytes = Buffer.byteLength(line);
    const repetitions = Math.floor(targetBytes / lineBytes);
    const markdown =
      line.repeat(repetitions) + "x".repeat(targetBytes % lineBytes);
    const started = performance.now();
    await page.locator(".md-input").setInputFiles({
      name: `long-${sizeMB}mb.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
    await expect(page.locator(".cm-content")).toContainText("长文性能基准", {
      timeout: 120_000,
    });
    const opened = performance.now();

    const scroller = page.locator(".cm-scroller");
    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(100);
    const scroll20Ms = await scroller.evaluate(async (element) => {
      const started = performance.now();
      for (let index = 0; index < 20; index += 1) {
        element.scrollTop = (element.scrollHeight * (index + 1)) / 20;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
      return Math.round(performance.now() - started);
    });

    await page.locator(".cm-content").press("Control+End");
    const typingStarted = performance.now();
    await page.locator(".cm-content").pressSequentially("x", { delay: 0 });
    await expect(page.locator(".cm-content")).toContainText("x");
    const typed = performance.now();

    const report = {
      sizeMB,
      payloadBytes: Buffer.byteLength(markdown),
      openMs: Math.round(opened - started),
      scroll20Ms,
      endOfDocumentInputMs: Math.round(typed - typingStarted),
    };
    console.info("MOXIE_PERF", JSON.stringify(report));
    await testInfo.attach(`long-doc-${sizeMB}mb.json`, {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  });
}
