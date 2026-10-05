import {
  defaultHighlightStyle,
  LanguageDescription,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightTree } from "@lezer/highlight";

export async function highlightCodeElement(
  element: HTMLElement,
  source: string,
  language: string,
) {
  const description = LanguageDescription.matchLanguageName(
    languages,
    language,
    true,
  );
  if (!description) return;
  try {
    const support = await description.load();
    const tree = support.language.parser.parse(source);
    const ranges: { from: number; to: number; classes: string }[] = [];
    highlightTree(tree, defaultHighlightStyle, (from, to, classes) => {
      if (classes) ranges.push({ from, to, classes });
    });
    if (!element.isConnected) return;
    const output = document.createDocumentFragment();
    let position = 0;
    for (const range of ranges) {
      if (range.from > position)
        output.append(source.slice(position, range.from));
      const token = document.createElement("span");
      token.className = `md-code-token ${range.classes}`;
      token.textContent = source.slice(range.from, range.to);
      output.append(token);
      position = range.to;
    }
    if (position < source.length) output.append(source.slice(position));
    element.replaceChildren(output);
  } catch {
    // Keep the plain-text code block if a language module cannot be loaded.
  }
}
