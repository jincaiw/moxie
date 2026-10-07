import { GFM, parser as markdownParser } from "@lezer/markdown";

export const welcome = `# 欢迎使用墨写

让想法自然成文。

---

## 从这里开始

这是你的本地写作空间。使用 Markdown 记录想法，让排版随文字自然呈现。

1. 尝试输入一些文字，体验即时排版的流畅。
2. 使用侧边栏管理你的文档。
3. 探索右上角的功能，按自己的方式开始写作。

## 为写作留一点空间

> 好的工具，让你专注于内容。

## 常用快捷键

| 操作 | 快捷键 |
| --- | --- |
| 保存文档 | Cmd + S |
| 查找内容 | Cmd + F |
| 切换源码模式 | Cmd + / |
`;
export const guide = `# 写作指南

[TOC]

## 基础格式

用 **粗体** 强调，用 *斜体* 表达，也可以使用 ~~删除线~~ 和 \`行内代码\`。

## 任务清单

- [x] 开始写作
- [ ] 记录一个新想法

## 代码

\`\`\`typescript
const message = "让想法自然成文";
console.log(message);
\`\`\`

## 数学公式

$$
E = mc^2
$$

## Mermaid 图表

\`\`\`mermaid
flowchart LR
  idea[想法] --> draft[草稿]
  draft --> polish[润色]
\`\`\`

## 脚注

脚注可以补充说明[^detail]，也可以在正文中再次引用[^detail]。

[^detail]: 点击编辑器中的上标星号可以跳到脚注定义；HTML 和 PDF 导出会生成可往返跳转的编号脚注。

## 链接

[Markdown 语法参考](https://commonmark.org/help/)

点击表格、公式或图表即可编辑原文。文件保存在本地，浏览器预览版将恢复副本保存在当前浏览器中。
`;
export type DocumentFile = {
  id: string;
  name: string;
  text: string;
  path?: string;
  diskText?: string;
  diskVersion?: string;
  dirty?: boolean;
  group?: string;
};
function markdownContainerContent(line: string) {
  let content = line;
  while (true) {
    const indentation = /^ {0,3}/.exec(content)?.[0].length || 0;
    content = content.slice(indentation);
    if (content.startsWith(">")) {
      content = content.slice(1).replace(/^[ \t]?/, "");
      continue;
    }
    const list = /^((?:[-+*]|\d{1,9}[.)])([ \t]+))/.exec(content);
    if (list) {
      // Excess padding (or a tab) starts indented code inside a list item.
      // Keep the marker so heading-looking code is never added to the outline.
      if (list[2].length > 4 || / +\t/.test(list[2])) return content;
      content = content.slice(list[0].length);
      continue;
    }
    return content;
  }
}
function markdownHeadingUsesListCodeTab(prefix: string) {
  let content = prefix;
  while (true) {
    const indentation = /^ {0,3}/.exec(content)?.[0].length || 0;
    content = content.slice(indentation);
    if (content.startsWith(">")) {
      content = content.slice(1).replace(/^[ \t]?/, "");
      continue;
    }
    const list = /^((?:[-+*]|\d{1,9}[.)])([ \t]+))/.exec(content);
    return Boolean(list && / +\t/.test(list[2]));
  }
}
function htmlHeadingIsHidden(openingTag: string) {
  const style = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(
    openingTag,
  );
  const displayValues = style?.[1] ?? style?.[2] ?? style?.[3] ?? "";
  const declarations: string[] = [];
  let declarationStart = 0;
  let quote = "";
  let escaped = false;
  let inComment = false;
  for (let index = 0; index < displayValues.length; index++) {
    const character = displayValues[index];
    const nextCharacter = displayValues[index + 1];
    if (inComment) {
      if (character === "*" && nextCharacter === "/") {
        inComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      inComment = true;
      index++;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === ";") {
      declarations.push(displayValues.slice(declarationStart, index));
      declarationStart = index + 1;
    }
  }
  declarations.push(displayValues.slice(declarationStart));
  const displayDeclarations = declarations
    .map((declaration) =>
      /^\s*display\s*:\s*([^;]*?)(\s*!important)?\s*$/i.exec(
        declaration.replace(/\/\*[\s\S]*?\*\//g, " "),
      ),
    )
    .filter(Boolean)
    .filter((declaration) => declaration?.[1] !== undefined);
  const displayDeclaration =
    displayDeclarations.filter((declaration) => declaration?.[2]).at(-1) ??
    displayDeclarations.at(-1);
  const display = displayDeclaration?.[1].trim();
  return (
    /\shidden(?:\s|=|\/?>)/i.test(openingTag) ||
    /\baria-hidden\s*=\s*(?:"true"|'true'|true)(?:\s|\/?>)/i.test(openingTag) ||
    display?.toLowerCase() === "none"
  );
}
function htmlElementEnd(source: string, tag: string, openingEnd: number) {
  let depth = 1;
  const tagPattern = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokens = new RegExp(
    `<!--[\\s\\S]*?-->|<plaintext\\b${htmlAttributeSource}>|<(${htmlRawTextElement})\\b${htmlAttributeSource}>|<template\\b${htmlAttributeSource}>|<${tagPattern}\\b${htmlAttributeSource}>|<\\/${tagPattern}\\s*>|<[A-Za-z][\\w:-]*\\b${htmlAttributeSource}>`,
    "gi",
  );
  tokens.lastIndex = openingEnd;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source))) {
    if (match[0].startsWith("<!--")) continue;
    if (/^<plaintext\b/i.test(match[0])) return source.length;
    if (match[1]) {
      const close = new RegExp(`</${match[1]}\\s*>`, "ig");
      close.lastIndex = tokens.lastIndex;
      const closing = close.exec(source);
      if (!closing) return source.length;
      tokens.lastIndex = close.lastIndex;
      continue;
    }
    if (/^<template\b/i.test(match[0])) {
      tokens.lastIndex = htmlTemplateEnd(source, tokens.lastIndex);
    } else if (/^<\//.test(match[0])) {
      if (--depth === 0) return tokens.lastIndex;
    } else if (new RegExp(`^<${tagPattern}\\b`, "i").test(match[0])) {
      depth++;
    }
  }
  return source.length;
}

