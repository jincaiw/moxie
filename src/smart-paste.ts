import DOMPurify from "dompurify";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/** Clipboard HTML is untrusted. Strip active content before converting it. */
export function clipboardMarkdown(html: string): string | null {
  if (!html || html.length > 5 * 1024 * 1024) return null;
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "form", "input"],
    FORBID_ATTR: ["style"],
  });
  const document = new DOMParser().parseFromString(clean, "text/html");
  document.querySelectorAll("a[href], img[src]").forEach((node) => {
    const attribute = node.tagName === "A" ? "href" : "src";
    if (!safeURL(node.getAttribute(attribute))) node.removeAttribute(attribute);
  });
  document.querySelectorAll("table").forEach((table) => {
    if (!table.rows.length) table.remove();
  });
  const converter = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  converter.use(gfm);
  converter.addRule("tableCells", {
    filter: ["td", "th"],
    replacement: (content, node) => {
      const cell = node as HTMLTableCellElement;
      const text = content
        .trim()
        .replace(/\|/g, "\\|")
        .replace(/[ \t]*\n+/g, "<br>");
      return `${cell.cellIndex === 0 ? "| " : " "}${text} |`;
    },
  });
  converter.addRule("strike", {
    filter: (node) => ["DEL", "S", "STRIKE"].includes(node.nodeName),
    replacement: (content) => `~~${content}~~`,
  });
  // Never import local files, inline data or executable links from clipboard HTML.
  converter.addRule("safeLinks", {
    filter: (node) =>
      node.nodeName === "A" && !safeURL(node.getAttribute("href")),
    replacement: (content) => content,
  });
  converter.addRule("safeImages", {
    filter: (node) =>
      node.nodeName === "IMG" && !safeURL(node.getAttribute("src")),
    replacement: (_content, node) =>
      (node as HTMLElement).getAttribute("alt") || "",
  });
  const markdown = converter.turndown(document.body);
  return markdown.trim() ? markdown : null;
}

function safeURL(value: string | null): boolean {
  return !!value && /^(https?:\/\/|mailto:|#)/i.test(value.trim());
}
