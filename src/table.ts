export type Cell = { text: string; from: number; to: number };
export type TableModel = { rows: Cell[][]; separator: string; columns: number };

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
  const lines = text.split("\n");
  let offset = 0;
  const parsed = lines.map((line) => {
    const cells = splitRow(line, offset);
    offset += line.length + 1;
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
export function serializeTable(rows: string[][], separator?: string): string {
  const columns = rows[0].length;
  const line = (row: string[]) =>
    "| " +
    Array.from({ length: columns }, (_, i) => row[i] || "").join(" | ") +
    " |";
  return [
    line(rows[0]),
    separator || line(Array(columns).fill("---")),
    ...rows.slice(1).map(line),
  ].join("\n");
}
