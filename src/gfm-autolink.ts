import type { MarkedExtension, Tokens } from "marked";

const urlStart = /^(?:(?:ftp|https?):\/\/|www\.)/i;
const urlCandidate = /^(?:(?:ftp|https?):\/\/|www\.)(?:[a-z\d-]+\.?)+[^\s<]*/i;
const trailingPunctuation = /[?!.,:*_~]$/;

function nestedBalancedURL(source: string) {
  const match = urlCandidate.exec(source);
  if (!match) return null;
  let url = match[0];
  while (trailingPunctuation.test(url)) url = url.slice(0, -1);

  const parentheses = (value: string) => {
    let depth = 0;
    let maximumDepth = 0;
    let unmatchedClosings = 0;
    for (const character of value) {
      if (character === "(") maximumDepth = Math.max(maximumDepth, ++depth);
      else if (character === ")") {
        if (depth) depth--;
        else unmatchedClosings++;
      }
    }
    return { depth, maximumDepth, unmatchedClosings };
  };

  while (url.endsWith(")") && parentheses(url).unmatchedClosings) {
    url = url.slice(0, -1);
  }
  const { depth, maximumDepth, unmatchedClosings } = parentheses(url);
  if (depth || unmatchedClosings || maximumDepth < 2) return null;
  return url;
}

/** Preserve nested, balanced parentheses in GFM literal URL autolinks. */
export const nestedGfmAutolink: MarkedExtension = {
  extensions: [
    {
      name: "nestedGfmAutolink",
      level: "inline",
      start(source) {
        const match = /(?:https?:\/\/|ftp:\/\/|www\.)/i.exec(source);
        return match?.index;
      },
      tokenizer(source, tokens) {
        if (!urlStart.test(source) || this.lexer.state.inLink) return;
        const url = nestedBalancedURL(source);
        if (!url) return;

        const previous = tokens.at(-1)?.raw?.slice(-1);
        if (previous && !/[\s*_~(]/u.test(previous))
          return { type: "text", raw: url, text: url };

        const href = /^www\./i.test(url) ? `http://${url}` : url;
        const label: Tokens.Text = { type: "text", raw: url, text: url };
        return {
          type: "link",
          raw: url,
          href,
          text: url,
          tokens: [label],
        } satisfies Tokens.Link;
      },
    },
  ],
};
