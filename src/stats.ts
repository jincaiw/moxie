export type DocumentStats = {
  words: number;
  characters: number;
  charactersWithoutSpaces: number;
  lines: number;
  paragraphs: number;
  readingMinutes: number;
};

/** Count readable Markdown text without rendering the document to HTML. */
export function documentStats(markdown: string): DocumentStats {
  let words = 0;
  let characters = 0;
  let charactersWithoutSpaces = 0;
  let lines = 0;
  let paragraphs = 0;
  let inParagraph = false;
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  const lineBreak = /\r\n?|\n/g;
  let start = 0;
  const readableLines: string[] = [];

  const flushWords = () => {
    if (!readableLines.length) return;
    for (const part of segmenter.segment(readableLines.join("\n"))) {
      if (part.isWordLike) words++;
    }
    readableLines.length = 0;
  };

  const countLine = (line: string) => {
    lines++;
    const trimmed = line.trim();
    if (trimmed) {
      if (!inParagraph) paragraphs++;
      inParagraph = true;
    } else {
      inParagraph = false;
    }

    // Remove Markdown presentation syntax while preserving the text readers see.
    const codeSpans: string[] = [];
    const readable = trimmed
      .replace(
        /(`+)(.*?)\1/g,
        (_match, _delimiter: string, content: string) => {
          const index = codeSpans.push(content) - 1;
          return `\uE000${index}\uE001`;
        },
      )
      .replace(/^ {0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/, "")
      .replace(/^\[([^\]]+)\]:\s*\S+.*$/, "$1")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/`+([^`]*?)`+/g, "$1")
      // Underscores inside words (for example `file_name`) are literal text,
      // while underscores at word boundaries can delimit emphasis.
      .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, "")
      .replace(/[*~^=]+/g, "")
      .replace(/<[^>]*>/g, "")
      .replace(/\\([\\`*{}\[\]()#+.!_>~-])/g, "$1")
      .replace(
        /\uE000(\d+)\uE001/g,
        (_match, index: string) => codeSpans[Number(index)],
      );

    readableLines.push(readable);
    if (readableLines.length >= 256) flushWords();
    for (const character of readable) {
      characters++;
      if (!/\s/u.test(character)) charactersWithoutSpaces++;
    }
  };

  for (const match of markdown.matchAll(lineBreak)) {
    countLine(markdown.slice(start, match.index));
    start = match.index! + match[0].length;
  }
  if (markdown.length || start) countLine(markdown.slice(start));
  flushWords();

  return {
    words,
    characters,
    charactersWithoutSpaces,
    lines,
    paragraphs,
    readingMinutes: Math.max(1, Math.ceil(words / 300)),
  };
}
