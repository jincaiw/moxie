import { EditorView, WidgetType } from "@codemirror/view";
import { Transaction } from "@codemirror/state";
import { undo, redo } from "@codemirror/commands";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  parseTable,
  cellValue,
  escapeCell,
  serializeTable,
  parseClipboardTable,
} from "./table";

type Context = { widget: TableWidget; row: number; col: number };
const contexts = new WeakMap<HTMLElement, Context>();
const positions = new WeakMap<
  EditorView,
  Map<number, { row: number; col: number }>
>();
const html = (text: string) =>
  DOMPurify.sanitize(marked.parseInline(text, { async: false }) as string);

export class TableWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly from: number,
    readonly to: number,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return this.text === other.text && this.from === other.from;
  }
  updateDOM(el: HTMLElement) {
    const context = contexts.get(el);
    const before = context && parseTable(context.widget.text);
    const after = parseTable(this.text);
    if (
      !context ||
      before!.columns !== after.columns ||
      before!.rows.length !== after.rows.length
    )
      return false;
    context.widget = this;
    el.querySelectorAll<HTMLElement>("[data-cell]").forEach((cell) => {
      const [row, col] = cell.dataset.cell!.split(":").map(Number);
      const input = cell.querySelector("input");
      const value = after.rows[row]?.[col]?.text || "";
      if (!input) cell.innerHTML = html(value);
      else if (input.value !== cellValue(value)) input.value = cellValue(value);
    });
    return true;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "render-block table editable-table";
    let selected = positions.get(view);
    if (!selected) {
      selected = new Map();
      positions.set(view, selected);
    }
    const last = selected.get(this.from);
    const context: Context = {
      widget: this,
      row: last?.row ?? 1,
      col: last?.col ?? 0,
    };
    el.dataset.tableStart = String(this.from);
    contexts.set(el, context);
    const tools = document.createElement("div");
    tools.className = "table-tools";
    tools.setAttribute("aria-label", "表格操作");
    const button = (label: string, operation: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", operation);
      tools.append(btn);
    };
    const changeShape = (
      operation: (rows: string[][], ctx: Context) => void,
    ) => {
      (el.querySelector("input") as HTMLInputElement | null)?.blur();
      const ctx = contexts.get(el)!;
      const model = parseTable(ctx.widget.text);
      const rows = model.rows.map((row) =>
        Array.from({ length: model.columns }, (_, c) => row[c]?.text || ""),
      );
      operation(rows, ctx);
      selected!.set(ctx.widget.from, { row: ctx.row, col: ctx.col });
      const from = ctx.widget.from;
      view.dispatch({
        changes: {
          from: ctx.widget.from,
          to: ctx.widget.to,
          insert: serializeTable(rows),
        },
        annotations: Transaction.userEvent.of("input.table"),
      });
      requestAnimationFrame(() => {
        const cell = view.dom.querySelector<HTMLElement>(
          `[data-table-start="${from}"] [data-cell="${ctx.row}:${ctx.col}"]`,
        );
        cell?.focus();
      });
    };
    button("添加行", () =>
      changeShape((rows, ctx) => {
        ctx.row = Math.min(ctx.row + 1, rows.length);
        rows.splice(ctx.row, 0, Array(rows[0].length).fill(""));
      }),
    );
    button("添加列", () =>
      changeShape((rows, ctx) => {
        ctx.col = Math.min(ctx.col + 1, rows[0].length);
        rows.forEach((row) => row.splice(ctx.col, 0, ""));
      }),
    );
    button("删除行", () =>
      changeShape((rows, ctx) => {
        if (rows.length > 1 && ctx.row > 0) {
          rows.splice(Math.min(ctx.row, rows.length - 1), 1);
          ctx.row = Math.min(ctx.row, rows.length - 1);
        }
      }),
    );
    button("删除列", () =>
      changeShape((rows, ctx) => {
        if (rows[0].length > 1) {
          rows.forEach((row) => row.splice(ctx.col, 1));
          ctx.col = Math.min(ctx.col, rows[0].length - 1);
        }
      }),
    );
    button("编辑原文", () => {
      const widget = contexts.get(el)!.widget;
      view.dispatch({ selection: { anchor: widget.from } });
      view.focus();
    });
    el.append(tools);
    const table = document.createElement("table");
    const model = parseTable(this.text);
    model.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      Array.from({ length: model.columns }, (_, c) => {
        const cell = document.createElement(r === 0 ? "th" : "td");
        cell.dataset.cell = `${r}:${c}`;
        cell.innerHTML = html(row[c]?.text || "");
        cell.tabIndex = 0;
        cell.setAttribute("aria-label", `表格第 ${r + 1} 行第 ${c + 1} 列`);
        const startEditing = () => {
          if (cell.querySelector("input")) return;
          context.row = r;
          context.col = c;
          selected!.set(context.widget.from, { row: r, col: c });
          const input = document.createElement("input");
          input.type = "text";
          input.className = "table-cell-input";
          input.setAttribute("aria-label", `编辑第 ${r + 1} 行第 ${c + 1} 列`);
          input.value = cellValue(
            parseTable(context.widget.text).rows[r]?.[c]?.text || "",
          );
          const write = () => {
            const widget = context.widget;
            const current = parseTable(widget.text);
            const target = current.rows[r]?.[c];
            const value = escapeCell(input.value);
            if (target && target.text === value) return;
            if (target)
              view.dispatch({
                changes: {
                  from: widget.from + target.from,
                  to: widget.from + target.to,
                  insert: value,
                },
                annotations: Transaction.userEvent.of("input.table"),
              });
            else {
              const rows = current.rows.map((row) =>
                Array.from(
                  { length: current.columns },
                  (_, i) => row[i]?.text || "",
                ),
              );
              rows[r][c] = value;
              view.dispatch({
                changes: {
                  from: widget.from,
                  to: widget.to,
                  insert: serializeTable(rows, current.separator),
                },
                annotations: Transaction.userEvent.of("input.table"),
              });
            }
          };
          input.addEventListener("input", write);
          input.addEventListener("paste", (event) => {
            const pasted = event.clipboardData?.getData("text/plain") || "";
            if (!/[\t\r\n]/.test(pasted)) return;
            const pastedRows = parseClipboardTable(pasted);
            if (!pastedRows.length) return;
            event.preventDefault();
            changeShape((rows, ctx) => {
              const targetRow = r;
              const targetCol = c;
              const requiredColumns = Math.max(
                rows[0].length,
                targetCol + Math.max(...pastedRows.map((row) => row.length)),
              );
              rows.forEach((row) => {
                while (row.length < requiredColumns) row.push("");
              });
              pastedRows.forEach((pastedRow, rowIndex) => {
                const row = targetRow + rowIndex;
                while (rows.length <= row)
                  rows.push(Array(requiredColumns).fill(""));
                pastedRow.forEach((value, columnIndex) => {
                  rows[row][targetCol + columnIndex] = escapeCell(value);
                });
              });
              ctx.row = Math.min(
                targetRow + pastedRows.length - 1,
                rows.length - 1,
              );
              ctx.col = Math.min(
                targetCol + pastedRows.at(-1)!.length - 1,
                requiredColumns - 1,
              );
            });
          });
          input.addEventListener("blur", () => {
            cell.innerHTML = html(
              parseTable(context.widget.text).rows[r]?.[c]?.text || "",
            );
          });
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              input.blur();
              cell.focus();
            }
            if (e.key === "Tab") {
              e.preventDefault();
              input.blur();
              const cells = Array.from(
                el.querySelectorAll<HTMLElement>("[data-cell]"),
              );
              const next = cells[cells.indexOf(cell) + (e.shiftKey ? -1 : 1)];
              if (next) {
                next.focus();
                next.click();
              } else if (!e.shiftKey) {
                changeShape((rows, ctx) => {
                  ctx.row = rows.length;
                  ctx.col = 0;
                  rows.push(Array(rows[0].length).fill(""));
                });
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    view.dom
                      .querySelector<HTMLElement>(
                        `[data-table-start="${context.widget.from}"] [data-cell="${context.row}:${context.col}"]`,
                      )
                      ?.click();
                  });
                });
              } else view.focus();
            }
          });
          cell.replaceChildren(input);
          input.focus();
          input.select();
        };
        cell.addEventListener("click", startEditing);
        cell.addEventListener("keydown", (e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === cell) {
            e.preventDefault();
            startEditing();
            return;
          }
          if (e.target !== cell) return;
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
          };
          const movement = delta[e.key];
          if (!movement) return;
          const next = el.querySelector<HTMLElement>(
            `[data-cell="${r + movement[0]}:${c + movement[1]}"]`,
          );
          if (next) {
            e.preventDefault();
            next.focus();
          }
        });
        tr.append(cell);
      });
      (r === 0
        ? table.tHead || table.createTHead()
        : table.tBodies[0] || table.createTBody()
      ).append(tr);
    });
    el.append(table);
    el.addEventListener("keydown", (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "z" &&
        !event.isComposing
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) redo(view);
        else undo(view);
      }
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}