function scanHtmlHiddenRanges(source: string, offset: number) {
  const ranges: { from: number; to: number }[] = [];
  const voidElements = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  const openings = new RegExp(
    `<!--[\\s\\S]*?-->|<plaintext\\b${htmlAttributeSource}>|<(${htmlRawTextElement})\\b${htmlAttributeSource}>|<template\\b${htmlAttributeSource}>|<([A-Za-z][\\w:-]*)\\b${htmlAttributeSource}>`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = openings.exec(source))) {
    if (match[0].startsWith("<!--")) continue;
    if (/^<plaintext\b/i.test(match[0])) break;
    const rawTag = match[1];
    if (rawTag) {
      const close = new RegExp(`</${rawTag}\\s*>`, "ig");
      close.lastIndex = openings.lastIndex;
      const closing = close.exec(source);
      openings.lastIndex = closing ? close.lastIndex : source.length;
      continue;
    }
    if (/^<template\b/i.test(match[0])) {
      openings.lastIndex = htmlTemplateEnd(source, openings.lastIndex);
      continue;
    }
    const tag = match[2].toLowerCase();
    if (voidElements.has(tag) || !htmlHeadingIsHidden(match[0])) continue;
    const to = htmlElementEnd(source, tag, openings.lastIndex);
    ranges.push({ from: offset + match.index, to: offset + to });
    openings.lastIndex = to;
  }
  return ranges;
}
function stripHTMLHeadingMarkup(source: string) {
  let result = "";
  let index = 0;
  while (index < source.length) {
    if (source.startsWith("<!--", index)) {
      const close = source.indexOf("-->", index + 4);
      index = close < 0 ? source.length : close + 3;
      continue;
    }
    if (source[index] !== "<") {
      result += source[index++];
      continue;
    }
    const tag = /^<\s*(\/?)\s*([A-Za-z][\w:-]*)/.exec(source.slice(index));
    if (!tag) {
      result += source[index++];
      continue;
    }
    let quote = "";
    let end = index + tag[0].length;
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = "";
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= source.length) {
      result += source[index++];
      continue;
    }
    const closing = tag[1] === "/";
    const name = tag[2].toLowerCase();
    index = end + 1;
    if (!closing && (name === "script" || name === "style")) {
      const close = new RegExp(`<\\/${name}\\s*>`, "ig");
      close.lastIndex = index;
      const match = close.exec(source);
      index = match ? close.lastIndex : source.length;
    } else if (!closing && name === "br") {
      result += " ";
    }
  }
  return result;
}

function htmlHeadingTitle(source: string) {
  return stripHTMLHeadingMarkup(source)
    .replace(
      /&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/gi,
      (match, entity: string) => {
        const named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '\"',
          apos: "'",
        };
        if (entity[0] !== "#") return named[entity.toLowerCase()] || match;
        const value =
          entity[1]?.toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        try {
          return Number.isFinite(value) ? String.fromCodePoint(value) : match;
        } catch {
          return match;
        }
      },
    )
    .replace(/\s+/g, " ")
    .trim();
}
const htmlRawTextElement =
  "script|pre|style|textarea|title|xmp|iframe|noembed|noframes|noscript|listing";
