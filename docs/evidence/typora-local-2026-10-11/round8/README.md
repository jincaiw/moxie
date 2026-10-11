# 第八轮：本地图片迁移与 Typora 兼容（2026-10-11）

## 验收结果

本轮使用自建 480×240 PNG（三色图，无外部数据）及临时 Markdown，通过真实 QA 包的原生图片文件选择器插入。图片写入 image-note.assets，手动保存后另存为到独立 destination 目录。副本链接改为 image-copy.assets，新旧图片与输入文件字节完全一致。

将自建 source 目录改名为 source-isolated，关闭已保存副本标签，通过 Cmd+O 重新打开 destination/image-copy.md；副本仍能显示图片。随后用本机 Typora 打开同一副本，也能正常显示。旧资源不在原路径，排除了重新打开时依赖旧目录的情况；未验证进程重启后的缓存行为。

未发现此 PNG 基本流程缺陷，本轮只新增验收证据和更新清单，未改产品代码、版本或 QA 包。

## 编号截图

1. `01-inserted.png`：原生选择 PNG 后，编辑器显示三色图及未保存状态。
2. `02-save-as.png`：另存为 image-copy.md 后显示已保存，图片可见。
3. `03-reopened-independent.png`：隔离旧目录并关闭标签后重新打开副本，图片可见；对应 `03-reopened-ax.txt`。
4. `04-typora-same-copy.png`：Typora 读取同一副本并显示图片；对应 `04-typora-ax.txt`。

全部截图保存原字节并查看。窗口尺寸、缩放和主题未统一，这组截图只证明图片加载和相对资源兼容，不作为严格视觉尺寸一致的结论。默认主题下字号、段落留白和图片对齐有差异，仍归 P01/E05。图片尺寸编辑操作未完成可确认的原生验收，保留待办。

## 可复核材料

- `three-colors.png` 是自建输入素材。
- `image-copy.md` 及同级 `image-copy.assets/` 可直接用编辑器打开。
- `verification.json` 记录输入和迁移图片 SHA-256、目录隔离与 fixture 摘要。输入/原资源/新资源逐字节一致，Markdown 相对链接已更新。
- 现有图片迁移专项测试 1 项通过（`image-test.log`），覆盖引用式、括号/空格、HTML、尺寸语法、纯 CR 和代码示例保留。该项使用桥接桩，不替代本轮真实 PNG 原生验收。
- 未重复桌面全量、界面全量、构建和性能；运行的是第七轮 QA 包。原件 fixture 未改，远端 fetch 后 main 无新提交，未推送发布。

## 剩余顺序

E03 仍需 JPEG/GIF/WebP/SVG 等素材、尺寸编辑、图片缺失/迁移失败/并发编辑，以及 DOCX、Preview 和打印。随后按现有计划推进 P01/E05 视觉主题、E02 输入法/VoiceOver/跨应用剪贴板；E01/E04 凭据与其他平台条件、E06 生产性能仍未完成。不能将 PNG 基本流程通过等同 E03 整体验收通过。
