import { Facet } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { usableLink } from "./links";
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
