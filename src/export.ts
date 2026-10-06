import { Lexer, Marked, type MarkedExtension, type Tokens } from "marked";
import DOMPurify from "dompurify";
import { resolveImage } from "./assets";
import { headingSlug } from "./links";
import { renderMermaid } from "./mermaid";
import { inlineMathMatches, renderMath } from "./math";
import { themeCSSError } from "./theme-css";
import type { ThemePreset } from "./preferences";
type FootnoteState = {
  definitions: Map<string, string>;
  numbers: Map<string, number>;
  references: Map<number, number>;
};

function normalizeFootnote(label: string) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function stripMarkdownContainers(line: string) {
  let content = line;
  for (let depth = 0; depth < 12; depth++) {
    content = content.replace(/^ {0,3}/, "");
    if (content.startsWith(">")) {
      content = content.slice(1).replace(/^[ \t]?/, "");
      continue;
    }
    const list = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(content);
    if (list) {
      content = content.slice(list[0].length);
      continue;
    }
    break;
  }
  return content;
}

function markNestedHTMLLines(
  token: Tokens.Generic,
  parentLines: string[],
  parentStart: number,
  htmlLines: Set<number>,
) {
  const structured = token as Tokens.Generic & {
    tokens?: Tokens.Generic[];
    items?: { tokens?: Tokens.Generic[] }[];
  };
  const children = [
    ...(structured.tokens || []),
    ...(structured.items || []).flatMap((item) => item.tokens || []),
  ];
  let cursor = 0;
  for (const child of children) {
    const childLines = child.raw.split("\n");
    const first = stripMarkdownContainers(childLines[0] || "");
    let relativeStart = -1;
    for (let index = cursor; index < parentLines.length; index++) {
      if (stripMarkdownContainers(parentLines[index]) === first) {
        relativeStart = index;
        break;
      }
    }
    if (relativeStart < 0) continue;
    const childStart = parentStart + relativeStart;
    const rawLineCount = (child.raw.match(/\n/g) || []).length;
    if (child.type === "html" && child.block) {
      const coveredLines = rawLineCount + Number(!child.raw.endsWith("\n"));
      for (let line = childStart; line < childStart + coveredLines; line++)
        htmlLines.add(line);
    }
    markNestedHTMLLines(child, childLines, childStart, htmlLines);
    cursor = relativeStart + Math.max(rawLineCount, 1);
  }
}

function extractFootnotes(source: string) {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const htmlLines = new Set<number>();
  let lineOffset = 0;
  for (const token of Lexer.lex(normalized)) {
    const startLine = lineOffset;
    const rawLineCount = token.raw.match(/\n/g)?.length || 0;
    lineOffset += rawLineCount;
    if (token.type === "html" && token.block) {
      const coveredLines = rawLineCount + Number(!token.raw.endsWith("\n"));
      for (let line = startLine; line < startLine + coveredLines; line++)
        htmlLines.add(line);
    } else {
      markNestedHTMLLines(token, token.raw.split("\n"), startLine, htmlLines);
    }
  }
  const remaining: string[] = [];
  const definitions = new Map<string, string>();
  let fence: { character: string; length: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (fence) {
      remaining.push(lines[i]);
      const close = new RegExp(
        `^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`,
      );
      if (close.test(lines[i])) fence = undefined;
      continue;
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines[i]);
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      remaining.push(lines[i]);
      continue;
    }
    if (htmlLines.has(i)) {
      remaining.push(lines[i]);
      continue;
    }
    const match = /^ {0,3}\[\^([^\]]+)\]:[ \t]*(.*)$/.exec(lines[i]);
    if (!match) {
      remaining.push(lines[i]);
      continue;
    }
    const key = normalizeFootnote(match[1]);
    const contents = [match[2]];
    let next = i + 1;
    while (next < lines.length) {
      if (/^(?: {2,}|\t)/.test(lines[next])) {
        contents.push(lines[next].replace(/^(?: {2,}|\t)/, ""));
        next++;
      } else if (
        !lines[next].trim() &&
        next + 1 < lines.length &&
        /^(?: {2,}|\t)/.test(lines[next + 1])
      ) {
        contents.push("");
        next++;
      } else break;
    }
    if (!definitions.has(key)) definitions.set(key, contents.join("\n").trim());
    i = next - 1;
  }
  return { source: remaining.join("\n"), definitions };
}

