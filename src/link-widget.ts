import { Facet } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { usableLink } from "./links";
import { inlineMathMatches, renderMath } from "./math";
export const linkHandler = Facet.define<
  (href: string) => void,
  (href: string) => void
>({ combine: (values) => values[0] || (() => {}) });
export class LinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly href: string,
    readonly from: number,
  ) {
    super();
  }
  eq(other: LinkWidget) {
    return (
      this.label === other.label &&
      this.href === other.href &&
      this.from === other.from
    );
  }
  toDOM(view: EditorView) {
    const anchor = document.createElement("a");
    anchor.className = "rendered-link";
    anchor.href = usableLink(this.href) ? this.href : "#";
    anchor.dataset.mdLink = this.href;
    anchor.title = `${this.href}\n⌘/Ctrl + 单击打开，单击编辑`;
    anchor.innerHTML = DOMPurify.sanitize(
      marked.parseInline(this.label, { async: false }) as string,
      { ALLOWED_TAGS: ["strong", "em", "s", "code", "br"], ALLOWED_ATTR: [] },
    );
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    for (const textNode of textNodes) {
      if (textNode.parentElement?.closest("code")) continue;
      const matches = inlineMathMatches(textNode.data);
      for (const match of matches.reverse()) {
        const formula = document.createElement("span");
        formula.className = "inline-formula";
        formula.textContent = match.text;
        formula.title = "点击编辑公式";
        textNode.splitText(match.to);
        const source = textNode.splitText(match.from);
        source.replaceWith(formula);
        void renderMath(match.text, { throwOnError: false, trust: false })
          .then((html) => {
            if (formula.isConnected) formula.innerHTML = html;
          })
          .catch(() => {});
      }
    }
    if (!anchor.textContent?.trim()) anchor.textContent = this.label;
    const click = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.button === 1 ||
        event.detail === 0
      )
        view.state.facet(linkHandler)(this.href);
      else {
        view.dispatch({ selection: { anchor: this.from } });
        view.focus();
      }
    };
    anchor.addEventListener("click", click);
    anchor.addEventListener("auxclick", click);
    return anchor;
  }
  ignoreEvent() {
    return true;
  }
}
