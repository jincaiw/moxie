import { JSON_SCHEMA, load as loadYAML } from "js-yaml";

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
