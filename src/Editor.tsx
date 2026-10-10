import { useEffect, useRef, forwardRef, useImperativeHandle } from "react";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  indentMore,
  indentLess,
  undo,
  redo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { GFM } from "@lezer/markdown";
import { tags } from "@lezer/highlight";
import { languages } from "@codemirror/language-data";
import {
  defaultHighlightStyle,
  syntaxHighlighting,
  HighlightStyle,
  syntaxTree,
} from "@codemirror/language";
import { searchKeymap, search, openSearchPanel } from "@codemirror/search";
import { livePreview, documentPath, previewTheme } from "./live";
import { imageTypes } from "./assets";
import { clipboardMarkdown } from "./smart-paste";
import { linkHandler } from "./link-widget";
import { markdownImageEnd, markdownImageSizing, markdownLink } from "./links";
import { detectLineEnding, restoreLineEnding } from "./data";

const sessions = new Map<string, EditorState>();
export type Format =
  | "bold"
  | "italic"
  | "highlight"
  | "superscript"
  | "subscript"
  | "strike"
  | "code"
  | "heading"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "paragraph"
  | "quote"
  | "codeblock"
  | "bulletList"
  | "orderedList"
  | "task"
  | "table"
  | "link"
  | "footnote"
  | "toc";
export type EditorHandle = {
  flush: () => void;
  selection: () => string;
  go: (pos: number) => void;
  find: () => void;
  undo: () => void;
  redo: () => void;
  format: (kind: Format, tableSize?: { rows: number; columns: number }) => void;
  images: (files: File[]) => Promise<void>;
  fileLink: (target: string) => Promise<void>;
  imageSize: () => { width: string; height: string } | null;
  setImageSize: (width: string, height: string) => boolean;
  forget: (id: string) => void;
  focus: () => void;
};
type Props = {
  id: string;
  text: string;
  path?: string;
  source: boolean;
  readOnly?: boolean;
  typewriter?: boolean;
  smartQuotes?: boolean;
  smartDashes?: boolean;
  spellCheck?: boolean;
  copyFormat?: "rich-text" | "markdown";
  onCopyRichText: (selection: string) => Promise<void>;
  theme?: "light" | "dark";
  onChange: (text: string) => void;
  onMapPositions: (mapPosition: (position: number) => number) => void;
  onDirty: () => void;
  onCursorChange: (
    position: number,
    line: number,
    column: number,
    selection: string,
    selectionAnchor?: { top: number; left: number },
  ) => void;
  onLink: (href: string) => void;
  onContextMenu: (point: { left: number; top: number }) => void;
  onImages: (files: File[]) => Promise<string>;
  onFileLink: (target: string, label?: string) => Promise<string>;
  onError: (message: string) => void;
};

