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
// decorated lines. Adapt only the shared typography and document box rules.
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
  const declarations = (
    style: CSSStyleDeclaration,
    accept: (name: string) => boolean,
  ) =>
    Array.from(style)
      .filter(accept)
      .map(
        (name) =>
          `${name}:${style.getPropertyValue(name)}${style.getPropertyPriority(name) ? " !important" : ""};`,
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
            const match = /^(?:#write\s*>?\s*)?h([1-6])$/.exec(selector);
            if (match)
              return `${host} .cm-content .md-h${match[1]}{${declarations(rule.style, (name) => typography.test(name) || heading.test(name))}}`;
            return "";
          })
          .join("");
      })
      .join("");
  return `${host} .cm-line{min-height:1em;}\n${walk(sheet.cssRules)}`;
}