const htmlAttributeSource = String.raw`(?:"[^"]*"|'[^']*'|[^'">])*`;

function htmlTemplateEnd(source: string, openingEnd: number) {
  let depth = 1;
  const tokens = new RegExp(
    `<!--[\\s\\S]*?-->|<plaintext\\b${htmlAttributeSource}>|<(${htmlRawTextElement})\\b${htmlAttributeSource}>|<template\\b${htmlAttributeSource}>|<\\/template\\s*>|<[A-Za-z][\\w:-]*\\b${htmlAttributeSource}>`,
    "gi",
  );
  tokens.lastIndex = openingEnd;
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source))) {
    if (match[0].startsWith("<!--")) continue;
    if (/^<plaintext\b/i.test(match[0])) return source.length;
    const rawTag = match[1];
    if (rawTag) {
      const close = new RegExp(`</${rawTag}\\s*>`, "ig");
      close.lastIndex = tokens.lastIndex;
      const closing = close.exec(source);
      if (!closing) return source.length;
      tokens.lastIndex = close.lastIndex;
      continue;
    }
    if (/^<template\b/i.test(match[0])) depth++;
    else if (/^<\/template\s*>/i.test(match[0]) && --depth === 0)
      return tokens.lastIndex;
  }
  return source.length;
}

function scanHtmlTemplateRanges(source: string, offset: number) {
  const ranges: { from: number; to: number }[] = [];
  const openings = new RegExp(
    `<!--[\\s\\S]*?-->|<plaintext\\b${htmlAttributeSource}>|<(${htmlRawTextElement})\\b${htmlAttributeSource}>|<template\\b${htmlAttributeSource}>`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = openings.exec(source))) {
    if (match[0].startsWith("<!--")) continue;
    if (/^<plaintext\b/i.test(match[0])) break;
    if (match[1]) {
      const close = new RegExp(`</${match[1]}\\s*>`, "ig");
      close.lastIndex = openings.lastIndex;
      const closing = close.exec(source);
      openings.lastIndex = closing ? close.lastIndex : source.length;
    } else {
      const to = htmlTemplateEnd(source, openings.lastIndex);
      ranges.push({ from: offset + match.index, to: offset + to });
      openings.lastIndex = to;
    }
  }
  return ranges;
}

