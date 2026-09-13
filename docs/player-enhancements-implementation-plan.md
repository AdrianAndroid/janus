# 播放器功能补全：速度全局应用 / 列表定位 / 进度与时间 / 视频收藏 / 收藏列表时间

## 需求（用户确认版）
1. **播放速度全局应用**：调速度后，本次播放器所有视频（含连播切集）都用该速度
2. **播放列表自动定位当前播放文件**（列表滚动到当前集可见）
3. **每个视频保留进度 + 记录最后播放时间**，都在集列表上直接显示
4. **集列表加视频收藏**；收藏夹里点该视频直接打开播放，且其所在文件夹的视频照常进入播放列表
5. **收藏夹列表行追加最后查看时间**：短文本显示，鼠标悬停看完整年月日时分秒

## 关键架构决策：视频收藏存主进程（不进 localStorage）
- 播放器窗口是**独立渲染进程**：主窗 zustand 不可达；localStorage 虽同源共享，但主窗/播放器双写数组会 last-write-wins 互相覆盖（竞态丢收藏）
- 因此视频收藏由**主进程持有**：`userData/video-favorites.json`，两窗口都走 IPC（单一写入者，零竞态）
- 文件夹收藏维持现状（renderer localStorage，只有主窗写，无竞态）
- 视频收藏的"最后观看时间"**不冗余存储**：直接读既有 `media-progress.json` v2 的 `at`（按 key 合并）

## 现状（已核实）
- `src/main/media.ts`：`PlayerWindowManager`（context 含 items/index/progress）、进度 v2 `{t,d?,done?,at}`、`saveProgressEntry`
- `src/renderer/src/player/main.tsx`：集列表（✓/"at mm:ss"）、Autoplay 开关、无速度控制、无滚动定位、无收藏
- 收藏夹：`FavoritesPanel.tsx` 文件夹区 + 最近区（localStorage `janus.favorites.v1`）
- preload 模式：`preload/player.ts`（自包含内联通道名）可扩展；主窗 `preload/index.ts` 可加 `videoFavorites.*`

## 模块设计

### 1. 主进程：视频收藏存储 + IPC
- `src/main/video-favorites.ts`：
  - 记录：`{id, serverId?, path, name, addedAt}`
  - `list()`：合并 media-progress 的 `at/done/t` → 输出 `{...item, lastWatchedAt?, done?, resumeT?}`（按 addedAt 倒序）
  - `toggle(serverId, path, name)` → `{favorited: boolean}`；`remove(id)`
  - 纯数组操作抽到 `src/shared/video-favorites.ts`（`toggleVideoFav/removeVideoFav/isVideoFav`，可单测）
- IPC（新增，不改旧名）：`videoFav:list`、`videoFav:toggle`、`videoFav:remove`
  - 主窗经 handle()（自带主窗守卫）；播放器窗口：sender 校验为已登记 player 窗（`playerWindows.contextFor(sender)` 存在否则 INVALID_OWNER）
- preload：`preload/index.ts` 加 `videoFavorites.*`；`preload/player.ts` 加同名三方法（内联通道名）
- 打开方式：收藏夹点击 → 直接调既有 `media:open`（serverId?, path）——**所在文件夹视频自动进列表**（buildPlaylist 既有行为，需求 4 后半句零成本满足）

### 2. 播放器窗口（player renderer）
- **速度**：`rate` 状态存 localStorage `janus.player.rate`（默认 1，播放器窗口私有无需跨窗）；底部栏新增速度选择（0.5/0.75/1/1.25/1.5/2 循环按钮或 select）；`video.playbackRate = rate` 在 onChange 与每次 `loadedmetadata` 后应用 → 全列表视频统一速度（需求 1）
- **自动定位**：index 变化时当前行 `scrollIntoView({block:'nearest'})`（需求 2）
- **行显示**（需求 3）：保留 ✓/"at mm:ss"，追加**最后播放时间**短文本（来自 progress.at，行 hover 的 title 显示完整 `YYYY-MM-DD HH:mm:ss`）；`saveNow` 后同步更新本地 progress state（现在只更新 done，扩展为全字段），保证刚播完的行立即刷新时间
- **行收藏**（需求 4）：每行 Star 按钮（实心=已收藏），`videoFav:toggle` 更新本地收藏集合；context 增加 `favoriteKeys: string[]`（开窗时主进程读一次）
- 时间格式 helper 放 `src/shared/timefmt.ts`：`fmtShort(ts)`（当天 HH:mm；当年 MM-DD HH:mm；更早 YY-MM-DD）、`fmtFull(ts)`（YYYY-MM-DD HH:mm:ss）——可单测