function formatSelection(
  view: EditorView,
  kind: Format,
  tableSize?: { rows: number; columns: number },
) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  if (kind === "footnote") {
    const source = view.state.doc.toString();
    let index = 1;
    let label = `note-${index}`;
    while (new RegExp(`\\[\\^${label}\\]`, "i").test(source)) {
      index++;
      label = `note-${index}`;
    }
    const definition = `[^${label}]: `;
    const separator =
      source.length === 0 || source.endsWith("\n\n")
        ? ""
        : source.endsWith("\n")
          ? "\n"
          : "\n\n";
    const reference = selected ? `${selected}[^${label}]` : `[^${label}]`;
    const appended = separator + definition;
    const atEnd = to === source.length;
    const changes = atEnd
      ? [{ from, to, insert: reference + appended }]
      : [
          { from, to, insert: reference },
          { from: source.length, insert: appended },
        ];
    const definitionStart = atEnd
      ? from + reference.length + appended.length
      : source.length + appended.length;
    view.dispatch({
      changes,
      selection: { anchor: definitionStart },
      annotations: Transaction.userEvent.of("input.format"),
    });
    view.focus();
    return;
  }
  if (kind === "toc") {
    const source = view.state.doc.toString();
    const before = source.slice(0, from);
    const after = source.slice(from);
    const prefix = before
      ? before.endsWith("\n\n")
        ? ""
        : before.endsWith("\n")
          ? "\n"
          : "\n\n"
      : "";
    const suffix = after
      ? after.startsWith("\n\n")
        ? ""
        : after.startsWith("\n")
          ? "\n"
          : "\n\n"
      : "\n\n";
    const insertion = `${prefix}[TOC]${suffix}`;
    view.dispatch({
      changes: { from, insert: insertion },
      selection: { anchor: from + insertion.length },
      annotations: Transaction.userEvent.of("input.format"),
    });
    view.focus();
    return;
  }
  const wrappers: Partial<Record<Format, string>> = {
    bold: "**",
    italic: "*",
    highlight: "==",
    superscript: "^",
    subscript: "~",
    strike: "~~",
    code: "`",
  };
  const wrapper = wrappers[kind];
  if (wrapper) {
    if (
      view.state.sliceDoc(Math.max(0, from - wrapper.length), from) ===
        wrapper &&
      view.state.sliceDoc(to, to + wrapper.length) === wrapper
    ) {
      view.dispatch({
        changes: [
          { from: from - wrapper.length, to: from, insert: "" },
          { from: to, to: to + wrapper.length, insert: "" },
        ],
        selection: { anchor: from - wrapper.length, head: to - wrapper.length },
        annotations: Transaction.userEvent.of("input.format"),
      });
    } else {
      const content = selected || "文字";
      view.dispatch({
        changes: { from, to, insert: wrapper + content + wrapper },
        selection: {
          anchor: from + wrapper.length,
          head: from + wrapper.length + content.length,
        },
        annotations: Transaction.userEvent.of("input.format"),
      });
    }
  } else if (kind === "codeblock") {
    const lines = selected.split("\n");
    const fenceSize = Math.max(
      3,
      ...lines.map((line) =>
        (line.match(/`+/g) || []).reduce(
          (max, part) => Math.max(max, part.length + 1),
          0,
        ),
      ),
    );
    const fence = "`".repeat(fenceSize);
    const content = selected || "代码";
    const leading = from === view.state.doc.lineAt(from).from ? "" : "\n\n";
    const trailing = to === view.state.doc.lineAt(to).to ? "" : "\n\n";
    const block = `${leading}${fence}\n${content}\n${fence}${trailing}`;
    view.dispatch({
      changes: { from, to, insert: block },
      selection: {
        anchor: from + leading.length + fence.length + 1,
        head: from + leading.length + fence.length + 1 + content.length,
      },
      annotations: Transaction.userEvent.of("input.format"),
    });
  } else if (kind === "table") {
    const rows = Math.max(2, Math.min(20, Math.floor(tableSize?.rows || 3)));
    const columns = Math.max(
      1,
      Math.min(12, Math.floor(tableSize?.columns || 2)),
    );
    const table = [
      `| ${Array.from({ length: columns }, (_, index) => `标题 ${index + 1}`).join(" | ")} |`,
      `| ${Array.from({ length: columns }, () => "---").join(" | ")} |`,
      ...Array.from(
        { length: rows - 1 },
        () =>
          `| ${Array.from({ length: columns }, () => "内容").join(" | ")} |`,
      ),
    ].join("\n");
    const before = view.state.sliceDoc(0, from);
    const after = view.state.sliceDoc(to);
    const prefix = before
      ? before.endsWith("\n\n")
        ? ""
        : before.endsWith("\n")
          ? "\n"
          : "\n\n"
      : "";
    const suffix = after
      ? after.startsWith("\n\n")
        ? ""
        : after.startsWith("\n")
          ? "\n"
          : "\n\n"
      : "\n\n";
    const text = `${prefix}${table}${suffix}`;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      annotations: Transaction.userEvent.of("input.format"),
    });
  } else if (kind === "link") {
    let node = syntaxTree(view.state).resolveInner(from, 1);
    while (node.parent && node.name !== "Link") node = node.parent;
    const url =
      node.name === "Link" && node.to >= to ? node.getChild("URL") : null;
    if (url) {
      view.dispatch({ selection: { anchor: url.from, head: url.to } });
      view.focus();
      return;
    }
    if (node.name === "Link" && node.to >= to) {
      const link = markdownLink(
        view.state.sliceDoc(node.from, node.to),
        view.state.doc,
      );
      if (link) {
        const prefix = `[${link.label}](<`;
        const destination = link.href.replace(/</g, "%3C").replace(/>/g, "%3E");
        view.dispatch({
          changes: {
            from: node.from,
            to: node.to,
            insert: prefix + destination + ">)",
          },
          selection: {
            anchor: node.from + prefix.length,
            head: node.from + prefix.length + destination.length,
          },
          annotations: Transaction.userEvent.of("input.format"),
        });
        view.focus();
        return;
      }
    }
    const text = `[${selected || "链接文字"}](https://)`;
    const start = from + text.indexOf("https://");
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: start, head: start + 8 },
      annotations: Transaction.userEvent.of("input.format"),
    });
  } else {
    const first = view.state.doc.lineAt(from).number;
    const last = view.state.doc.lineAt(to > from ? to - 1 : to).number;
    const lines = Array.from({ length: last - first + 1 }, (_, index) =>
      view.state.doc.line(first + index),
    );
    const isHeading = kind === "heading" || kind.startsWith("heading");
    const isList = kind === "bulletList" || kind === "orderedList";
    const headingLevel =
      kind === "heading" ? 2 : Number(kind.slice("heading".length));
    const listPattern = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/;
    const expression =
      isHeading || kind === "paragraph"
        ? /^( {0,3})#{1,6}\s+/
        : kind === "quote"
          ? /^(\s*)> ?/
          : isList
            ? listPattern
            : /^(\s*)[-*+]\s+\[[ xX]\]\s*/;
    const eligible = lines.filter(
      (line) => line.text.trim() || lines.length === 1,
    );
    const remove =
      eligible.length > 0 &&
      eligible.every((line) => {
        const match = expression.exec(line.text);
        if (!match) return false;
        if (isHeading && kind !== "heading")
          return match[0].match(/#/g)?.length === headingLevel;
        if (isList) {
          const marker = /^(\s*)([-*+]|\d+[.)])/.exec(line.text)?.[2] || "";
          const hasTask = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(line.text);
          return kind === "orderedList"
            ? /^\d+[.)]$/.test(marker) && !hasTask
            : /^[-*+]$/.test(marker) && !hasTask;
        }
        return true;
      });
    const prefix = isHeading
      ? `${"#".repeat(headingLevel)} `
      : kind === "paragraph"
        ? ""
        : kind === "quote"
          ? "> "
          : kind === "bulletList"
            ? "- "
            : "- [ ] ";
    const changes = eligible.map((line, index) => {
      const match = expression.exec(line.text);
      const indent = match
        ? match[1].length
        : line.text.match(/^\s*/)?.[0].length || 0;
      const bullet =
        kind === "task" && !match
          ? /^(\s*)(?:[-*+]|\d+[.)])\s+/.exec(line.text)
          : null;
      const listMarker = isList && !match ? listPattern.exec(line.text) : null;
      const insert = remove
        ? ""
        : kind === "orderedList"
          ? `${index + 1}. `
          : isList
            ? "- "
            : prefix;
      return {
        from: line.from + indent,
        to:
          line.from +
          (match?.[0].length ??
            bullet?.[0].length ??
            listMarker?.[0].length ??
            indent),
        insert,
      };
    });
    view.dispatch({
      changes,
      annotations: Transaction.userEvent.of("input.format"),
    });
  }
  view.focus();
}

