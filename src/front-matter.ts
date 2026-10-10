import { JSON_SCHEMA, load as loadYAML } from "js-yaml";
import { parseDocument, YAMLMap } from "yaml";

export type FrontMatter = {
  body: string;
  metadata: Record<string, unknown>;
};

export function parseFrontMatter(source: string): FrontMatter | null {
  const normalized = source.replace(/\r\n?/g, "\n").replace(/^\uFEFF/, "");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") return null;
  const closing = lines.findIndex(
    (line, index) => index > 0 && (line === "---" || line === "..."),
  );
  if (closing < 0) return null;
  const rawMetadata = lines.slice(1, closing).join("\n");
  if (new TextEncoder().encode(rawMetadata).byteLength > 64 * 1024) return null;
  try {
    const value = loadYAML(rawMetadata, { schema: JSON_SCHEMA });
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      return null;
    return {
      body: lines.slice(closing + 1).join("\n"),
      metadata: value as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

/** End offset in the original source, preserving BOM and line endings. */
export function frontMatterEnd(source: string): number {
  if (!parseFrontMatter(source)) return 0;
  return (
    /^(?:\uFEFF)?---(?:\r\n?|\n)[\s\S]*?(?:\r\n?|\n)(?:---|\.\.\.)(?:(?:\r\n?|\n)|$)/.exec(
      source,
    )?.[0].length || 0
  );
}

export type EditableDocumentMetadata = {
  title: string;
  author: string;
  description: string;
  keywords: string;
  subject: string;
  creator: string;
};

export function updateDocumentMetadata(
  source: string,
  metadata: EditableDocumentMetadata,
) {
  const hasBOM = source.startsWith("\uFEFF");
  const content = hasBOM ? source.slice(1) : source;
  const existing = content.match(
    /^---(\r\n|\n|\r)([\s\S]*?)(\r\n|\n|\r)(---|\.\.\.)(?:(\r\n|\n|\r)|$)/,
  );
  if (
    !existing &&
    Object.values(metadata).every((value) => value.trim().length === 0)
  )
    return source;
  const lineEnding = existing?.[1] || content.match(/\r\n|\r|\n/)?.[0] || "\n";
  const document = parseDocument(existing?.[2] || "", {
    schema: "core",
    uniqueKeys: true,
  });
  if (document.errors.length)
    throw new Error("YAML 文档属性格式无效，请先修复顶部 Front Matter。");
  if (document.contents && !(document.contents instanceof YAMLMap))
    throw new Error("文档属性必须使用 YAML 键值对象格式。");

  for (const key of [
    "title",
    "author",
    "description",
    "subject",
    "creator",
  ] as const) {
    const value = metadata[key].trim();
    if (value) document.set(key, value);
    else document.delete(key);
  }
  const keywordKey =
    document.has("keywords") || !document.has("tags") ? "keywords" : "tags";
  const keywords = metadata.keywords
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  if (keywords.length) {
    document.set(keywordKey, keywords);
  } else {
    document.delete(keywordKey);
  }

  const yaml = document
    .toString()
    .replace(/\n/g, lineEnding)
    .replace(/(?:\r\n|\r|\n)+$/, "");
  const body = existing ? content.slice(existing[0].length) : content;
  const prefix = existing
    ? `---${lineEnding}${yaml}${lineEnding}---${existing[5] || ""}`
    : `---${lineEnding}${yaml}${lineEnding}---${lineEnding}`;
  return `${hasBOM ? "\uFEFF" : ""}${prefix}${body}`;
}
