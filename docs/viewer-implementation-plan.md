# 通用文件查看器（Viewer）：PDF / Office / 纯文本 / 图片

## 需求（用户确认版）
点击文件即可查看：
- **Office 文档**：Word(.docx)、Excel(.xlsx/.xls)（"word excel 等等"）
- **纯文本**：vim 能打开的一切（.txt/.md/.json/.log/.conf/.ini/.sh/.py/.js/.ts/.xml/.yaml/.csv…）
- **PDF**（原始电子书需求）
- 附带：图片（.jpg/.jpeg/.png/.gif/.webp/.svg/.bmp，成本极低）
- V1 明确不支持：.doc/.ppt/.pptx（见「格式支持矩阵」说明原因）、EPUB/MOBI（V2 foliate-js）

## 总体思路（一句话）
**统一走现有 `janus-media://` 流式协议（Range、本地/远程同一套）+ 独立 Viewer 窗口（player 同款模式）+ 按扩展名路由查看器** —— 远程文件免下载直接看，本地远程体验完全一致。

已有资产直接复用：`janus-media://` Range 协议、`PlayerWindowManager` 式窗口管理、sandbox 自包含 preload 模式、FilePane 行按钮模式、media-progress 进度存储模式。

## 格式支持矩阵与库选型
| 格式 | 方案 | 依赖 | 说明 |
|---|---|---|---|
| PDF | **pdf.js**（官方 `pdfjs-dist`） | ~5MB | 自带 Range 分页请求（正好配 janus-media），页码/缩放/侧栏；Chromium PDFium 对自定义 scheme 支持不确定，不依赖它 |
| .docx | **docx-preview**（JSZip→HTML） | ~0.5MB | 保真度良好；.doc 旧二进制无纯 JS 渲染器 → 显示"不支持，请下载" |
| .xlsx/.xls/.csv | **SheetJS `xlsx`** 解析 → HTML 表格 + 工作表标签 | ~1MB | xls 旧格式也支持；大文件全量读入内存（>50MB 提示下载） |
| .ppt/.pptx | **不支持** | — | 无可靠纯 JS 渲染引擎；V1 显示"暂不支持，请下载后用系统应用打开" |
| 纯文本/代码 | 全量读取（≤10MB）→ 编码检测（UTF-8 strict，失败回退 **GB18030**）→ CodeMirror 只读 | 复用现有 CodeMirror + 4 个 lang 小包 | 中文老 txt 常见 GBK，回退 GB18030 是关键体验点 |
| .md | 同上 + **预览模式**（marked 渲染 + DOMPurify 消毒，源码/预览切换） | marked+DOMPurify ~0.2MB | |
| 图片 | `<img src="janus-media://…">` + 缩放/适配 | 0 | |
| 其他/未知 | 回退页：显示文件信息 + "下载" 提示 | 0 | |

依赖许可均 MIT/BSD；全部离线打包进 renderer，不引 CDN。

## 模块设计

### 1. 主进程
- `src/main/viewer-window.ts`：`ViewerWindowManager`（仿 VNC/Player）：`openViewer({serverId?, path})` → 窗口 1100×760、preload `viewer.js`、context={title, serverId, path, ext}；关窗清理；锁仓 closeAll
- IPC（新增，不改旧名）：`viewer:open`、`viewer:context`、`viewer:save-progress`（PDF 页码记忆，`userData/viewer-progress.json`，格式 `{key:{page,at}}`）
- 无协议改动：viewer 渲染层直接 `fetch('janus-media://play?path=…&server=…')` 取字节

### 2. 桥接 `src/preload/viewer.ts`（自包含，内联通道名）
`window.viewer = { getContext(), saveProgress(req) }`

