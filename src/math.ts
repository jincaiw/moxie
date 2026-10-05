import type { KatexOptions } from "katex";

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
