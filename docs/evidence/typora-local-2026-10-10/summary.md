# 本机最终验证摘要

2026-10-10；Node 22.23.3，macOS arm64。分支 `codex/local-typora-sidebar`。未推送或发布。

- 最终完整界面：230 passed、3 skipped（性能在独立命令中执行），2 workers，retries=0，1.7 分钟。
- 最终桌面逻辑：48 passed，0 failed。
- 关键树/列表、只读、大纲流程：5 轮共 15 passed，retries=0。
- 主题专项：3 passed；最终完整回归也包含兼容修复。
- TypeScript/生产构建及本机未签名目录打包成功；保留已有分包大小提示，未宣称完成生产启动优化。
- 原生验收：Finder 新窗口打开、菜单/只读、左右键大纲、过滤空态、真实 Typora GitHub 主题包导入、实际 PDF 查看器。
- PDF 原件 8 页，已查看首页与第 3/8 页。首次预览进入错误页，修复后加载内置 PDF 查看器并显示 Finished loading PDF。不是对全部页、系统 Preview、实际打印或与 Typora 导出等价的完整验收。
- native.log 中两个 image:read ENOENT 来自原件刻意引用的缺失图片，不是更新清单缺失；原件仍保留替代文本。
- 原件 SHA-256：d51c479830f5832455a540d22b8aa57aacf61762ebdf29d2b8cf3debd7fbf4b0。

## 最后执行的性能基准

最终轮单 worker、每个尺寸一次，在该 Mac 的 Playwright Chromium / Vite 开发服务器网页层测量，没有与构建或完整回归并行。它不是生产 Electron 启动/混合媒体测量，也不是延迟分布。

| 文档  | 打开 ms | 20 次滚动 ms | 文末输入 ms |
| ----- | ------- | ------------ | ----------- |
| 1 MB  | 470     | 401          | 37          |
| 5 MB  | 1528    | 313          | 82          |
| 10 MB | 2827    | 998          | 132         |

三个基准均通过，12.2 秒。此前一轮记录保留在 performance-initial.log，不把两轮数据解释为稳定分布。原始日志与结构化数值见 performance.log / performance.json。

## 失败记录

ui-first-failure.log 保留本轮首次完整回归的 228 passed / 1 failed / 3 skipped；关键流程第一次专项 5 次中 2 次失败。没有使用重试掩盖。连续命令请求竞争修复后取得 critical-repeat.log 和 ui-final.log。

真实主题首次因为 export-only 在线字体指令拒绝导入；仅忽略该指令后成功，外部 URL/@import/越界限制仍保留。真实 PDF 首次空白，12-pdf-preview.png 保留失败画面，13-pdf-preview-after.png 保留修复后画面。

最后代码审阅移除了误加到“已打开文档”列表的大纲左右键逻辑，并新增无标题文档回归。最终 230 项完整回归及重新构建之后，再执行上述最终性能轮；没有把先前 229 项结果当作最终源代码的完整结果。
