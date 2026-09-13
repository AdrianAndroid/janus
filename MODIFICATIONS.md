# Janus 本地修改记录（zhaojian 分支）

> 本文档持续记录本分支相对上游的全部改动，以**最新状态**为准。每次改动后更新对应章节，保持"唯一事实来源"。
> 最后更新：2026-09-12

## 1. 维护规则（每次改动必读，优先执行）

1. **文档保鲜**：每次改动后必须更新本文档对应章节与"最后更新"日期；发现旧记录与代码现状不符时，以代码为准修正文档。验证状态（文末"验证状态"节）如实更新。
2. **分支纪律**：在 `zhaojian` 分支工作；不提交除非用户明确要求；不碰加密/认证/IPC 通道名/vault schema。
3. **文案规范**：UI 文案一律英文（项目已完成英文化，无 i18n 体系），术语 vault/master password/upload/download/resume 保持一致。
4. **校验门禁**：改动后跑 `npm run typecheck` + `npm run build` + `git diff --check`，全绿才算完成。
5. **凭据红线**：凭据不入源码、不入文档。

## 2. 项目与分支基线

| 项 | 值 |
|---|---|
| 上游 | Janus 1.9.0（HEAD `22f29ef`），origin `git@github.com:AdrianAndroid/janus.git` |
| 开发分支 | `zhaojian`（不要切回 main，不要覆盖未提交修改） |
| 技术栈 | Electron 33 + React 18 + TS + electron-vite 2 + Vite 5 + ssh2 + Tailwind + zustand |
| 结构 | `src/main/` 主进程，`src/preload/` 桥接，`src/renderer/src/` 界面，`src/shared/` 共享类型 |
| 目标服务器 | `zhaojian@192.168.2.2:22`（局域网命令行 SSH 已验证；应用内功能未全验证） |
| 校验命令 | `npm run typecheck`、`npm run build`、`git diff --check` |

## 3. 构建修复（保留，勿回退）

- `electron.vite.config.ts`：renderer 的 `optimizeDeps.esbuildOptions.target` 与 `build.target` 设为 `es2022`。
- 原因：noVNC `core/util/browser.js` 使用顶层 await，Vite 默认预构建目标不支持导致 `npm run dev` 失败。
- 不要通过改 node_modules 解决。

## 4. 界面英文化（2026-09-12 完成）

- 决策：**不做中文，全部翻译为英文**（避免歧义）。无 i18n 体系，文案硬编码英文。
- 范围：39 个源文件 + `src/preload/index.ts`，约 380 条用户可见文案。
- 行为变更：`CopilotPanel.tsx`、`DbTab.tsx`、`src/main/ai.ts` 的 AI 提示词从"用土耳其语回答"改为英文回答。
- 有意保留：作者署名 `asaf üdürgücü`（SettingsPanel）、IPC 通道名、加密逻辑、CLI 输出。
- 新文案规范：新增 UI 一律写英文，术语 vault/master password/upload/download/resume 保持一致。

## 5. 双栏文件管理器 + 大文件传输引擎（2026-09-12 实现）

### 5.1 架构
| 层 | 文件 | 职责 |
|---|---|---|
| 主进程 | `src/main/local-fs.ts` | 本地（Mac）文件系统：list/mkdir/rename/递归删除/stat/home/dirSize |
| 主进程 | `src/main/transfer-manager.ts` | 传输引擎：3 并发队列、1MB 分块流、字节偏移断点续传、冲突协商、文件夹递归 manifest |
| 主进程 | `src/main/ssh-manager.ts` | 新增 `getSftp`/`sftpStat`/`sftpMakedirs`/`sftpRemoveRecursive`/`sftpDirSize` |
| IPC | `src/shared/ipc.ts` + `src/main/ipc.ts` | 新增 `localfs:*`、`transfer:*`、`sftp:remove-recursive`、`sftp:dir-size` 通道 |
| 桥接 | `src/preload/index.ts` | 暴露 `localFs.*`、`transfer.*`（含 onProgress/onConflict 订阅） |
| 类型 | `src/shared/types.ts` | `TransferTask`/`TransferStatus`/`TransferConflict`/`ConflictAction`/`TransferRequest` |
| 界面 | `FilesPanel.tsx` | 双栏布局+布局切换、传输编排、FileEditor（远程编辑，>2MB 不支持） |
| 界面 | `FilePane.tsx` | 单栏组件（Local/Remote 共用）：浏览/新建/重命名/删除/复制路径/大小列 |
| 界面 | `TransferQueue.tsx` | 底部传输队列：进度条、速度、取消、恢复、清除已完成 |
| 界面 | `ConflictModal.tsx` | 同名冲突：Resume(仅部分存在时)/Overwrite/Skip/Rename + 本次会话记住 |
| 状态 | `src/renderer/src/store.ts` | transfers/conflicts/rememberedActions、全局监听（只注册一次） |

