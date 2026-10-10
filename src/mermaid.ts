import DOMPurify from "dompurify";

let mermaidModule: Promise<typeof import("mermaid")> | undefined;
let renderQueue: Promise<void> = Promise.resolve();
let renderId = 0;

export function renderMermaid(source: string, theme: "dark" | "default") {
  const task = renderQueue.then(async () => {
    mermaidModule ??= import("mermaid");
    const { default: mermaid } = await mermaidModule;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme,
      htmlLabels: false,
    });
    const result = await mermaid.render(`moxie-mermaid-${++renderId}`, source);
    return DOMPurify.sanitize(result.svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
    });
  });
  renderQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}
