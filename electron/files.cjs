const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const https = require("node:https");

function isPublicAddress(address, family) {
  if (family === 4) {
    const octets = address.split(".").map(Number);
    const [a, b, c] = octets;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  return (
    /^[23]/.test(normalized) &&
    !normalized.startsWith("2001:db8:") &&
    !normalized.startsWith("2001:0db8:")
  );
}

async function downloadRemoteImage(urlValue) {
  let url;
  try {
    url = new URL(urlValue);
  } catch {
    throw Error("远程图片地址无效");
  }
  for (let redirects = 0; redirects <= 4; redirects++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".internal")
    )
      throw Error("只允许下载公开 HTTPS 图片地址");
    const addresses = await dns.lookup(hostname, {
      all: true,
      verbatim: true,
    });
    if (
      !addresses.length ||
      addresses.some(({ address, family }) => !isPublicAddress(address, family))
    )
      throw Error("远程图片地址解析到了非公开网络");
    const address = addresses[0];
    const response = await new Promise((resolve, reject) => {
      const request = https.get(
        url,
        {
          headers: {
            accept:
              "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/avif,image/svg+xml",
          },
          lookup: (_hostname, _options, callback) =>
            callback(null, address.address, address.family),
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on("data", (chunk) => {
            size += chunk.length;
            if (size > 10 * 1024 * 1024) {
              res.destroy(Error("远程图片不能超过 10 MB"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              location: res.headers.location,
              bytes: Buffer.concat(chunks),
            }),
          );
          res.on("error", reject);
        },
      );
      request.setTimeout(15000, () =>
        request.destroy(Error("远程图片下载超时")),
      );
      request.on("error", reject);
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirects === 4)
        throw Error("远程图片重定向次数超出限制");
      url = new URL(response.location, url);
      continue;
    }
    if (response.status !== 200)
      throw Error(`远程图片下载失败（${response.status}）`);
    imageType(response.bytes);
    return response.bytes;
  }
  throw Error("无法下载远程图片");
}

function validateText(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text, "utf8") > 30 * 1024 * 1024
  )
    throw Error("文档超出 30 MB 限制");
}
function lineBoundsAt(text, position) {
  const before = Math.max(
    text.lastIndexOf("\n", position - 1),
    text.lastIndexOf("\r", position - 1),
  );
  const after = [text.indexOf("\n", position), text.indexOf("\r", position)]
    .filter((offset) => offset >= 0)
    .reduce((nearest, offset) => Math.min(nearest, offset), text.length);
  return { from: before + 1, to: after };
}
async function atomicWrite(file, text) {
  const temp = path.join(
    path.dirname(file),
    "." + path.basename(file) + "." + crypto.randomUUID() + ".tmp",
  );
  try {
    let mode;
    try {
      mode = (await fs.stat(file)).mode;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await fs.writeFile(temp, text, {
      encoding: "utf8",
      flag: "wx",
      mode: mode ?? 0o600,
    });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}
function imageType(bytes) {
  if (bytes.length > 10 * 1024 * 1024) throw Error("单张图片不能超过 10 MB");
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { extension: "png", mime: "image/png" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { extension: "jpg", mime: "image/jpeg" };
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString()))
    return { extension: "gif", mime: "image/gif" };
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return { extension: "webp", mime: "image/webp" };
  if (bytes.length >= 26 && bytes.subarray(0, 2).toString() === "BM")
    return { extension: "bmp", mime: "image/bmp" };
  const svgHeader = bytes
    .subarray(0, Math.min(bytes.length, 4096))
    .toString("utf8")
    .replace(/^\uFEFF/, "")
    .trimStart();
  if (
    /^(?:<\?xml\b[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+svg(?:\s+(?:public\s+["'][^"']*["']\s+["'][^"']*["']|system\s+["'][^"']*["']))?\s*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(
      svgHeader,
    )
  )
    return { extension: "svg", mime: "image/svg+xml" };
  if (bytes.length >= 16 && bytes.subarray(4, 8).toString() === "ftyp") {
    const boxSize = bytes.readUInt32BE(0);
    const majorBrand = bytes.subarray(8, 12).toString();
    const compatibleBrands = Array.from(
      { length: Math.max(0, (boxSize - 16) / 4) },
      (_, index) => bytes.subarray(16 + index * 4, 20 + index * 4).toString(),
    );
    if (
      boxSize >= 16 &&
      boxSize <= bytes.length &&
      boxSize % 4 === 0 &&
      [majorBrand, ...compatibleBrands].some(
        (brand) => brand === "avif" || brand === "avis",
      )
    )
      return { extension: "avif", mime: "image/avif" };
  }
  throw Error("图片格式无效，支持 PNG、JPEG、GIF、WebP、BMP、AVIF 和 SVG");
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== ".." &&
    !relative.startsWith(".." + path.sep) &&
    !path.isAbsolute(relative)
  );
}
async function createAuthorizedDirectory(root, target) {
  const relative = path.relative(root, target);
  if (!inside(root, target)) throw Error("图片目录必须位于已打开的文件夹内");
  if (!relative) return root;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      await fs.mkdir(current);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("图片目录不能包含符号链接");
    const resolved = await fs.realpath(current);
    if (!inside(root, resolved)) throw Error("图片目录不能指向授权目录之外");
    current = resolved;
  }
  return current;
}

class FileStore {
  constructor(stateFile) {
    this.stateFile = stateFile;
    this.authorized = new Set();
    this.recent = [];
    this.writing = Promise.resolve();
    this.folders = new Set();
    this.treeRoots = new Map();
  }
  async init() {
    if (!this.stateFile) return;
    try {
      const state = JSON.parse(await fs.readFile(this.stateFile, "utf8"));
      if (state.version !== 1) return;
      this.authorized = new Set(
        (state.authorized || [])
          .filter((p) => typeof p === "string" && path.isAbsolute(p))
          .slice(-500),
      );
      this.folders = new Set(
        (state.folders || [])
          .filter((p) => typeof p === "string" && path.isAbsolute(p))
          .slice(-10),
      );
      this.treeRoots = new Map(
        (state.treeRoots || []).filter(
          (entry) =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            this.authorized.has(entry[0]) &&
            typeof entry[1] === "string" &&
            path.isAbsolute(entry[1]) &&
            inside(entry[1], entry[0]),
        ),
      );
      this.recent = (state.recent || [])
        .filter((p) => this.authorized.has(p))
        .slice(0, 12);
    } catch {}
  }
  async remember(file) {
    this.authorized.delete(file);
    this.authorized.add(file);
    this.recent = [file, ...this.recent.filter((p) => p !== file)].slice(0, 12);
    await this.persist();
  }
  async entryPath(file) {
    return path.join(
      await fs.realpath(path.dirname(file)),
      path.basename(file),
    );
  }
  async persist() {
    if (this.stateFile) {
      const recent = new Set(this.recent);
      const authorized = [...this.authorized]
        .filter((file) => !recent.has(file))
        .slice(-(500 - recent.size))
        .concat([...this.recent].reverse());
      const saved = new Set(authorized);
      const state = JSON.stringify({
        version: 1,
        authorized,
        recent: this.recent,
        folders: [...this.folders].slice(-10),
        treeRoots: [...this.treeRoots].filter(([file]) => saved.has(file)),
      });
      this.writing = this.writing
        .catch(() => {})
        .then(async () => {
          await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
          await atomicWrite(this.stateFile, state);
        });
      await this.writing;
    }
  }
  async folder(root, refresh = false, knownVersion) {
    if (refresh && !this.folders.has(root)) throw Error("请先选择该文件夹");
    const resolved = await fs.realpath(root);
    if (refresh && resolved !== root)
      throw Error("文件夹位置已改变，请重新选择文件夹");
    root = resolved;
    if (!refresh) this.folders.delete(root);
    this.folders.add(root);
    let count = 0,
      visited = 0,
      truncated = false;
    const walk = async (directory, depth) => {
      if (depth > 20) {
        truncated = true;
        return [];
      }
      if (!inside(root, await fs.realpath(directory))) return [];
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name, "zh-CN", { numeric: true }),
      );
      const nodes = [];
      for (const entry of entries) {
        if (++visited > 10000 || count >= 1000) {
          truncated = true;
          break;
        }
        if (
          entry.name.startsWith(".") ||
          entry.name === "node_modules" ||
          entry.name.endsWith(".assets")
        )
          continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          const children = await walk(file, depth + 1);
          nodes.push({
            path: file,
            name: entry.name,
            kind: "directory",
            children,
          });
        } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
          count++;
          this.authorized.add(file);
          this.treeRoots.set(file, root);
          nodes.push({ path: file, name: entry.name, kind: "file" });
        }
      }
      return nodes;
    };
    const entries = await walk(root, 0);
    const version = crypto
      .createHash("sha256")
      .update(JSON.stringify({ entries, truncated }))
      .digest("hex");
    if (!refresh) await this.persist();
    if (version === knownVersion) return null;
    return {
      path: root,
      name: path.basename(root),
      entries,
      truncated,
      version,
    };
  }
  async searchFolder({ root, query }) {
    if (typeof query !== "string" || !query.trim() || query.length > 200)
      throw Error("搜索内容无效");
    const normalized = query.trim().toLocaleLowerCase();
    const tree = await this.folder(root, true);
    const selectedRoot = tree?.path || root;
    const files = [...this.authorized].filter(
      (file) => this.treeRoots.get(file) === selectedRoot,
    );
    const results = [];
    let scanned = 0;
    let skipped = 0;
    let bytesRead = 0;
    for (const file of files) {
      if (results.length >= 200) break;
      try {
        if (!inside(selectedRoot, await fs.realpath(file))) continue;
        const stat = await fs.stat(file);
        if (
          !stat.isFile() ||
          stat.size > 10 * 1024 * 1024 ||
          bytesRead + stat.size > 100 * 1024 * 1024
        ) {
          skipped++;
          continue;
        }
        const text = await fs.readFile(file, "utf8");
        bytesRead += stat.size;
        scanned++;
        const lower = text.toLocaleLowerCase();
        let from = 0;
        while (results.length < 200) {
          const index = lower.indexOf(normalized, from);
          if (index < 0) break;
          const { from: start, to: end } = lineBoundsAt(text, index);
          const line = text.slice(start, end).trim();
          const excerpt =
            line.length > 180
              ? `…${line.slice(Math.max(0, index - start - 70), index - start + query.length + 90)}…`
              : line;
          results.push({
            path: file,
            name: path.basename(file),
            from: index,
            excerpt,
          });
          from = index + Math.max(normalized.length, 1);
        }
      } catch (error) {
        if (error.code !== "ENOENT") skipped++;
      }
    }
    return {
      results,
      scanned,
      skipped,
      truncated: results.length >= 200 || skipped > 0,
    };
  }
  async openLinked(documentPath, href) {
    if (typeof documentPath !== "string" || !path.isAbsolute(documentPath))
      throw Error("请先打开或保存当前文档");
    const entry = await this.entryPath(documentPath);
    if (!this.authorized.has(documentPath) && !this.authorized.has(entry))
      throw Error("请先打开或保存当前文档");
    if (
      typeof href !== "string" ||
      href.length > 8192 ||
      /^[a-z][a-z0-9+.-]*:/i.test(href) ||
      href.startsWith("//")
    )
      throw Error("链接无效");
    const hash = href.indexOf("#");
    let relative, anchor;
    try {
      relative = decodeURIComponent(hash < 0 ? href : href.slice(0, hash));
      anchor = hash < 0 ? undefined : decodeURIComponent(href.slice(hash + 1));
    } catch {
      throw Error("链接包含无效的百分号编码");
    }
    if (
      !relative ||
      path.isAbsolute(relative) ||
      relative.includes("\0") ||
      !/\.(md|markdown)$/i.test(relative)
    )
      throw Error("仅支持相对路径的 Markdown 文档链接");
    const directory = await fs.realpath(path.dirname(documentPath));
    const realDocument = await fs.realpath(documentPath);
    const root =
      this.treeRoots.get(documentPath) ||
      this.treeRoots.get(entry) ||
      this.treeRoots.get(realDocument) ||
      directory;
    if (!inside(root, directory) || !inside(root, realDocument))
      throw Error("文档位置已改变，请重新打开");
    const target = path.resolve(directory, relative);
    if (!inside(root, target) || !inside(root, await fs.realpath(target)))
      throw Error("链接必须位于已打开的文件夹内");
    this.treeRoots.set(target, root);
    return { file: await this.read(target), anchor };
  }
  async signature(file) {
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw Error("请选择普通文件");
    if (stat.size > 30 * 1024 * 1024) throw Error("文档超出 30 MB 限制");
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  }
  async inspect(files) {
    if (!Array.isArray(files) || files.length > 100)
      throw Error("文件检查请求无效");
    const changes = [];
    for (const input of files) {
      const file = input?.path;
      if (typeof file !== "string" || !path.isAbsolute(file))
        throw Error("文档未获授权");
      const entry = await this.entryPath(file).catch(() => file);
      if (!this.authorized.has(file) && !this.authorized.has(entry))
        throw Error("文档未获授权");
      try {
        const root = this.treeRoots.get(file) || this.treeRoots.get(entry);
        if (root && !inside(root, await fs.realpath(file)))
          throw Error("文档不能指向文件夹之外");
        const version = await this.signature(file);
        if (version === input.version) continue;
        const text = await fs.readFile(file, "utf8");
        changes.push({ path: file, version, text, status: "changed" });
      } catch (error) {
        const status = error.code === "ENOENT" ? "missing" : "unavailable";
        if (input.version !== status)
          changes.push({ path: file, version: status, status });
      }
    }
    return changes;
  }
  async read(file, requirePermission = false) {
    if (typeof file !== "string" || !path.isAbsolute(file))
      throw Error("文档路径无效");
    const entry = requirePermission
      ? await this.entryPath(file).catch(() => file)
      : file;
    if (
      requirePermission &&
      !this.authorized.has(file) &&
      !this.authorized.has(entry)
    )
      throw Error("请先通过“打开文件”选择该文档");
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw Error("请选择普通文件");
    if (stat.size > 30 * 1024 * 1024) throw Error("文档超出 30 MB 限制");
    const root = this.treeRoots.get(file) || this.treeRoots.get(entry);
    if (root && !inside(root, await fs.realpath(file)))
      throw Error("文档不能指向文件夹之外");
    const signature = await this.signature(file);
    const text = await fs.readFile(file, "utf8");
    await this.remember(file);
    return { path: file, name: path.basename(file), text, version: signature };
  }
  async save(input, choosePath, confirmConflict) {
    validateText(input.text);
    let file = input.path;
    const approved = file && this.authorized.has(file);
    if (input.automatic && (!approved || input.saveAs))
      throw Error("自动保存已暂停，请手动保存一次以确认文件路径");
    if (!approved || input.saveAs) {
      file = await choosePath(file || path.basename(input.name || "未命名.md"));
      if (!file) return null;
    } else {
      let actual;
      try {
        actual = await fs.readFile(file, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (actual !== input.expected) {
        if (input.automatic)
          throw Error(
            "自动保存已暂停：文件已被其他程序修改或删除，请手动保存处理冲突",
          );
        if (!(await confirmConflict())) return null;
      }
    }
    await atomicWrite(file, input.text);
    const version = await this.signature(file);
    await this.remember(file);
    return { path: file, name: path.basename(file), text: input.text, version };
  }
  async resourceRoot(documentPath) {
    if (!this.authorized.has(documentPath))
      throw Error("请先打开或保存文档，再访问图片");
    const directory = await fs.realpath(path.dirname(documentPath));
    const root = this.treeRoots.get(documentPath) || directory;
    if (
      !inside(root, directory) ||
      !inside(root, await fs.realpath(documentPath))
    )
      throw Error("文档位置已改变，请重新打开");
    return { directory, root };
  }
  async storeImage({ documentPath, bytes, targetDirectory }) {
    const buffer = Buffer.from(bytes);
    const type = imageType(buffer);
    const { directory, root } = await this.resourceRoot(documentPath);
    const rootPath = await fs.realpath(root);
    let outputDirectory;
    if (targetDirectory !== undefined) {
      if (
        typeof targetDirectory !== "string" ||
        !targetDirectory.trim() ||
        targetDirectory.length > 512 ||
        targetDirectory.includes("\0") ||
        path.isAbsolute(targetDirectory)
      )
        throw Error("图片目标目录无效");
      const target = path.resolve(directory, targetDirectory);
      outputDirectory = await createAuthorizedDirectory(rootPath, target);
    } else {
      const directoryName =
        path.basename(documentPath, path.extname(documentPath)) + ".assets";
      outputDirectory = path.join(rootPath, directoryName);
      await fs.mkdir(outputDirectory, { recursive: true });
      outputDirectory = await fs.realpath(outputDirectory);
      if (!inside(rootPath, outputDirectory))
        throw Error("图片目录不能指向文档目录之外");
    }
    const fileName = crypto.randomUUID() + "." + type.extension;
    await fs.writeFile(path.join(outputDirectory, fileName), buffer, {
      flag: "wx",
      mode: 0o600,
    });
    return {
      relativePath: path
        .relative(directory, path.join(outputDirectory, fileName))
        .split(path.sep)
        .join("/"),
    };
  }
  async downloadRemoteImage({ documentPath, url, targetDirectory }) {
    if (typeof url !== "string" || url.length > 8192)
      throw Error("远程图片地址无效");
    const bytes = await downloadRemoteImage(url);
    return this.storeImage({ documentPath, bytes, targetDirectory });
  }
  async readImage({ documentPath, relativePath }) {
    const { directory, root } = await this.resourceRoot(documentPath);
    if (
      typeof relativePath !== "string" ||
      path.isAbsolute(relativePath) ||
      relativePath.includes("\0")
    )
      throw Error("图片路径无效");
    const target = path.resolve(directory, relativePath);
    if (!inside(root, target)) throw Error("图片必须位于已打开的文件夹内");
    const resolved = await fs.realpath(target);
    if (!inside(root, resolved)) throw Error("图片不能指向已打开文件夹之外");
    const stat = await fs.stat(resolved);
    if (stat.size > 10 * 1024 * 1024) throw Error("图片不能超过 10 MB");
    const bytes = await fs.readFile(resolved);
    const type = imageType(bytes);
    return `data:${type.mime};base64,${bytes.toString("base64")}`;
  }
  async manageImage({
    documentPath,
    sourcePath,
    targetPath,
    mode,
    avoidCollision = false,
  }) {
    if (!["copy", "move"].includes(mode)) throw Error("图片操作无效");
    if (typeof avoidCollision !== "boolean") throw Error("图片操作参数无效");
    for (const value of [sourcePath, targetPath])
      if (
        typeof value !== "string" ||
        !value ||
        value.includes("\0") ||
        path.isAbsolute(value)
      )
        throw Error("图片路径无效");
    const { directory, root } = await this.resourceRoot(documentPath);
    const rootPath = await fs.realpath(root);
    const source = path.resolve(directory, sourcePath);
    const target = path.resolve(directory, targetPath);
    if (!inside(rootPath, source) || !inside(rootPath, target))
      throw Error("图片必须位于已打开的文件夹内");
    const sourceStat = await fs.lstat(source);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
      throw Error("只能操作普通图片文件");
    const resolved = await fs.realpath(source);
    if (!inside(rootPath, resolved))
      throw Error("图片不能指向已打开文件夹之外");
    imageType(await fs.readFile(resolved));
    if (source === target) {
      if (!avoidCollision) throw Error("图片目标路径不能与原图相同");
      return {
        relativePath: path
          .relative(directory, source)
          .split(path.sep)
          .join("/"),
      };
    }
    const targetDirectory = await createAuthorizedDirectory(
      rootPath,
      path.dirname(target),
    );
    const constants = require("node:fs").constants;
    const requestedName = path.basename(target);
    const parsedName = path.parse(requestedName);
    let finalTarget = path.join(targetDirectory, requestedName);
    if (avoidCollision) {
      for (let suffix = 1; ; suffix++) {
        try {
          await fs.copyFile(resolved, finalTarget, constants.COPYFILE_EXCL);
          break;
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (suffix >= 10000) throw Error("无法为图片分配唯一文件名");
          finalTarget = path.join(
            targetDirectory,
            `${parsedName.name} (${suffix + 1})${parsedName.ext}`,
          );
        }
      }
    } else {
      const targetExists = await fs.lstat(finalTarget).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      );
      if (targetExists) throw Error("目标位置已存在同名文件");
      await fs.copyFile(resolved, finalTarget, constants.COPYFILE_EXCL);
    }
    if (mode === "move") await fs.rm(resolved);
    return {
      relativePath: path
        .relative(directory, finalTarget)
        .split(path.sep)
        .join("/"),
    };
  }
}
module.exports = { FileStore, atomicWrite, validateText, imageType };