### 5.2 关键行为
- 原 `SftpPanel.tsx` 已删除；`Workspace.tsx` 的 `kind === 'sftp'` 分支渲染 `FilesPanel`；TabKind 仍为 `'sftp'`（不改 vault schema）。
- 入口文案统一为 **Files**：标签标题 `Files · name`，Sidebar 悬停钮/右键菜单、ServerDetail 按钮、CommandPalette（关键词含 files/transfer）。
- 旧 dialog 版 `sftpUpload/sftpDownload` IPC 保留未删（兼容），界面不再调用。
- 冲突处理：弹窗询问；记住选择按 direction 记忆（rename 不记忆）；同尺寸文件直接视为已传输跳过。
- 中断恢复：cancel/断网/错误状态的任务可在队列中 Resume，按记录的偏移继续；偏移与目标大小不符则该文件重传。
- 错误分类：流错误按消息启发式区分 `interrupted`（连接类）与 `error`（其余）；取消走 `CANCELED`。

### 5.3 布局与大小显示（2026-09-12 二次迭代）
- 双栏支持**竖向（上下，Local 上 Remote 下）**与**横向（左右）**切换，分隔栏中间为切换按钮（Columns2/Rows2 图标），默认竖向。
- **仅竖向**显示 Size 列：文件直接显示大小；文件夹异步测量（`localfs:dir-size`/`sftp:dir-size`，3 并发惰性加载，不阻塞列表，失败显示 `—`，换目录自动作废旧请求）。
- 横向完全隐藏 Size 列且不发起测量请求。
- 递归统计均不跟随符号链接；远程符号链接文件在文件夹下载时跳过。

### 5.4 已知取舍与限制
- 续传仅按字节偏移，无校验和；源文件中途被改会产生坏文件。
- 传输任务存内存，应用重启清空。
- 单文件上传不会自动建远程父目录（文件夹传输会）。
- 远程/本地均以登录用户权限运行，无提权能力；远程目录权限不足需 `sudo chown/chmod`。
- macOS 本地目录读不到时检查：系统设置 → 隐私与安全性 → 文件与文件夹 / 完全磁盘访问权限 → Janus(Electron)。

## 6. 视频播放功能（2026-09-12 实现；同日升级为播放列表版）

### 6.0 播放器升级：同目录列表 + 自动连播 + 选集（2026-09-12，方案见 docs/video-playlist-implementation-plan.md）
- **弃用 data: URL 裸视频页**，改为打包播放页：`src/renderer/player.html` + `src/renderer/src/player/main.tsx` + 自包含 `src/preload/player.ts`（sandbox:true，内联 `player:context`/`player:save-progress` 通道名）。
- `media:open` 入参不变，内部改走 `PlayerWindowManager.openPlayer`（`src/main/media.ts`）；FilePane 零改动。
- 播放列表：点击播放时按被点文件所在目录实时生成（远程 `sftpList` / 本地 `localList`），`src/shared/media.ts` 的 `VIDEO_EXT`/`isVideoFile`/`naturalCompare`（E1<E2<E10、第1集<第2集<第10集）；列举失败回退单集。
- 连播：`ended` → 标记 done → 自动切下一集（Autoplay 开关默认开，存 localStorage `janus.player.autoplay`）；最后一集停住不循环。
- 选集：底部集列表，当前集高亮、✓已看、"at mm:ss"进度提示、点击切换；done 集重播从 0 并清除标记。
- 进度存储 v2：`{key:{t,d?,done?,at}}`，旧格式（key:秒）读取时自动迁移；保存时机 timeupdate(5s节流)/pause/切集/pagehide；恢复阈值 >3 秒。
- 协议层修复：`janus-media` Response 流被浏览器中止（切集/拖进度）时 destroy 底层 fs/sftp 读流（原为泄漏）。
- 锁仓统一清理：播放器窗口加入 vaultLock closeAll。
- 测试：`scripts/test-player.mjs` 10/10（自然排序/过滤/进度迁移语义）。

