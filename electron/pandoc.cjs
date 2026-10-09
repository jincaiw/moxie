const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const pandocFormats = Object.freeze({
  rtf: { extension: "rtf", label: "RTF 文档", writer: "rtf" },
  epub: { extension: "epub", label: "EPUB 电子书", writer: "epub3" },
  odt: { extension: "odt", label: "OpenDocument 文档", writer: "odt" },
  latex: {
    extension: "tex",
    label: "LaTeX 文档",
    writer: "latex",
    companionAssets: true,
  },
  mediawiki: {
    extension: "mediawiki",
    label: "MediaWiki 文本",
    writer: "mediawiki",
    companionAssets: true,
  },
});

function pandocCandidates(env = process.env, platform = process.platform) {
  const pathVariable = env.PATH || env.Path || "";
  const pathDirectories = pathVariable.split(path.delimiter).filter(Boolean);
  const home = env.HOME || env.USERPROFILE;
  const commonDirectories =
    platform === "darwin"
      ? [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          home && path.join(home, ".local/bin"),
        ]
      : platform === "win32"
        ? [
            env.ProgramFiles && path.join(env.ProgramFiles, "Pandoc"),
            env["ProgramFiles(x86)"] &&
              path.join(env["ProgramFiles(x86)"], "Pandoc"),
          ]
        : ["/usr/local/bin", "/usr/bin", home && path.join(home, ".local/bin")];
  const directories = [
    ...new Set([...pathDirectories, ...commonDirectories].filter(Boolean)),
  ];
  const names = platform === "win32" ? ["pandoc.exe"] : ["pandoc"];
  return directories.flatMap((directory) =>
    names.map((name) => path.join(directory, name)),
  );
}

async function findPandoc(env = process.env, platform = process.platform) {
  for (const candidate of pandocCandidates(env, platform)) {
    try {
      await fs.access(candidate, platform === "win32" ? 0 : 1);
      return candidate;
    } catch {
      // Continue through PATH and the platform's usual installation folders.
    }
  }
  return null;
}

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

async function prepareHTML(html, directory) {
  const replacements = [];
  const mediaDirectory = path.join(directory, "media");
  const tags = [...html.matchAll(/<img\b[^>]*>/gi)];
  for (let index = 0; index < tags.length; index++) {
    const match = tags[index];
    const tag = match[0];
    const sourceMatch = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
      tag,
    );
    if (!sourceMatch) continue;
    const source = sourceMatch[1] ?? sourceMatch[2] ?? sourceMatch[3] ?? "";
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const altText = (alt?.[1] ?? alt?.[2] ?? alt?.[3] ?? "").trim();
    const data =
      /^data:image\/(png|jpeg|gif|webp|bmp|avif|svg\+xml);base64,([a-z\d+/=\s]+)$/i.exec(
        source,
      );
    if (!data) {
      // Pandoc should not fetch external resources during a local export.
      replacements.push({
        from: match.index,
        to: match.index + tag.length,
        value: `<span>${altText ? `[图片：${escapeHTML(altText)}]` : "[图片资源未嵌入]"}</span>`,
      });
      continue;
    }
    const bytes = Buffer.from(data[2].replace(/\s/g, ""), "base64");
    if (!bytes.length) continue;
    await fs.mkdir(mediaDirectory, { recursive: true });
    const extension = data[1]
      .toLowerCase()
      .replace("jpeg", "jpg")
      .replace("svg+xml", "svg");
    const relativePath = `media/image-${index + 1}.${extension}`;
    await fs.writeFile(path.join(directory, relativePath), bytes, {
      flag: "wx",
      mode: 0o600,
    });
    replacements.push({
      from: match.index,
      to: match.index + tag.length,
      value: tag.replace(sourceMatch[0], `src="${relativePath}"`),
    });
  }
  let prepared = html;
  for (const replacement of replacements.reverse())
    prepared =
      prepared.slice(0, replacement.from) +
      replacement.value +
      prepared.slice(replacement.to);
  return prepared;
}

function runPandoc(executable, args, input, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      cwd,
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8192) stderr += chunk.slice(0, 8192 - stderr.length);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          Error(
            `Pandoc 导出失败${stderr.trim() ? `：${stderr.trim()}` : `（退出码 ${code}）`}`,
          ),
        );
    });
    child.stdin.once("error", (error) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.stdin.end(input);
  });
}

async function exportWithPandoc({
  html,
  format,
  name,
  executable,
  assetsDirectoryName,
}) {
  const definition = Object.hasOwn(pandocFormats, format)
    ? pandocFormats[format]
    : null;
  if (!definition) throw Error("不支持的 Pandoc 导出格式");
  const binary = executable || (await findPandoc());
  if (!binary)
    throw Error(
      "此格式需要安装 Pandoc 并确保命令可用。安装说明：https://pandoc.org/installing.html",
    );

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-pandoc-"));
  const mediaDirectory = path.join(directory, "media");
  try {
    const input = await prepareHTML(html, directory);
    const output = path.join(directory, `document.${definition.extension}`);
    const title = path.basename(String(name)).replace(/\.(md|markdown)$/i, "");
    await runPandoc(
      binary,
      [
        "--standalone",
        "--from=html",
        `--to=${definition.writer}`,
        "--resource-path=.",
        "--metadata",
        `title=${title}`,
        "--output",
        output,
      ],
      input,
      directory,
    );
    let data = await fs.readFile(output);
    if (!data.length) throw Error("Pandoc 没有生成导出文件");
    const assets = [];
    if (definition.companionAssets) {
      try {
        for (const filename of await fs.readdir(mediaDirectory)) {
          if (!/^image-\d+\.[a-z\d]+$/i.test(filename)) continue;
          assets.push({
            name: filename,
            data: await fs.readFile(path.join(mediaDirectory, filename)),
          });
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (assets.length && assetsDirectoryName) {
        data = Buffer.from(
          data.toString("utf8").replaceAll("media/", `${assetsDirectoryName}/`),
        );
      }
    }
    return { data, assets };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = {
  pandocFormats,
  pandocCandidates,
  findPandoc,
  exportWithPandoc,
};
