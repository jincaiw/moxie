import { Facet } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";
import { Marked } from "marked";
import DOMPurify from "dompurify";
import { usableLink } from "./links";
import { resolveImage } from "./assets";
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
    readonly linkTitle = "",
    readonly path?: string,
  ) {
    super();
  }
  eq(other: LinkWidget) {
    return (
      this.label === other.label &&
      this.href === other.href &&
      this.from === other.from &&
      this.linkTitle === other.linkTitle &&
      this.path === other.path
    );
  }
  toDOM(view: EditorView) {
    const anchor = document.createElement("a");
    anchor.className = "rendered-link";
    let displayHref = this.href;
    try {
      displayHref = encodeURI(displayHref)
        .replace(/\|/g, "%7C")
        .replace(/%25/g, "%");
    } catch {
      displayHref = "#";
    }
    anchor.href = usableLink(this.href) ? displayHref : "#";
    anchor.dataset.mdLink = this.href;
    anchor.title = [this.linkTitle, this.href, "⌘/Ctrl + 单击打开，单击编辑"]
      .filter(Boolean)
      .join("\n");
    const formulas: string[] = [];
    const images: { src: string; alt: string; title: string }[] = [];
    const labelParser = new Marked();
    labelParser.use({
      renderer: {
        image({ href, text, title }) {
          const index =
            images.push({ src: href, alt: text, title: title || "" }) - 1;
          return `\uE002${index}\uE003`;
        },
      },
      extensions: [
        {
          name: "linkLabelMath",
          level: "inline",
          start(source) {
            return inlineMathMatches(source)[0]?.from;
          },
          tokenizer(source) {
            const match = inlineMathMatches(source)[0];
            if (match?.from === 0)
              return {
                type: "linkLabelMath",
                raw: match.raw,
                text: match.text,
              };
          },
          renderer(token) {
            const index = formulas.push(token.text) - 1;
            return `\uE000${index}\uE001`;
          },
        },
      ],
    });
    anchor.innerHTML = DOMPurify.sanitize(
      labelParser.parseInline(this.label, { async: false }) as string,
      { ALLOWED_TAGS: ["strong", "em", "s", "code", "br"], ALLOWED_ATTR: [] },
    );
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    for (const textNode of textNodes) {
      const markers = [
        ...textNode.data.matchAll(/([\uE000\uE002])(\d+)[\uE001\uE003]/g),
      ];
      for (const marker of markers.reverse()) {
        const index = Number(marker[2]);
        if (marker[1] === "\uE002") {
          const image = images[index];
          if (!image) continue;
          const preview = document.createElement("span");
          preview.className = "linked-image-preview";
          const status = document.createElement("span");
          status.className = "linked-image-status";
          status.setAttribute("role", "status");
          status.textContent = "正在载入图片：" + (image.alt || image.src);
          preview.append(status);
          const start = marker.index!;
          const source = textNode.splitText(start);
          source.splitText(marker[0].length);
          source.replaceWith(preview);
          const unavailable = () => {
            if (!preview.isConnected) return;
            status.textContent = "图片不可用：" + (image.alt || image.src);
            preview.replaceChildren(status);
            view.requestMeasure();
          };
          void resolveImage(image.src, this.path).then((src) => {
            if (!preview.isConnected) return;
            const img = document.createElement("img");
            img.alt = image.alt;
            img.title = image.title;
            img.addEventListener("load", () => view.requestMeasure());
            img.addEventListener("error", unavailable);
            img.src = src;
            preview.replaceChildren(img);
            view.requestMeasure();
          }, unavailable);
          continue;
        }
        const math = formulas[index];
        if (math === undefined) continue;
        const formula = document.createElement("span");
        formula.className = "inline-formula";
        formula.textContent = math;
        formula.title = "点击编辑公式";
        const start = marker.index!;
        const source = textNode.splitText(start);
        source.splitText(marker[0].length);
        source.replaceWith(formula);
        void renderMath(math, { throwOnError: false, trust: false })
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