### 6.1 初版实现（协议部分仍有效；窗口与进度轮询已被 6.0 取代）
- 入口：FilePane 行内操作区，视频文件（mp4/m4v/webm/ogv/mov/mkv/avi/wmv/flv/ts/mpg/mpeg/3gp/rmvb）显示 Play 按钮，本地与远程栏均有效。
- 架构：`src/main/media.ts` 注册自定义协议 `janus-media://`（`index.ts` 在 app ready 前 `registerMediaScheme()`，`ipc.ts` 在 ready 后 `setupMediaProtocol()`）；处理器支持 **HTTP Range**，本地走 `fs.createReadStream({start,end})`，远程走 `sftp.createReadStream({start,end})`（复用 `ssh-manager.getSftp`/`sftpStat`），**远程大视频免下载流式播放、可拖动进度**。
- ~~播放窗口：`openMediaPlayer()` data: URL 裸视频页~~（已被 6.0 的 PlayerWindowManager + player.html 取代）。
- IPC：`media:open`（`MediaOpenRequest{title,path,serverId?}`）；preload 暴露 `media.open`；远程请求先 `findServer` 校验。
- 限制：Chromium 编解码决定可播范围——mp4/H.264/WebM 良好；**MKV/AVI/HEVC/RMVB 很可能无法解码**（按钮仍在，播不出属预期）；MIME 未知时回退 octet-stream。
- ~~播放进度记忆：主进程 5 秒轮询 `executeJavaScript` 读写 `currentTime`~~（已被 6.0 的事件驱动保存 + 进度 v2 取代）。
- **VNC 弹出窗口**（2026-09-12）：`VncPanel` 工具栏新增 Pop out 按钮 → `src/main/vnc-window.ts`（`VncWindowManager`）复用 `ssh.startVnc` 的 WS 桥（独立 sessionId），开 1280×820 独立窗口加载 `vnc.html`（`src/renderer/src/vnc/main.tsx`，noVNC + 状态栏 + Ctrl+Alt+Del + Reconnect）；`vnc:popout`/`vnc:context` IPC；preload `src/preload/vnc.ts` 自包含（sandbox:true 同样内联通道名）；关窗自动 stopVnc；锁仓关闭全部弹出窗；弹窗 ready-to-show 强制 show+focus（防止开到后台/其他 Space 被误判为失败）。
- **VNC 首连竞态修复**（同日）：WS 桥在 SSH forwardOut 就绪前会丢弃 noVNC 帧 → 改为 backlog 缓冲，通道就绪后回放；标签页与弹窗的首次失败自动重试一次（800ms）；弹窗 getContext 失败显示明确错误。
- **VNC 全部改为弹出窗口**（同日）：内置 VNC 标签页已移除（`VncPanel.tsx` 删除、TabKind 去掉 'vnc'、Workspace 分支与图标清理）；`store.openVnc` 改为直接调用 `vnc:popout`，ServerDetail/Sidebar 入口不变即得弹窗。旧 `vnc:start`/`vnc:stop` 通道保留未用（不删旧 IPC）。

### 6.2 同日其他界面与体验调整
- `ServerDetail.tsx` 操作按钮 8 个一排过长 → 改为两行（Open Terminal/Files/Disk Usage/Services；Logs/VNC/RDP/Edit）。
- `CopilotPanel.tsx` 输入框占位符 "Ask Copilot… (Enter to send, Shift+Enter for a new line)" 在窄栏换行被裁 → 缩短为 "Ask Copilot…"，快捷键说明移至 title 悬停。
- `TransferQueue.tsx` 完成任务原仅 ✓ 无文字 → `done` 状态显示 "Completed"；任务保留设计不变（Clear finished 手动清除）。
- **VNC 排障结论**（2026-09-12 实测）：台式机 x11vnc 正常运行于 5900（display :1，`-rfbauth ~/.vnc/passwd`），SSH 转发链路验证通过（收到 RFB 003.008）；连接失败原因是服务器配置未填 `vncPassword` → 在 ServerForm「Remote Desktop (VNC)」区填密码即可。

## 6.5 Files 文件夹收藏 + 最近打开（2026-09-13 实现，方案见 docs/files-favorites-implementation-plan.md）

