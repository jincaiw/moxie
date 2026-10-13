export const THEME_CSS_LIMIT = 128 * 1024;
export const THEME_LIBRARY_CSS_LIMIT = 1536 * 1024;

export function themeCSSError(css: string): string | null {
  if (css.length > THEME_CSS_LIMIT) return "主题 CSS 超过 128 KB。";
  const decoded = css.replace(
    /\\([\da-f]{1,6})\s?|\\([^\r\n\f])/gi,
    (_match, hex, char) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        return String.fromCodePoint(codePoint > 0x10ffff ? 0xfffd : codePoint);
      }
      return char || "";
    },
  );
  if (/@import\b/i.test(decoded)) return "为保护本地隐私，不支持 @import。";
  const withoutEmbeddedAssets = decoded.replace(
    /url\(\s*(['"]?)data:(?:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)|font\/woff2|application\/font-woff);base64,[a-z\d+/=]+\1\s*\)/gi,
    "",
  );
  if (/url\s*\(|expression\s*\(/i.test(withoutEmbeddedAssets))
    return "主题 CSS 不支持外部资源或动态表达式。";
  return null;
}

// Typora themes describe a #write document; CodeMirror renders headings as
// decorated lines. Adapt shared typography and real table elements narrowly.
// Keep the original CSS for local theme editing and export.
export function typoraEditorCSS(css: string): string {
  if (!/#write\b/.test(css) || themeCSSError(css)) return "";
  const sheet = new CSSStyleSheet();
  try {
    sheet.replaceSync(css);
  } catch {
    return "";
  }
  const hasWriteRule = (rules: CSSRuleList): boolean =>
    Array.from(rules).some((rule) =>
      rule instanceof CSSMediaRule
        ? hasWriteRule(rule.cssRules)
        : rule instanceof CSSStyleRule && /#write\b/.test(rule.selectorText),
    );
  if (!hasWriteRule(sheet.cssRules)) return "";
  const host = ".editor-host:not(.source-mode)";
  const typography =
    /^(?:font(?:-(?:family|size|style|weight|variant|stretch))?|line-height|letter-spacing|word-spacing|color|text-align|text-decoration)$/;
  const box =
    /^(?:max-width|min-width|width|margin(?:-(?:top|right|bottom|left))?|padding(?:-(?:top|right|bottom|left))?|box-sizing)$/;
  const heading = /^(?:margin|padding|border)(?:-[a-z-]+)?$/;
  const surface =
    /^(?:background(?:-color)?|border(?:-[a-z-]+)?|padding(?:-[a-z-]+)?|word-break|border-collapse)$/;
  const declarations = (
    style: CSSStyleDeclaration,
    accept: (name: string) => boolean,
    forcePriority: (name: string) => boolean = () => false,
  ) =>
    Array.from(style)
      .filter(accept)
      .map(
        (name) =>
          `${name}:${style.getPropertyValue(name)}${style.getPropertyPriority(name) || forcePriority(name) ? " !important" : ""};`,
      )
      .join("");
  const walk = (rules: CSSRuleList): string =>
    Array.from(rules)
      .map((rule) => {
        if (rule instanceof CSSMediaRule)
          return `@media ${rule.conditionText}{${walk(rule.cssRules)}}`;
        if (!(rule instanceof CSSStyleRule)) return "";
        return rule.selectorText
          .split(",")
          .map((part) => {
            const selector = part.trim();
            if (selector === "#write")
              return `${host}{${declarations(rule.style, (name) => box.test(name))}}${host} .cm-editor,${host} .cm-content{${declarations(rule.style, (name) => typography.test(name))}}`;
            if (
              selector === "html" ||
              selector === "body" ||
              selector === ":root"
            )
              return `${host} .cm-editor,${host} .cm-content{${declarations(rule.style, (name) => typography.test(name))}}`;
            if (/^(?:#write\s*(?:>\s*|\s+))?a$/.test(selector))
              return `${host} .cm-content .md-link{${declarations(rule.style, (name) => typography.test(name))}}`;
            if (/^(?:#write\s*(?:>\s*|\s+))?\.md-lang$/.test(selector))
              return `${host} .cm-content .md-code-language{${declarations(rule.style, (name) => typography.test(name))}}`;
            if (/^(?:#write\s*(?:>\s*|\s+))?pre\.md-meta-block$/.test(selector))
              return `${host} .cm-content .md-front-matter{${declarations(
                rule.style,
                (name) => typography.test(name) || surface.test(name),
              )}}${host} .md-metadata-source{${declarations(
                rule.style,
                (name) =>
                  typography.test(name) || surface.test(name) || box.test(name),
              )}}`;
            const match = /^(?:#write\s*>?\s*)?h([1-6])$/.exec(selector);
            if (match) {
              // CodeMirror measures each line's border box. Vertical margins
              // sit outside it and make pointer/arrow coordinates drift.
              const spacing = ["top", "bottom"]
                .flatMap((side) =>
                  ["margin", "padding"].map((kind) => {
                    const name = `${kind}-${side}`;
                    const value = rule.style.getPropertyValue(name);
                    return value
                      ? `--md-heading-${name}:${value === "auto" ? "0px" : value}${rule.style.getPropertyPriority(name) ? " !important" : ""};`
                      : "";
                  }),
                )
                .join("");
              // Draw the bottom rule before the former outside margin while
              // retaining its measured border width in the line box.
              const bottomBorder = ["width", "style", "color"]
                .map((part) => {
                  const name = `border-bottom-${part}`;
                  const value = rule.style.getPropertyValue(name);
                  return value
                    ? `--md-heading-${name}:${value}${rule.style.getPropertyPriority(name) ? " !important" : ""};`
                    : "";
                })
                .join("");
              const horizontal = ["left", "right"]
                .map((side) => {
                  const value = rule.style.getPropertyValue(`padding-${side}`);
                  return value ? `padding-${side}:${value};` : "";
                })
                .join("");
              return `${host} .cm-content .md-h${match[1]}{${declarations(rule.style, (name) => typography.test(name) || (heading.test(name) && !/^(?:margin|padding)/.test(name)))}${spacing}${horizontal}${bottomBorder}border-bottom-color:transparent !important;}`;
            }
            const headingInlineCode =
              /^(?:#write\s*(?:>\s*|\s+))?h([1-6])\s+(?:tt|code)$/.exec(
                selector,
              );
            if (headingInlineCode)
              return `${host} .cm-content .md-h${headingInlineCode[1]} .md-inline-code{${declarations(rule.style, (name) => typography.test(name))}}`;
            if (/^(?:#write\s*>?\s*)?p$/.test(selector)) {
              // Paragraphs are measured CodeMirror lines, including soft line
              // breaks. Preserve direct-child scope and scoped-rule specificity.
              const paragraphSelector = selector.includes(">")
                ? ".md-root-paragraph"
                : ".md-paragraph";
              const paragraphTypography = `${host} ${selector.startsWith("#write") ? ".cm-content" : ":where(.cm-content)"} ${paragraphSelector}{${declarations(rule.style, (name) => typography.test(name))}}`;
              const spacing = ["top", "bottom"]
                .map((side) => {
                  const name = `margin-${side}`;
                  const value = rule.style.getPropertyValue(name);
                  return value && value !== "auto"
                    ? `--md-paragraph-${name}:${value}${rule.style.getPropertyPriority(name) ? " !important" : ""};`
                    : "";
                })
                .join("");
              if (!spacing) return paragraphTypography;
              const gap =
                "max(0px,var(--md-paragraph-margin-top,0px),var(--md-paragraph-margin-bottom,0px))";
              // Share the measured gap across source blank lines, keeping each
              // one selectable without introducing unmeasured outside margins.
              return `${paragraphTypography}${host} .cm-content{${spacing}}${host} .cm-content .md-paragraph-gap{font-size:inherit;line-height:inherit;min-height:0;height:calc((${gap} + var(--md-empty-paragraphs)*(1lh + ${gap}))/var(--md-blank-count));}`;
            }
            const paragraphPath = selector
              .replace(/^#write\s*(?:>\s*)?/, "")
              .split(/\s*>\s*|\s+/)
              .filter(Boolean);
            if (
              paragraphPath.at(-1) === "p" &&
              paragraphPath.length > 1 &&
              paragraphPath
                .slice(0, -1)
                .every((part) =>
                  ["blockquote", "ul", "ol", "li"].includes(part),
                )
            ) {
              // Nested block paragraphs are represented by decorated lines;
              // map their typography without repeating block margins per line.
              const context = [
                paragraphPath.includes("blockquote") ? ".md-quote" : "",
                paragraphPath.some((part) => ["ul", "ol", "li"].includes(part))
                  ? ".md-list-line"
                  : "",
                ".md-paragraph",
              ]
                .filter(Boolean)
                .join("");
              const scope = selector.startsWith("#write")
                ? ".cm-content"
                : ":where(.cm-content)";
              return `${host} ${scope} ${context}{${declarations(rule.style, (name) => typography.test(name))}}`;
            }
            if (/^#write\s*>\s*(?:ul|ol):first-child$/.test(selector)) {
              const marginTop = rule.style.getPropertyValue("margin-top");
              return marginTop
                ? `${host} .cm-content .md-first-root-list{padding-top:${marginTop}${rule.style.getPropertyPriority("margin-top") ? " !important" : ""};}`
                : "";
            }
            const list = /^(?:#write\s*>?\s*)?(ul|ol)$/.exec(selector);
            if (list) {
              const inset = rule.style.getPropertyValue("padding-left");
              return inset
                ? `${host} .cm-content{--md-${list[1] === "ul" ? "bullet" : "ordered"}-inset:${inset};}`
                : "";
            }
            if (/^(?:#write\s*>?\s*)?code$/.test(selector))
              return `${host} .cm-content .md-inline-code{${declarations(rule.style, (name) => typography.test(name) || surface.test(name))}}`;
            if (/^(?:#write\s*>?\s*)?\.md-fences$/.test(selector)) {
              // Keep the copy/language controls clear while transferring the
              // theme's code surface and padding to the actual code body.
              const padding = ["top", "right", "bottom", "left"]
                .map((side) => {
                  const value = rule.style.getPropertyValue(`padding-${side}`);
                  return value ? `--md-code-pad-${side}:${value};` : "";
                })
                .join("");
              return `${host} .cm-content .md-code-preview{${declarations(rule.style, (name) => typography.test(name) || (surface.test(name) && !/^padding/.test(name)) || /^margin(?:-|$)/.test(name))}${padding}}`;
            }
            if (/^(?:#write\s*>?\s*)?hr$/.test(selector)) {
              // A thematic break is a decorated editor line rather than an
              // <hr> element. Fold its outside margins into the line height
              // so CodeMirror keeps accurate pointer and caret coordinates.
              const height =
                rule.style.getPropertyValue("height") ||
                rule.style.getPropertyValue("border-top-width") ||
                "1px";
              const marginTop =
                rule.style.getPropertyValue("margin-top") || "0px";
              const marginBottom =
                rule.style.getPropertyValue("margin-bottom") || "0px";
              const color =
                rule.style.getPropertyValue("background-color") ||
                rule.style.getPropertyValue("border-top-color") ||
                "currentColor";
              return `${host} .cm-content .md-rule{--md-rule-height:${height};--md-rule-margin-top:${marginTop};--md-rule-margin-bottom:${marginBottom};height:calc(var(--md-rule-margin-top) + var(--md-rule-height) + var(--md-rule-margin-bottom));margin:0 !important;padding:0 !important;background:none !important;}${host} .cm-content .md-rule::after{top:calc(var(--md-rule-margin-top) + var(--md-rule-height)/2);border-top:var(--md-rule-height) solid ${color};}`;
            }
            if (
              /^(?:#write\s*(?:>\s*|\s+))?blockquote\s+blockquote$/.test(
                selector,
              )
            )
              return `${host} .cm-content .md-quote[data-quote-depth]:not([data-quote-depth="1"]){${declarations(
                rule.style,
                (name) => name === "padding-right",
                () => true,
              )}}`;
            // A quote is a sequence of decorated lines, not a block element.
            // Do not repeat block margins on every line or flatten nested quotes.
            if (/^(?:#write\s*>?\s*)?blockquote$/.test(selector)) {
              const inset = rule.style.getPropertyValue("padding-left");
              const borderWidth =
                rule.style.getPropertyValue("border-left-width");
              const borderColor =
                rule.style.getPropertyValue("border-left-color");
              const nested = `${inset ? `--md-quote-inset:${inset};padding-left:calc(var(--md-list-offset,0px) + var(--md-quote-inset)*var(--md-quote-depth,1) + var(--md-quote-border-width,4px)*(var(--md-quote-depth,1) - 1)) !important;` : ""}${borderWidth ? `--md-quote-border-width:${borderWidth};` : ""}${borderColor ? `--md-quote-border-color:${borderColor};` : ""}`;
              return `${host} .cm-content .md-quote{${declarations(
                rule.style,
                (name) => typography.test(name) || surface.test(name),
                (name) => /^padding(?:-|$)/.test(name),
              )}${nested}}`;
            }
            const tableSelector = selector.replace(/^#write\s*>?\s*/, "");
            if (
              /^(?:table(?:\s+|\s*>\s*))?(?:table|thead|tbody|tr|th|td)(?::(?:first-child|last-child|nth-child\(2n\)))?$/.test(
                tableSelector,
              )
            )
              return `${host} .cm-content .render-block ${tableSelector}{${declarations(rule.style, (name) => typography.test(name) || surface.test(name) || /^(?:margin(?:-[a-z]+)?|width|max-width)$/.test(name))}}`;
            return "";
          })
          .join("");
      })
      .join("");
  return `${host} .cm-line{min-height:1em;}\n${host} .md-heading{position:relative;margin-top:0;margin-bottom:0;padding-top:calc(var(--md-heading-margin-top,0px) + var(--md-heading-padding-top,0px));padding-bottom:calc(var(--md-heading-margin-bottom,0px) + var(--md-heading-padding-bottom,0px));}\n${host} .md-heading::after{content:"";position:absolute;pointer-events:none;left:0;right:0;bottom:calc(var(--md-heading-margin-bottom,0px) - var(--md-heading-border-bottom-width,0px));border-bottom:var(--md-heading-border-bottom-width,0px) var(--md-heading-border-bottom-style,none) var(--md-heading-border-bottom-color,currentColor);}\n${walk(sheet.cssRules)}`;
}
