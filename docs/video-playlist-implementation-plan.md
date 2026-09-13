# 视频播放器升级：同目录播放列表 + 自动连播 + 选集

## 目标
点击 FilePane 的播放按钮时：
1. 自动读取被点视频**同一目录下的全部视频文件**，生成播放列表
2. 当前集播完**自动播放下一集**（可开关）
3. 播放界面有**选集侧栏**（点击任意集切换，显示已看/进度状态）

## 现状关键代码（已核实）
- `src/main/media.ts`：`janus-media://` 流式协议（Range，本地 fs / 远程 sftp，**保持不变，直接复用**）；`openMediaPlayer()` 用 **data: URL** 内嵌裸 `<video>` 开窗；进度存 `userData/media-progress.json`（`{key: 秒}`），靠主进程每 5 秒 `executeJavaScript` 轮询 `video.currentTime` 读写。
- `src/main/ipc.ts`：`media:open` 收到 `{title, path, serverId?}` 即开窗（FilePane 无需改协议）。
- 本仓库已有两个独立窗口范式可抄：Disk Usage（`disk-usage.html` + 专用 preload + context IPC）与 VNC 弹窗（`vnc.html` + `preload/vnc.ts` 内联通道名 + sandbox）。

## 方案选型：弃用 data: URL，改为打包播放页（推荐）

| | A. 打包播放页（推荐） | B. 继续 data: URL |
|---|---|---|
| 选集 UI | React 组件，可维护 | 手写字符串 HTML+JS，难维护 |
| 切集恢复进度 | preload 调 IPC 即时取，精确 | 主进程 5 秒轮询探测，会"先播 0 秒再跳" |
| 进度保存 | timeupdate/pause/切集/关闭 事件驱动，准确 | 只能继续轮询 hack |
| 成本 | 1 HTML + 1 preload + 1 React 页（~350 行） | 看似省，实际把复杂 JS 塞进模板字符串，风险高 |

沿用 VNC 弹窗模式：`player.html` + `src/renderer/src/player/main.tsx` + `src/preload/player.ts`（sandbox:true，**内联 IPC 通道名**——Disk Usage 黑屏的教训：sandbox preload 不能引共享 chunk）。

## 模块设计

### 1. 主进程 `src/main/media.ts`（重构，协议部分不动）
- **播放列表构建** `buildPlaylist(serverId?, filePath)`：
  - 远程：`ssh.sftpList(profile, dirname)`；本地：`localFs.localList(dirname)`
  - 过滤视频扩展名（复用 FilePane 的 VIDEO_EXT 集合，移到 `src/shared/media.ts` 共用）
  - **自然排序**：`localeCompare(b, undefined, {numeric: true, sensitivity: 'base'})`（保证 E01/E02/…/E10、第1集/第2集顺序正确）
  - 目录列举失败（权限等）→ 回退为单集列表，不报错
- **播放器窗口管理** `openPlayerWindow({serverId?, filePath, title})`：
  - 构建列表 + 定位当前集 index；每窗口独立上下文（`webContents.id → context`）
  - 1280×800，sandbox + `preload/player.js`；关窗清理
- **进度存储 v2**（`media-progress.json`）：
  - 新格式 `{key: {t: 秒, d?: 时长, done?: bool, at: 时间戳}}`；读时兼容旧格式（数字 → 对象）
  - `done` 判定：播放到结尾或 t/d ≥ 95% 由渲染端上报
- **IPC（新通道，不动旧名）**：`media:open`（签名不变，内部改走新窗口）、`player:context`（返回 {items:[{name,path,key}], index, title, progress: Record<key,{t,d,done}>}）、`player:save-progress`（{key,t,d?,done?}）
- **顺手修流泄漏**：`janus-media` 协议 handler 在 Response 流被浏览器中止（切集/拖进度关闭旧请求）时 destroy 对应 fs/sftp 读流（现无处理，切集多了会漏流）

### 2. 桥接 `src/preload/player.ts`（自包含，内联通道名）
暴露 `window.player`：`getContext()`、`saveProgress(req)`。