- **收藏**：FilePane 目录行星标（实心=已收藏，再点取消）；`Favorites` 标签页（TabKind 新增 'favorites'，`openFavorites()` 单例，status 置 'connected'）；Workspace 标签栏改为**常驻**（0 标签也渲染，右端常驻 Star 按钮入口）；CommandPalette 加 `Open Favorites`。
- **FavoritesPanel**：列表视图=收藏区（名称/完整路径/设备标签 This Mac 或服务器名/Open/Copy/Remove，addedAt 倒序）+ 最近打开区（50 上限/Clear all/相对时间）；点进后为文件夹视图：内嵌泛化 FilesPanel（伪 tab `fav-<id>`/`fav-recent-<kind>-<hash>`），默认**单栏**（收藏侧），"Show both panes" 切双栏；本地收藏无选中服务器时 `allowDual=false` 并提示。
- **FilesPanel 泛化**：新 props `initialLeftPath/initialRightPath`（传 FilePane `initialPath` 仅首挂载生效）、`singleSide`（单栏模式，隐藏 layout 切换与传输钮）、`allowDual`、`enableCrossWindowNav`（收藏夹视图传 false，避免与真实 Files 标签抢消费 filesNavigation）。
- **最近记录**：FilePane 每次 load 成功即 `recordRecent(target, cwd)`（含初始 home，接受）；同 target+path 去重置顶，硬上限 50。
- **存储**：localStorage `janus.favorites.v1`/`janus.recentFolders.v1`（刻意不入 vault schema）；纯函数 `src/renderer/src/lib/favorites.ts`（sameTarget/toggleFavorite/recordRecent/favoriteDisplayName/folderViewTabId），单测 `scripts/test-favorites.mjs` 20/20。
- 服务器被删：收藏/最近显示 "server missing"，Open 禁用、可移除。
- **失效路径处理**（2026-09-13）：点击 Open 先校验路径存在性（本地 `localFs.stat`，远程新增 IPC `sftp:stat` → `ssh.sftpStat`）；不存在则弹二级确认窗（Modal）询问 Remove/Keep（收藏走 `removeFavorite`，最近走新 action `removeRecent`）；连接/权限失败不算失效，仅显示错误条不提供删除。

## 6.6 通用文件查看器 Viewer（2026-09-13 实现，方案见 docs/viewer-implementation-plan.md）

- **架构**：独立 Viewer 窗口（`src/main/viewer-window.ts`）+ `viewer.html` + `src/renderer/src/viewer/main.tsx`（路由+`ViewerErrorBoundary`）+ 自包含 `src/preload/viewer.ts`；字节统一走既有 `janus-media://`（本地/远程零差异，免下载）；IPC `viewer:open`（主窗守卫）/`viewer:context`/`viewer:save-progress`（sender 校验）；锁仓 closeAll；`render-process-gone` 关窗兜底。
- **格式矩阵**：PDF（pdfjs-dist v6，worker 以 `?url` 打包、`task.onPassword` 拒加密、页码记忆存 `userData/viewer-progress.json`）、.docx（docx-preview）、.xlsx/.xls/.csv（SheetJS→HTML 表+sheet 标签，前 1000 行）、纯文本（CodeMirror 只读 `@uiw/react-codemirror`，UTF-8 strict 失败回退 **GB18030**；.md 源码/marked+DOMPurify 预览切换）、图片（`<img>` Fit/Actual）；.doc/.ppt/.pptx 与未知类型 → Unsupported 回退页。
- **防崩溃三层防线**（用户专项要求）：扩展名白名单 `viewerFor()`（`src/shared/viewer.ts`）→ 魔数嗅探 `sniffMatches()`（PDF `%PDF-`/Office `PK`/图片魔数/文本 NUL 抽样；WEBP 'P'=0x50 已由测试抓修）→ 每查看器 ErrorBoundary；上限：文本 10MB（截断预览 2MB）、图片 100MB、docx/xlsx 50MB、xlsx 1000 行、解析 30s 超时；组件卸载取消在途加载。
- **FilePane 入口**：View（Eye）行按钮 + **双击行为变更**：`isVideoFile`→播放器、`viewerFor` 命中→Viewer、否则远程=Edit/本地无行为（优先级显式，互不串）。
- **依赖新增**：pdfjs-dist、docx-preview、xlsx、marked、dompurify、@uiw/react-codemirror+codemirror、@codemirror/lang-json/javascript/xml。
- 测试：`scripts/test-viewer.mjs` 21/21（路由/魔数/NUL 判定/GB18030 回退）。

## 7. Disk Usage 磁盘分析器（2026-09-12 实现，设计规格见 docs/disk-usage-implementation-plan.md）

