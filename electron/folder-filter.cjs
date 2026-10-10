// Bounded wildcard matching avoids executing user-supplied regular expressions.
function match(pattern, value) {
  const tokens = pattern.match(/\*\*|\*|\?|[^*?]/gu) || [];
  const characters = Array.from(value);
  let previous = new Uint8Array(characters.length + 1);
  previous[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(characters.length + 1);
    const star = token === "*" || token === "**";
    if (star) next[0] = previous[0];
    for (let i = 1; i <= characters.length; i++) {
      const character = characters[i - 1];
      next[i] = star
        ? Number(
            Boolean(
              previous[i] ||
              (next[i - 1] && (token === "**" || character !== "/")),
            ),
          )
        : Number(
            Boolean(
              previous[i - 1] &&
              (token === "?" ? character !== "/" : token === character),
            ),
          );
    }
    previous = next;
  }
  return Boolean(previous[characters.length]);
}
function folderFilter(input) {
  const rules = (typeof input === "string" ? input.slice(0, 2048) : "")
    .split(/\r?\n/)
    .map((rule) => rule.trim().replaceAll("\\", "/").replace(/^\.\//, ""))
    .filter((rule) => rule && rule.length <= 200)
    .slice(0, 40);
  return (relative, name) =>
    rules.some((rule) => {
      if (rule.endsWith("/**") && match(rule.slice(0, -3), relative))
        return true;
      return match(rule, rule.includes("/") ? relative : name);
    });
}
module.exports = { folderFilter };