const mathExtensions: NonNullable<MarkedExtension["extensions"]> = [
  {
    name: "escapedHighlight",
    level: "inline",
    tokenizer(source) {
      const match = /^\\==(?=\S)(.+?\S)==(?![=])/.exec(source);
      if (match)
        return { type: "text", raw: match[0], text: match[0].slice(1) };
    },
  },
  {
    name: "highlight",
    level: "inline",
    start: (source) => source.indexOf("=="),
    tokenizer(source) {
      const match = /^(?<![=])==(?=\S)(.+?\S)==(?![=])/.exec(source);
      if (match)
        return {
          type: "highlight",
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        };
    },
    childTokens: ["tokens"],
    renderer(token) {
      return `<mark>${this.parser.parseInline(token.tokens || [])}</mark>`;
    },
  },
  {
    name: "superscript",
    level: "inline",
    start: (source) => source.indexOf("^"),
    tokenizer(source) {
      const match = /^(?<![\\^])\^(?=\S)([^\s^]+)\^(?!\^)/.exec(source);
      if (match)
        return {
          type: "superscript",
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        };
    },
    childTokens: ["tokens"],
    renderer(token) {
      return `<sup>${this.parser.parseInline(token.tokens || [])}</sup>`;
    },
  },
  {
    name: "subscript",
    level: "inline",
    start: (source) => source.indexOf("~"),
    tokenizer(source) {
      const match = /^(?<![~\\])~(?=\S)([^\s~]+)~(?!~)/.exec(source);
      if (match)
        return {
          type: "subscript",
          raw: match[0],
          text: match[1],
          tokens: this.lexer.inlineTokens(match[1]),
        };
    },
    childTokens: ["tokens"],
    renderer(token) {
      return `<sub>${this.parser.parseInline(token.tokens || [])}</sub>`;
    },
  },
  {
    name: "blockMath",
    level: "block",
    start: (src) => src.indexOf("$$"),
    tokenizer(src) {
      const match = /^\$\$[^\S\n]*\n([\s\S]*?)\n\$\$[^\S\n]*(?:\n|$)/.exec(src);
      if (match) return { type: "blockMath", raw: match[0], text: match[1] };
    },
    renderer(token) {
      return token.raw;
    },
  },
  {
    name: "inlineMath",
    level: "inline",
    start(src) {
      const match = inlineMathMatches(src)[0];
      return match?.from;
    },
    tokenizer(src) {
      const match = inlineMathMatches(src)[0];
      if (match?.from === 0)
        return { type: "inlineMath", raw: match.raw, text: match.text };
    },
    renderer(token) {
      return token.raw;
    },
  },
];

