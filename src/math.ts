import type { KatexOptions } from "katex";

export type InlineMathMatch = {
  from: number;
  to: number;
  raw: string;
  text: string;
};

export function inlineMathMatches(source: string): InlineMathMatch[] {
  const matches: InlineMathMatch[] = [];
  let opening = -1;
  let slashCount = 0;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (char === "\\") {
      slashCount++;
      continue;
    }
    const escaped = slashCount % 2 === 1;
    slashCount = 0;
    if (char === "\n") {
      opening = -1;
      continue;
    }
    if (
      char !== "$" ||
      escaped ||
      source[index - 1] === "$" ||
      source[index + 1] === "$"
    )
      continue;
    if (opening < 0) {
      if (source[index + 1] && !/\s/.test(source[index + 1])) opening = index;
      continue;
    }
    if (index !== opening + 1 && !/\s/.test(source[index - 1])) {
      const to = index + 1;
      matches.push({
        from: opening,
        to,
        raw: source.slice(opening, to),
        text: source.slice(opening + 1, index),
      });
      opening = -1;
      continue;
    }
    // A delimiter that cannot close the current span may begin a later formula.
    opening = source[index + 1] && !/\s/.test(source[index + 1]) ? index : -1;
  }
  return matches;
}

let katexModule: Promise<typeof import("katex")> | undefined;

function loadKatex() {
  katexModule ??= Promise.all([
    import("katex"),
    import("katex/dist/katex.min.css"),
  ]).then(([module]) => module);
  return katexModule;
}

export async function renderMath(source: string, options: KatexOptions = {}) {
  const katex = await loadKatex();
  return katex.default.renderToString(source, options);
}