### 3. 渲染页 `src/renderer/player.html` + `src/renderer/src/player/main.tsx`
- CSP 仿照 vnc.html（`media-src 'self' janus-media:` 需放行视频源：CSP 加 `media-src janus-media:`；connect-src 不需要，视频走 src）
- `PlayerApp`：
  - 左侧视频区 `<video controls autoplay>`，src = 当前集 `janus-media://play?...`（主进程已验证 Range 可拖动）
  - **选集侧栏**：集名列表，当前集高亮；每集显示 ✓（done）或"看到 mm:ss"（有进度）；点击切集
  - 底部条：上一集/下一集按钮、**自动连播开关**（默认开，存 localStorage `janus.player.autoplay`）
  - 标题栏随切集更新 `document.title = 集名`
- 播放逻辑：
  - 切集：先 `saveProgress(当前集)` → 换 src → `loadedmetadata` 后 `currentTime = progress[key].t`（>3 秒才恢复）
  - `timeupdate` 节流 5 秒保存；`pause`/切集/关窗前（`pagehide`）保存
  - `ended`：标记当前集 done → 若自动连播开且有下一集 → 切下一集（从 0 或其进度续播）
- StrictMode 双挂载保护：初始化只跑一次（ref 守卫）

### 4. 构建与类型
- `electron.vite.config.ts`：preload 入口 +`player`，renderer input +`player.html`
- `src/shared/media.ts`：`PlayerItem`/`PlayerContext`/`SaveProgressReq` 类型 + `VIDEO_EXT` 常量；`MediaOpenRequest` 不变
- `src/preload/index.d.ts`：`Window.player` 类型
- FilePane / `media:open` 入参**零改动**（行为升级对调用方透明）

## 交互与规则细节
- 排序即"集序"：自然排序结果即播放顺序；当前集 = 被点击的文件
- 连播边界：最后一集播完停在结尾画面，不循环
- 恢复阈值：>3 秒才跳进度；done 的集再点开从 0 播（并清除 done）
- 远程切集即新的 Range 流，经 `getSftp` 复用连接，不新建 SSH
- 非 UTF-8 文件名：只显示，不禁止播放（janus-media 按原路径字节流）

## 边缘情况
| 情况 | 处理 |
|---|---|
| 目录列举失败/无权限 | 单集列表兜底 |
| 目录 500+ 视频 | 侧栏虚拟滚动暂缓（普通 overflow 即可，500 行无压力） |
| 切集瞬间旧流未关 | 协议层 Response cancel → destroy node 流（本次一起修） |
| 播放中锁仓 | 主进程 vaultLock 现关 Disk Usage/VNC 窗；播放器窗口一并关闭（加入统一清理） |
| 进度文件损坏 | read 失败回退 `{}`（现有行为） |

## 实施步骤
- **P1**：`src/shared/media.ts` 类型/常量；media.ts 进度存储 v2+迁移、bundlePlaylist、协议流泄漏修复；测试脚本补自然排序与播放列表构建用例
- **P2**：preload/player.ts + player.html + main.tsx 播放器 UI；`player:context`/`player:save-progress` IPC；`media:open` 切换到新窗口；锁仓清理
- **P3**：构建入口、`Window.player` 类型；typecheck/build/diff --check；`node scripts/test-disk-usage.mjs` 回归
- **P4**：MODIFICATIONS.md 第 6 节更新（播放列表/连播/选集 + 进度格式 v2 + 流泄漏修复），验证状态如实登记（GUI 真机连播未测项）

## 验证
1. typecheck / build / diff --check 全绿；既有测试 32/32 回归
2. 新增：自然排序（E1<E2<E10、中文集名）、本地目录列表过滤、进度格式 v1→v2 迁移
3. 真机手测（登记为未做项）：同目录连播 3 集、选集跳转、进度恢复、远程 /Backup 剧集目录

## 明确不做
- 片头跳过、字幕加载、转码、外挂播放器、倍速记忆、循环/随机模式
- 子目录递归进列表、跨目录列表、播放列表持久化（每次按目录实时生成）