function createParser(footnotes: FootnoteState, enableFootnotes = true) {
  const parser = new Marked();
  parser.use({
    async: true,
    async walkTokens(token) {
      if (token.type === "blockMath" || token.type === "inlineMath") {
        const block = token.type === "blockMath";
        const html = await renderMath(token.text, {
          displayMode: block,
          output: "mathml",
          throwOnError: false,
          trust: false,
        });
        Object.assign(token, { type: "html", text: html, block, pre: false });
        return;
      }
      if (
        token.type !== "code" ||
        token.lang?.trim().split(/\s+/)[0].toLowerCase() !== "mermaid"
      )
        return;
      const svg = await renderMermaid(
        token.text,
        ["dark", "solarized-dark"].includes(
          document.documentElement.dataset.theme || "",
        )
          ? "dark"
          : "default",
      );
      Object.assign(token, {
        type: "html",
        text: `<div class="mermaid-diagram" role="img" aria-label="Mermaid 图表">${svg}</div>`,
        block: true,
        pre: false,
      });
    },
    extensions: [
      ...mathExtensions,
      {
        name: "moxieToc",
        level: "block",
        start(source: string) {
          const match = /^ {0,3}\[TOC\][ \t]*$/im.exec(source);
          return match?.index;
        },
        tokenizer(source: string) {
          const match = /^ {0,3}\[TOC\][ \t]*(?:\n|$)/i.exec(source);
          if (match) return { type: "moxieToc", raw: match[0] };
        },
        renderer(_token: Tokens.Generic) {
          return '<nav class="moxie-toc" aria-label="目录"></nav>';
        },
      },
      ...(enableFootnotes
        ? [
            {
              name: "footnoteReference",
              level: "inline" as const,
              start(source: string) {
                const match = /\[\^([^\]]+)\]/.exec(source);
                return match?.index;
              },
              tokenizer(source: string) {
                const match = /^\[\^([^\]]+)\]/.exec(source);
                if (
                  !match ||
                  !footnotes.definitions.has(normalizeFootnote(match[1]))
                )
                  return;
                return {
                  type: "footnoteReference",
                  raw: match[0],
                  label: match[1],
                };
              },
              renderer(token: Tokens.Generic) {
                const key = normalizeFootnote(token.label || "");
                let number = footnotes.numbers.get(key);
                if (!number) {
                  number = footnotes.numbers.size + 1;
                  footnotes.numbers.set(key, number);
                }
                const occurrence = (footnotes.references.get(number) || 0) + 1;
                footnotes.references.set(number, occurrence);
                return `<sup id="fnref-${number}-${occurrence}" role="doc-noteref"><a href="#fn-${number}">${number}</a></sup>`;
              },
            },
          ]
        : []),
    ],
  });
  return parser;
}
export async function exportHTML(
  text: string,
  name: string,
  documentPath?: string,
  customThemeCSS = "",
  theme: ThemePreset = "light",
) {
  const title = name.replace(/[&<>"']/g, "");
  const palettes: Record<
    ThemePreset,
    {
      bg: string;
      text: string;
      muted: string;
      border: string;
      code: string;
      accent: string;
    }
  > = {
    light: {
      bg: "#fff",
      text: "#22262c",
      muted: "#737b88",
      border: "#e5e7eb",
      code: "#f5f6f8",
      accent: "#557895",
    },
    dark: {
      bg: "#202226",
      text: "#e3e5e9",
      muted: "#9da4af",
      border: "#36393f",
      code: "#292c32",
      accent: "#91bad8",
    },
    sepia: {
      bg: "#fbf5e9",
      text: "#40382d",
      muted: "#81735e",
      border: "#dfd3bf",
      code: "#f1e8d8",
      accent: "#936538",
    },
    "solarized-light": {
      bg: "#fdf6e3",
      text: "#586e75",
      muted: "#839496",
      border: "#e4ddc8",
      code: "#eee8d5",
      accent: "#268bd2",
    },
    "solarized-dark": {
      bg: "#002b36",
      text: "#93a1a1",
      muted: "#657b83",
      border: "#214750",
      code: "#073642",
      accent: "#2aa198",
    },
  };
  const palette = palettes[theme];
  const safeThemeCSS = themeCSSError(customThemeCSS)
    ? ""
    : customThemeCSS.replace(/</g, "\\3C ");
  const extracted = extractFootnotes(text);
  const footnotes: FootnoteState = {
    definitions: extracted.definitions,
    numbers: new Map(),
    references: new Map(),
  };
  const parser = createParser(footnotes);
  let body = await parser.parse(extracted.source, { async: true });
  if (footnotes.numbers.size) {
    const notes = createParser(footnotes, false);
    const items: string[] = [];
    for (const [key, number] of [...footnotes.numbers].sort(
      (a, b) => a[1] - b[1],
    )) {
      const definition = footnotes.definitions.get(key) || "";
      const rendered = await notes.parse(definition, { async: true });
      const backrefs = Array.from(
        { length: footnotes.references.get(number) || 0 },
        (_, index) =>
          ` <a class="footnote-backref" href="#fnref-${number}-${index + 1}" aria-label="返回正文引用">↩</a>`,
      ).join("");
      items.push(
        `<li id="fn-${number}" role="doc-endnote">${rendered}${backrefs}</li>`,
      );
    }
    body += `<section class="footnotes" role="doc-endnotes" aria-label="脚注"><hr><ol>${items.join("")}</ol></section>`;
  }
  body = DOMPurify.sanitize(body);
  const content = document.createElement("div");
  content.innerHTML = body;
  const used = new Map<string, number>();
  content.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((heading) => {
    const base = headingSlug(heading.textContent || ""),
      number = used.get(base) || 0;
    used.set(base, number + 1);
    heading.id = number ? `${base}-${number}` : base;
  });
  content.querySelectorAll<HTMLElement>(".moxie-toc").forEach((nav) => {
    const list = document.createElement("ol");
    content.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((heading) => {
      const item = document.createElement("li");
      item.style.marginInlineStart = `${(Number(heading.tagName.slice(1)) - 1) * 14}px`;
      const link = document.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.textContent || "（无标题）";
      item.append(link);
      list.append(item);
    });
    if (!list.childElementCount) {
      const item = document.createElement("li");
      item.textContent = "尚无标题";
      list.append(item);
    }
    nav.append(list);
  });
  await Promise.all(
    Array.from(content.querySelectorAll("img")).map(async (image) => {
      const src = image.getAttribute("src") || "";
      image.src = await resolveImage(src, documentPath);
    }),
  );
  const styles = `:root{--bg:${palette.bg};--text:${palette.text};--muted:${palette.muted};--border:${palette.border};--code:${palette.code};--accent:${palette.accent}}
body{font:17px/1.8 -apple-system,BlinkMacSystemFont,sans-serif;max-width:760px;margin:50px auto;padding:0 28px;color:var(--text);background:var(--bg)}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid var(--border);padding:8px;text-align:left;overflow-wrap:anywhere}
pre{padding:20px;background:var(--code);white-space:pre-wrap;overflow-wrap:anywhere}
blockquote{border-left:3px solid var(--border);margin-left:0;padding-left:24px;color:var(--muted)}
img{max-width:100%;height:auto}
svg{max-width:100%;height:auto}
.mermaid-diagram{overflow-x:auto;text-align:center;margin:24px 0}
.moxie-toc{border:1px solid var(--border);padding:14px 20px;margin:24px 0}
.moxie-toc ol{margin:0;padding-left:24px}.moxie-toc li{margin:4px 0}
math[display=block]{margin:24px 0}a{color:var(--accent)}
@media print{
  body{margin:0;max-width:none}
  h1,h2,h3,h4,h5,h6{break-after:avoid;page-break-after:avoid}
  table,tr,img,svg,.mermaid-diagram,.moxie-toc,.footnotes{break-inside:avoid;page-break-inside:avoid}
  pre,table{break-inside:auto;page-break-inside:auto}
  pre{white-space:pre-wrap;overflow-wrap:anywhere}
  thead{display:table-header-group}tfoot{display:table-footer-group}
  p{orphans:3;widows:3}
}`;
  const customStyle = safeThemeCSS
    ? `<style id="moxie-export-theme">${safeThemeCSS}</style>`
    : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>${styles}</style>${customStyle}</head><body>${content.innerHTML}</body></html>`;
}
