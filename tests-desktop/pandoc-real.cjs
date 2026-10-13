const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  findPandoc,
  pandocFormats,
  exportWithPandoc,
  importWithPandoc,
} = require("../electron/pandoc.cjs");

// Explicit local integration suite: never substitute a fake converter or silently skip.
test("真实 Pandoc：五种格式中文、列表、表格和图片往返", async (t) => {
  const executable = await findPandoc();
  assert.ok(executable, "此专项需要已安装的 Pandoc");
  t.diagnostic(
    execFileSync(executable, ["--version"], { encoding: "utf8" }).split(
      "\n",
    )[0],
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-pandoc-real-"));
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=";
  const html = `<html><body><h1>中文验收标题</h1><p>正文保留检查。</p><ul><li>列表首项<ul><li>嵌套项</li></ul></li></ul><table><thead><tr><th>左列</th><th>右列</th></tr></thead><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table><img alt="本地像素" src="data:image/png;base64,${png}"><img alt="空载荷缺图" src="data:image/png;base64,===="><img src="data:image/png;base64,===="><img alt="未嵌入远程图" src="https://example.invalid/never-fetch.png"></body></html>`;
  try {
    for (const [format, definition] of Object.entries(pandocFormats)) {
      await t.test(format, async () => {
        const outputPath = path.join(root, `样本.${definition.extension}`);
        const assetsDirectoryName = `样本.${definition.extension}_assets`;
        const output = await exportWithPandoc({
          html,
          format,
          name: "样本.md",
          executable,
          assetsDirectoryName,
        });
        assert.ok(output.data.length > 0);
        await fs.writeFile(outputPath, output.data);
        if (definition.companionAssets) {
          assert.equal(output.assets.length, 1);
          await fs.mkdir(path.join(root, assetsDirectoryName));
          for (const asset of output.assets) {
            assert.deepEqual(asset.data, Buffer.from(png, "base64"));
            await fs.writeFile(
              path.join(root, assetsDirectoryName, asset.name),
              asset.data,
            );
          }
        } else assert.equal(output.assets.length, 0);
        const imported = await importWithPandoc({
          inputPath: outputPath,
          executable,
        });
        assert.deepEqual(
          await fs.readFile(outputPath),
          output.data,
          "导入不得改写源文件",
        );
        for (const text of [
          "中文验收标题",
          "正文保留检查",
          "列表首项",
          "嵌套项",
          "左列",
          "右列",
          "甲",
          "乙",
          "空载荷缺图",
          "图片资源未嵌入",
          "未嵌入远程图",
        ])
          assert.ok(imported.text.includes(text), `${format}: 缺少 ${text}`);
        assert.ok(
          !imported.text.includes("example.invalid"),
          `${format}: 远程图片应替换为说明`,
        );
        if (format === "latex") {
          assert.match(
            output.data.toString(),
            /\\includegraphics[^\n]*样本\.tex_assets\/image-1\.png/,
          );
        }
        assert.match(
          imported.text,
          /data:image\/png;base64,/,
          `${format}: 导入后应保留内嵌图片`,
        );
      });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("真实 Pandoc：伴随图片目录重写不改代码示例", async (t) => {
  const executable = await findPandoc();
  assert.ok(executable, "此专项需要已安装的 Pandoc");
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVFEAAAAASUVORK5CYII=";
  for (const format of ["latex", "mediawiki"]) {
    await t.test(format, async () => {
      const assetsDirectoryName = `sample.${format}_assets`;
      const output = await exportWithPandoc({
        html: `<html><body><pre><code>media/image-1.png</code></pre><img alt="image" src="data:image/png;base64,${png}"></body></html>`,
        format,
        name: "sample.md",
        executable,
        assetsDirectoryName,
      });
      const document = output.data.toString("utf8");
      assert.ok(document.includes("media/image-1.png"));
      assert.ok(document.includes(`${assetsDirectoryName}/image-1.png`));
      if (format === "latex") {
        assert.match(
          document,
          /\\begin\{verbatim\}\s*media\/image-1\.png\s*\\end\{verbatim\}/,
        );
        assert.doesNotMatch(
          document,
          /\\includegraphics[^\n]*\{media\/image-1\.png\}/,
        );
      } else {
        assert.match(document, /<pre>media\/image-1\.png<\/pre>/);
        assert.doesNotMatch(document, /\[\[File:media\/image-1\.png/);
      }
    });
  }
});