function htmlHeadingClose(source: string, level: number) {
  const tokens = new RegExp(
    `<!--[\\s\\S]*?-->|<template\\b${htmlAttributeSource}>|<(${htmlRawTextElement})\\b${htmlAttributeSource}>[\\s\\S]*?<\\/\\1\\s*>|<plaintext\\b${htmlAttributeSource}>[\\s\\S]*$|<\\/h${level}\\s*>|<[A-Za-z][\\w:-]*\\b${htmlAttributeSource}>`,
    "gi",
  );
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source))) {
    if (/^<template\b/i.test(match[0])) {
      tokens.lastIndex = htmlTemplateEnd(source, tokens.lastIndex);
      continue;
    }
    if (/^<\/h/i.test(match[0])) return match;
  }
  return null;
}
function htmlBlockHeadingNodes(source: string, from: number) {
  const masked = source.split("");
  const blank = (start: number, end: number) => {
    for (let index = start; index < end; index++) {
      if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " ";
    }
  };
  const literals = new RegExp(
    `<!--|<plaintext\\b${htmlAttributeSource}>|<(${htmlRawTextElement})\\b${htmlAttributeSource}>|<template\\b${htmlAttributeSource}>`,
    "gi",
  );
  let literal: RegExpExecArray | null;
  while ((literal = literals.exec(source))) {
    let end: number;
    if (literal[0] === "<!--") {
      const close = source.indexOf("-->", literal.index + 4);
      end = close < 0 ? source.length : close + 3;
    } else if (/^<template\b/i.test(literal[0])) {
      end = htmlTemplateEnd(source, literals.lastIndex);
    } else {
      const tag = /^<([A-Za-z][\w-]*)/.exec(literal[0])?.[1];
      if (tag?.toLowerCase() === "plaintext") {
        end = source.length;
      } else {
        const close = tag ? new RegExp(`</${tag}\\s*>`, "ig") : undefined;
        if (close) close.lastIndex = literal.index + literal[0].length;
        const closing = close?.exec(source);
        end = closing ? closing.index + closing[0].length : source.length;
      }
    }
    blank(literal.index, end);
    literals.lastIndex = end;
  }

  const result: { level: number; title: string; from: number }[] = [];
  const opening = new RegExp(`<h([1-6])(?:\\s${htmlAttributeSource})?>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = opening.exec(masked.join("")))) {
    if (htmlHeadingIsHidden(match[0])) continue;
    const level = Number(match[1]);
    const close = htmlHeadingClose(
      masked.join("").slice(opening.lastIndex),
      level,
    );
    if (!close) continue;
    result.push({
      level,
      title: htmlHeadingTitle(
        source.slice(opening.lastIndex, opening.lastIndex + close.index),
      ),
      from: from + match.index,
    });
    opening.lastIndex += close.index + close[0].length;
  }
  return result;
}
type HtmlBlockState =
  { close: RegExp; endsAtBlank: false } | { endsAtBlank: true };
function htmlBlockOpening(
  content: string,
  blankBefore = false,
): HtmlBlockState | undefined {
  const terminated = (close: RegExp): HtmlBlockState | undefined =>
    close.test(content) ? undefined : { close, endsAtBlank: false };
  if (/^<!--/.test(content)) return terminated(/-->/);
  if (/^<\?/.test(content)) return terminated(/\?>/);
  if (/^<!\[CDATA\[/i.test(content)) return terminated(/\]\]>/);
  if (/^<![A-Z]/.test(content)) return terminated(/>/);

  const raw = /^<(script|pre|style|textarea|noscript)\b/i.exec(content);
  if (raw) return terminated(new RegExp(`</${raw[1]}\\s*>`, "i"));
  if (/^<plaintext\b/i.test(content))
    return { close: /(?!)/, endsAtBlank: false };

  if (
    /^<(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)\b/i.test(
      content,
    )
  )
    return { endsAtBlank: true };

  if (
    blankBefore &&
    /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?\/?>/.test(content)
  )
    return { endsAtBlank: true };
}
export function headings(text: string) {
  const result: { level: number; title: string; from: number }[] = [];
  const markdownHeadings: { level: number; title: string; from: number }[] = [];
  const htmlHeadings: { level: number; title: string; from: number }[] = [];
  let plaintextStart = Number.POSITIVE_INFINITY;
  const templateRanges: { from: number; to: number }[] = [];
  const hiddenRanges: { from: number; to: number }[] = [];
  const inTemplate = (from: number) =>
    templateRanges.some((range) => from >= range.from && from < range.to);
  const inHiddenElement = (from: number) =>
    hiddenRanges.some((range) => from >= range.from && from < range.to);
  markdownParser
    .configure(GFM)
    .parse(text)
    .iterate({
      enter(node) {
        if (node.name === "HTMLBlock") {
          const html = text.slice(node.from, node.to);
          templateRanges.push(...scanHtmlTemplateRanges(html, node.from));
          hiddenRanges.push(...scanHtmlHiddenRanges(html, node.from));
          const plaintext = /<plaintext\b/i.exec(html);
          if (plaintext)
            plaintextStart = Math.min(
              plaintextStart,
              node.from + plaintext.index,
            );
          if (node.from >= plaintextStart) return;
          htmlHeadings.push(...htmlBlockHeadingNodes(html, node.from));
          return;
        }
        if (inTemplate(node.from)) return;
        const atx = /^ATXHeading([1-6])$/.exec(node.name);
        const setext = /^SetextHeading([12])$/.exec(node.name);
        if (!atx && !setext) return;
        const lineStart = text.lastIndexOf("\n", node.from - 1) + 1;
        if (lineStart >= plaintextStart) return;
        if (markdownHeadingUsesListCodeTab(text.slice(lineStart, node.from)))
          return;
        const raw = text.slice(node.from, node.to);
        const firstLine = raw.split(/\r?\n/, 1)[0];
        const title = atx
          ? firstLine
              .replace(/^#{1,6}[ \t]*/, "")
              .replace(/[ \t]+#+[ \t]*$/, "")
              .trim()
          : raw
              .replace(/\r?\n(?:[ \t]*>[ \t]?)*[ \t]*[=-]+[ \t]*$/, "")
              .replace(/\r?\n/g, " ")
              .replace(/[ \t]+/g, " ")
              .trim();
        markdownHeadings.push({
          level: Number(atx?.[1] || setext?.[1]),
          title,
          from: lineStart,
        });
      },
    });
  const lineAt = (from: number) => {
    const lf = text.indexOf("\n", from);
    const cr = text.indexOf("\r", from);
    const newline = cr >= 0 && (lf < 0 || cr < lf) ? cr : lf;
    const end = newline < 0 ? text.length : newline;
    const next =
      newline < 0
        ? text.length + 1
        : newline +
          (text.charCodeAt(newline) === 13 &&
          text.charCodeAt(newline + 1) === 10
            ? 2
            : 1);
    return {
      text: text.slice(from, end),
      from,
      next,
    };
  };

  let fence: RegExp | undefined;
  let htmlBlock: HtmlBlockState | undefined;
  let htmlHeadingCapture:
    { level: number; from: number; content: string } | undefined;
  let line: ReturnType<typeof lineAt> | null = lineAt(0);
  while (line) {
    if (inTemplate(line.from)) {
      line = line.next <= text.length ? lineAt(line.next) : null;
      continue;
    }
    const content = markdownContainerContent(line.text);
    const previousLineEnd =
      line.from > 1 &&
      text.charCodeAt(line.from - 1) === 10 &&
      text.charCodeAt(line.from - 2) === 13
        ? line.from - 2
        : Math.max(0, line.from - 1);
    const previousLineStart = text.lastIndexOf("\n", previousLineEnd - 1) + 1;
    const blankBefore =
      line.from === 0 ||
      !markdownContainerContent(
        text.slice(previousLineStart, previousLineEnd),
      ).trim();
    const insideHtmlHeading =
      htmlBlock?.endsAtBlank &&
      (htmlHeadingCapture || /^<h[1-6]\b/i.test(content));
    if (htmlBlock && !insideHtmlHeading) {
      if (htmlBlock.endsAtBlank && !content.trim()) {
        htmlBlock = undefined;
      } else {
        if (!htmlBlock.endsAtBlank && htmlBlock.close.test(content))
          htmlBlock = undefined;
        line = line.next <= text.length ? lineAt(line.next) : null;
        continue;
      }
    }
    if (htmlHeadingCapture && !fence) {
      if (!content.trim()) {
        htmlHeadingCapture = undefined;
      } else {
        const combined = `${htmlHeadingCapture.content}\n${content}`;
        const close = htmlHeadingClose(combined, htmlHeadingCapture.level);
        if (close) {
          result.push({
            level: htmlHeadingCapture.level,
            title: htmlHeadingTitle(combined.slice(0, close.index)),
            from: htmlHeadingCapture.from,
          });
          htmlHeadingCapture = undefined;
        } else {
          htmlHeadingCapture.content = combined;
        }
      }
    } else if (fence) {
      if (fence.test(content)) fence = undefined;
    } else {
      const opening = /^(`{3,}|~{3,})/.exec(content);
      if (opening) {
        const character = opening[1][0] === "`" ? "`" : "~";
        fence = new RegExp(`^${character}{${opening[1].length},}[ \\t]*$`);
      } else {
        const htmlHeadingOpening = new RegExp(
          `^<h([1-6])(?:\\s${htmlAttributeSource})?>([\\s\\S]*)$`,
          "i",
        ).exec(content);
        if (
          htmlHeadingOpening &&
          !htmlHeadingIsHidden(
            htmlHeadingOpening[0].slice(
              0,
              htmlHeadingOpening[0].indexOf(">") + 1,
            ),
          )
        ) {
          const level = Number(htmlHeadingOpening[1]);
          const close = htmlHeadingClose(htmlHeadingOpening[2], level);
          if (
            close &&
            !htmlHeadingOpening[2].slice(close.index + close[0].length).trim()
          ) {
            result.push({
              level,
              title: htmlHeadingTitle(
                htmlHeadingOpening[2].slice(0, close.index),
              ),
              from: line.from,
            });
          } else if (!close) {
            htmlHeadingCapture = {
              level,
              from: line.from,
              content: htmlHeadingOpening[2],
            };
          }
        } else {
          const htmlBlockStart = htmlBlockOpening(content, blankBefore);
          if (htmlBlockStart) htmlBlock = htmlBlockStart;
        }
      }
    }
    line = line && line.next <= text.length ? lineAt(line.next) : null;
  }
  const htmlStarts = new Set(
    htmlHeadings.map((heading) =>
      JSON.stringify([
        heading.level,
        heading.title,
        text.lastIndexOf("\n", heading.from - 1) + 1,
      ]),
    ),
  );
  const scannedHtmlHeadings = result.filter(
    (heading) =>
      !inTemplate(heading.from) &&
      !htmlStarts.has(
        JSON.stringify([heading.level, heading.title, heading.from]),
      ),
  );
  return [...scannedHtmlHeadings, ...htmlHeadings, ...markdownHeadings]
    .sort((a, b) => a.from - b.from)
    .filter((heading) => !inHiddenElement(heading.from));
}
