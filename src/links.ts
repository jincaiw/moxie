import { Lexer, marked } from "marked";
import DOMPurify from "dompurify";
import type { Text } from "@codemirror/state";
import { headings } from "./data";
const definitions = new WeakMap<Text, ReturnType<typeof Lexer.lex>["links"]>();
export function markdownLink(raw: string, document: Text) {
  const lexer = new Lexer();
  if (/\]\s*(?:\[|$)/.test(raw)) {
    let refs = definitions.get(document);
    if (!refs) {
      refs = Lexer.lex(document.toString()).links;
      definitions.set(document, refs);
    }
    lexer.tokens.links = refs;
  }
  const tokens = lexer.inlineTokens(raw);
  if (tokens.length !== 1 || tokens[0].type !== "link") return null;
  const link = tokens[0];
  return { href: link.href, label: link.text };
}
export function markdownImage(raw: string, document: Text) {
  const inline = /^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)$/.exec(raw);
  if (inline) return { src: inline[2], alt: inline[1] };

  const reference = /^!\[([^\]]*)\](?:\[([^\]]*)\])?$/.exec(raw);
  if (!reference) return null;
  let refs = definitions.get(document);
  if (!refs) {
    refs = Lexer.lex(document.toString()).links;
    definitions.set(document, refs);
  }
  const label = (reference[2] || reference[1])
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  const definition = refs[label];
  return definition ? { src: definition.href, alt: reference[1] } : null;
}
export function htmlImage(raw: string) {
  if (!/^<img\b[^>]*>$/i.test(raw)) return null;
  const sourceAttribute = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
    raw,
  );
  if (!sourceAttribute) return null;
  const template = document.createElement("template");
  template.innerHTML = raw;
  const image = template.content.firstElementChild;
  if (
    template.content.childElementCount !== 1 ||
    image?.tagName !== "IMG" ||
    !image.getAttribute("src")
  )
    return null;
  const rawSource =
    sourceAttribute[1] ?? sourceAttribute[2] ?? sourceAttribute[3];
  const start =
    sourceAttribute.index + sourceAttribute[0].lastIndexOf(rawSource);
  return {
    src: image.getAttribute("src")!,
    alt: image.getAttribute("alt") || "",
    start,
    end: start + rawSource.length,
  };
}
export function usableLink(href: string) {
  return (
    href.length <= 8192 &&
    !/[\u0000-\u001f\u007f]/.test(href) &&
    !href.startsWith("//") &&
    (!/^[a-z][a-z0-9+.-]*:/i.test(href) || /^(https?:|mailto:)/i.test(href))
  );
}
export function headingSlug(title: string) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}
export function headingTarget(text: string, anchor: string) {
  const used = new Map<string, number>();
  return headings(text).find((heading) => {
    const element = document.createElement("span");
    element.innerHTML = DOMPurify.sanitize(
      marked.parseInline(heading.title, { async: false }) as string,
    );
    const base = headingSlug(element.textContent || ""),
      number = used.get(base) || 0;
    used.set(base, number + 1);
    const id = number ? `${base}-${number}` : base;
    return id === anchor.toLowerCase() || heading.title === anchor;
  });
}
