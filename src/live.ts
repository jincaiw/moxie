import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { renderInlineHTMLMarkdown } from "./export";
import { Facet } from "@codemirror/state";
import { TableWidget } from "./table-widget";
import { resolveImage } from "./assets";
import {
  headingLabel,
  htmlImage,
  markdownImage,
  markdownImageEnd,
  markdownLink,
} from "./links";
import { headings } from "./data";
import { LinkWidget } from "./link-widget";
import { renderMermaid } from "./mermaid";
import { highlightCodeElement } from "./code-highlight";
import { inlineMathMatches, renderMath } from "./math";
export const documentPath = Facet.define<
  string | undefined,
  string | undefined
>({ combine: (values) => values[0] });
export const previewTheme = Facet.define<"light" | "dark", "light" | "dark">({
  combine: (values) => values[0] || "light",
});

function hydrateHTMLImages(
  root: HTMLElement,
  view: EditorView,
  documentPath: string | undefined,
) {
  root.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
    const source = image.getAttribute("src") || "";
    image.addEventListener("load", () => view.requestMeasure());
    image.addEventListener("error", () => {
      image.removeAttribute("src");
      image.alt ||= "图片不可用";
      view.requestMeasure();
    });
    void resolveImage(source, documentPath).then(
      (resolved) => {
        if (!root.isConnected) return;
        image.src = resolved;
        view.requestMeasure();
      },
      () => {
        image.removeAttribute("src");
        image.alt ||= "图片不可用";
        view.requestMeasure();
      },
    );
  });
}

function renderInlineHTMLPreview(
  element: HTMLElement,
  view: EditorView,
  source: string,
  path: string | undefined,
) {
  element.innerHTML = DOMPurify.sanitize(
    marked.parseInline(source, { async: false }) as string,
  );
  hydrateHTMLImages(element, view, path);
  void renderInlineHTMLMarkdown(source)
    .then((html) => {
      if (!element.isConnected) return;
      element.innerHTML = DOMPurify.sanitize(html);
      hydrateHTMLImages(element, view, path);
      view.requestMeasure();
    })
    .catch(() => {});
}

class RenderWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly kind: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: RenderWidget) {
    return (
      this.text === other.text &&
      this.kind === other.kind &&
      this.from === other.from
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "render-block " + this.kind;
    el.setAttribute("aria-label", "点击编辑 " + this.kind);
    el.title = "点击编辑原文";
    if (this.kind === "formula") {
      el.textContent = this.text;
      void renderMath(this.text, {
        displayMode: true,
        throwOnError: false,
        trust: false,
      })
        .then((html) => {
          if (!el.isConnected) return;
          el.innerHTML = html;
          view.requestMeasure();
        })
        .catch(() => {});
    } else {
      el.innerHTML = DOMPurify.sanitize(
        marked.parse(this.text, { async: false }) as string,
      );
    }
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function enableHTMLSourceEditing(
  element: HTMLElement,
  view: EditorView,
  from: number,
) {
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  const editSource = (event: Event) => {
    event.preventDefault();
    view.dispatch({ selection: { anchor: from } });
    view.focus();
  };
  element.addEventListener("mousedown", editSource);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") editSource(event);
  });
}

class RawHTMLWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly path: string | undefined,
  ) {
    super();
  }
  eq(other: RawHTMLWidget) {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.path === other.path
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "render-block html-block-preview";
    el.setAttribute("aria-label", "HTML 预览，点击编辑原文");
    el.title = "点击编辑原文";
    el.innerHTML = DOMPurify.sanitize(
      marked.parse(this.source, { async: false }) as string,
    );
    hydrateHTMLImages(el, view, this.path);
    enableHTMLSourceEditing(el, view, this.from);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class InlineHTMLWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly path: string | undefined,
  ) {
    super();
  }
  eq(other: InlineHTMLWidget) {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.path === other.path
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "md-inline-html-preview";
    el.setAttribute("aria-label", "HTML 预览，点击编辑原文");
    renderInlineHTMLPreview(el, view, this.source, this.path);
    el.title = "点击编辑原文";
    enableHTMLSourceEditing(el, view, this.from);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

class InlineHTMLParagraphWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly path: string | undefined,
  ) {
    super();
  }
  eq(other: InlineHTMLParagraphWidget) {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.path === other.path
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "md-inline-html-paragraph-preview";
    el.setAttribute("aria-label", "HTML 预览，点击编辑原文");
    el.title = "点击编辑原文";
    renderInlineHTMLPreview(el, view, this.source, this.path);
    enableHTMLSourceEditing(el, view, this.from);
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

const voidHTMLTags = new Set([
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

function isVoidHTMLTag(source: string) {
  const match = /^<\s*([\w:-]+)\b[\s\S]*>$/.exec(source);
  return !!match && voidHTMLTags.has(match[1].toLowerCase());
}

function inlineHTMLRanges(
  state: import("@codemirror/state").EditorState,
  from: number,
  to: number,
) {
  const stack: { name: string; from: number; to: number }[] = [];
  const pairs: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (node.name !== "HTMLTag") return;
      const raw = state.doc.sliceString(node.from, node.to);
      const closing = /^<\/\s*([\w:-]+)\s*>$/.exec(raw);
      if (closing) {
        const name = closing[1].toLowerCase();
        let openIndex = stack.length - 1;
        while (openIndex >= 0 && stack[openIndex].name !== name) openIndex--;
        if (openIndex < 0) return;
        const opening = stack[openIndex];
        stack.length = openIndex;
        pairs.push({ from: opening.from, to: node.to });
        return;
      }
      const opening = /^<\s*([\w:-]+)\b[\s\S]*>$/.exec(raw);
      if (!opening) return;
      const name = opening[1].toLowerCase();
      if (voidHTMLTags.has(name) || /\/\s*>$/.test(raw)) return;
      stack.push({ name, from: node.from, to: node.to });
    },
  });
  pairs.sort((a, b) => a.from - b.from || b.to - a.to);
  const outermost: { from: number; to: number }[] = [];
  for (const pair of pairs) {
    const previous = outermost.at(-1);
    if (previous && pair.from < previous.to) continue;
    outermost.push(pair);
  }
  return outermost;
}

class CodeBlockWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly language: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: CodeBlockWidget) {
    return (
      this.code === other.code &&
      this.language === other.language &&
      this.from === other.from
    );
  }
  toDOM(view: EditorView) {
    const block = document.createElement("div");
    block.className = "md-code-preview";
    if (this.language) {
      const label = document.createElement("span");
      label.className = "md-code-language";
      label.textContent = this.language;
      block.append(label);
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = "md-code-copy";
    button.textContent = "复制";
    button.setAttribute("aria-label", "复制代码");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(this.code);
        button.textContent = "已复制";
      } catch {
        button.textContent = "复制失败";
      }
      window.setTimeout(() => {
        if (button.isConnected) button.textContent = "复制";
      }, 1500);
    });
    block.append(button);
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = this.code;
    if (this.language) code.className = "language-" + this.language;
    pre.append(code);
    block.append(pre);
    if (this.language)
      void highlightCodeElement(code, this.code, this.language);
    block.addEventListener("mousedown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return block;
  }
  ignoreEvent(event: Event) {
    return (event.target as HTMLElement).closest("button") !== null;
  }
}

