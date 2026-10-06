export const welcome = `# 欢迎使用墨写

让想法自然成文。

---

## 从这里开始

这是你的本地写作空间。使用 Markdown 记录想法，让排版随文字自然呈现。

1. 尝试输入一些文字，体验即时排版的流畅。
2. 使用侧边栏管理你的文档。
3. 探索右上角的功能，按自己的方式开始写作。

## 为写作留一点空间

> 好的工具，让你专注于内容。

## 常用快捷键

| 操作 | 快捷键 |
| --- | --- |
| 保存文档 | Cmd + S |
| 查找内容 | Cmd + F |
| 切换源码模式 | Cmd + / |
`;
export const guide = `# 写作指南

[TOC]

## 基础格式

用 **粗体** 强调，用 *斜体* 表达，也可以使用 ~~删除线~~ 和 \`行内代码\`。

## 任务清单

- [x] 开始写作
- [ ] 记录一个新想法

## 代码

\`\`\`typescript
const message = "让想法自然成文";
console.log(message);
\`\`\`

## 数学公式

$$
E = mc^2
$$

## Mermaid 图表

\`\`\`mermaid
flowchart LR
  idea[想法] --> draft[草稿]
  draft --> polish[润色]
\`\`\`

## 脚注

脚注可以补充说明[^detail]，也可以在正文中再次引用[^detail]。

[^detail]: 点击编辑器中的上标星号可以跳到脚注定义；HTML 和 PDF 导出会生成可往返跳转的编号脚注。

## 链接

[Markdown 语法参考](https://commonmark.org/help/)

点击表格、公式或图表即可编辑原文。文件保存在本地，浏览器预览版将恢复副本保存在当前浏览器中。
`;
export type DocumentFile = {
  id: string;
  name: string;
  text: string;
  path?: string;
  diskText?: string;
  diskVersion?: string;
  dirty?: boolean;
  group?: string;
};
function markdownContainerContent(line: string) {
  let content = line;
  for (let depth = 0; depth < 12; depth++) {
    const indentation = /^ {0,3}/.exec(content)?.[0].length || 0;
    content = content.slice(indentation);
    if (content.startsWith(">")) {
      content = content.slice(1).replace(/^[ \t]?/, "");
      continue;
    }
    const list = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(content);
    if (list) {
      content = content.slice(list[0].length);
      continue;
    }
    break;
  }
  return content;
}
export function headings(text: string) {
  const result: { level: number; title: string; from: number }[] = [];
  const lineAt = (from: number) => {
    const lf = text.indexOf("\n", from);
    const cr = text.indexOf("\r", from);
    const newline = cr >= 0 && (lf < 0 || cr < lf) ? cr : lf;
    const end = newline < 0 ? text.length : newline;
    const next =
      newline < 0
        ? text.length + 1
        : newline +
          (text.charCodeAt(newline) === 13 &&
          text.charCodeAt(newline + 1) === 10
            ? 2
            : 1);
    return {
      text: text.slice(from, end),
      from,
      next,
    };
  };

  let fence: RegExp | undefined;
  let line: ReturnType<typeof lineAt> | null = lineAt(0);
  while (line) {
    const next: ReturnType<typeof lineAt> | null =
      line.next <= text.length ? lineAt(line.next) : null;
    const content = markdownContainerContent(line.text);
    const nextContent = next ? markdownContainerContent(next.text) : "";
    if (fence) {
      if (fence.test(content)) fence = undefined;
    } else {
      const opening = /^(`{3,}|~{3,})/.exec(content);
      if (opening) {
        const character = opening[1][0] === "`" ? "`" : "~";
        fence = new RegExp(`^${character}{${opening[1].length},}[ \\t]*$`);
      } else {
        const atx = /^(#{1,6})(?:[ \\t]+(.*?)|[ \\t]*)$/.exec(content);
        if (atx) {
          result.push({
            level: atx[1].length,
            title: (atx[2] || "").replace(/[ \\t]+#+[ \\t]*$/, "").trim(),
            from: line.from,
          });
        } else {
          const setext = next && /^(=+|-+)[ \\t]*$/.exec(nextContent);
          if (
            setext &&
            content.trim() &&
            !/^(?:>|[-+*][ \\t]|\\d+[.)][ \\t])/.test(content)
          ) {
            result.push({
              level: setext[1][0] === "=" ? 1 : 2,
              title: content.trim(),
              from: line.from,
            });
            line = next;
          }
        }
      }
    }
    line = line && line.next <= text.length ? lineAt(line.next) : null;
  }
  return result;
}