### 3. 收藏夹（FavoritesPanel）
- 新增 **Favorite videos 区**（置于文件夹收藏上方）：
  - 行 = ▶ 图标、名称、设备标签（This Mac/服务器名）、**最后观看时间**（短文本 + title 完整时间；未看过显示 "never"）、Remove
  - 点击 → 路径存在性校验（沿用 stale 弹窗模式，远程走 sftp:stat）→ `media:open` 打开播放器
  - 服务器被删：沿用 "server missing" 禁用
- **文件夹收藏行追加最后打开时间**（需求 5 的"列表后面都追加"）：
  - `FavoriteFolder` 增加可选 `lastOpenedAt`；`openFolder` 成功时写回（localStorage 持久化）
  - 显示：短文本 + title 完整时间
- 最近打开区不动

### 4. 类型与共享
- `src/shared/video-favorites.ts`：`VideoFavorite`/`VideoFavoriteView` 类型 + 纯函数（toggle/remove/isFav/mergeProgress）
- `src/shared/timefmt.ts`：fmtShort/fmtFull
- `Window.player`/`Window.janus` 类型增补（`src/preload/index.d.ts` 自动随导出）

## 边界与细节
| 点 | 处理 |
|---|---|
| 速度合法性 | 仅允许预设档位；localStorage 读出没命中回退 1 |
| 切集速度保持 | rate 是组件状态，loadedmetadata 后重新赋值（原生 controls 自带速度菜单与此不冲突，统一由我们的状态覆盖） |
| 播放器多开 | 各窗独立 rate（窗口级）；进度/收藏经主进程天然一致 |
| 收藏后删除服务器 | 视频收藏显示 server missing 禁用（与文件夹一致） |
| 进度 at 语义 | `at` = 最近一次保存时间（5s 节流/pause/切集/关窗），作为"最后播放时间"足够准确 |
| 时间文本长度 | 行内只放 fmtShort（≤12 字符），title 放 fmtFull（需求 5 原话） |
| 旧 media-progress v1 数据 | 读取已自动迁移（v2 实现时已有），at 可能为 0 → 显示 "—" |

## 二次审查补遗（2026-09-13 第二轮）
1. **速度单一事实来源**：除自有速度选择器外，监听 `ratechange` 事件同步 state（原生控制菜单改速度也被捕获），保证"当前所有视频统一速度"不被旁路修改破坏；赋值是幂等的不会循环。
2. **进度显示的数据源**：`ctx.progress` 是开窗快照——播放器内改为组件 state `progressMap`（boot 时用 ctx.progress 初始化），每次 `saveNow`/切集保存后同步更新该 state；集列表行只读 progressMap，保证时间与"at mm:ss"实时刷新。
3. **收藏 key 格式显式统一**：收藏身份 = `mediaProgressKey(serverId, path)`（`serverId:path` 或裸 path）；`PlayerContext` 增加 `favoriteKeys?: string[]` 字段（开窗时主进程合并），集列表行用 `item.key` 直接匹配；video-favorites 存储的 mergeProgress 也用同一 key。
4. **lastOpenedAt 写回时机**：仅在"校验通过且成功进入文件夹视图"时更新；路径失效/校验失败/连接错误一律不改写（避免失效路径的时间被刷新误导）。
5. **fmtShort 精确定义**：同一天→`HH:mm`；同一年→`MM-DD HH:mm`；更早→`YY-MM-DD`；`fmtFull` 固定 `YYYY-MM-DD HH:mm:ss`（行内 title 用）；`at=0`（v1 迁移数据）显示 `—`。
6. **播放器 preload 方法命名**：挂在既有 `window.player` 下 `listFavorites()/toggleFavorite()/removeFavorite()`（与 getContext/saveProgress 并列，内联通道名 `videoFav:*`）；播放器侧 sender 校验用 `playerWindows.contextFor(sender)` 存在性（INVALID_OWNER）。

