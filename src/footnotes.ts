export type FootnoteDefinitionLine = {
  label: string;
  content: string;
  prefix: string;
  quotePrefix: string;
};

export function parseFootnoteDefinitionLine(
  line: string,
  allowDeepQuoteIndent = false,
): FootnoteDefinitionLine | null {
  let remaining = line;
  let quotePrefix = "";
  for (let depth = 0; depth < 12; depth++) {
    const quote = new RegExp(
      `^ {0,${allowDeepQuoteIndent ? 12 : 3}}>[ \\t]?`,
    ).exec(remaining);
    if (!quote) break;
    quotePrefix += quote[0];
    remaining = remaining.slice(quote[0].length);
  }

  const match = /^([ ]{0,3})\[\^([^\]]+)\]:[ \t]*(.*)$/.exec(remaining);
  if (!match || (!quotePrefix && !/^ {0,3}\[\^/.test(line))) return null;
  return {
    label: match[2],
    content: match[3],
    prefix: quotePrefix + match[1],
    quotePrefix,
  };
}

export function isFootnoteDefinitionLine(line: string) {
  return parseFootnoteDefinitionLine(line) !== null;
}
