# Janus 本地修改记录（zhaojian 分支）

> 本文档持续记录本分支相对上游的全部改动，以**最新状态**为准。每次改动后更新对应章节，保持"唯一事实来源"。
> 最后更新：2026-09-12

## 1. 维护规则（每次改动必读，优先执行）

1. **文档保鲜**：每次改动后必须更新本文档对应章节与"最后更新"日期；发现旧记录与代码现状不符时，以代码为准修正文档。验证状态（第 6 节）如实更新。
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

## 6. 视频播放功能（2026-09-12 实现）

- 入口：FilePane 行内操作区，视频文件（mp4/m4v/webm/ogv/mov/mkv/avi/wmv/flv/ts/mpg/mpeg/3gp/rmvb）显示 Play 按钮，本地与远程栏均有效。
- 架构：`src/main/media.ts` 注册自定义协议 `janus-media://`（`index.ts` 在 app ready 前 `registerMediaScheme()`，`ipc.ts` 在 ready 后 `setupMediaProtocol()`）；处理器支持 **HTTP Range**，本地走 `fs.createReadStream({start,end})`，远程走 `sftp.createReadStream({start,end})`（复用 `ssh-manager.getSftp`/`sftpStat`），**远程大视频免下载流式播放、可拖动进度**。
- 播放窗口：`openMediaPlayer()` 新建独立 BrowserWindow（960×600 黑底），加载 data: URL 内嵌 `<video controls autoplay>`；无 preload、无 node 集成。
- IPC：`media:open`（`MediaOpenRequest{title,path,serverId?}`）；preload 暴露 `media.open`；远程请求先 `findServer` 校验。
- 限制：Chromium 编解码决定可播范围——mp4/H.264/WebM 良好；**MKV/AVI/HEVC/RMVB 很可能无法解码**（按钮仍在，播不出属预期）；MIME 未知时回退 octet-stream。
- 播放进度记忆（2026-09-12）：进度存主进程 `userData/media-progress.json`（key = `serverId:path` 或本地 path，远程按服务器隔离）；播放中每 5 秒及关闭窗口时经 `webContents.executeJavaScript` 读取 `video.currentTime` 保存；重开时 dom-ready 注入脚本在 `loadedmetadata` 后恢复 `currentTime`（>3 秒才恢复）。data: URL 页面无可靠 localStorage，故走主进程持久化。

## 7. 验证状态

| 项 | 状态 |
|---|---|
| `npm run typecheck`（node+web） | ✅ 通过 |
| `npm run build` | ✅ 通过 |
| `git diff --check` | ✅ 通过 |
| GUI 逐页面目检 | ❌ 未做 |
| 真机传输（192.168.2.2）：大文件续传、断网恢复、文件夹递归、冲突四动作 | ❌ 未做 |
| 视频播放：本地/远程 mp4、Range 拖动、MKV 行为 | ❌ 未做 |
| frp 隧道传输 | ❌ 未做 |
| 首次真机传输出现 Failed（2026-09-12 用户报告），原因待确认（疑似权限/路径），错误文本未拿到 | ⏳ 待排查 |