### 3. 渲染页 `src/renderer/viewer.html` + `src/renderer/src/viewer/main.tsx`
- 按 context.ext 路由组件：
  - `PdfViewer`：pdf.js（`?worker` 打包方式需在 P1 验证 vite/electron-vite 兼容；备选 legacy build+全局 worker 路径）；工具栏：上一页/下一页/页码输入/缩放/适配宽度；页码写入 viewer-progress；重开恢复页码
  - `DocxViewer`：docx-preview 渲染进 div（样式隔离容器）
  - `XlsxViewer`：SheetJS → 首个工作表 HTML 表格 + 底部 sheet 切换标签；行列截断（>1000 行分页提示）
  - `TextViewer`：CodeMirror 只读（lang-json/javascript/xml/markdown 按扩展名选）；.md 增加 源码/预览 切换；>10MB 显示"过大仅预览前 2MB"+下载提示
  - `ImageViewer`：适应窗口/原始尺寸切换 + 滚轮缩放
  - `UnsupportedViewer`：格式说明 + 打开 Files 下载提示
- 顶栏统一：文件名、格式标签、（远程）服务器标签

### 4. FilePane 入口
- 行按钮区新增 **View（Eye 图标）**：出现在可查看扩展名文件上（查看器类型集合放 `src/shared/viewer.ts`，含 ext→viewer 路由表 `viewerFor(name)`）
- **双击行为**：双击文件 → 若是可查看类型则打开 Viewer（远程文件的"双击=编辑"语义改为"双击=查看"；Edit 仍由行按钮进入）。本地文件双击原无行为 → 变为查看。此为本需求的显式行为变更，写入文档
- `media:open`（视频）不受影响：视频文件双击/Play 仍走播放器

### 5. 构建
- electron.vite.config：preload +`viewer`、renderer input +`viewer.html`
- 新依赖：`pdfjs-dist`、`docx-preview`、`xlsx`、`marked`、`dompurify`、`@codemirror/lang-json`、`@codemirror/lang-javascript`、`@codemirror/lang-xml`（lang-markdown 视体积定）
- `Window.viewer` 类型进 `src/preload/index.d.ts`

## 健壮性设计（防崩溃边界，用户专项要求）

**总原则：打不开的文件绝不进入渲染；渲染异常绝不拖垮窗口/主程序。**

### A. 三层防线
1. **扩展名白名单（路由层）**：只有 `viewerFor()` 明确识别的扩展名才进入对应查看器；未识别 → `UnsupportedViewer` 信息页（文件信息+下载提示），不尝试任何解析。
2. **魔数嗅探（加载前）**：扩展名不可信。读取文件头校验，不匹配直接拒绝并明示：
   - PDF：`%PDF-`
   - docx/xlsx：`PK\x03\x04`（zip 容器）
   - 图片：PNG `\x89PNG` / JPEG `\xFF\xD8` / GIF `GIF8` / WebP `RIFF…WEBP` / BMP `BM`（SVG 按文本处理且**禁用脚本**：`<img>` 加载天然不执行脚本，不内联渲染）
   - 纯文本：前 8KB 抽样不含 NUL 即视为文本（二进制 → 拒绝）
3. **渲染隔离（组件层）**：每个查看器组件包在 `ViewerErrorBoundary`（componentDidCatch）中——任何渲染异常 → 错误页（文件名+返回/下载按钮），**绝不上抛白屏**。

### B. 资源上限（超限即拒，给出下载引导）
| 类型 | 上限 | 超限行为 |
|---|---|---|
| 纯文本 | 10MB | 仅预览前 2MB + 明确截断提示 |
| 图片 | 100MB | 拒绝 + 下载提示 |
| docx / xlsx | 50MB（压缩包） | 拒绝 + 下载提示（防 zip bomb 内存爆炸） |
| PDF | 不限（Range 流式） | — |
| xlsx 行数 | 渲染前 1000 行 | 截断 + 分页提示 |

### C. 解析异常与超时
- pdf.js/docx-preview/SheetJS 的解析全部 `try/catch` + **30 秒超时自动放弃**（显示错误页）；加载中有 spinner + 可手动取消
- **加密 PDF**（pdf.js onPassword）→ 显示"受密码保护，暂不支持"，**不弹浏览器密码框**
- **损坏 zip**（docx/xlsx 伪后缀或坏包）→ catch → "文件已损坏或格式不符"
- 组件卸载/切换文件时取消在途加载（AbortController + disposed 标志），防旧回调写状态崩溃