function build(
  state: import("@codemirror/state").EditorState,
  visibleRanges: readonly { from: number; to: number }[],
): DecorationSet {
  const theme = state.facet(previewTheme) === "dark" ? "dark" : "default";
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  const codeRanges: { from: number; to: number }[] = [];
  const active = (from: number, to: number) =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const activeLine = (from: number, to: number) =>
    active(state.doc.lineAt(from).from, state.doc.lineAt(to).to);
  const add = (from: number, to: number, deco: Decoration) =>
    ranges.push({ from, to, deco });
  const regions: { from: number; to: number }[] = [];
  for (const visible of visibleRanges) {
    const firstLine = Math.max(1, state.doc.lineAt(visible.from).number - 24);
    const lastLine = Math.min(
      state.doc.lines,
      state.doc.lineAt(Math.min(visible.to, state.doc.length)).number + 24,
    );
    const from = state.doc.line(firstLine).from;
    const to = state.doc.line(lastLine).to;
    const previous = regions.at(-1);
    if (previous && from <= previous.to)
      previous.to = Math.max(previous.to, to);
    else regions.push({ from, to });
  }
  for (const visible of regions) {
    const tree = ensureSyntaxTree(state, visible.to, 12) || syntaxTree(state);
    const inlineHTML = inlineHTMLRanges(state, visible.from, visible.to);
    const inlineHTMLOpenings = new Map(
      inlineHTML.map((range) => [range.from, range.to]),
    );
    const replacedParagraphs: { from: number; to: number }[] = [];
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        if (
          replacedParagraphs.some(
            (range) => node.from >= range.from && node.to <= range.to,
          )
        )
          return false;
        const line = state.doc.lineAt(node.from);
        const isActive = active(line.from, state.doc.lineAt(node.to).to);
        if (
          (node.name === "Comment" || node.name === "CommentBlock") &&
          !isActive
        ) {
          codeRanges.push({ from: node.from, to: node.to });
          add(node.from, node.to, Decoration.replace({}));
          return false;
        }
        if (/^ATXHeading[1-6]$/.test(node.name)) {
          add(
            line.from,
            line.from,
            Decoration.line({ class: "md-heading md-h" + node.name.slice(-1) }),
          );
        }
        if (node.name === "SetextHeading1" || node.name === "SetextHeading2") {
          add(
            line.from,
            line.from,
            Decoration.line({
              class:
                "md-heading " +
                (node.name === "SetextHeading1" ? "md-h1" : "md-h2"),
            }),
          );
        }
        if (node.name === "Blockquote") {
          for (
            let n = line.number;
            n <= state.doc.lineAt(node.to).number;
            n++
          ) {
            const quoteLine = state.doc.line(n);
            add(
              quoteLine.from,
              quoteLine.from,
              Decoration.line({ class: "md-quote" }),
            );
          }
        }
        if (
          node.name === "InlineCode" ||
          node.name === "FencedCode" ||
          node.name === "CodeBlock" ||
          node.name === "URL"
        )
          codeRanges.push({ from: node.from, to: node.to });
        if (node.name === "FencedCode") {
          for (
            let n = line.number;
            n <= state.doc.lineAt(node.to).number;
            n++
          ) {
            const l = state.doc.line(n);
            add(l.from, l.from, Decoration.line({ class: "md-code-line" }));
          }
          if (!isActive) {
            const raw = state.doc.sliceString(node.from, node.to);
            const lines = raw.split(/\r?\n/);
            const opening = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(
              lines[0] || "",
            );
            if (
              opening &&
              lines.length > 1 &&
              opening[2].toLowerCase() !== "mermaid"
            ) {
              const closing = lines[lines.length - 1].trim();
              const hasClosing = new RegExp(
                `^${opening[1][0]}{${opening[1].length},}\\s*$`,
              ).test(closing);
              const code = lines
                .slice(1, hasClosing ? -1 : undefined)
                .join("\n");
              add(
                node.from,
                node.to,
                Decoration.replace({
                  widget: new CodeBlockWidget(code, opening[2], node.from),
                }),
              );
              return false;
            }
            const diagram =
              /^([ \t]*)(`{3,}|~{3,})[ \t]*mermaid(?:[ \t][^\n]*)?\r?\n([\s\S]*?)\r?\n\1\2[ \t]*$/i.exec(
                raw,
              );
            if (diagram) {
              add(
                node.from,
                node.to,
                Decoration.replace({
                  widget: new MermaidWidget(diagram[3], node.from, theme),
                }),
              );
              return false;
            }
          }
        }
        if (node.name === "Table")
          codeRanges.push({ from: node.from, to: node.to });
        if (node.name === "Table" && !isActive) {
          add(
            node.from,
            node.to,
            Decoration.replace({
              widget: new TableWidget(
                state.doc.sliceString(node.from, node.to),
                node.from,
                node.to,
              ),
            }),
          );
          return false;
        }
        if (
          node.name === "ListMark" &&
          /^\s*[-*+]\s+\[[ xX]\]/.test(line.text)
        ) {
          add(node.from, node.to, Decoration.replace({}));
          return false;
        }
        if (node.name === "TaskMarker") {
          add(
            node.from,
            node.to,
            Decoration.replace({
              widget: new TaskWidget(
                state.doc.sliceString(node.from, node.to).includes("x") ||
                  state.doc.sliceString(node.from, node.to).includes("X"),
                node.from,
                line.text.slice(node.to - line.from).trim(),
              ),
            }),
          );
          return false;
        }
        if (node.name === "Image") {
          codeRanges.push({ from: node.from, to: node.to });
          if (!isActive) {
            const lineOffset = node.from - line.from;
            const rawLine = line.text.slice(lineOffset);
            const inlineLength = markdownImageEnd(rawLine);
            const raw = inlineLength
              ? rawLine.slice(0, inlineLength)
              : state.doc.sliceString(node.from, node.to);
            const image = markdownImage(raw, state.doc);
            if (image) {
              const imageTo = inlineLength
                ? line.from + lineOffset + inlineLength
                : node.to;
              if (imageTo > node.to)
                codeRanges.push({ from: node.to, to: imageTo });
              const wholeLine = node.from === line.from && imageTo === line.to;
              add(
                node.from,
                imageTo,
                Decoration.replace({
                  widget: new ImageWidget(
                    image.src,
                    image.alt,
                    node.from,
                    state.facet(documentPath),
                    wholeLine,
                    image.width,
                    image.height,
                  ),
                }),
              );
              return false;
            }
          }
          codeRanges.push({ from: node.from, to: node.to });
        }
        if (
          (node.name === "HTMLTag" || node.name === "HTMLBlock") &&
          !isActive
        ) {
          const source = state.doc.sliceString(node.from, node.to);
          const raw = source.trim();
          const inlineEnd = inlineHTMLOpenings.get(node.from);
          if (node.name === "HTMLTag" && inlineEnd !== undefined) {
            const inlineSource = state.doc.sliceString(node.from, inlineEnd);
            if (inlineSource.includes("\n")) {
              let paragraph = tree.resolveInner(node.from, 1);
              while (paragraph.name !== "Paragraph" && paragraph.parent)
                paragraph = paragraph.parent;
              if (
                paragraph.name === "Paragraph" &&
                paragraph.from <= node.from &&
                paragraph.to >= inlineEnd &&
                !active(paragraph.from, paragraph.to)
              ) {
                const range = { from: paragraph.from, to: paragraph.to };
                replacedParagraphs.push(range);
                codeRanges.push(range);
                add(
                  range.from,
                  range.to,
                  Decoration.replace({
                    widget: new InlineHTMLParagraphWidget(
                      state.doc.sliceString(range.from, range.to),
                      range.from,
                      state.facet(documentPath),
                    ),
                    block: true,
                  }),
                );
                return false;
              }
            } else if (!active(node.from, inlineEnd)) {
              add(
                node.from,
                inlineEnd,
                Decoration.replace({
                  widget: new InlineHTMLWidget(
                    inlineSource,
                    node.from,
                    state.facet(documentPath),
                  ),
                }),
              );
              codeRanges.push({ from: node.from, to: inlineEnd });
              return false;
            }
          }
          const image = htmlImage(raw);
          if (image) {
            const leading = source.indexOf(raw);
            const from = node.from + leading;
            const to = from + raw.length;
            add(
              from,
              to,
              Decoration.replace({
                widget: new ImageWidget(
                  image.src,
                  image.alt,
                  from,
                  state.facet(documentPath),
                  from === line.from && to === line.to,
                ),
              }),
            );
            codeRanges.push({ from, to });
            return false;
          }
          if (node.name === "HTMLTag" && isVoidHTMLTag(raw)) {
            add(
              node.from,
              node.to,
              Decoration.replace({
                widget: new InlineHTMLWidget(
                  raw,
                  node.from,
                  state.facet(documentPath),
                ),
              }),
            );
            codeRanges.push({ from: node.from, to: node.to });
            return false;
          }
          if (node.name === "HTMLBlock" && raw && !/^<img\b/i.test(raw)) {
            add(
              node.from,
              node.to,
              Decoration.replace({
                widget: new RawHTMLWidget(
                  source,
                  node.from,
                  state.facet(documentPath),
                ),
              }),
            );
            codeRanges.push({ from: node.from, to: node.to });
            return false;
          }
        }
        if (node.name === "HorizontalRule" && !isActive) {
          add(line.from, line.from, Decoration.line({ class: "md-rule" }));
          add(node.from, node.to, Decoration.mark({ class: "md-rule-text" }));
        }
        if (node.name === "StrongEmphasis")
          add(node.from, node.to, Decoration.mark({ class: "md-strong" }));
        if (node.name === "Emphasis")
          add(node.from, node.to, Decoration.mark({ class: "md-emphasis" }));
        if (node.name === "Strikethrough")
          add(node.from, node.to, Decoration.mark({ class: "md-strike" }));
        if (node.name === "InlineCode")
          add(node.from, node.to, Decoration.mark({ class: "md-inline-code" }));
        if (node.name === "URL") {
          let parent = tree.resolveInner(node.from, 1).parent;
          while (parent && parent.name !== "Link" && parent.name !== "Autolink")
            parent = parent.parent;
          if (parent) return false;
        }
        if (
          node.name === "Link" ||
          node.name === "Autolink" ||
          node.name === "URL"
        ) {
          if (!isActive) {
            const raw = state.doc.sliceString(node.from, node.to);
            if (/^\[TOC\]$/i.test(raw)) {
              codeRanges.push({ from: node.from, to: node.to });
              add(
                node.from,
                node.to,
                Decoration.replace({ widget: new TocWidget(node.from) }),
              );
              return false;
            }
            const footnote = /^\[\^([^\]]+)\]$/.exec(raw);
            if (footnote && !/^\s*\[\^[^\]]+\]\s*:/.test(line.text)) {
              codeRanges.push({ from: node.from, to: node.to });
              add(
                node.from,
                node.to,
                Decoration.replace({
                  widget: new FootnoteWidget(footnote[1], node.from),
                }),
              );
              return false;
            }
            const link = markdownLink(raw, state.doc);
            if (link) {
              codeRanges.push({ from: node.from, to: node.to });
              add(
                node.from,
                node.to,
                Decoration.replace({
                  widget: new LinkWidget(
                    link.label,
                    link.href,
                    node.from,
                    link.title,
                  ),
                }),
              );
              return false;
            }
          }
          add(node.from, node.to, Decoration.mark({ class: "md-link" }));
        }
        if (
          !isActive &&
          [
            "HeaderMark",
            "EmphasisMark",
            "CodeMark",
            "QuoteMark",
            "StrikethroughMark",
          ].includes(node.name)
        )
          add(node.from, node.to, Decoration.replace({}));
      },
    });
  }
  for (const visible of regions) {
    let lineNo = state.doc.lineAt(visible.from).number;
    const lastLine = state.doc.lineAt(
      Math.min(visible.to, state.doc.length),
    ).number;
    for (; lineNo <= lastLine; lineNo++) {
      const line = state.doc.line(lineNo);
      if (!line.text)
        add(line.from, line.from, Decoration.line({ class: "md-empty" }));
    }
    const from = visible.from;
    const to = visible.to;
    const text = state.doc.sliceString(from, to);
    const formula = /^\$\$[^\S\n]*\n([\s\S]*?)\n\$\$[^\S\n]*(?=\n|$)/gm;
    let m;
    while ((m = formula.exec(text))) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (
        !activeLine(start, end) &&
        !codeRanges.some((r) => start < r.to && end > r.from)
      ) {
        codeRanges.push({ from: start, to: end });
        add(
          start,
          end,
          Decoration.replace({
            widget: new RenderWidget(m[1], "formula", start),
          }),
        );
      }
    }
    for (const match of inlineMathMatches(text)) {
      const start = from + match.from;
      const end = from + match.to;
      if (
        !activeLine(start, end) &&
        !codeRanges.some((r) => start < r.to && end > r.from)
      )
        add(
          start,
          end,
          Decoration.replace({
            widget: new InlineMathWidget(match.text, start),
          }),
        );
    }
    const highlightDelimiter = /==/g;
    let highlightOpen = -1;
    let escapedHighlightOpen = -1;
    while ((m = highlightDelimiter.exec(text))) {
      const index = m.index;
      const previous = text[index - 1] || "";
      const next = text[index + 2] || "";
      if (previous === "=" || next === "=") continue;
      if (
        highlightOpen >= 0 &&
        text.slice(highlightOpen + 2, index).includes("\n")
      )
        highlightOpen = -1;
      if (
        escapedHighlightOpen >= 0 &&
        text.slice(escapedHighlightOpen + 2, index).includes("\n")
      )
        escapedHighlightOpen = -1;
      let backslashes = 0;
      for (
        let cursor = index - 1;
        cursor >= 0 && text[cursor] === "\\";
        cursor--
      )
        backslashes++;
      const escaped = backslashes % 2 === 1;
      if (escaped) {
        if (next && !/\s/.test(next)) escapedHighlightOpen = index;
        continue;
      }
      if (escapedHighlightOpen >= 0 && previous && !/\s/.test(previous)) {
        escapedHighlightOpen = -1;
        continue;
      }
      if (highlightOpen < 0) {
        if (next && !/\s/.test(next)) highlightOpen = index;
        continue;
      }
      if (!previous || /\s/.test(previous)) continue;
      const start = from + highlightOpen;
      const end = from + index + 2;
      if (
        !activeLine(start, end) &&
        !codeRanges.some((r) => start < r.to && end > r.from)
      ) {
        add(start, end, Decoration.mark({ class: "md-highlight" }));
        add(start, start + 2, Decoration.replace({}));
        add(end - 2, end, Decoration.replace({}));
      }
      highlightOpen = -1;
    }
    const superscript = /(?<![\\^])\^(?=\S)([^\s^]+)\^(?!\^)/g;
    while ((m = superscript.exec(text))) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (
        !activeLine(start, end) &&
        !codeRanges.some((r) => start < r.to && end > r.from)
      ) {
        add(start, end, Decoration.mark({ tagName: "sup" }));
        add(start, start + 1, Decoration.replace({}));
        add(end - 1, end, Decoration.replace({}));
      }
    }
    const subscript = /(?<![~\\])~(?=\S)([^\s~]+)~(?!~)/g;
    while ((m = subscript.exec(text))) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (
        !activeLine(start, end) &&
        !codeRanges.some((r) => start < r.to && end > r.from)
      ) {
        add(start, end, Decoration.mark({ tagName: "sub" }));
        add(start, start + 1, Decoration.replace({}));
        add(end - 1, end, Decoration.replace({}));
      }
    }
  }
  ranges.sort(
    (a, b) =>
      a.from - b.from || a.deco.startSide - b.deco.startSide || a.to - b.to,
  );
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) builder.add(r.from, r.to, r.deco);
  return builder.finish();
}

class FootnoteWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: FootnoteWidget) {
    return this.label === other.label && this.from === other.from;
  }
  toDOM(view: EditorView) {
    const marker = document.createElement("sup");
    marker.className = "md-footnote-ref";
    marker.textContent = "*";
    marker.title = `脚注 ${this.label}，点击跳到注释`;
    marker.setAttribute("role", "link");
    marker.setAttribute("aria-label", `跳转到脚注 ${this.label}`);
    marker.tabIndex = 0;
    const goToDefinition = () => {
      const normalize = (label: string) =>
        label.trim().replace(/\s+/g, " ").toLowerCase();
      const target = normalize(this.label);
      let fence: { character: string; length: number } | undefined;
      for (let number = 1; number <= view.state.doc.lines; number++) {
        const line = view.state.doc.line(number);
        if (fence) {
          const close = new RegExp(
            `^ {0,3}${fence.character}{${fence.length},}[ \\t]*$`,
          );
          if (close.test(line.text)) fence = undefined;
          continue;
        }
        const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line.text);
        if (opening) {
          fence = { character: opening[1][0], length: opening[1].length };
          continue;
        }
        const definition = /^ {0,3}\[\^([^\]]+)\]:/.exec(line.text);
        if (definition && normalize(definition[1]) === target) {
          view.dispatch({
            selection: { anchor: line.from },
            effects: EditorView.scrollIntoView(line.from, { y: "center" }),
          });
          view.focus();
          break;
        }
      }
    };
    marker.addEventListener("mousedown", (event) => {
      event.preventDefault();
      goToDefinition();
    });
    marker.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        goToDefinition();
      }
    });
    return marker;
  }
  ignoreEvent() {
    return false;
  }
}

class TocWidget extends WidgetType {
  constructor(readonly from: number) {
    super();
  }
  eq(other: TocWidget) {
    return this.from === other.from;
  }
  toDOM(view: EditorView) {
    const details = document.createElement("details");
    details.className = "md-toc";
    details.setAttribute("aria-label", "文档目录");
    const summary = document.createElement("summary");
    summary.textContent = "目录";
    details.append(summary);
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      const list = document.createElement("ol");
      const source = view.state.doc.toString();
      for (const heading of headings(source)) {
        const normalizedBefore = source
          .replace(/\r\n?/g, "\n")
          .slice(0, heading.from);
        const lineNumber = normalizedBefore.split("\n").length;
        const line = view.state.doc.line(
          Math.min(lineNumber, view.state.doc.lines),
        );
        const item = document.createElement("li");
        item.style.marginInlineStart = `${Math.max(0, heading.level - 1) * 14}px`;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = headingLabel(heading.title) || "（无标题）";
        button.addEventListener("mousedown", (event) => {
          event.preventDefault();
          view.dispatch({
            selection: { anchor: line.from },
            effects: EditorView.scrollIntoView(line.from, { y: "center" }),
          });
          view.focus();
          details.open = false;
        });
        item.append(button);
        list.append(item);
      }
      if (!list.childElementCount) {
        const item = document.createElement("li");
        item.textContent = "尚无标题";
        list.append(item);
      }
      details.querySelector("ol")?.remove();
      details.append(list);
    });
    return details;
  }
  ignoreEvent() {
    return true;
  }
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly theme: "dark" | "default",
  ) {
    super();
  }
  eq(other: MermaidWidget) {
    return (
      this.source === other.source &&
      this.from === other.from &&
      this.theme === other.theme
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "mermaid-preview";
    el.setAttribute("role", "img");
    el.setAttribute("aria-label", "Mermaid 图表");
    el.textContent = "正在绘制图表…";
    void renderMermaid(this.source, this.theme).then(
      (svg) => {
        if (el.isConnected) el.innerHTML = svg;
      },
      () => {
        if (el.isConnected) {
          el.classList.add("mermaid-error");
          el.textContent = "Mermaid 图表语法有误，点击此处编辑代码";
        }
      },
    );
    el.title = "点击编辑图表代码";
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}
type PreviewRange = { from: number; to: number };
type LivePreviewState = { ranges: PreviewRange[]; decorations: DecorationSet };
const setPreviewRanges = StateEffect.define<PreviewRange[]>({
  map: (ranges, changes) =>
    ranges.map(({ from, to }) => ({
      from: changes.mapPos(from, 1),
      to: changes.mapPos(to, -1),
    })),
});
const livePreviewField = StateField.define<LivePreviewState>({
  create: (state) => ({ ranges: [], decorations: build(state, []) }),
  update(value, transaction) {
    let ranges = transaction.docChanged
      ? value.ranges.map(({ from, to }) => ({
          from: transaction.changes.mapPos(from, 1),
          to: transaction.changes.mapPos(to, -1),
        }))
      : value.ranges;
    let rangesChanged = false;
    for (const effect of transaction.effects) {
      if (effect.is(setPreviewRanges)) {
        ranges = effect.value;
        rangesChanged = true;
      }
    }
    const shouldRebuild =
      transaction.docChanged ||
      rangesChanged ||
      !transaction.startState.selection.eq(transaction.state.selection) ||
      transaction.startState.facet(documentPath) !==
        transaction.state.facet(documentPath) ||
      transaction.startState.facet(previewTheme) !==
        transaction.state.facet(previewTheme);
    return shouldRebuild
      ? { ranges, decorations: build(transaction.state, ranges) }
      : { ...value, ranges };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

class LivePreviewViewportPlugin {
  private queued = false;
  private destroyed = false;
  private lastKey = "";

  constructor(readonly view: EditorView) {
    this.schedule();
  }

  update(update: import("@codemirror/view").ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged)
      this.schedule();
  }

  destroy() {
    this.destroyed = true;
  }

  private schedule() {
    const ranges = this.view.visibleRanges.map(({ from, to }) => ({
      from,
      to,
    }));
    const key = ranges.map(({ from, to }) => `${from}:${to}`).join(",");
    if (this.queued || key === this.lastKey) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      if (this.destroyed) return;
      const current = this.view.visibleRanges.map(({ from, to }) => ({
        from,
        to,
      }));
      const currentKey = current
        .map(({ from, to }) => `${from}:${to}`)
        .join(",");
      if (currentKey === this.lastKey) return;
      this.lastKey = currentKey;
      this.view.dispatch({ effects: setPreviewRanges.of(current) });
    });
  }
}

export const livePreview = [
  livePreviewField,
  ViewPlugin.fromClass(LivePreviewViewportPlugin),
];

class TaskWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
    readonly label: string,
  ) {
    super();
  }
  eq(other: TaskWidget) {
    return (
      this.checked === other.checked &&
      this.from === other.from &&
      this.label === other.label
    );
  }
  toDOM(view: EditorView) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "task-checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", "任务：" + this.label);
    input.addEventListener("change", () => {
      view.dispatch({
        changes: {
          from: this.from + 1,
          to: this.from + 2,
          insert: input.checked ? "x" : " ",
        },
        annotations: Transaction.userEvent.of("input.task"),
      });
    });
    return input;
  }
  ignoreEvent() {
    return true;
  }
}
class InlineMathWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: InlineMathWidget) {
    return this.text === other.text && this.from === other.from;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "inline-formula";
    el.textContent = this.text;
    void renderMath(this.text, { throwOnError: false, trust: false })
      .then((html) => {
        if (!el.isConnected) return;
        el.innerHTML = html;
        view.requestMeasure();
      })
      .catch(() => {});
    el.title = "点击编辑公式";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}
class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly from: number,
    readonly path: string | undefined,
    readonly block: boolean,
    readonly width?: number,
    readonly height?: number,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return (
      this.src === other.src &&
      this.alt === other.alt &&
      this.from === other.from &&
      this.path === other.path &&
      this.width === other.width &&
      this.height === other.height
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.block ? "div" : "span");
    el.className =
      "image-preview " + (this.block ? "image-block" : "image-inline");
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `编辑图片：${this.alt || this.src}`);
    const status = document.createElement("span");
    status.className = "image-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "正在载入图片…";
    el.append(status);
    void resolveImage(this.src, this.path)
      .then((src) => {
        const img = document.createElement("img");
        img.alt = this.alt;
        if (this.width) img.width = this.width;
        if (this.height) img.height = this.height;
        img.src = src;
        img.addEventListener("load", () => {
          view.requestMeasure();
        });
        img.addEventListener("error", () => {
          status.textContent = "无法显示图片：" + this.alt;
          el.replaceChildren(status);
        });
        el.replaceChildren(img);
        view.requestMeasure();
      })
      .catch(() => {
        status.textContent = "图片不可用：" + (this.alt || this.src);
        view.requestMeasure();
      });
    el.title = "点击编辑图片路径";
    const focusSource = () => {
      view.dispatch({ selection: { anchor: this.from } });
      view.focus();
    };
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      focusSource();
    });
    el.addEventListener("keydown", (rawEvent) => {
      const event = rawEvent as KeyboardEvent;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      focusSource();
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}
