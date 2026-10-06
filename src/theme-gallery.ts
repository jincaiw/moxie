import { fetchThemeResource } from "./bridge";
import { THEME_CSS_LIMIT, themeCSSError } from "./theme-css";

export const THEME_CATALOG_URL =
  "https://raw.githubusercontent.com/jincaiw/moxie/main/public/theme-catalog-v1.json";
const releaseBase = "https://github.com/jincaiw/moxie/releases/download/";

export type GalleryTheme = {
  id: string;
  name: string;
  description: string;
  author: string;
  license: string;
  sourceUrl: string;
  previewUrl: string;
  version: string;
  releaseVersion: string;
  minimumAppVersion: string;
  packageUrl: string;
  sha256: string;
  size: number;
  appearance: "light" | "dark" | "paper";
};

export type ThemeCatalog = {
  schemaVersion: 1;
  version: string;
  generatedAt: string;
  themes: GalleryTheme[];
  withdrawnThemes: { id: string; reason: string }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validVersion = (value: unknown) =>
  typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);

const compareVersions = (left: string, right: string) => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
};

export function validateThemeCatalog(input: unknown): ThemeCatalog {
  if (
    !isRecord(input) ||
    input.schemaVersion !== 1 ||
    !validVersion(input.version) ||
    typeof input.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(input.generatedAt)) ||
    !Array.isArray(input.themes) ||
    input.themes.length > 50
  )
    throw new Error("主题目录格式无效或版本不受支持。");

  const ids = new Set<string>();
  const themes = input.themes.map((entry): GalleryTheme => {
    if (!isRecord(entry)) throw new Error("主题目录包含无效条目。");
    const fields = [
      "id",
      "name",
      "description",
      "author",
      "license",
      "sourceUrl",
      "previewUrl",
      "version",
      "minimumAppVersion",
      "releaseVersion",
      "packageUrl",
      "sha256",
    ] as const;
    if (
      fields.some((field) => typeof entry[field] !== "string") ||
      !validVersion(entry.version) ||
      !validVersion(entry.minimumAppVersion) ||
      !validVersion(entry.releaseVersion) ||
      !/^[a-z0-9][a-z0-9-]{1,39}$/.test(entry.id as string) ||
      ids.has(entry.id as string) ||
      !(entry.name as string).trim() ||
      (entry.name as string).length > 60 ||
      (entry.description as string).length > 240 ||
      !(entry.author as string).trim() ||
      (entry.author as string).length > 80 ||
      !(entry.license as string).trim() ||
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/.test(
        entry.sourceUrl as string,
      ) ||
      !["light", "dark", "paper"].includes(entry.appearance as string) ||
      !/^[a-f\d]{64}$/i.test(entry.sha256 as string) ||
      !Number.isInteger(entry.size) ||
      (entry.size as number) < 1 ||
      (entry.size as number) > THEME_CSS_LIMIT
    )
      throw new Error("主题目录包含字段无效或超出限制的条目。");
    const versionPath = `${releaseBase}v${entry.releaseVersion}/theme-${entry.id}`;
    if (
      entry.packageUrl !== `${versionPath}.css` ||
      entry.previewUrl !== `${versionPath}.svg`
    )
      throw new Error("主题下载地址必须来自 Moxie 官方 Release。");
    ids.add(entry.id as string);
    return entry as unknown as GalleryTheme;
  });

  const withdrawnInput = input.withdrawnThemes ?? [];
  if (!Array.isArray(withdrawnInput) || withdrawnInput.length > 50)
    throw new Error("主题目录撤回列表无效。");
  const withdrawnIds = new Set<string>();
  const withdrawnThemes = withdrawnInput.map((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,39}$/.test(entry.id) ||
      ids.has(entry.id) ||
      withdrawnIds.has(entry.id) ||
      typeof entry.reason !== "string" ||
      !entry.reason.trim() ||
      entry.reason.length > 180
    )
      throw new Error("主题目录撤回列表包含无效条目。");
    withdrawnIds.add(entry.id);
    return { id: entry.id, reason: entry.reason };
  });

  return {
    schemaVersion: 1,
    version: input.version as string,
    generatedAt: input.generatedAt as string,
    themes,
    withdrawnThemes,
  };
}

export async function loadThemeCatalog(appVersion: string) {
  const text = await fetchThemeResource(THEME_CATALOG_URL);
  if (new TextEncoder().encode(text).byteLength > 128 * 1024)
    throw new Error("主题目录超过 128 KB 限制。");
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("主题目录不是有效的 JSON。");
  }
  const catalog = validateThemeCatalog(input);
  return {
    ...catalog,
    themes: catalog.themes.filter(
      (theme) => compareVersions(appVersion, theme.minimumAppVersion) >= 0,
    ),
  };
}

export async function downloadVerifiedTheme(theme: GalleryTheme) {
  const css = await fetchThemeResource(theme.packageUrl);
  const bytes = new TextEncoder().encode(css);
  if (bytes.byteLength !== theme.size)
    throw new Error("主题文件大小与目录记录不一致。");
  if (bytes.byteLength > THEME_CSS_LIMIT)
    throw new Error("主题 CSS 超过 128 KB。");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (sha256 !== theme.sha256.toLowerCase())
    throw new Error("主题完整性校验失败，文件可能已损坏或被替换。");
  const cssError = themeCSSError(css);
  if (cssError) throw new Error(`主题样式未通过安全检查：${cssError}`);
  return css;
}

export function isThemeCompatible(theme: GalleryTheme, appVersion: string) {
  return compareVersions(appVersion, theme.minimumAppVersion) >= 0;
}
