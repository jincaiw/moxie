const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const importReaders = Object.freeze({
  docx: "docx",
  html: "html",
  htm: "html",
  rtf: "rtf",
  epub: "epub",
  odt: "odt",
  tex: "latex",
  latex: "latex",
  mediawiki: "mediawiki",
});
const importImageTypes = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
});

async function importedMediaUsage(root) {
  let bytes = 0;
  let files = 0;
  const visit = async (directory) => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      const metadata = await fs.lstat(target);
      if (metadata.isSymbolicLink())
        throw Error("Pandoc 导入媒体目录包含符号链接");
      if (metadata.isDirectory()) await visit(target);
      else if (metadata.isFile()) {
        bytes += metadata.size;
        files++;
      } else throw Error("Pandoc 导入媒体目录包含不支持的文件");
    }
  };
  await visit(root);
  return { bytes, files };
}

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

async function importWithPandoc({ inputPath, executable, timeoutMs = 60000 }) {
  if (typeof inputPath !== "string" || !path.isAbsolute(inputPath))
    throw Error("导入文件路径无效");
  const extension = path.extname(inputPath).slice(1).toLowerCase();
  const reader = importReaders[extension];
  if (!reader) throw Error("不支持此导入格式");
  const source = await fs.realpath(inputPath);
  const metadata = await fs.stat(source);
  if (!metadata.isFile()) throw Error("请选择普通文档文件");
  if (metadata.size > 30 * 1024 * 1024) throw Error("导入文件不能超过 30 MB");
  const binary = executable || (await findPandoc());
  if (!binary)
    throw Error(
      "文档导入需要安装 Pandoc 并确保命令可用。安装说明：https://pandoc.org/installing.html",
    );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moxie-import-"));
  const mediaDirectory = path.join(directory, "media");
  try {
    await fs.mkdir(mediaDirectory);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        binary,
        [
          "--sandbox",
          `--from=${reader}`,
          "--to=gfm",
          `--resource-path=${path.dirname(source)}`,
          "--extract-media=media",
          source,
        ],
        {
          windowsHide: true,
          cwd: directory,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = Buffer.alloc(0);
      let stderr = "";
      let settled = false;
      let monitoring = false;
      let mediaLimitError;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(mediaMonitor);
        callback(value);
      };
      const mediaMonitor = setInterval(async () => {
        if (monitoring || settled) return;
        monitoring = true;
        try {
          const usage = await importedMediaUsage(mediaDirectory);
          if (usage.bytes > 10 * 1024 * 1024 || usage.files > 100) {
            mediaLimitError = Error("导入媒体总量超出 10 MB 或 100 个文件限制");
            child.kill();
          }
        } catch (error) {
          mediaLimitError = error;
          child.kill();
        } finally {
          monitoring = false;
        }
      }, 50);
      const timer = setTimeout(() => {
        child.kill();
        finish(
          reject,
          Error(
            `文档转换超时（${Math.ceil(timeoutMs / 1000)} 秒），未写入任何文件`,
          ),
        );
      }, timeoutMs);
      child.stdout.on("data", (chunk) => {
        if (stdout.length + chunk.length > 30 * 1024 * 1024) {
          child.kill();
          finish(reject, Error("转换结果超过 30 MB，已停止导入"));
          return;
        }
        stdout = Buffer.concat([stdout, chunk]);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 8192)
          stderr += chunk.slice(0, 8192 - stderr.length);
      });
      child.once("error", (error) => finish(reject, error));
      child.once("close", async (code) => {
        if (mediaLimitError) finish(reject, mediaLimitError);
        else if (code === 0) {
          try {
            const usage = await importedMediaUsage(mediaDirectory);
            if (usage.bytes > 10 * 1024 * 1024 || usage.files > 100)
              throw Error("导入媒体总量超出 10 MB 或 100 个文件限制");
            finish(resolve, stdout.toString("utf8"));
          } catch (error) {
            finish(reject, error);
          }
        } else
          finish(
            reject,
            Error(
              `Pandoc 导入失败${stderr.trim() ? `：${stderr.trim()}` : `（退出码 ${code}）`}`,
            ),
          );
      });
    });
    let text = output;
    let mediaBytes = 0;
    let mediaCount = 0;
    try {
      for (const entry of await fs.readdir(mediaDirectory, {
        withFileTypes: true,
      })) {
        const match = /^image-\d+\.([a-z\d]+)$/i.exec(entry.name);
        if (!entry.isFile() || !match) continue;
        const mime = importImageTypes[match[1].toLowerCase()];
        if (!mime) continue;
        const image = await fs.readFile(path.join(mediaDirectory, entry.name));
        mediaBytes += image.length;
        if (mediaBytes > 10 * 1024 * 1024 || ++mediaCount > 100)
          throw Error("导入图片总量超出 10 MB 或 100 张限制");
        text = text.replaceAll(
          `media/${entry.name}`,
          `data:${mime};base64,${image.toString("base64")}`,
        );
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const sourceDirectory = path.dirname(source);
    const imagePattern =
      /(!\[[^\]]*\]\()(<([^>]+)>|((?:\\.|[^)\s])+))([^)]*\))/g;
    const localImages = [...text.matchAll(imagePattern)];
    const embedded = new Map();
    for (const match of localImages) {
      const reference = match[3] ?? match[4];
      if (/^(?:data:|[a-z][a-z\d+.-]*:|\/|#|\/\/)/i.test(reference)) continue;
      const resource = reference.split(/[?#]/, 1)[0];
      let decoded;
      try {
        decoded = decodeURIComponent(resource).replace(/\\([()\\ ])/g, "$1");
      } catch {
        continue;
      }
      const candidate = path.resolve(sourceDirectory, decoded);
      const relative = path.relative(sourceDirectory, candidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
      try {
        const real = await fs.realpath(candidate);
        if (real !== candidate) continue;
        const metadata = await fs.stat(real);
        const mime =
          importImageTypes[path.extname(real).slice(1).toLowerCase()];
        if (!metadata.isFile() || !mime) continue;
        const image = await fs.readFile(real);
        mediaBytes += image.length;
        if (mediaBytes > 10 * 1024 * 1024 || ++mediaCount > 100)
          throw Error("导入图片总量超出 10 MB 或 100 张限制");
        embedded.set(
          reference,
          `data:${mime};base64,${image.toString("base64")}`,
        );
      } catch (error) {
        if (error.message === "导入图片总量超出 10 MB 或 100 张限制")
          throw error;
      }
    }
    for (const [reference, dataUrl] of embedded)
      text = text.replaceAll(reference, dataUrl);
    if (Buffer.byteLength(text, "utf8") > 30 * 1024 * 1024)
      throw Error("转换结果和内嵌媒体超过 30 MB，已取消导入");
    if (!text.trim()) throw Error("转换结果为空，未导入文档");
    const base = path.basename(source, path.extname(source));
    return { name: `${base}.md`, text };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

module.exports = {
  pandocFormats,
  pandocCandidates,
  findPandoc,
  exportWithPandoc,
  importReaders,
  importWithPandoc,
};
