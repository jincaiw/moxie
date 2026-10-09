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
async function moveFileNoReplace(source, destination) {
  await fs.link(source, destination);
  try {
    await fs.unlink(source);
  } catch (error) {
    throw Error(
      `移动未完成；为避免覆盖或丢失文件，原文件和目标副本都已保留。${error.message}`,
    );
  }
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

async function inspectDirectory(root) {
  const entries = [];
  let totalBytes = 0;
  const visit = async (current, relative = "") => {
    const children = await fs.readdir(current, { withFileTypes: true });
    for (const child of children) {
      const childPath = path.join(current, child.name);
      const childRelative = path.join(relative, child.name);
      const metadata = await fs.lstat(childPath);
      if (metadata.isSymbolicLink())
        throw Error("目录包含符号链接，无法安全操作整个目录");
      if (metadata.isDirectory()) {
        entries.push({
          path: childPath,
          relative: childRelative,
          kind: "directory",
        });
        if (entries.length > 5000) throw Error("目录项目超过 5000 项限制");
        await visit(childPath, childRelative);
      } else if (metadata.isFile()) {
        totalBytes += metadata.size;
        if (metadata.size > 30 * 1024 * 1024 || totalBytes > 100 * 1024 * 1024)
          throw Error(
            "目录文件或总数据超过安全操作限制（单文件 30 MB，总计 100 MB）",
          );
        entries.push({
          path: childPath,
          relative: childRelative,
          kind: "file",
        });
        if (entries.length > 5000) throw Error("目录项目超过 5000 项限制");
      } else throw Error("目录包含不支持的特殊文件");
    }
  };
  await visit(root);
  return entries;
}

async function directoryFingerprint(root) {
  const hash = crypto.createHash("sha256");
  for (const entry of await inspectDirectory(root)) {
    hash.update(entry.kind).update("\0").update(entry.relative).update("\0");
    if (entry.kind === "file") hash.update(await fs.readFile(entry.path));
  }
  return hash.digest("hex");
}

async function copyDirectoryContents(source, destination, entries) {
  await fs.mkdir(destination);
  try {
    for (const entry of entries) {
      const target = path.join(destination, entry.relative);
      if (entry.kind === "directory") await fs.mkdir(target);
      else
        await fs.copyFile(
          entry.path,
          target,
          require("node:fs").constants.COPYFILE_EXCL,
        );
    }
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
}

class FileStore {
  constructor(stateFile, trashItem) {
    this.stateFile = stateFile;
    this.authorized = new Set();
    this.recent = [];
    this.writing = Promise.resolve();
    this.folders = new Set();
    this.listedFiles = new Map();
    this.treeRoots = new Map();
    this.trashItem = trashItem;
    this.fileOperationHistory = [];
  }
  async remapDirectoryPaths(from, to, root) {
    const files = [...this.authorized].filter((file) => inside(from, file));
    for (const folder of [...this.folders])
      if (inside(from, folder)) {
        this.folders.delete(folder);
        this.folders.add(path.join(to, path.relative(from, folder)));
      }
    const mappings = files.map((file) => ({
      from: file,
      to: path.join(to, path.relative(from, file)),
    }));
    for (const { from: oldPath, to: newPath } of mappings) {
      this.authorized.delete(oldPath);
      this.authorized.add(newPath);
      this.treeRoots.delete(oldPath);
      this.treeRoots.set(newPath, root);
    }
    this.recent = this.recent.map((file) =>
      inside(from, file) ? path.join(to, path.relative(from, file)) : file,
    );
    await this.persist();
    return Promise.all(
      mappings.map(async (mapping) => ({
        ...mapping,
        version: await this.signature(mapping.to).catch(() => undefined),
      })),
    );
  }
  async removeDirectoryPaths(prefix) {
    const files = [...this.authorized].filter((file) => inside(prefix, file));
    for (const folder of [...this.folders])
      if (inside(prefix, folder)) this.folders.delete(folder);
    for (const file of [...this.authorized])
      if (inside(prefix, file)) {
        this.authorized.delete(file);
        this.treeRoots.delete(file);
      }
    this.recent = this.recent.filter((file) => !inside(prefix, file));
    await this.persist();
    return files;
  }
  async fileOperation(input) {
    const {
      action,
      root: suppliedRoot,
      target: suppliedTarget,
      directory: suppliedDirectory,
      name,
    } = input || {};
    if (
      typeof suppliedRoot !== "string" ||
      !path.isAbsolute(suppliedRoot) ||
      !this.folders.has(suppliedRoot)
    )
      throw Error("请选择已授权的文件夹");
    const root = await fs.realpath(suppliedRoot);
    if (root !== suppliedRoot) throw Error("文件夹位置已改变，请重新选择");
    const insideRoot = (target) => inside(root, target);
    const directory = async (value) => {
      if (
        typeof value !== "string" ||
        !path.isAbsolute(value) ||
        !insideRoot(value)
      )
        throw Error("目标必须位于已授权文件夹内");
      let current = root;
      const relative = path.relative(root, path.resolve(value));
      for (const segment of relative ? relative.split(path.sep) : []) {
        current = path.join(current, segment);
        const metadata = await fs.lstat(current);
        if (!metadata.isDirectory() || metadata.isSymbolicLink())
          throw Error("目标目录不能包含符号链接");
        const real = await fs.realpath(current);
        if (real !== current || !insideRoot(real))
          throw Error("目标目录不能指向授权范围之外");
      }
      return current;
    };
    const document = async (value) => {
      if (
        typeof value !== "string" ||
        !path.isAbsolute(value) ||
        !insideRoot(value)
      )
        throw Error("文件必须位于已授权文件夹内");
      await directory(path.dirname(value));
      const metadata = await fs.lstat(value);
      if (metadata.size > 30 * 1024 * 1024) throw Error("文档超出 30 MB 限制");
      if (metadata.isSymbolicLink() || !metadata.isFile())
        throw Error("仅支持普通文件和目录，不能操作符号链接");
      if (!insideRoot(await fs.realpath(value)))
        throw Error("文件不能指向授权文件夹之外");
      return value;
    };
    const filename = (value) => {
      if (
        typeof value !== "string" ||
        !value.trim() ||
        value.length > 160 ||
        /[<>:"|?*\\/\x00-\x1f]/.test(value) ||
        value === "." ||
        value === ".."
      )
        throw Error("名称无效；请使用不含路径分隔符的文件名");
      return value.trim();
    };
    if (action === "new-file" || action === "new-folder") {
      const parent = await directory(suppliedTarget || root);
      const label = filename(name);
      if (action === "new-file" && !/\.(md|markdown|txt)$/i.test(label))
        throw Error("文件名需以 .md、.markdown 或 .txt 结尾");
      const target = path.join(parent, label);
      if (!insideRoot(target)) throw Error("目标必须位于已授权文件夹内");
      if (action === "new-folder") await fs.mkdir(target);
      else
        await fs.writeFile(target, "", {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
      if (action === "new-file") {
        this.authorized.add(target);
        this.treeRoots.set(target, root);
        await this.persist();
      }
      this.rememberFileOperation({
        action,
        path: target,
        directory: action === "new-folder",
        fingerprint:
          action === "new-file"
            ? await this.contentFingerprint(target)
            : action === "new-folder"
              ? await directoryFingerprint(target)
              : undefined,
      });
      return {
        action,
        path: target,
        kind: action === "new-folder" ? "directory" : "file",
      };
    }
    if (action === "undo") {
      const previous = this.fileOperationHistory.at(-1);
      if (!previous || !insideRoot(previous.path))
        throw Error("没有可撤销的文件操作");
      if (previous.action === "trash")
        throw Error("此系统的废纸篓操作无法由应用自动撤销");
      let undoPaths;
      if (["new-file", "new-folder", "copy"].includes(previous.action)) {
        const metadata = await fs.lstat(previous.path);
        if (
          metadata.isSymbolicLink() ||
          (previous.directory &&
            (await directoryFingerprint(previous.path)) !==
              previous.fingerprint) ||
          (!previous.directory &&
            metadata.isDirectory() &&
            (await fs.readdir(previous.path)).length)
        )
          throw Error("目标已包含新内容，无法安全撤销");
        if (
          !previous.directory &&
          metadata.isFile() &&
          (await this.contentFingerprint(previous.path)) !==
            previous.fingerprint
        )
          throw Error("文件内容已更改，无法安全撤销");
        if (previous.directory)
          undoPaths = (await this.removeDirectoryPaths(previous.path)).map(
            (from) => ({ from, remove: true }),
          );
        await fs.rm(previous.path, { recursive: Boolean(previous.directory) });
      } else {
        if (
          await fs.lstat(previous.from).then(
            () => true,
            (error) =>
              error.code === "ENOENT" ? false : Promise.reject(error),
          )
        )
          throw Error("原位置已被占用，无法撤销");
        if (
          previous.fingerprint &&
          (previous.directory
            ? await directoryFingerprint(previous.path)
            : await this.contentFingerprint(previous.path)) !==
            previous.fingerprint
        )
          throw Error("文件内容已更改，无法安全撤销");
        if (previous.directory) {
          await fs.rename(previous.path, previous.from);
          undoPaths = await this.remapDirectoryPaths(
            previous.path,
            previous.from,
            root,
          );
        } else {
          await moveFileNoReplace(previous.path, previous.from);
        }
        if (
          !previous.directory &&
          ["rename", "move"].includes(previous.action)
        ) {
          this.authorized.delete(previous.path);
          this.authorized.add(previous.from);
          this.treeRoots.delete(previous.path);
          this.treeRoots.set(previous.from, root);
          this.recent = this.recent.map((file) =>
            file === previous.path ? previous.from : file,
          );
          await this.persist();
        }
      }
      this.fileOperationHistory.pop();
      return {
        action: "undo",
        path: previous.path,
        from: previous.from,
        kind: previous.directory ? "directory" : "file",
        undid: previous.action,
        paths: undoPaths,
        version:
          !previous.directory &&
          previous.from &&
          (await this.signature(previous.from).catch(() => undefined)),
      };
    }
    if (
      typeof suppliedTarget !== "string" ||
      !path.isAbsolute(suppliedTarget) ||
      !insideRoot(suppliedTarget)
    )
      throw Error("目标必须位于已授权文件夹内");
    const sourceMetadata = await fs.lstat(suppliedTarget);
    if (sourceMetadata.isDirectory()) {
      const source = await directory(suppliedTarget);
      if (source === root) throw Error("不能对已打开的根文件夹执行此操作");
      const entries = await inspectDirectory(source);
      if (action === "trash") {
        if (!this.trashItem) throw Error("当前平台不支持移入系统废纸篓");
        const files = [...this.authorized].filter((file) =>
          inside(source, file),
        );
        await this.trashItem(source);
        await this.removeDirectoryPaths(source);
        this.rememberFileOperation({ action: "trash", path: source });
        return {
          action,
          path: source,
          kind: "directory",
          paths: files.map((from) => ({ from, remove: true })),
        };
      }
      if (!["rename", "copy", "move"].includes(action))
        throw Error("未知目录操作");
      const parent =
        action === "move"
          ? await directory(suppliedDirectory)
          : path.dirname(source);
      const label =
        action === "copy" && !name
          ? `${path.basename(source)} 副本`
          : filename(name || path.basename(source));
      const destination = path.join(parent, label);
      if (!insideRoot(destination)) throw Error("目标必须位于已授权文件夹内");
      if (action === "move" && inside(source, destination))
        throw Error("不能把文件夹移动到自身或其子文件夹中");
      if (
        await fs.lstat(destination).then(
          () => true,
          (error) => (error.code === "ENOENT" ? false : Promise.reject(error)),
        )
      )
        throw Error("目标位置已存在同名文件夹");
      let mappings;
      if (action === "copy") {
        const temporary = path.join(
          parent,
          `.moxie-copy-${crypto.randomUUID()}`,
        );
        try {
          await copyDirectoryContents(source, temporary, entries);
          await fs.rename(temporary, destination);
        } catch (error) {
          await fs.rm(temporary, { recursive: true, force: true });
          throw error;
        }
        for (const entry of entries) {
          if (
            entry.kind === "file" &&
            /\.(md|markdown|txt)$/i.test(entry.path)
          ) {
            const target = path.join(destination, entry.relative);
            this.authorized.add(target);
            this.treeRoots.set(target, root);
          }
        }
        await this.persist();
      } else {
        await fs.rename(source, destination);
        mappings = await this.remapDirectoryPaths(source, destination, root);
      }
      const fingerprint = await directoryFingerprint(destination);
      this.rememberFileOperation({
        action,
        path: destination,
        from: source,
        directory: true,
        fingerprint,
      });
      return {
        action,
        path: destination,
        from: source,
        kind: "directory",
        paths: mappings,
      };
    }
    const source = await document(suppliedTarget);
    const metadata = await fs.lstat(source);
    if (action === "trash") {
      if (!this.trashItem) throw Error("当前平台不支持移入系统废纸篓");
      await this.trashItem(source);
      this.authorized.delete(source);
      this.treeRoots.delete(source);
      this.recent = this.recent.filter((file) => file !== source);
      await this.persist();
      this.rememberFileOperation({ action: "trash", path: source });
      return { action, path: source, kind: "file" };
    }
    const parent =
      action === "move"
        ? await directory(suppliedDirectory)
        : path.dirname(source);
    if (!["rename", "copy", "move"].includes(action))
      throw Error("未知文件操作");
    if (metadata.isDirectory())
      throw Error(
        "暂不支持复制、重命名或移动整个目录；请逐个操作其中的 Markdown 文件",
      );
    const label =
      action === "copy" && !name
        ? `${path.parse(source).name} 副本${path.extname(source)}`
        : filename(name || path.basename(source));
    if (
      ![".md", ".markdown", ".txt"].includes(path.extname(label).toLowerCase())
    )
      throw Error("只支持 Markdown 和 TXT 文档");
    const destination = path.join(parent, label);
    if (!insideRoot(destination)) throw Error("目标必须位于已授权文件夹内");
    if (
      await fs.lstat(destination).then(
        () => true,
        (error) => (error.code === "ENOENT" ? false : Promise.reject(error)),
      )
    )
      throw Error("目标位置已存在同名文件");
    if (action === "copy") {
      await fs.copyFile(
        source,
        destination,
        require("node:fs").constants.COPYFILE_EXCL,
      );
      this.authorized.add(destination);
      this.treeRoots.set(destination, this.treeRoots.get(source) || root);
      await this.persist();
    } else await moveFileNoReplace(source, destination);
    if (action !== "copy") {
      this.authorized.delete(source);
      this.authorized.add(destination);
      const treeRoot = this.treeRoots.get(source) || root;
      this.treeRoots.delete(source);
      this.treeRoots.set(destination, treeRoot);
      this.recent = this.recent.map((file) =>
        file === source ? destination : file,
      );
      await this.persist();
    }
    const version = await this.signature(destination);
    this.rememberFileOperation({
      action,
      path: destination,
      from: source,
      version,
      fingerprint: await this.contentFingerprint(destination),
    });
    return { action, path: destination, from: source, kind: "file", version };
  }
  async authorizedPath(value, allowListed = false) {
    if (typeof value !== "string" || !path.isAbsolute(value))
      throw Error("路径无效");
    const root = [...this.folders]
      .filter((folder) => inside(folder, value))
      .sort((a, b) => b.length - a.length)[0];
    if (!root) throw Error("路径不在已打开的文件夹中");
    const metadata = await fs.lstat(value);
    if (metadata.isSymbolicLink()) throw Error("不能显示符号链接路径");
    const real = await fs.realpath(value);
    if (real !== value || !inside(root, real))
      throw Error("路径位置已改变，请刷新文件夹");
    const listed =
      allowListed && (this.listedFiles.get(root)?.has(real) || false);
    if (!metadata.isDirectory() && !this.authorized.has(real) && !listed)
      throw Error("该文件尚未由文件夹浏览器授权");
    return real;
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
  async folder(root, refresh = false, knownVersion, displayOptions = {}) {
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
    const showHiddenFiles = displayOptions?.showHiddenFiles === true;
    const showOtherFiles = displayOptions?.showOtherFiles === true;
    const listedFiles = new Set();
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
          (!showHiddenFiles && entry.name.startsWith(".")) ||
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
        } else if (entry.isFile()) {
          if (/\.(md|markdown|txt)$/i.test(entry.name)) {
            count++;
            this.authorized.add(file);
            this.treeRoots.set(file, root);
            nodes.push({ path: file, name: entry.name, kind: "file" });
          } else if (showOtherFiles) {
            count++;
            listedFiles.add(file);
            nodes.push({ path: file, name: entry.name, kind: "other" });
          }
        }
      }
      return nodes;
    };
    const entries = await walk(root, 0);
    this.listedFiles.set(root, listedFiles);
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
  async contentFingerprint(file) {
    const bytes = await fs.readFile(file);
    if (bytes.length > 30 * 1024 * 1024) throw Error("文档超出 30 MB 限制");
    return crypto.createHash("sha256").update(bytes).digest("hex");
  }
  rememberFileOperation(operation) {
    this.fileOperationHistory.push(operation);
    if (this.fileOperationHistory.length > 50)
      this.fileOperationHistory.shift();
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
