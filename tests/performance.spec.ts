import { expect, test } from "@playwright/test";
import { documentEnd } from "./keyboard";

const sizes = [1, 5, 10];
const profileCpu = Boolean(process.env.MOXIE_PROFILE);

test.skip(!process.env.MOXIE_PERF, "仅通过 npm run benchmark:long-doc 执行");

for (const sizeMB of sizes) {
  test(`${sizeMB} MB 文档打开、输入与滚动基准`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.goto("/");
    const profiler = profileCpu
      ? await page.context().newCDPSession(page)
      : null;
    if (profiler) {
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.setSamplingInterval", { interval: 100 });
      await profiler.send("Profiler.start");
    }

    const title = "# 长文性能基准\n\n";
    const line = "普通中文段落，用于测量 Markdown 文档编辑与滚动性能。\n\n";
    const targetBytes = sizeMB * 1024 * 1024;
    const titleBytes = Buffer.byteLength(title);
    const lineBytes = Buffer.byteLength(line);
    const repetitions = Math.floor((targetBytes - titleBytes) / lineBytes);
    const markdown =
      title +
      line.repeat(repetitions) +
      "x".repeat(targetBytes - titleBytes - repetitions * lineBytes);
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
    let cpuHotspots:
      | {
          functionName: string;
          selfMs: number;
          url?: string;
          lineNumber?: number;
          callers?: string[];
        }[]
      | undefined;
    if (profiler) {
      const { profile } = await profiler.send("Profiler.stop");
      await profiler.detach();
      const profileNodes = new Map(
        profile.nodes.map((node) => [node.id, node.callFrame]),
      );
      const parents = new Map<number, number>();
      for (const node of profile.nodes)
        for (const child of node.children || []) parents.set(child, node.id);
      const samples = new Map<
        string,
        {
          microseconds: number;
          frame: (typeof profile.nodes)[number]["callFrame"];
          callers: Map<string, number>;
        }
      >();
      profile.samples.forEach((id, index) => {
        const callFrame = profileNodes.get(id);
        if (!callFrame) return;
        const name = callFrame.functionName || "(anonymous)";
        const stack = [name];
        let parent = parents.get(id);
        for (let depth = 0; parent !== undefined && depth < 3; depth++) {
          const frame = profileNodes.get(parent);
          if (!frame) break;
          stack.push(frame.functionName || "(anonymous)");
          parent = parents.get(parent);
        }
        const callers = stack.slice(1).reverse().join(" > ");
        const sample = samples.get(name);
        if (sample) {
          const delta = profile.timeDeltas[index] || 0;
          sample.microseconds += delta;
          sample.callers.set(
            callers,
            (sample.callers.get(callers) || 0) + delta,
          );
        } else
          samples.set(name, {
            microseconds: profile.timeDeltas[index] || 0,
            frame: callFrame,
            callers: new Map([[callers, profile.timeDeltas[index] || 0]]),
          });
      });
      cpuHotspots = [...samples]
        .sort((left, right) => right[1].microseconds - left[1].microseconds)
        .slice(0, 8)
        .map(([functionName, sample]) => {
          const frame = sample.frame;
          return {
            functionName,
            selfMs: Math.round(sample.microseconds / 1000),
            ...(frame?.url ? { url: frame.url } : {}),
            ...(frame ? { lineNumber: frame.lineNumber + 1 } : {}),
            ...(sample.callers.size
              ? {
                  callers: [...sample.callers]
                    .sort((left, right) => right[1] - left[1])
                    .slice(0, 3)
                    .map(([caller]) => caller),
                }
              : {}),
          };
        });
    }

    const scroller = page.locator(".document-area");
    await scroller.evaluate((element) => {
      element.scrollTo(0, element.scrollHeight);
    });
    await expect
      .poll(() => scroller.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
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

    await page.locator(".cm-content").press(documentEnd);
    const typingStarted = performance.now();
    // The payload already ends in x; use a new marker to verify the edit rendered.
    await page.locator(".cm-content").pressSequentially("Z", { delay: 0 });
    await expect(page.locator(".cm-content")).toContainText("Z");
    const typed = performance.now();

    const report = {
      sizeMB,
      payloadBytes: Buffer.byteLength(markdown),
      openMs: Math.round(opened - started),
      scroll20Ms,
      endOfDocumentInputMs: Math.round(typed - typingStarted),
      ...(cpuHotspots ? { cpuHotspots } : {}),
    };
    console.info("MOXIE_PERF", JSON.stringify(report));
    await testInfo.attach(`long-doc-${sizeMB}mb.json`, {
      body: JSON.stringify(report, null, 2),
      contentType: "application/json",
    });
  });
}
