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
