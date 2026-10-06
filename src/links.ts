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
  return { href: link.href, label: link.text, title: link.title || undefined };
}
export function markdownImage(raw: string, document: Text) {
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
  if (tokens.length !== 1 || tokens[0].type !== "image") return null;
  const image = tokens[0];
  return { src: image.href, alt: image.text };
}

export function markdownImageDestination(raw: string) {
  if (!raw.startsWith("![")) return null;
  let depth = 0;
  let closeLabel = -1;
  for (let index = 2; index < raw.length; index++) {
    if (raw[index] === "\\") {
      index++;
      continue;
    }
    if (raw[index] === "[") depth++;
    else if (raw[index] === "]") {
      if (depth === 0) {
        closeLabel = index;
        break;
      }
      depth--;
    }
  }
  if (closeLabel < 0 || raw[closeLabel + 1] !== "(") return null;
  let start = closeLabel + 2;
  while (/\s/.test(raw[start] || "")) start++;
  if (raw[start] === "<") {
    const destinationStart = start + 1;
    for (let index = destinationStart; index < raw.length; index++) {
      if (raw[index] === "\\") {
        index++;
        continue;
      }
      if (raw[index] === ">") return { start: destinationStart, end: index };
    }
    return null;
  }

  const destinationStart = start;
  let parentheses = 0;
  for (let index = start; index < raw.length; index++) {
    if (raw[index] === "\\") {
      index++;
      continue;
    }
    if (raw[index] === "(") parentheses++;
    else if (raw[index] === ")") {
      if (parentheses === 0) return { start: destinationStart, end: index };
      parentheses--;
    } else if (/\s/.test(raw[index])) return null;
  }
  return null;
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
export function headingLabel(source: string) {
  const codeSpans: string[] = [];
  const protectedSource = source.replace(
    /(`+)([\s\S]*?)(?<!`)\1(?!`)/g,
    (raw) => {
      const tokens = Lexer.lexInline(raw);
      const code = tokens.find((token) => token.type === "codespan");
      if (!code || code.type !== "codespan") return raw;
      const placeholder = `MOXIECODESPAN${codeSpans.length}TOKEN`;
      codeSpans.push(code.text);
      return placeholder;
    },
  );
  // Match the visible text produced by the Moxie inline extensions used by
  // the HTML exporter. Keep the contents and remove only the syntax markers.
  const visibleSource = protectedSource
    .replace(/(?<![=])==(?=\S)(.+?\S)==(?![=])/g, "$1")
    .replace(/(?<![\\^])\^(?=\S)([^\s^]+)\^(?!\^)/g, "$1")
    .replace(/(?<![~\\])~(?=\S)([^\s~]+)~(?!~)/g, "$1")
    .replace(/(?<!\\)\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/g, "$1");
  const element = document.createElement("span");
  element.innerHTML = DOMPurify.sanitize(
    marked.parseInline(visibleSource, { async: false }) as string,
  );
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    walker.currentNode.textContent = (
      walker.currentNode.textContent || ""
    ).replace(
      /MOXIECODESPAN(\d+)TOKEN/g,
      (placeholder, index: string) => codeSpans[Number(index)] ?? placeholder,
    );
  }
  return element.textContent || "";
}
export function headingTarget(text: string, anchor: string) {
  const used = new Map<string, number>();
  return headings(text).find((heading) => {
    const base = headingSlug(headingLabel(heading.title)),
      number = used.get(base) || 0;
    used.set(base, number + 1);
    const id = number ? `${base}-${number}` : base;
    return id === anchor.toLowerCase() || heading.title === anchor;
  });
}
