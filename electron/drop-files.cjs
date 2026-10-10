const fs = require("node:fs/promises");
const path = require("node:path");
const { constants } = require("node:fs");

// Validate the whole batch before writing; only remove entries created by us.
async function copyDroppedPaths(
  paths,
  destination,
  { signal, onProgress } = {},
) {
  const checkCancelled = () => {
    if (signal?.aborted) {
      const error = Error("复制已取消");
      error.code = "COPY_CANCELLED";
      throw error;
    }
  };
  let lastReport = 0,
    lastPhase;
  const report = (phase, completed, total, name, force = false) => {
    const now = Date.now();
    if (!force && phase === lastPhase && now - lastReport < 100) return;
    lastReport = now;
    lastPhase = phase;
    onProgress?.({ phase, completed, total, name });
  };
  checkCancelled();
  if (!Array.isArray(paths) || !paths.length || paths.length > 20)
    throw Error("一次最多复制 20 个文件或文件夹");
  const plans = [],
    names = new Set();
  let count = 0,
    bytes = 0;
  const visit = async (source, target, depth) => {
    checkCancelled();
    if (++count > 5000 || depth > 20)
      throw Error("文件夹项目过多或层级超过 20 层");
    const stat = await fs.lstat(source);
    report("checking", count, undefined, path.basename(source));
    if (stat.isSymbolicLink())
      throw Error("不能复制符号链接，请选择实际文件或文件夹");
    if (stat.isDirectory()) {
      plans.push({ source, target, directory: true });
      for (const name of await fs.readdir(source))
        await visit(
          path.join(source, name),
          path.join(target, name),
          depth + 1,
        );
    } else if (stat.isFile()) {
      bytes += stat.size;
      if (stat.size > 30 * 1024 * 1024 || bytes > 100 * 1024 * 1024)
        throw Error("单文件不能超过 30 MB，一次复制总计不能超过 100 MB");
      plans.push({ source, target, directory: false });
    } else throw Error("不能复制特殊文件");
  };
  for (const value of paths) {
    checkCancelled();
    if (
      typeof value !== "string" ||
      !path.isAbsolute(value) ||
      value.includes("\0")
    )
      throw Error("拖入的文件路径无效");
    if ((await fs.lstat(value)).isSymbolicLink())
      throw Error("不能复制符号链接");
    const source = await fs.realpath(value),
      name = path.basename(source);
    if (!name || names.has(name))
      throw Error("拖入项目存在同名文件，请分开复制或先重命名");
    names.add(name);
    const target = path.join(destination, name);
    const relative = path.relative(source, destination);
    if (
      (await fs.stat(source)).isDirectory() &&
      (!relative ||
        (!relative.startsWith(".." + path.sep) &&
          relative !== ".." &&
          !path.isAbsolute(relative)))
    )
      throw Error("不能把文件夹复制到自身或子文件夹");
    try {
      await fs.lstat(target);
      throw Error(`目标已存在“${name}”，请先重命名或选择其他文件夹`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await visit(source, target, 0);
  }
  const created = [];
  try {
    checkCancelled();
    report("copying", 0, plans.length, undefined, true);
    for (const entry of plans) {
      checkCancelled();
      if (entry.directory) await fs.mkdir(entry.target);
      else
        await fs.copyFile(entry.source, entry.target, constants.COPYFILE_EXCL);
      created.push(entry);
      report(
        "copying",
        created.length,
        plans.length,
        path.basename(entry.source),
        created.length === plans.length,
      );
      checkCancelled();
    }
  } catch (error) {
    const remaining = [];
    report("cleanup", 0, created.length, undefined, true);
    const cleanupTotal = created.length;
    let cleaned = 0;
    for (const entry of created.reverse()) {
      try {
        if (entry.directory) await fs.rmdir(entry.target);
        else await fs.unlink(entry.target);
      } catch (cleanupError) {
        if (cleanupError.code !== "ENOENT") remaining.push(entry.target);
      }
      report(
        "cleanup",
        ++cleaned,
        cleanupTotal,
        path.basename(entry.target),
        cleaned === cleanupTotal,
      );
    }
    if (remaining.length)
      throw Error(
        `${error.message}\n本次创建的以下项目未能清理，请检查：\n${remaining.slice(0, 10).join("\n")}`,
      );
    throw error;
  }
  report("finishing", plans.length, plans.length, undefined, true);
  return [...names].map((name) => path.join(destination, name));
}
module.exports = { copyDroppedPaths };