function inYAMLFrontMatter(view: EditorView, position: number) {
  if (view.state.doc.lines < 2) return false;
  const first = view.state.doc.line(1).text.replace(/^\uFEFF/, "");
  if (first !== "---") return false;
  const scanEnd = Math.min(position, 64 * 1024);
  for (let number = 2; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    if (line.from > scanEnd) break;
    if (line.text === "---" || line.text === "...") return position <= line.to;
  }
  return position <= 64 * 1024;
}

function inMath(view: EditorView, position: number) {
  const line = view.state.doc.lineAt(position);
  const scanStart = Math.max(0, position - 64 * 1024);
  const firstLine = view.state.doc.lineAt(scanStart).number;
  let displayOpen = false;
  let fence: { character: string; length: number } | undefined;
  for (let number = firstLine; number <= line.number; number++) {
    const current = view.state.doc.line(number);
    const content =
      position < current.to
        ? current.text.slice(0, position - current.from)
        : current.text;
    const trimmed = content.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fence) {
      const close = trimmed.match(/^(`+|~+)/);
      if (
        close &&
        close[0][0] === fence.character &&
        close[0].length >= fence.length &&
        trimmed.slice(close[0].length).trim() === ""
      )
        fence = undefined;
      continue;
    }
    if (fenceMatch) {
      fence = { character: fenceMatch[0][0], length: fenceMatch[0].length };
      continue;
    }
    if (trimmed.startsWith("$$")) {
      const markers = trimmed.match(/\$\$/g)?.length || 0;
      if (markers % 2 === 1) displayOpen = !displayOpen;
    }
  }
  if (displayOpen) return true;
  let escaped = false;
  let inlineOpen = false;
  for (const char of view.state.sliceDoc(line.from, position)) {
    if (char === "\\" && !escaped) {
      escaped = true;
      continue;
    }
    if (char === "$" && !escaped) inlineOpen = !inlineOpen;
    escaped = false;
  }
  return inlineOpen;
}

function inProtectedPunctuationContext(view: EditorView, position: number) {
  if (inYAMLFrontMatter(view, position) || inMath(view, position)) return true;
  let node = syntaxTree(view.state).resolveInner(position, -1);
  while (node) {
    if (/Code/.test(node.name)) return true;
    node = node.parent!;
  }
  return false;
}

function smartQuote(view: EditorView, from: number, quote: string) {
  const before = from > 0 ? view.state.sliceDoc(from - 1, from) : "";
  const after = view.state.sliceDoc(from, from + 1);
  const opens =
    !before || /\s|[([{—–]/u.test(before) || (before === "-" && !after);
  return quote === "'" ? (opens ? "‘" : "’") : opens ? "“" : "”";
}

function applySmartPunctuation(
  view: EditorView,
  from: number,
  to: number,
  inserted: string,
  props: Props,
) {
  if (!props.smartQuotes && !props.smartDashes) return false;
  if (inserted.length !== 1 || inProtectedPunctuationContext(view, from))
    return false;

  let changeFrom = from;
  let changeTo = to;
  let replacement = inserted;
  if (props.smartQuotes && (inserted === "'" || inserted === '"')) {
    replacement = smartQuote(view, from, inserted);
  } else if (props.smartDashes && inserted === "-") {
    if (from >= 2 && view.state.sliceDoc(from - 2, from) === "--") {
      const line = view.state.doc.lineAt(from);
      const beforeDashes = view.state.sliceDoc(line.from, from - 2);
      if (beforeDashes.trim()) {
        changeFrom = from - 2;
        replacement = "—";
      }
    }
  } else if (props.smartDashes && inserted === " ") {
    const line = view.state.doc.lineAt(from);
    const linePrefix = view.state.sliceDoc(line.from, from);
    if (linePrefix.endsWith("--") && linePrefix.slice(0, -2).trim()) {
      changeFrom = from - 2;
      replacement = "– ";
    }
  }

  if (replacement === inserted && changeFrom === from) return false;
  changeTo = to;
  view.dispatch({
    changes: { from: changeFrom, to: changeTo, insert: replacement },
    selection: { anchor: changeFrom + replacement.length },
    annotations: Transaction.userEvent.of("input.type"),
  });
  return true;
}

function indentList(view: EditorView, direction: 1 | -1) {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from).number;
  const last = view.state.doc.lineAt(
    selection.to > selection.from ? selection.to - 1 : selection.to,
  ).number;
  const lines = Array.from({ length: last - first + 1 }, (_, index) =>
    view.state.doc.line(first + index),
  );
  const listPrefix = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s*)?/;
  if (!lines.some((line) => listPrefix.test(line.text))) return false;

  const changes: { from: number; to?: number; insert: string }[] = [];
  let currentItem: { indent: number; contentIndent: number } | null = null;
  for (const line of lines) {
    const marker = listPrefix.exec(line.text);
    if (marker) {
      const indent = marker[1].length;
      const markerWidth = marker[0].length - indent;
      currentItem = { indent, contentIndent: indent + markerWidth };
      if (direction > 0) {
        changes.push({ from: line.from, insert: "  " });
      } else {
        const remove = Math.min(2, indent);
        currentItem.indent -= remove;
        currentItem.contentIndent -= remove;
        if (remove)
          changes.push({
            from: line.from,
            to: line.from + remove,
            insert: "",
          });
      }
      continue;
    }
    if (!currentItem || !line.text.trim()) continue;
    const indentation = /^ */.exec(line.text)?.[0].length || 0;
    if (indentation < currentItem.contentIndent) {
      currentItem = null;
      continue;
    }
    if (direction > 0) {
      changes.push({ from: line.from, insert: "  " });
    } else {
      const remove = Math.min(
        2,
        indentation - currentItem.contentIndent + currentItem.indent,
      );
      if (remove)
        changes.push({
          from: line.from,
          to: line.from + remove,
          insert: "",
        });
    }
  }
  if (changes.length) {
    const transaction = view.state.update({
      changes,
      selection: view.state.selection.map(view.state.changes(changes)),
      annotations: Transaction.userEvent.of("input.indent"),
    });
    view.dispatch(transaction);
  }
  return true;
}

export const Editor = forwardRef<EditorHandle, Props>(
  function Editor(props, ref) {
    const { id, text, path, source, theme } = props;
    const spellCheck = props.spellCheck ?? false;
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const imageSizeTarget = useRef<{
      from: number;
      to: number;
      raw: string;
    } | null>(null);
    const docSnapshot = useRef("");
    const pendingChange = useRef<{
      view: EditorView;
      id: string;
      onChange: Props["onChange"];
      lineEnding: ReturnType<typeof detectLineEnding>;
    } | null>(null);
    const changeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const latest = useRef(props);
    const plainPaste = useRef(false);
    latest.current = props;
    const mode = useRef(new Compartment());
    const editability = useRef(new Compartment());
    const assetMode = useRef(new Compartment());
    const themeMode = useRef(new Compartment());
    const pending = useRef(new Set<{ from: number; to: number }>());

    const flushChange = () => {
      if (changeTimer.current) clearTimeout(changeTimer.current);
      changeTimer.current = null;
      const change = pendingChange.current;
      pendingChange.current = null;
      if (!change || view.current !== change.view) return;
      const value = change.view.state.doc.toString();
      docSnapshot.current = value.replace(/\r\n?/g, "\n");
      change.onChange(restoreLineEnding(value, change.lineEnding));
    };
    const flushChangeRef = useRef(flushChange);
    flushChangeRef.current = flushChange;

    const insertImages = async (files: File[]) => {
      const instance = view.current;
      if (!instance || !files.length) return;
      const point = {
        from: instance.state.selection.main.from,
        to: instance.state.selection.main.to,
      };
      pending.current.add(point);
      const handler = latest.current.onImages;
      try {
        const markdown = await handler(files);
        if (view.current !== instance) return;
        const insert = "\n\n" + markdown + "\n\n";
        instance.dispatch({
          changes: { from: point.from, to: point.to, insert },
          selection: { anchor: point.from + insert.length },
          annotations: Transaction.userEvent.of("input.image"),
        });
        instance.focus();
      } catch (error) {
        latest.current.onError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        pending.current.delete(point);
      }
    };
    const insertFileLink = async (target: string) => {
      const instance = view.current;
      if (!instance) return;
      const point = {
        from: instance.state.selection.main.from,
        to: instance.state.selection.main.to,
      };
      pending.current.add(point);
      try {
        const label = instance.state.sliceDoc(point.from, point.to);
        const insert = await latest.current.onFileLink(
          target,
          label || undefined,
        );
        if (view.current !== instance) return;
        instance.dispatch({
          changes: { from: point.from, to: point.to, insert },
          selection: { anchor: point.from + insert.length },
          annotations: Transaction.userEvent.of("input.link"),
        });
        instance.focus();
      } catch (error) {
        latest.current.onError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        pending.current.delete(point);
      }
    };
    const fileLinkRef = useRef(insertFileLink);
    fileLinkRef.current = insertFileLink;
    const insertRef = useRef(insertImages);
    insertRef.current = insertImages;

    useImperativeHandle(ref, () => ({
      fileLink(target) {
        return fileLinkRef.current(target);
      },
      focus() {
        view.current?.focus();
      },
      flush() {
        flushChangeRef.current();
      },
      selection() {
        const instance = view.current;
        if (!instance) return "";
        const { from, to } = instance.state.selection.main;
        return from === to ? "" : instance.state.sliceDoc(from, to);
      },
      go(pos) {
        const instance = view.current;
        if (!instance) return;
        pos = Math.min(instance.state.doc.length, Math.max(0, pos));
        instance.dispatch({
          selection: { anchor: pos },
          effects: EditorView.scrollIntoView(pos, { y: "start" }),
        });
        instance.focus();
      },
      find() {
        if (view.current) openSearchPanel(view.current);
      },
      undo() {
        if (view.current) {
          undo(view.current);
          view.current.focus();
        }
      },
      redo() {
        if (view.current) {
          redo(view.current);
          view.current.focus();
        }
      },
      format(kind, tableSize) {
        if (view.current) formatSelection(view.current, kind, tableSize);
      },
      imageSize() {
        const instance = view.current;
        if (!instance) return null;
        const position = instance.state.selection.main.from;
        let imageFrom = -1;
        syntaxTree(instance.state).iterate({
          enter(node) {
            if (
              node.name === "Image" &&
              position >= node.from &&
              position <= node.to
            )
              imageFrom = node.from;
          },
        });
        if (imageFrom < 0) return null;
        const line = instance.state.doc.lineAt(imageFrom);
        const rawLine = line.text.slice(imageFrom - line.from);
        const length = markdownImageEnd(rawLine);
        if (!length) return null;
        const raw = rawLine.slice(0, length);
        imageSizeTarget.current = {
          from: imageFrom,
          to: imageFrom + length,
          raw,
        };
        const sizing = markdownImageSizing(raw);
        return {
          width: sizing?.width ? String(sizing.width) : "",
          height: sizing?.height ? String(sizing.height) : "",
        };
      },
      setImageSize(width, height) {
        const instance = view.current;
        const target = imageSizeTarget.current;
        if (!instance || !target) return false;
        const widthValue = width.trim() ? Number(width) : undefined;
        const heightValue = height.trim() ? Number(height) : undefined;
        if (
          (widthValue !== undefined &&
            (!Number.isInteger(widthValue) ||
              widthValue < 1 ||
              widthValue > 4096)) ||
          (heightValue !== undefined &&
            (!Number.isInteger(heightValue) ||
              heightValue < 1 ||
              heightValue > 4096)) ||
          instance.state.doc.sliceString(target.from, target.to) !== target.raw
        )
          return false;
        const sizing = markdownImageSizing(target.raw);
        const base = sizing?.raw || target.raw;
        if (!base.endsWith(")")) return false;
        const updated =
          widthValue === undefined && heightValue === undefined
            ? base
            : `${base.slice(0, -1)} =${widthValue || ""}x${heightValue || ""})`;
        instance.dispatch({
          changes: { from: target.from, to: target.to, insert: updated },
          selection: { anchor: target.from + updated.length },
          annotations: Transaction.userEvent.of("input.image-size"),
        });
        imageSizeTarget.current = null;
        instance.focus();
        return true;
      },
      images: insertImages,
      forget(key) {
        sessions.delete(key);
      },
    }));

    useEffect(() => {
      if (!host.current) return;
      const commands = keymap.of([
        {
          key: "Mod-b",
          run: (v) => {
            formatSelection(v, "bold");
            return true;
          },
        },
        {
          key: "Mod-i",
          run: (v) => {
            formatSelection(v, "italic");
            return true;
          },
        },
        {
          key: "Mod-Shift-h",
          run: (v) => {
            formatSelection(v, "highlight");
            return true;
          },
        },
        {
          key: "Mod-k",
          run: (v) => {
            formatSelection(v, "link");
            return true;
          },
        },
        {
          key: "Mod-Shift-5",
          run: (v) => {
            formatSelection(v, "strike");
            return true;
          },
        },
        {
          key: "Mod-Shift-`",
          run: (v) => {
            formatSelection(v, "code");
            return true;
          },
        },
        {
          key: "Mod-Shift-q",
          run: (v) => {
            formatSelection(v, "quote");
            return true;
          },
        },
        {
          key: "Mod-*",
          run: (v) => {
            formatSelection(v, "bulletList");
            return true;
          },
        },
        {
          key: "Mod-Shift-8",
          run: (v) => {
            formatSelection(v, "bulletList");
            return true;
          },
        },
        {
          key: "Mod-&",
          run: (v) => {
            formatSelection(v, "orderedList");
            return true;
          },
        },
        {
          key: "Mod-Shift-7",
          run: (v) => {
            formatSelection(v, "orderedList");
            return true;
          },
        },
        {
          key: "Mod-Shift-l",
          run: (v) => {
            formatSelection(v, "task");
            return true;
          },
        },
        {
          key: "Mod-Shift-k",
          run: (v) => {
            formatSelection(v, "codeblock");
            return true;
          },
        },
        ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
          key: `Mod-${level}`,
          run: (v: EditorView) => {
            formatSelection(v, `heading${level}`);
            return true;
          },
        })),
        {
          key: "Mod-0",
          run: (v) => {
            formatSelection(v, "paragraph");
            return true;
          },
        },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        {
          ...indentWithTab,
          run: (view) => indentList(view, 1) || indentMore(view),
          shift: (view) => indentList(view, -1) || indentLess(view),
        },
      ]);
      const cached = sessions.get(id);
      const normalized = text.replace(/\r\n?/g, "\n");
      const state =
        cached?.doc.toString() === normalized
          ? cached
          : EditorState.create({
              doc: text,
              selection: { anchor: normalized.length },
              extensions: [
                history(),
                linkHandler.of((href) => latest.current.onLink(href)),
                drawSelection(),
                highlightActiveLine(),
                markdown({ codeLanguages: languages, extensions: [GFM] }),
                EditorView.inputHandler.of((instance, from, to, inserted) =>
                  applySmartPunctuation(
                    instance,
                    from,
                    to,
                    inserted,
                    latest.current,
                  ),
                ),
                EditorState.languageData.of(() => [
                  {
                    closeBrackets: { brackets: ["(", "[", "{", "'", '"', "`"] },
                  },
                ]),
                closeBrackets(),
                syntaxHighlighting(
                  HighlightStyle.define([
                    { tag: tags.keyword, color: "#a45292" },
                    { tag: tags.string, color: "#548260" },
                    { tag: tags.comment, color: "#7b8490" },
                    { tag: tags.number, color: "#b5763c" },
                    { tag: tags.function(tags.variableName), color: "#4b7eab" },
                  ]),
                ),
                syntaxHighlighting(defaultHighlightStyle),
                search({ top: true }),
                commands,
                EditorView.lineWrapping,
                EditorView.contentAttributes.of({
                  "aria-label": "Markdown 编辑区",
                  lang: "zh-CN",
                  spellcheck: String(spellCheck),
                }),
                mode.current.of(source ? [] : [livePreview]),
                editability.current.of([
                  EditorState.readOnly.of(Boolean(latest.current.readOnly)),
                  EditorView.editable.of(!latest.current.readOnly),
                ]),
                EditorState.transactionFilter.of((transaction) =>
                  transaction.docChanged &&
                  latest.current.readOnly &&
                  !transaction.isUserEvent("input.external")
                    ? []
                    : transaction,
                ),
                assetMode.current.of(documentPath.of(path)),
                themeMode.current.of(
                  previewTheme.of(latest.current.theme || "light"),
                ),
                EditorView.domEventObservers({
                  keydown(event) {
                    plainPaste.current =
                      event.shiftKey &&
                      (event.metaKey || event.ctrlKey) &&
                      event.key.toLowerCase() === "v";
                  },
                  keyup() {
                    plainPaste.current = false;
                  },
                }),
                EditorView.domEventHandlers({
                  contextmenu(event, instance) {
                    if (
                      event.defaultPrevented ||
                      (event.target as Element).closest(
                        '[contenteditable="false"]',
                      )
                    )
                      return false;
                    event.preventDefault();
                    const position = instance.posAtCoords({
                      x: event.clientX,
                      y: event.clientY,
                    });
                    const { from, to } = instance.state.selection.main;
                    if (position !== null && (position < from || position > to))
                      instance.dispatch({ selection: { anchor: position } });
                    latest.current.onContextMenu({
                      left: event.clientX,
                      top: event.clientY,
                    });
                    return true;
                  },
                  keydown(event, instance) {
                    if (
                      event.key !== "ContextMenu" &&
                      !(event.shiftKey && event.key === "F10")
                    )
                      return false;
                    event.preventDefault();
                    const bounds = instance.coordsAtPos(
                      instance.state.selection.main.head,
                    );
                    if (bounds)
                      latest.current.onContextMenu({
                        left: bounds.left,
                        top: bounds.bottom,
                      });
                    return true;
                  },
                  copy(event, instance) {
                    if (latest.current.copyFormat !== "rich-text") return false;
                    const { from, to } = instance.state.selection.main;
                    if (from === to) return false;
                    const selected = instance.state.sliceDoc(from, to);
                    event.preventDefault();
                    void latest.current.onCopyRichText(selected);
                    return true;
                  },
                  paste(event, instance) {
                    const files = Array.from(
                      event.clipboardData?.files || [],
                    ).filter((file) => imageTypes.has(file.type));
                    if (!files.length) {
                      const bypass =
                        plainPaste.current || latest.current.source;
                      plainPaste.current = false;
                      if (bypass) return false;
                      const html =
                        event.clipboardData?.getData("text/html") || "";
                      let markdown: string | null;
                      try {
                        markdown = clipboardMarkdown(html);
                      } catch {
                        latest.current.onError(
                          "网页格式无法转换，已改为粘贴纯文本。",
                        );
                        return false;
                      }
                      if (!markdown) return false;
                      event.preventDefault();
                      instance.dispatch(
                        instance.state.replaceSelection(markdown),
                        {
                          userEvent: "input.paste",
                          scrollIntoView: true,
                        },
                      );
                      return true;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    void insertRef.current(files);
                    return true;
                  },
                  dragover(event) {
                    if (
                      event.dataTransfer?.types.includes(
                        "application/x-moxie-path",
                      )
                    ) {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "copy";
                      return true;
                    }
                    if (event.dataTransfer?.types.includes("Files")) {
                      event.preventDefault();
                      return true;
                    }
                    return false;
                  },
                  drop(event, instance) {
                    const target = event.dataTransfer?.getData(
                      "application/x-moxie-path",
                    );
                    if (target) {
                      event.preventDefault();
                      event.stopPropagation();
                      const pos = instance.posAtCoords({
                        x: event.clientX,
                        y: event.clientY,
                      });
                      if (pos !== null)
                        instance.dispatch({ selection: { anchor: pos } });
                      void fileLinkRef.current(target);
                      return true;
                    }
                    const files = Array.from(
                      event.dataTransfer?.files || [],
                    ).filter((file) => imageTypes.has(file.type));
                    if (!files.length) return false;
                    event.preventDefault();
                    event.stopPropagation();
                    const pos = instance.posAtCoords({
                      x: event.clientX,
                      y: event.clientY,
                    });
                    if (pos !== null)
                      instance.dispatch({ selection: { anchor: pos } });
                    void insertRef.current(files);
                    return true;
                  },
                }),
                EditorView.updateListener.of((update) => {
                  if (update.selectionSet || update.docChanged) {
                    const position = update.state.selection.main.head;
                    const line = update.state.doc.lineAt(position);
                    const range = update.state.selection.main;
                    const start = range.empty
                      ? null
                      : update.view.coordsAtPos(range.from);
                    const end = range.empty
                      ? null
                      : update.view.coordsAtPos(range.to);
                    latest.current.onCursorChange(
                      position,
                      line.number,
                      Array.from(update.state.sliceDoc(line.from, position))
                        .length + 1,
                      update.state.sliceDoc(
                        update.state.selection.main.from,
                        update.state.selection.main.to,
                      ),
                      start && end
                        ? {
                            top: Math.min(start.top, end.top),
                            left: (start.left + end.right) / 2,
                          }
                        : undefined,
                    );
                  }
                  if (
                    latest.current.typewriter &&
                    (update.docChanged || update.selectionSet)
                  )
                    requestAnimationFrame(() => {
                      if (view.current === update.view)
                        update.view.dispatch({
                          effects: EditorView.scrollIntoView(
                            update.view.state.selection.main.head,
                            { y: "center" },
                          ),
                        });
                    });
                  if (!update.docChanged) return;
                  latest.current.onMapPositions((position) => {
                    let insertedAtPosition = false;
                    update.changes.iterChanges((from, to) => {
                      if (from === position && to === position)
                        insertedAtPosition = true;
                    });
                    return update.changes.mapPos(
                      position,
                      insertedAtPosition ? 1 : -1,
                    );
                  });
                  latest.current.onDirty();
                  window.desktop?.dirty(true);
                  pending.current.forEach((point) => {
                    point.from = update.changes.mapPos(point.from);
                    point.to = update.changes.mapPos(point.to, 1);
                  });
                  pendingChange.current = {
                    view: update.view,
                    id,
                    onChange: latest.current.onChange,
                    lineEnding: detectLineEnding(latest.current.text),
                  };
                  if (changeTimer.current) clearTimeout(changeTimer.current);
                  changeTimer.current = setTimeout(
                    () => flushChangeRef.current(),
                    400,
                  );
                }),
              ],
            });
      const instance = new EditorView({ parent: host.current, state });
      view.current = instance;
      const reportSelectionAnchor = () => {
        const range = instance.state.selection.main;
        if (range.empty) return;
        const start = instance.coordsAtPos(range.from);
        const end = instance.coordsAtPos(range.to);
        if (!start || !end) return;
        const position = range.head;
        const line = instance.state.doc.lineAt(position);
        latest.current.onCursorChange(
          position,
          line.number,
          Array.from(instance.state.sliceDoc(line.from, position)).length + 1,
          instance.state.sliceDoc(range.from, range.to),
          {
            top: Math.min(start.top, end.top),
            left: (start.left + end.right) / 2,
          },
        );
      };
      instance.scrollDOM.addEventListener("scroll", reportSelectionAnchor, {
        passive: true,
      });
      window.addEventListener("resize", reportSelectionAnchor, {
        passive: true,
      });
      const cursor = instance.state.selection.main.head;
      const line = instance.state.doc.lineAt(cursor);
      latest.current.onCursorChange(
        cursor,
        line.number,
        Array.from(instance.state.sliceDoc(line.from, cursor)).length + 1,
        instance.state.sliceDoc(
          instance.state.selection.main.from,
          instance.state.selection.main.to,
        ),
        undefined,
      );
      docSnapshot.current = instance.state.doc
        .toString()
        .replace(/\r\n?/g, "\n");
      return () => {
        if (pendingChange.current?.id === id) flushChangeRef.current();
        instance.scrollDOM.removeEventListener("scroll", reportSelectionAnchor);
        window.removeEventListener("resize", reportSelectionAnchor);
        sessions.set(id, instance.state);
        instance.destroy();
        view.current = null;
        pending.current.clear();
      };
    }, [id]);
    useEffect(() => {
      const beforeUnload = () => flushChangeRef.current();
      window.addEventListener("beforeunload", beforeUnload, true);
      return () =>
        window.removeEventListener("beforeunload", beforeUnload, true);
    }, []);
    useEffect(() => {
      view.current?.dispatch({
        effects: mode.current.reconfigure(source ? [] : [livePreview]),
      });
    }, [id, source]);
    useEffect(() => {
      view.current?.dispatch({
        effects: editability.current.reconfigure([
          EditorState.readOnly.of(Boolean(props.readOnly)),
          EditorView.editable.of(!props.readOnly),
        ]),
      });
      view.current?.contentDOM.setAttribute(
        "aria-readonly",
        String(Boolean(props.readOnly)),
      );
    }, [id, props.readOnly]);
    useEffect(() => {
      view.current?.dispatch({
        effects: themeMode.current.reconfigure(
          previewTheme.of(theme || "light"),
        ),
      });
    }, [id, theme]);
    useEffect(() => {
      view.current?.dispatch({
        effects: assetMode.current.reconfigure(documentPath.of(path)),
      });
    }, [id, path]);
    useEffect(() => {
      const content = view.current?.contentDOM;
      if (content) content.setAttribute("spellcheck", String(spellCheck));
    }, [id, spellCheck]);
    useEffect(() => {
      const instance = view.current;
      const normalized = text.replace(/\r\n?/g, "\n");
      if (!instance || docSnapshot.current === normalized) return;
      instance.dispatch({
        changes: { from: 0, to: instance.state.doc.length, insert: text },
        annotations: Transaction.userEvent.of("input.external"),
      });
    }, [text, id]);
    return (
      <div
        className={"editor-host " + (source ? "source-mode" : "")}
        ref={host}
      />
    );
  },
);
