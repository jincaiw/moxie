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
  const sizing = markdownImageSizing(raw);
  const source = sizing?.raw || raw;
  const lexer = new Lexer();
  if (/\]\s*(?:\[|$)/.test(source)) {
    let refs = definitions.get(document);
    if (!refs) {
      refs = Lexer.lex(document.toString()).links;
      definitions.set(document, refs);
    }
    lexer.tokens.links = refs;
  }
  const tokens = lexer.inlineTokens(source);
  if (tokens.length !== 1 || tokens[0].type !== "image") return null;
  const image = tokens[0];
  return {
    src: image.href,
    alt: image.text,
    ...(sizing && { width: sizing.width, height: sizing.height }),
  };
}

export function markdownImageSizing(raw: string) {
  const match = /[ \t]+=(\d*)x(\d*)\)$/.exec(raw);
  if (!match || (!match[1] && !match[2])) return null;
  const width = match[1] ? Number(match[1]) : undefined;
  const height = match[2] ? Number(match[2]) : undefined;
  if (
    (width !== undefined &&
      (!Number.isInteger(width) || width < 1 || width > 4096)) ||
    (height !== undefined &&
      (!Number.isInteger(height) || height < 1 || height > 4096))
  )
    return null;
  return {
    raw: raw.slice(0, match.index) + ")",
    width,
    height,
  };
}

export function markdownImageEnd(raw: string) {
  if (!raw.startsWith("![")) return null;
  let brackets = 0;
  let labelEnd = -1;
  for (let index = 2; index < raw.length; index++) {
    if (raw[index] === "\\") {
      index++;
      continue;
    }
    if (raw[index] === "[") brackets++;
    else if (raw[index] === "]") {
      if (brackets === 0) {
        labelEnd = index;
        break;
      }
      brackets--;
    }
  }
  if (labelEnd < 0 || raw[labelEnd + 1] !== "(") return null;
  let parentheses = 0;
  let angleDestination = false;
  for (let index = labelEnd + 2; index < raw.length; index++) {
    if (raw[index] === "\\") {
      index++;
      continue;
    }
    if (raw[index] === "<" && index === labelEnd + 2) angleDestination = true;
    else if (raw[index] === ">" && angleDestination) angleDestination = false;
    else if (!angleDestination && raw[index] === "(") parentheses++;
    else if (!angleDestination && raw[index] === ")") {
      if (parentheses === 0) return index + 1;
      parentheses--;
    }
  }
  return null;
}

export function markdownImageDestination(raw: string) {
  const sizing = markdownImageSizing(raw);
  if (sizing) raw = sizing.raw;
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
export function htmlImages(raw: string) {
  const images: { src: string; alt: string; start: number; end: number }[] = [];
  const lower = raw.toLowerCase();
  const rawTextElements = new Set([
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "plaintext",
  ]);
  let cursor = 0;
  while (cursor < raw.length) {
    if (raw.startsWith("<!--", cursor)) {
      const end = raw.indexOf("-->", cursor + 4);
      cursor = end < 0 ? raw.length : end + 3;
      continue;
    }
    if (raw[cursor] !== "<") {
      cursor++;
      continue;
    }
    const opening = /^<([a-z][a-z\d:-]*)\b/i.exec(raw.slice(cursor));
    if (!opening) {
      cursor++;
      continue;
    }
    const tagName = opening[1].toLowerCase();
    const tagStart = cursor;
    const nameEnd = cursor + opening[0].length;
    let quote = "";
    let end = nameEnd;
    for (; end < raw.length; end++) {
      const character = raw[end];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end >= raw.length) break;
    const tag = raw.slice(tagStart, end + 1);
    if (tagName === "img") {
      const image = htmlImage(tag);
      if (image)
        images.push({
          ...image,
          start: tagStart + image.start,
          end: tagStart + image.end,
        });
    }
    if (tagName === "img" || tagName === "source") {
      const sourceSet =
        /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
      if (sourceSet) {
        const rawValue = sourceSet[1] ?? sourceSet[2] ?? sourceSet[3];
        const valueStart = sourceSet.index + sourceSet[0].lastIndexOf(rawValue);
        const decoded = document.createElement("textarea");
        let position = 0;
        while (position < rawValue.length) {
          while (position < rawValue.length && /[\s,]/.test(rawValue[position]))
            position++;
          const start = position;
          while (position < rawValue.length && !/\s/.test(rawValue[position]))
            position++;
          let urlEnd = position;
          while (urlEnd > start && rawValue[urlEnd - 1] === ",") urlEnd--;
          const rawURL = rawValue.slice(start, urlEnd);
          if (rawURL) {
            decoded.innerHTML = rawURL;
            images.push({
              src: decoded.value,
              alt: "",
              start: tagStart + valueStart + start,
              end: tagStart + valueStart + urlEnd,
            });
          }
          if (urlEnd < position) continue;
          while (position < rawValue.length && rawValue[position] !== ",")
            position++;
          if (rawValue[position] === ",") position++;
        }
      }
    }
    cursor = end + 1;
    if (rawTextElements.has(tagName)) {
      if (tagName === "plaintext") break;
      const closing = lower.indexOf(`</${tagName}`, cursor);
      if (closing < 0) break;
      cursor = closing;
    }
  }
  return images;
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
export function headingElementIsHidden(element: Element) {
  let current: Element | null = element;
  while (current) {
    const style = (current as HTMLElement).style;
    if (
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden")?.toLowerCase() === "true" ||
      style.display.toLowerCase() === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden" ||
      current.matches("details:not([open]), dialog:not([open]), [popover]")
    )
      return true;
    current = current.parentElement;
  }
  return false;
}
export function visibleHeadingText(element: Element) {
  let text = "";
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || "";
      return;
    }
    if (!(node instanceof Element) || headingElementIsHidden(node)) return;
    if (node.tagName === "BR") {
      text += " ";
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(element);
  return text;
}
export function headingLabel(source: string) {
  const codeSpans = new Map<string, string>();
  const protectedSource = source.replace(
    /(`+)([\s\S]*?)(?<!`)\1(?!`)/g,
    (raw) => {
      const tokens = Lexer.lexInline(raw);
      const code = tokens.find((token) => token.type === "codespan");
      if (!code || code.type !== "codespan") return raw;
      let placeholder = `MOXIECODESPAN${codeSpans.size}TOKEN`;
      while (source.includes(placeholder) || codeSpans.has(placeholder)) {
        placeholder = placeholder.replace("TOKEN", "XTOKEN");
      }
      codeSpans.set(placeholder, code.text);
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
  let visibleText = visibleHeadingText(element);
  for (const [placeholder, code] of codeSpans) {
    visibleText = visibleText.split(placeholder).join(code);
  }
  return visibleText;
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
