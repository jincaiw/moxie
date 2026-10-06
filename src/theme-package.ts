import { themeCSSError } from "./theme-css";
import DOMPurify from "dompurify";

const packageLimit = 96 * 1024;
const mimeTypes: Record<string, string> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  woff: "application/font-woff",
  woff2: "font/woff2",
};

function normalizedPath(path: string) {
  const result: string[] = [];
  for (const part of path.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!result.length)
        throw new Error("主题资源不能引用主题文件夹之外的文件。");
      result.pop();
    } else result.push(part);
  }
  return result.join("/");
}

function resolveResource(base: string, reference: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(reference.trim());
  } catch {
    throw new Error(`主题资源路径编码无效：${reference}`);
  }
  if (
    !decoded ||
    /^[a-z][a-z\d+.-]*:/i.test(decoded) ||
    decoded.startsWith("/")
  )
    throw new Error(`主题资源必须使用包内相对路径：${reference}`);
  return normalizedPath(`${base}/${decoded}`);
}

export async function importThemePackage(files: File[]) {
  if (!files.length) throw new Error("主题包为空。");
  if (files.length > 128) throw new Error("主题包文件数不能超过 128 个。");
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  if (totalSize > packageLimit) throw new Error("主题包总大小不能超过 96 KB。");

  const paths = files.map((file) =>
    normalizedPath(file.webkitRelativePath || file.name),
  );
  const stylesheets = files
    .map((file, index) => ({ file, path: paths[index] }))
    .filter(({ path }) => /\.css$/i.test(path));
  if (stylesheets.length !== 1)
    throw new Error("主题包必须且只能包含一个 CSS 文件。");

  const stylesheet = stylesheets[0];
  const root = paths[0].includes("/") ? paths[0].split("/")[0] : "";
  const cssDirectory = stylesheet.path.split("/").slice(0, -1).join("/");
  const assets = new Map<string, File>();
  files.forEach((file, index) => {
    const path = paths[index];
    if (path === stylesheet.path) return;
    const extension = path.split(".").pop()?.toLowerCase() || "";
    if (!mimeTypes[extension])
      throw new Error(`主题包包含不支持的资源类型：${path}`);
    const key =
      root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
    if (assets.has(key)) throw new Error(`主题包中有重复资源：${path}`);
    assets.set(key, file);
  });
  const embeddedAssets = new Map<string, string>();
  for (const [path, file] of assets) {
    const extension = path.split(".").pop()?.toLowerCase() || "";
    const bytes =
      extension === "svg"
        ? new TextEncoder().encode(
            DOMPurify.sanitize(await file.text(), {
              USE_PROFILES: { svg: true },
              FORBID_TAGS: [
                "script",
                "foreignObject",
                "style",
                "iframe",
                "object",
                "embed",
                "animate",
                "animateTransform",
                "set",
              ],
              FORBID_ATTR: ["style", "href", "xlink:href"],
            }),
          )
        : new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    embeddedAssets.set(
      path,
      `data:${mimeTypes[extension]};base64,${btoa(binary)}`,
    );
  }

  let css = await stylesheet.file.text();
  if (/@import\b/i.test(css)) throw new Error("主题 CSS 不支持 @import。");
  css = css.replace(
    /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    (_match, double, single, bare) => {
      const reference = String(double ?? single ?? bare ?? "").trim();
      const key = resolveResource(cssDirectory, reference);
      const relativeKey =
        root && key.startsWith(`${root}/`) ? key.slice(root.length + 1) : key;
      const embedded = embeddedAssets.get(relativeKey);
      if (!embedded) throw new Error(`主题包缺少资源：${reference}`);
      return `url("${embedded}")`;
    },
  );
  const error = themeCSSError(css);
  if (error) throw new Error(error);
  return css;
}
