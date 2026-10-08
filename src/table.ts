export type Cell = { text: string; from: number; to: number };
export type TableModel = { rows: Cell[][]; separator: string; columns: number };

export function tableLineEnding(text: string) {
  return /\r\n|\r|\n/.exec(text)?.[0] || "\n";
}

function splitRow(line: string, offset: number): Cell[] {
  const cuts: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== "|") continue;
    let slashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j--) slashes++;
    if (slashes % 2 === 0) cuts.push(i);
  }
  const start = cuts[0] === line.search(/\S/) ? cuts.shift()! + 1 : 0;
  const last = cuts.at(-1);
  const end =
    last !== undefined && !line.slice(last + 1).trim()
      ? cuts.pop()!
      : line.length;
  const boundaries = [start - 1, ...cuts, end];
  return boundaries.slice(1).map((right, i) => {
    const left = boundaries[i] + 1;
    const value = line.slice(left, right);
    const leading = value.length - value.trimStart().length;
    const trimmed = value.trim();
    return {
      text: trimmed,
      from: offset + left + leading,
      to: offset + left + leading + trimmed.length,
    };
  });
}

export function parseTable(text: string): TableModel {
  const lineBreaks = [...text.matchAll(/\r\n|\r|\n/g)];
  const lines = text.split(/\r\n|\r|\n/);
  let offset = 0;
  const parsed = lines.map((line, index) => {
    const cells = splitRow(line, offset);
    offset += line.length + (lineBreaks[index]?.[0].length || 0);
    return cells;
  });
  return {
    rows: [parsed[0], ...parsed.slice(2)],
    separator: lines[1] || "",
    columns: parsed[0].length,
  };
}

export function cellValue(value: string) {
  return value.replace(/\\\|/g, "|");
}
export function escapeCell(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
}
export function parseClipboardTable(value: string): string[][] {
  if (!value) return [];
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quoted) {
      if (char === '"' && value[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"' && !cell) quoted = true;
    else if (char === "\t") {
      rows.at(-1)!.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      rows.at(-1)!.push(cell);
      cell = "";
      if (char === "\r" && value[i + 1] === "\n") i++;
      rows.push([]);
    } else cell += char;
  }
  rows.at(-1)!.push(cell);
  if (rows.length > 1 && rows.at(-1)!.length === 1 && !rows.at(-1)![0])
    rows.pop();
  return rows;
}
export function serializeTable(
  rows: string[][],
  separator?: string,
  lineEnding = "\n",
): string {
  const columns = rows[0].length;
  const separatorLine = separator
    ? resizeSeparator(separator, columns)
    : undefined;
  const line = (row: string[]) =>
    "| " +
    Array.from({ length: columns }, (_, i) => row[i] || "").join(" | ") +
    " |";
  return [
    line(rows[0]),
    separatorLine || line(Array(columns).fill("---")),
    ...rows.slice(1).map(line),
  ].join(lineEnding);
}

function resizeSeparator(separator: string, columns: number) {
  const cells = separator
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  while (cells.length < columns) cells.push("---");
  return `| ${cells.slice(0, columns).join(" | ")} |`;
}

export type TableAlignment = "left" | "center" | "right";

export function tableColumnAlignment(
  separator: string,
  column: number,
): TableAlignment | undefined {
  const cells = separator
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  const cell = cells[column] || "";
  if (/^:-+:$/.test(cell)) return "center";
  if (/^:-+$/.test(cell)) return "left";
  if (/^-+:$/.test(cell)) return "right";
  return undefined;
}

export function setTableColumnAlignment(
  separator: string,
  columns: number,
  column: number,
  alignment: TableAlignment,
): string {
  const cells = separator
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  while (cells.length < columns) cells.push("---");
  const current = cells[column] || "---";
  const dashes = Math.max(3, current.replace(/:/g, "").length);
  cells[column] =
    alignment === "left"
      ? `:${"-".repeat(dashes)}`
      : alignment === "center"
        ? `:${"-".repeat(dashes)}:`
        : `${"-".repeat(dashes)}:`;
  return `| ${cells.slice(0, columns).join(" | ")} |`;
}

export function moveTableRow(
  rows: string[][],
  from: number,
  to: number,
): string[][] {
  const moved = rows.map((row) => [...row]);
  if (
    from < 1 ||
    from >= moved.length ||
    to < 1 ||
    to >= moved.length ||
    from === to
  )
    return moved;
  const [row] = moved.splice(from, 1);
  moved.splice(to, 0, row);
  return moved;
}

export function moveTableColumn(
  rows: string[][],
  separator: string,
  from: number,
  to: number,
): { rows: string[][]; separator: string } {
  const columns = rows[0]?.length || 0;
  const movedRows = rows.map((row) => [...row]);
  if (from < 0 || from >= columns || to < 0 || to >= columns || from === to)
    return { rows: movedRows, separator };
  for (const row of movedRows) {
    const [cell] = row.splice(from, 1);
    row.splice(to, 0, cell);
  }
  const cells = separator
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
  while (cells.length < columns) cells.push("---");
  const [alignment] = cells.splice(from, 1);
  cells.splice(to, 0, alignment);
  return {
    rows: movedRows,
    separator: `| ${cells.slice(0, columns).join(" | ")} |`,
  };
}