### 7.1 架构
| 层 | 文件 | 职责 |
|---|---|---|
| 契约 | `src/shared/disk-usage.ts` | DiskTarget/ScanSnapshot/DiskNode/DirectoryView/DeletePlan/事件/错误码/上限常量 |
| 主进程 | `src/main/disk-usage/manager.ts` | 任务状态机、worker/SSH 句柄、事件序号、删除计划、跨窗消息 |
| 主进程 | `src/main/disk-usage/worker.ts` | worker_threads 工作线程：本地遍历 / 远程 NDJSON 解析、索引、查询（构建为 out/main/disk-usage-worker.js） |
| 主进程 | `src/main/disk-usage/index-store.ts` | 纯 TS 节点索引：upsert/commitBatch/排序缓存/面包屑/树图 top-300/删除解析 |
| 主进程 | `src/main/disk-usage/protocol.ts` | NDJSON 流式解析（StringDecoder、行边界、1MiB 行上限、 malformed 即终止） |
| 主进程 | `src/main/disk-usage/remote-adapter.ts` | Python 探测（3.8+ 缓存）、固定 bootstrap、base64 信封、取消写入 |
| 主进程 | `src/main/disk-usage/delete-manager.ts` | 本地 shell.trashItem（身份校验）/ 远程 helper 删除（结果收集、unknown 处理） |
| 主进程 | `src/main/disk-usage/path-guards.ts` | 组件级 containment（/data vs /data2）、危险目标拒绝 |
| 主进程 | `src/main/disk-usage/window-manager.ts` | 每设备一个窗口、owner 绑定、恢复聚焦、关闭清理 |
| 主进程 | `src/main/disk-usage/ipc.ts` | disk:* 通道注册 + sender 校验（主窗仅 open-window，分析窗仅自身资源） |
| 远程 | `resources/disk-usage/remote.py` | Python 3.8+ 助手：scan（迭代 DFS 后序汇总/st_dev 挂载边界/mountinfo/深度与节点上限/符号链接不跟随/非 UTF-8 标记）+ delete（dir_fd+O_NOFOLLOW 递归、身份与挂载校验、OUTSIDE_ROOT 拒绝） |
| 桥接 | `src/preload/disk-usage.ts` | 分析窗专用 window.diskUsage（无 vault/profile/ipcRenderer 暴露） |
| 界面 | `src/renderer/disk-usage.html` + `src/renderer/src/disk-usage/*` | 独立 renderer：DiskUsageApp/DiskToolbar/DiskTreemap(echarts 按需)/DiskDirectoryList(手写虚拟列表)/DiskDeleteDialog/DiskWarnings/BrowseDialog/store（与主窗 vault 完全隔离） |
| 主窗改动 | `ServerDetail.tsx`（Disk Usage 按钮）、`FilePane.tsx`（目录行 Analyze 入口 + nav 属性）、`FilesPanel.tsx`（导航消费/变更刷新）、`store.ts`（filesNavigation/filesChangedToken/监听） | |

### 7.2 关键行为
- 入口不自动扫描：仅预填路径；Start Analysis 才建任务；Browse 只列直接子目录；Busy 设备返回 SCAN_BUSY（每设备 1 个活动扫描，全局最多 2 个，结果最多保留 2 份）。
- 统计口径：普通文件逻辑大小之和；目录自身不计；符号链接 0 字节不跟随；权限错误标 Partial；上限 **50 万节点**（2026-09-12 用户实测家目录超 20 万后由 20 万上调，worker 堆同步 256→512 MiB，maxStringBytes 64→128 MiB）/512 深度，超限 limited。
- 远程执行：独立 SSH 连接（可单独取消不打断传输/终端/视频）；stdin 信封传 base64 源码+JSON 请求，绝不拼接 shell；Stop 流程 cancel 行→3s TERM→2s 关连接；背压 4MiB pause / 1MiB resume。
- 删除：两阶段（prepareDelete 后端解析 nodeId→路径+身份 → 60s 计划 → executeDelete 分配 operationId，重复执行幂等）；本地仅废纸篓（失败不降级永久删除）；远程永久删除；逐项 succeeded/failed/not-found/skipped/unknown；断线最后一项 unknown 不重放；传输冲突（activePaths 祖先/后代重叠）拒绝；完成后结果 stale + 主窗 disk:files-changed 刷新 FilePane。
- IPC 边界加固：旧 handle() 增加主窗 sender 校验（INVALID_OWNER）；分析窗 sandbox:true + 专用 preload；IpcResult 增加可选 code 字段。
- 锁仓/关主窗 → 关分析窗并取消任务；关分析窗 → 取消其扫描。
- 构建：electron.vite.config 三处入口（main worker/preload/renderer）；electron-builder extraResources 复制 remote.py；echarts 按需注册（TreemapChart+TooltipComponent+CanvasRenderer）。

