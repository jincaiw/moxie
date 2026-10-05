export function themeCSSError(css: string): string | null {
  if (css.length > 65536) return "主题 CSS 超过 64 KB。";
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
    /url\(\s*(['"]?)data:(?:image\/(?:png|jpeg|gif|webp|avif)|font\/woff2|application\/font-woff);base64,[a-z\d+/=]+\1\s*\)/gi,
    "",
  );
  if (/url\s*\(|expression\s*\(/i.test(withoutEmbeddedAssets))
    return "主题 CSS 不支持外部资源或动态表达式。";
  return null;
}