### D. 进程级隔离
- Viewer 是独立 sandbox 窗口：渲染进程崩溃不波及主窗；`webContents.on('render-process-gone')` → 关窗并在主窗 Files 提示
- janus-media 协议已有 400/404/416/500 分支；viewer fetch 非 2xx → 错误页
- 零字节文件：文本/图片显示正常空态，不异常
- StrictMode 双挂载 boot 守卫（沿用现有模式）

### E. 验收用例（进测试清单）
伪后缀（.pdf 实 txt）、零字节文件、NUL 二进制伪 .txt、加密 PDF、损坏 zip 伪 .docx、10MB+ 文本、zip bomb 小样本、连续快速双击多文件、远程断连中打开。

## 风险与边界
| 风险 | 处理 |
|---|---|
| pdf.js worker 与 electron-vite 打包兼容性 | P1 先做 spike 验证；不通过则用 legacy 构建或禁用 worker（主线程渲染，性能可接受） |
| SheetJS npm 包有历史 audit 提示 | 仅解析用户自己的文件，风险可接受；记录于文档 |
| docx 复杂排版保真度 | docx-preview 非完美，复杂文档提示可下载；不接受时用户可退回系统应用 |
| 大文件内存 | 文本>10MB 截断预览；xlsx/docx>50MB 提示下载 |
| GBK 误判 | UTF-8 strict 失败才回退 GB18030；状态栏显示使用的编码 |
| 非 UTF-8 文件名 | 与播放器一致：仅显示 |

## 三次审查补遗（2026-09-13 第三轮）
1. **双击路由优先级必须显式**：`isVideoFile()` → 视频播放器（既有）；`viewerFor()` 命中 → Viewer；否则远程=Edit、本地=无行为。视频文件绝不进 Viewer，可查看文本绝不进播放器。
2. **viewer.html CSP 需显式放行**：`connect-src 'self' janus-media:`（fetch 字节）、`img-src 'self' data: janus-media:`（图片）、`worker-src 'self' blob:`（pdf.js worker 兜底）、`script-src 'self'`、`style-src 'self' 'unsafe-inline'`（docx-preview 注入样式）。
3. **IPC sender 校验补齐**：`viewer:open` 走 handle()（自动继承主窗守卫）；`viewer:context`/`viewer:save-progress` 必须像 vnc/player 一样校验 sender 是已登记 viewer 窗，否则 INVALID_OWNER。
4. **多窗口语义**：允许同时开多个 viewer 窗（每窗独立 context）；连续快速双击多文件由 ErrorBoundary + 独立窗口天然兜底（验收用例 E 已含）。
5. **CodeMirror 复用项目现有 `@uiw/react-codemirror`**（DbTab 同款），不引入第二套编辑器封装；lang 包按需新增。
6. **docx-preview 样式隔离**：渲染进带独立类名的容器防样式串扰；pdf.js v1 只渲染 canvas 主层，不做 text layer/批注层。

## 实施步骤
- **P1**：装依赖 + `src/shared/viewer.ts`（ext 集合+路由）+ ViewerWindowManager/IPC/preload/html 骨架 + ImageViewer（最小闭环验证打包与协议）+ pdf.js worker spike
- **P2**：TextViewer（编码检测/CodeMirror/md 预览）+ FilePane View 按钮与双击改行为
- **P3**：PdfViewer（页码/缩放/页码记忆）
- **P4**：DocxViewer + XlsxViewer + Unsupported 回退页
- **P5**：校验（typecheck/build/diff）+ 测试（`scripts/test-viewer.mjs`：ext 路由、魔数嗅探、NUL 二进制判定、编码检测、截断逻辑）+ 既有三套测试回归 + MODIFICATIONS.md 新章节 + 工作区 AGENTS.md 概要同步

## 验证
1. 静态检查全绿 + 新测试 + 既有 62 项测试回归
2. 真机手测（登记为未做项）：本地 PDF/docx/xlsx/md/gbk txt/图片；远程同组文件；页码记忆；双击行为

## 明确不做
- EPUB/MOBI/AZW/CBZ（V2 foliate-js）、.doc/.ppt/.pptx 渲染、Office 编辑、批注/签名、打印优化、OCR
- 文本文件保存/编辑（Viewer 全程只读；编辑仍走 Files 的 Edit）