### 7.3 与规格的已知偏差（有意简化，后续可补）
- 本地（macOS）挂载边界仅 st_dev 比较，无 mountinfo（/proc 仅 Linux）；远程已解析 mountinfo。
- 服务器配置编辑/删除不会自动关闭其分析窗（操作时 findServer 会报错）；窗口标题不跟随改名。
- StrictMode 双调用下目录查询可能重复发起（幂等，无扫描副作用）。
- 删除计划 expect 字段随公开计划返回渲染端（只读展示，无安全风险但属冗余）。

### 7.4 后续修复（2026-09-12 同日）
- **黑屏修复**：分析窗 preload 原引用 `shared/ipc`，rollup 将共享模块拆成 `out/preload/chunks/*.js`，而 `sandbox:true` 的 preload 不允许相对 require → preload 加载失败、`window.diskUsage` 未定义。已将 disk:* 通道名内联进 `src/preload/disk-usage.ts`（注释注明与 shared/ipc.ts 同步），产物自包含仅 `require('electron')`。
- **调试**：开发模式下分析窗曾自动 `openDevTools({mode:'detach'})` 诊断黑屏；问题修复后已于同日移除。
- **工具栏改两行**：DiskToolbar 第一行 Root 输入 + Browse，第二行 Start/Stop + 扫描状态 + warnings；原独立状态行删除，stale 提示独立成行。
- **unknown node 竞态修复**：`start()` 原在收到 `hello` 即返回，但根节点记录随 `nodes` 批次稍后到达，渲染端首个目录查询可能早于索引建立 → `PATH_NOT_FOUND: unknown node`。现 `start()` 需 `hello` + 首个批次（revision≥1）均就绪才返回；任务失败/终态也会释放等待者；目录查询成功后清除旧错误横幅。
- **本地扫描 Stop 兜底**：本地取消原完全依赖 worker 响应，worker 卡死时停在 Stopping… 无出口。新增 5 秒兜底：仍 canceling 则强制 finishTask(canceled) 并 terminate worker；定时器在 finishTask/disposeTask 均清理。取消响应性已入测试（本地 worker + Python helper，32/32）。

## 8. 验证状态

| 项 | 状态 |
|---|---|
| `npm run typecheck`（node+web） | ✅ 通过（0 错误） |
| `npm run build`（含 worker/preload/HTML 新产物） | ✅ 通过 |
| `git diff --check` | ✅ 通过 |
| Disk Usage 自动化 `node scripts/test-disk-usage.mjs` | ✅ 32/32（协议/守卫/索引/Python 扫描与删除边界/本地+远程取消响应性） |
| Disk Usage GUI：开窗、扫描、树图、下钻、删除、跨窗刷新 | ❌ 未做 |
| 真机远程扫描（192.168.2.2）与隔离目录删除 | ❌ 未做 |
| 生产打包后分析窗/worker/remote.py 路径 | ❌ 未做 |
| GUI 逐页面目检 | ❌ 未做 |
| 真机传输（192.168.2.2）：大文件续传、断网恢复、文件夹递归、冲突四动作 | ❌ 未做 |
| 视频播放：本地/远程 mp4、Range 拖动、MKV 行为 | ❌ 未做 |
| 播放器升级：同目录列表、连播 3 集、选集跳转、进度恢复（真机） | ❌ 未做 |
| 播放器自动化 `node scripts/test-player.mjs` | ✅ 10/10 |
| 收藏夹自动化 `node scripts/test-favorites.mjs` | ✅ 20/20 |
| 查看器自动化 `node scripts/test-viewer.mjs` | ✅ 21/21 |
| 查看器 GUI：PDF/docx/xlsx/文本 GBK/图片 本地+远程、页码记忆、双击路由 | ❌ 未做 |
| 收藏夹 GUI：星标、收藏列表、单双栏切换、最近记录、重启保留 | ❌ 未做 |
| frp 隧道传输 | ❌ 未做 |
| 首次真机传输出现 Failed（2026-09-12 用户报告），原因待确认（疑似权限/路径），错误文本未拿到 | ⏳ 待排查 |
