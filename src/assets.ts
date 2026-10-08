import type { DocumentFile } from "./data";
import { lineBoundsAt } from "./data";
import { parser } from "@lezer/markdown";
import { htmlImage, markdownImageDestination, markdownImageEnd } from "./links";

export const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
export async function imageSource(
  file: File,
  documentPath?: string,
): Promise<string> {
  if (!imageTypes.has(file.type))
    throw new Error("支持 PNG、JPEG、GIF 和 WebP 图片。");
  if (file.size > 10 * 1024 * 1024) throw new Error("单张图片不能超过 10 MB。");
  if (window.desktop && documentPath) {
    const stored = await window.desktop.storeImage({
      documentPath,
      bytes: new Uint8Array(await file.arrayBuffer()),
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
          const rawLine = text.slice(
            node.from,
            lineEnd,
          );
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
        const image = htmlImage(trimmed);
        if (!image) return;
        const leading = raw.indexOf(trimmed);
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
export function withImages(document: DocumentFile) {
  return async (files: File[]) => {
    const sources = await Promise.all(
      files.map((file) => imageSource(file, document.path)),
    );
    return files
      .map(
        (file, i) =>
          `![${file.name.replace(/[\[\]\\\r\n]/g, "")}](${sources[i]})`,
      )
      .join("\n\n");
  };
}
