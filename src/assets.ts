import type { DocumentFile } from "./data";
import { lineBoundsAt } from "./data";
import { parser } from "@lezer/markdown";
import {
  htmlImages,
  markdownImageDestination,
  markdownImageEnd,
} from "./links";
import { parseFrontMatter } from "./front-matter";

export const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export async function imageSource(
  file: File,
  documentPath?: string,
  targetDirectory?: string,
): Promise<string> {
  if (!imageTypes.has(file.type))
    throw new Error("支持 PNG、JPEG、GIF 和 WebP 图片。");
  if (file.size > 10 * 1024 * 1024) throw new Error("单张图片不能超过 10 MB。");
  if (window.desktop && documentPath) {
    const stored = await window.desktop.storeImage({
      documentPath,
      bytes: new Uint8Array(await file.arrayBuffer()),
      targetDirectory,
    });
    return stored.relativePath.split("/").map(encodeURIComponent).join("/");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("无法读取图片。"));
    reader.readAsDataURL(file);
  });
}
export async function resolveImage(
  src: string,
  documentPath?: string,
): Promise<string> {
  if (/^(https:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/i.test(src))
    return src;
  if (window.desktop && documentPath && !/^[a-z][a-z0-9+.-]*:/i.test(src))
    return window.desktop.readImage({
      documentPath,
      relativePath: decodeURIComponent(src),
    });
  throw new Error("无法读取图片，请检查路径或重新打开文档。");
}
export async function rehomeImages(
  text: string,
  oldPath: string,
  newPath: string,
): Promise<string> {
  if (!window.desktop || oldPath === newPath) return text;
  const matches: { src: string; start: number; end: number }[] = [];
  const imageReferences = new Set<string>();
  const linkReferenceDefinitions: { raw: string; from: number }[] = [];
  // Keep parser offsets stable while letting Lezer split classic Mac lines.
  const parserText = text.replace(/\r(?!\n)/g, "\n");
  parser.parse(parserText).iterate({
    enter(node) {
      const raw = text.slice(node.from, node.to);
      if (node.name === "Image") {
        let imageRaw = raw;
        let inline = markdownImageDestination(imageRaw);
        if (!inline) {
          const lineEnd = lineBoundsAt(text, node.from).to;
          const rawLine = text.slice(node.from, lineEnd);
          const imageLength = markdownImageEnd(rawLine);
          const candidate = imageLength ? rawLine.slice(0, imageLength) : "";
          if (/[ \t]+=\d*x\d*\)$/.test(candidate)) {
            imageRaw = candidate;
            inline = markdownImageDestination(imageRaw);
          }
        }
        if (inline) {
          const source = imageRaw
            .slice(inline.start, inline.end)
            .replace(/\\([\\()])/g, "$1");
          matches.push({
            src: source,
            start: node.from + inline.start,
            end: node.from + inline.end,
          });
          return;
        }
        const reference = /^!\[([^\]]*)\](?:\[([^\]]*)\])?$/.exec(raw);
        if (reference) {
          imageReferences.add(
            (reference[2] || reference[1])
              .trim()
              .replace(/\s+/g, " ")
              .toLowerCase(),
          );
        }
      } else if (node.name === "LinkReference") {
        linkReferenceDefinitions.push({ raw, from: node.from });
      } else if (node.name === "HTMLTag" || node.name === "HTMLBlock") {
        const trimmed = raw.trim();
        const images = htmlImages(trimmed);
        if (!images.length) return;
        const leading = raw.indexOf(trimmed);
        for (const image of images)
          matches.push({
            src: image.src,
            start: node.from + leading + image.start,
            end: node.from + leading + image.end,
          });
      }
    },
  });
  for (const { raw, from } of linkReferenceDefinitions) {
    const reference = /^\[([^\]]+)\]:[ \t]*(<[^>]+>|\S+)/.exec(raw);
    if (!reference) continue;
    const label = reference[1].trim().replace(/\s+/g, " ").toLowerCase();
    if (!imageReferences.has(label)) continue;
    const target = reference[2];
    matches.push({
      src: target.startsWith("<") ? target.slice(1, -1) : target,
      start: from + reference.index + reference[0].indexOf(target),
      end:
        from + reference.index + reference[0].indexOf(target) + target.length,
    });
  }
  matches.sort((a, b) => b.start - a.start);
  for (const match of matches) {
    const src = match.src;
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
    const data = await resolveImage(src, oldPath);
    const bytes = Uint8Array.from(
      atob(data.slice(data.indexOf(",") + 1)),
      (c) => c.charCodeAt(0),
    );
    const stored = await window.desktop.storeImage({
      documentPath: newPath,
      bytes,
    });
    const encoded = stored.relativePath
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    text = text.slice(0, match.start) + encoded + text.slice(match.end);
  }
  return text;
}
export async function downloadRemoteImages(
  text: string,
  documentPath?: string,
) {
  if (!window.desktop?.downloadRemoteImage || !documentPath)
    throw new Error("请在桌面版打开并保存文档后下载远程图片。");
  const matches: { url: string; start: number; end: number }[] = [];
  const imageReferences = new Set<string>();
  const definitions: { raw: string; from: number }[] = [];
  const parserText = text.replace(/\r(?!\n)/g, "\n");
  parser.parse(parserText).iterate({
    enter(node) {
      const raw = text.slice(node.from, node.to);
      if (node.name === "Image") {
        let sourceRaw = raw;
        let destination = markdownImageDestination(sourceRaw);
        if (!destination) {
          const lineEnd = lineBoundsAt(text, node.from).to;
          const line = text.slice(node.from, lineEnd);
          const imageLength = markdownImageEnd(line);
          const candidate = imageLength ? line.slice(0, imageLength) : "";
          if (/[ \t]+=\d*x\d*\)$/.test(candidate)) {
            sourceRaw = candidate;
            destination = markdownImageDestination(sourceRaw);
          }
        }
        if (destination) {
          const url = sourceRaw
            .slice(destination.start, destination.end)
            .replace(/\\([\\()])/g, "$1");
          if (/^https:\/\//i.test(url))
            matches.push({
              url,
              start: node.from + destination.start,
              end: node.from + destination.end,
            });
          return;
        }
        const reference = /^!\[([^\]]*)\](?:\[([^\]]*)\])?$/.exec(raw);
        if (reference)
          imageReferences.add(
            (reference[2] || reference[1])
              .trim()
              .replace(/\s+/g, " ")
              .toLowerCase(),
          );
      } else if (node.name === "LinkReference") {
        definitions.push({ raw, from: node.from });
      } else if (node.name === "HTMLTag" || node.name === "HTMLBlock") {
        const trimmed = raw.trim();
        const images = htmlImages(trimmed).filter((image) =>
          /^https:\/\//i.test(image.src),
        );
        if (!images.length) return;
        const leading = raw.indexOf(trimmed);
        for (const image of images)
          matches.push({
            url: image.src,
            start: node.from + leading + image.start,
            end: node.from + leading + image.end,
          });
      }
    },
  });
  for (const { raw, from } of definitions) {
    const reference = /^\[([^\]]+)\]:[ \t]*(<[^>]+>|\S+)/.exec(raw);
    if (!reference) continue;
    const label = reference[1].trim().replace(/\s+/g, " ").toLowerCase();
    if (!imageReferences.has(label)) continue;
    const target = reference[2];
    const url = target.startsWith("<") ? target.slice(1, -1) : target;
    if (!/^https:\/\//i.test(url)) continue;
    const offset = from + reference.index + reference[0].indexOf(target);
    matches.push({
      url,
      start: offset + (target.startsWith("<") ? 1 : 0),
      end: offset + target.length - (target.startsWith("<") ? 1 : 0),
    });
  }
  if (matches.length > 100) throw new Error("单次最多下载 100 张远程图片。");
  const targetValue = parseFrontMatter(text)?.metadata["typora-copy-images-to"];
  const targetDirectory =
    typeof targetValue === "string"
      ? targetValue.trim() || undefined
      : undefined;
  const replacements = new Map<string, string>();
  let failed = 0;
  for (const url of new Set(matches.map((match) => match.url))) {
    try {
      const stored = await window.desktop.downloadRemoteImage({
        documentPath,
        url,
        targetDirectory,
      });
      replacements.set(
        url,
        stored.relativePath.split("/").map(encodeURIComponent).join("/"),
      );
    } catch {
      failed++;
    }
  }
  const updates = matches
    .filter((match) => replacements.has(match.url))
    .sort((a, b) => b.start - a.start);
  for (const match of updates)
    text =
      text.slice(0, match.start) +
      replacements.get(match.url)! +
      text.slice(match.end);
  return {
    text,
    downloaded: replacements.size,
    failed,
    found: new Set(matches.map((match) => match.url)).size,
  };
}
export async function manageLocalImages(
  text: string,
  documentPath: string | undefined,
  targetDirectory: string,
  mode: "copy" | "move",
) {
  if (!window.desktop?.manageImage || !documentPath)
    throw new Error("请在桌面版打开并保存文档后管理图片。");
  const matches: { url: string; start: number; end: number }[] = [];
  const imageReferences = new Set<string>();
  const definitions: { raw: string; from: number }[] = [];
  const parserText = text.replace(/\r(?!\n)/g, "\n");
  parser.parse(parserText).iterate({
    enter(node) {
      const raw = text.slice(node.from, node.to);
      if (node.name === "Image") {
        let sourceRaw = raw;
        let destination = markdownImageDestination(sourceRaw);
        if (!destination) {
          const lineEnd = lineBoundsAt(text, node.from).to;
          const line = text.slice(node.from, lineEnd);
          const imageLength = markdownImageEnd(line);
          const candidate = imageLength ? line.slice(0, imageLength) : "";
          if (/[ \t]+=\d*x\d*\)$/.test(candidate)) {
            sourceRaw = candidate;
            destination = markdownImageDestination(sourceRaw);
          }
        }
        if (destination) {
          const url = sourceRaw
            .slice(destination.start, destination.end)
            .replace(/\\([\\()])/g, "$1");
          if (url && !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith("/"))
            matches.push({
              url,
              start: node.from + destination.start,
              end: node.from + destination.end,
            });
          return;
        }
        const reference = /^!\[([^\]]*)\](?:\[([^\]]*)\])?$/.exec(raw);
        if (reference)
          imageReferences.add(
            (reference[2] || reference[1])
              .trim()
              .replace(/\s+/g, " ")
              .toLowerCase(),
          );
      } else if (node.name === "LinkReference") {
        definitions.push({ raw, from: node.from });
      } else if (node.name === "HTMLTag" || node.name === "HTMLBlock") {
        const trimmed = raw.trim();
        const images = htmlImages(trimmed).filter(
          (image) =>
            !/^[a-z][a-z0-9+.-]*:/i.test(image.src) &&
            !image.src.startsWith("/"),
        );
        if (!images.length) return;
        const leading = raw.indexOf(trimmed);
        for (const image of images)
          matches.push({
            url: image.src,
            start: node.from + leading + image.start,
            end: node.from + leading + image.end,
          });
      }
    },
  });
  for (const { raw, from } of definitions) {
    const reference = /^\[([^\]]+)\]:[ \t]*(<[^>]+>|\S+)/.exec(raw);
    if (!reference) continue;
    const label = reference[1].trim().replace(/\s+/g, " ").toLowerCase();
    if (!imageReferences.has(label)) continue;
    const target = reference[2];
    const url = target.startsWith("<") ? target.slice(1, -1) : target;
    if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/"))
      continue;
    const offset = from + reference.index + reference[0].indexOf(target);
    matches.push({
      url,
      start: offset + (target.startsWith("<") ? 1 : 0),
      end: offset + target.length - (target.startsWith("<") ? 1 : 0),
    });
  }
  const sources = new Map<string, string>();
  for (const match of matches) {
    try {
      sources.set(match.url, decodeURIComponent(match.url));
    } catch {
      // Malformed percent escapes remain visible and are skipped.
    }
  }
  if (sources.size > 100) throw new Error("单次最多管理 100 张本地图片。");
  const directory = targetDirectory.trim().replace(/[\\/]+$/, "");
  if (!directory) throw new Error("请输入图片目标文件夹。");
  const replacements = new Map<string, string>();
  const operations: { sourcePath: string; targetPath: string }[] = [];
  let failed = matches.filter((match) => !sources.has(match.url)).length;
  for (const [encoded, sourcePath] of sources) {
    const name = sourcePath.split(/[\\/]/).at(-1)!;
    const targetPath = `${directory}/${name}`;
    try {
      const result = await window.desktop.manageImage({
        documentPath,
        sourcePath,
        targetPath,
        mode,
        avoidCollision: true,
      });
      operations.push({ sourcePath, targetPath: result.relativePath });
      replacements.set(
        encoded,
        result.relativePath.split("/").map(encodeURIComponent).join("/"),
      );
    } catch {
      failed++;
    }
  }
  const updates = matches
    .filter((match) => replacements.has(match.url))
    .sort((a, b) => b.start - a.start);
  for (const match of updates)
    text =
      text.slice(0, match.start) +
      replacements.get(match.url)! +
      text.slice(match.end);
  return {
    text,
    managed: replacements.size,
    failed,
    found: sources.size,
    operations,
  };
}
export function withImages(document: DocumentFile) {
  const value = parseFrontMatter(document.text)?.metadata[
    "typora-copy-images-to"
  ];
  const targetDirectory =
    typeof value === "string" ? value.trim() || undefined : undefined;
  return async (files: File[]) => {
    const sources = await Promise.all(
      files.map((file) => imageSource(file, document.path, targetDirectory)),
    );
    return files
      .map(
        (file, i) =>
          `![${file.name.replace(/[\[\]\\\r\n]/g, "")}](${sources[i]})`,
      )
      .join("\n\n");
  };
}