## 三次审查补遗（2026-09-13 第三轮）
1. **收藏夹视频区跨窗刷新**：播放器窗口里的 star/toggle 主窗不可见 → FavoritesPanel 视频区在 mount、增删操作后，以及 **window focus/visibilitychange** 时重新 `videoFav:list`（低成本覆盖跨窗更新）。
2. **store 实例归属**：`VideoFavoritesStore` 在 `ipc.ts` 创建并**注入** `PlayerWindowManager`（构造第三参），`favoriteKeys` 在 `openPlayer` 内与播放列表同 key 口径合并——避免 media.ts 直接读文件、保证单实例。
3. **换源会重置倍速（浏览器行为）**：`video.src` 变更/load() 会把 `playbackRate` 重置为 `defaultPlaybackRate(1)`——所以 rate 必须在**每次** `loadedmetadata` 后重新赋值（已列入方案，此处明确原因，不可省）。
4. **media:open 重复点击语义**：每次点击新开一个播放器窗口（与现状一致），不做单例去重——明示接受。
5. **video-favorites.json 写入**：直写小文件（与 media-progress.json 同模式），接受非原子写；损坏回退空数组。
6. **UI 文案英文**：速度标签 `Speed`、未观看显示 `never`、无时间显示 `—`（项目英文文案规范）。

## 四次审查补遗（2026-09-13 第四轮，实现级）
1. **key 函数必须下沉到 shared**：`mediaProgressKey()` 现位于 `src/main/media.ts`（依赖 electron，shared/渲染层不可 import）。收藏身份 key 在 shared 纯函数、播放器渲染层、主进程三处都要用 → 将 `mediaProgressKey` 移入 `src/shared/media.ts`（无依赖），`src/main/media.ts` 改为从 shared 复用，禁止两处各写一份格式。
2. **进度读取复用**：`readProgressMap()`（含 v1→v2 迁移）现在是 media.ts 私有——video-favorites.ts 的 list() 合并需要它 → 从 media.ts **导出**该函数复用，不重写迁移逻辑。
3. **集列表行结构**：现有行是整行 `<button onClick={switchTo}>`，**不能再嵌套 `<button>` 放 Star**（非法嵌套且点击冲突）→ 行容器改为 `<div>`，内部两个独立按钮：切换区（flex-1）+ Star 区（shrink-0），Star 点击 `stopPropagation`。
4. **lastOpenedAt 需要专用 store action**：新增 `markFavoriteOpened(id)`（更新数组对应项 + saveJson + set state），openFolder 校验通过进入视图时调用；不要复用 toggleFavorite（语义不符）。
5. **fmtShort 测试注意**：当天/当年判定走本地时区，单测用固定 epoch 构造（同日内边界、跨年边界），不测当前时钟。

## 五次核查（2026-09-13 代码逐行核对，已验证）
- 已验证补遗 1–4 的必要性：mediaProgressKey 位于 main 层（media.ts:132）、readProgressMap 私有（media.ts:143）、集行整行 button（player/main.tsx:231）、ctx.progress 开窗快照（main.tsx:165）、构造仅 (ssh, find)（media.ts:218）。
- 新澄清 A：**video 元素每集重挂载**（`key={current.key}`，main.tsx:173）→ rate 应用挂在 `loadedmetadata` 恰好覆盖"新元素默认 speed=1"，方案正确且必须保留该钩子。
- 新澄清 B：**主进程进度副本一致性**：`player:save-progress` 同时更新 media.ts 内存 context.progress 与磁盘 media-progress.json（同一次 saveProgress 调用）→ FavoritesPanel 视频区经 videoFav:list 读磁盘合并不会出现内存/磁盘不一致，无需额外同步通道。

## 实施步骤
- **P1**：`src/shared/video-favorites.ts` + `src/shared/timefmt.ts` + 主进程 `video-favorites.ts` + IPC/双 preload + 单测（toggle/merge/时间格式）
- **P2**：播放器：rate 持久化与应用、列表 scrollIntoView、行时间显示与本地 progress 刷新、行 Star + context.favoriteKeys
- **P3**：FavoritesPanel：视频收藏区（含 stale 校验打开）+ 文件夹行 lastOpenedAt 写回与显示
- **P4**：typecheck/build/diff --check + 新单测 + 既有四套测试（viewer 21/favorites 20/player 10/disk 32）回归 + MODIFICATIONS.md（6.0 播放器节追加）+ 工作区 AGENTS.md 概要

## 验证
1. 静态检查全绿 + 全部测试回归
2. 真机手测（登记未做项）：调速后连播 3 集速度一致；列表滚动跟随；进度+时间显示；收藏视频从收藏夹一键打开且同目录进列表；时间悬停看完整值

## 明确不做
- 倍速记忆到每个文件（速度是播放器窗口级偏好，非每文件属性）
- 收藏视频分组/备注/缩略图、观看历史独立页、跨设备同步
- 文件夹收藏的"查看时间"改为打开时间的迁移（旧收藏无 lastOpenedAt → 显示 —）
