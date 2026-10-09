export type FootnoteDefinitionLine = {
  label: string;
  content: string;
  prefix: string;
  quotePrefix: string;
  definitionIndent: string;
};

export function parseFootnoteDefinitionLine(
  line: string,
  allowDeepContainerIndent = false,
): FootnoteDefinitionLine | null {
  let remaining = line;
  let quotePrefix = "";
  for (let depth = 0; depth < 12; depth++) {
    const quote = new RegExp(
      `^ {0,${allowDeepContainerIndent ? 12 : 3}}>[ \\t]?`,
    ).exec(remaining);
    if (!quote) break;
    quotePrefix += quote[0];
    remaining = remaining.slice(quote[0].length);
  }

  const match = new RegExp(
    `^([ ]{0,${allowDeepContainerIndent ? 12 : 3}})\\[\\^([^\\]]+)\\]:[ \\t]*(.*)$`,
  ).exec(remaining);
  const definitionStart = new RegExp(
    `^ {0,${allowDeepContainerIndent ? 12 : 3}}\\[\\^`,
  );
  if (!match || (!quotePrefix && !definitionStart.test(line))) return null;
  return {
    label: match[2],
    content: match[3],
    prefix: quotePrefix + match[1],
    quotePrefix,
    definitionIndent: match[1],
  };
}

export function isFootnoteDefinitionLine(
  line: string,
  allowDeepContainerIndent = false,
) {
  return parseFootnoteDefinitionLine(line, allowDeepContainerIndent) !== null;
}
