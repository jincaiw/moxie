const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function verifyThemeCatalog(catalog, packageVersion, read = fs.readFileSync) {
  if (
    !catalog ||
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.themes) ||
    catalog.themes.length > 50
  )
    throw new Error("主题目录 schema 无效。");
  const ids = new Set();
  for (const theme of catalog.themes) {
    if (
      !theme ||
      !/^[a-z0-9][a-z0-9-]{1,39}$/.test(theme.id) ||
      ids.has(theme.id)
    )
      throw new Error("主题目录中有无效或重复的 ID。");
    ids.add(theme.id);
    if (
      !/^\d+\.\d+\.\d+$/.test(theme.minimumAppVersion) ||
      !/^\d+\.\d+\.\d+$/.test(theme.releaseVersion)
    )
      throw new Error(`主题 ${theme.id} 的最低版本或资源版本无效。`);
    const release = `https://github.com/jincaiw/moxie/releases/download/v${theme.releaseVersion}`;
    if (
      theme.packageUrl !== `${release}/theme-${theme.id}.css` ||
      theme.previewUrl !== `${release}/theme-${theme.id}.svg`
    )
      throw new Error(
        `主题 ${theme.id} 必须引用其资源版本对应的官方 Release。`,
      );
    if (theme.size < 1 || theme.size > 128 * 1024)
      throw new Error(`主题 ${theme.id} CSS 超出大小限制。`);
    const css = read(path.resolve(`public/themes/theme-${theme.id}.css`));
    const preview = read(path.resolve(`public/themes/theme-${theme.id}.svg`));
    const hash = createHash("sha256").update(css).digest("hex");
    if (css.length !== theme.size || hash !== theme.sha256)
      throw new Error(`主题 ${theme.id} 的 CSS 大小或 SHA-256 与目录不一致。`);
    if (!preview.length || preview.length > 256 * 1024)
      throw new Error(`主题 ${theme.id} 的预览图无效或过大。`);
  }
  if (
    packageVersion &&
    catalog.themes.some(
      (theme) => compareVersions(packageVersion, theme.minimumAppVersion) < 0,
    )
  )
    throw new Error("主题目录含有高于当前应用版本的主题条目。");
  return true;
}

if (require.main === module) {
  const packageVersion = require("../package.json").version;
  const catalog = JSON.parse(
    fs.readFileSync("public/theme-catalog-v1.json", "utf8"),
  );
  verifyThemeCatalog(catalog, packageVersion);
  process.stdout.write(`Verified ${catalog.themes.length} curated themes.\n`);
}

module.exports = { verifyThemeCatalog };
