# Files 文件夹收藏 + 最近打开记录

## 需求（用户确认版）
1. Files 里的文件夹可加收藏（星标开关）
2. Workspace 标签区域有「收藏夹」按钮，点击打开收藏夹界面（**Workspace 新标签页**，已确认）
3. 收藏夹界面默认显示被收藏文件夹的路径，**拥有 Files 全部功能**，默认**单栏**，按钮可切双栏
4. 收藏夹界面（Workspace 内容区）显示最近打开的文件夹，**最多 50 个路径**
5. 存储：**localStorage**（已确认，不碰 vault schema）

## 现状关键代码（已核实）
- `store.ts`：TabKind 无 favorites；`LS_KEY='janus.ui'` 已有 loadPrefs/savePrefs 模式；openSftp 建 tab 模式可抄（store.ts:502）
- `Workspace.tsx`：标签栏 `tabs.map` + `TAB_ICON`；内容区按 kind 分支渲染
- `FilesPanel.tsx`：持有 leftPath/rightPath/选中/刷新/layout(vertical|horizontal)；upload/download；TransferQueue + ConflictModal + FileEditor；接受 `tab` 属性（仅用 `tab.serverId`/`tab.id`）
- `FilePane.tsx`：props kind/serverId/selected/onSelect/onPathChange/onTransferEntry/onEditFile/refreshToken/onStatus/showSizes/nav；初始 load('')→home/'.'
- `src/shared/disk-usage.ts` 的 `DiskTarget`（{kind:'local'}|{kind:'ssh',serverId}）可直接复用为目标类型

## 数据模型（localStorage）
```
janus.favorites.v1: FavoriteFolder[]
  { id, target: DiskTarget, path, name, addedAt }
janus.recentFolders.v1: RecentFolder[]
  { target: DiskTarget, path, openedAt }   // 最近在前，去重，硬上限 50
```
- 纯函数模块 `src/renderer/src/lib/favorites.ts`（无 React 依赖，可单测）：
  `toggleFavorite(list, target, path, name)`、`removeFavorite(list, id)`、`isFavorite(list, target, path)`、`recordRecent(list, target, path, cap=50)`（同 target+path 去重置顶）、`capRecents`

## store.ts 扩展
- 状态：`favorites: FavoriteFolder[]`、`recentFolders: RecentFolder[]`（模块加载时从 localStorage 读入）
- 动作：`toggleFavorite(target,path,name)`、`removeFavorite(id)`、`isFavorite(target,path)`、`recordRecent(target,path)`、`clearRecentFolders()`、`openFavorites()`
- 每次变更即写回 localStorage（savePrefs 同款 try/catch 容错）
- TabKind 增加 `'favorites'`；`openFavorites()` 单例 tab（已存在则聚焦），标题 `Favorites`

## 界面改动

### 1. FilePane（收藏入口 + 最近记录 + 初始路径）
- 目录行操作区加 **Star** 按钮（已收藏为实心 accent）：`toggleFavorite(target, e.path, e.name)`；target = local→`{kind:'local'}`，remote→`{kind:'ssh',serverId}`
- `onPathChange` 时调用 `recordRecent(target, cwd)`（同路径去重；每次导航都记）
- 新增可选属性 `initialPath?: string`：首次加载用它替代 home/'.'（FilesPanel 传入）

### 2. FilesPanel 泛化（复用为收藏夹的文件夹视图）
新增可选 props：
- `initialLeftPath?` / `initialRightPath?` → 传给两侧 FilePane 的 initialPath
- `singleSide?: 'local' | 'remote'` → 单栏模式：只渲染指定侧 + 分隔栏放「双栏」切换按钮；双栏模式下该按钮可切回单栏；单栏时隐藏 layout 切换与 Upload/Download 钮（补遗 #5）
- `enableCrossWindowNav?: boolean`（默认 true）→ 收藏夹视图传 false，避免与真实 Files 标签抢消费 filesNavigation（补遗 #1）
- 其余（上传/下载/TransferQueue/ConflictModal/FileEditor/filesChangedToken）原样工作
- 兼容伪 tab：收藏夹文件夹视图构造 `tab = {id:'fav-<favoriteId>', kind:'sftp', serverId, title, status:'connecting'}`；`setTabStatus` 对不在 tabs 里的 id 是 no-op，无副作用；ssh 收藏 serverId=原服务器，local 收藏 serverId=`selectedServerId ?? ''`（补遗 #4）

### 3. FavoritesPanel（新组件，`kind==='favorites'` 时 Workspace 渲染）
- **列表视图（默认）**：
  - Favorites 区：每行 = 星标、名称、完整路径（font-mono）、设备标签（`This Mac` 或服务器名）、Open / Copy path / Remove
  - Recent 区：最近打开文件夹（最多 50，显示相对时间与设备标签），点击进文件夹视图，右上 Clear all
  - 空态文案：提示在 Files 里点星标收藏
- **文件夹视图**：顶部返回条（← Favorites · 路径）+ 泛化 FilesPanel（initial 路径=收藏路径，singleSide=收藏侧）
- 本地收藏无双击服务器上下文时：双栏按钮禁用并提示（需要远程侧 serverId，取 `selectedServerId`，无则禁用）

### 4. Workspace 标签区「收藏夹」按钮
- 标签栏右端常驻 **Star 图标按钮** → `openFavorites()`；标签栏改为**常驻渲染**（0 标签时也显示，仅含 Star 按钮），保证入口永远可见（补遗 #2）
- 内容区新增显式 `tab.kind === 'favorites'` 分支渲染 FavoritesPanel（置于 db fallback 之前，防止被 DbTab 吃掉）（补遗 #3）
- `TAB_ICON` 增加 `favorites: Star`；收藏夹 tab 可关闭、可拖动排序（现有机制免费获得）
- CommandPalette 加 `Open Favorites` 命令（补遗 #7）

## 边界情况
| 情况 | 处理 |
|---|---|
| 收藏的服务器被删除 | 列表仍显示 + "server missing" 标签，Open 禁用，可 Remove |
| 最近记录含已删服务器 | 同上 |
| 重复收藏同一路径 | toggle 去重（再点一次=取消收藏） |
| 最近记录刷新 | 同 target+path 置顶去重；超过 50 截断尾部 |
| 单栏模式传输按钮 | 需双栏才有目标侧，单栏时隐藏/禁用 |
| localStorage 损坏 | JSON.parse try/catch 回退空数组 |

## 复查补遗（2026-09-13 二次审查发现的遗漏，已并入实施步骤）
1. **跨窗导航双消费竞态**：`filesNavigation`（Disk Usage "Open in Files"）会被所有挂载中的 FilesPanel 同时消费（标签页保活 display:none）。收藏夹文件夹视图内嵌的 FilesPanel 也会抢消费 → FilesPanel 新增 `enableCrossWindowNav?: boolean`（默认 true），收藏夹视图传 **false**；filesChangedToken 刷新不受影响。
2. **0 标签时收藏夹按钮不可见**：现标签栏 `tabs.length > 0` 才渲染 → 改为标签栏**常驻**：0 标签时仅渲染右端 Star 按钮，保证入口永远可见。
3. **Workspace 内容区分支漏项**：现有渲染链末尾 `else → DbTab` 会吃掉未匹配 kind → 必须新增显式 `tab.kind === 'favorites'` 分支渲染 FavoritesPanel（放在 db 分支之前）。
4. **伪 tab 的 serverId 取值**：ssh 收藏=原服务器 id；**local 收藏**=`selectedServerId ?? ''`——无双击服务器时双栏切换按钮禁用并提示原因（远程侧无上下文）。
5. **单栏模式下的多余控件**：layout（竖/横）切换钮与 Upload/Download 钮仅在双栏显示，单栏一律隐藏（分隔栏只留"展开双栏"按钮）。
6. **FilePane initialPath 语义**：仅首次挂载生效一次（path==='' 时 load(initialPath)）；之后 refreshToken/手动导航不受影响；初始 home 加载也会记一条最近打开（接受并在文档注明）。
7. **CommandPalette 入口**（小项）：加 `Open Favorites` 命令（关键词 favorites/star/bookmark），与全局入口习惯一致。
8. **收藏列表排序**：列表展示按 addedAt 倒序（最新在前）；recordRecent 跳过空 path。
9. **文档同步范围**：P4 除 `janus/MODIFICATIONS.md` 新增章节外，同步更新工作区 `AGENTS.md` 概要行（与历次做法一致）。

## 三次审查补遗（2026-09-13 第三轮，细节级）
1. **收藏夹 tab 状态点**：Tab.status 若取 'connecting' 会永久黄色脉冲；`openFavorites()` 创建时直接置 `'connected'`。
2. **伪 tab id 唯一性**：收藏用 `fav-<favoriteId>`；最近记录无 favoriteId，用 `fav-recent-<target.kind>-<path 的稳定 hash>`，避免两个最近项共用 id 导致 React key/状态串扰。
3. **目标相等性 helper**：`lib/favorites.ts` 必须含 `sameTarget(a,b)`（kind 相同且 ssh 时 serverId 相同）——`isFavorite`/`recordRecent` 去重/`toggleFavorite` 全靠它，不能只用 path 字符串比较（本地与远程可能同路径）。
4. **收藏显示名兜底**：`name` 为空时用 path 最后一段；根路径（`/`）显示设备名（This Mac / 服务器名）。
5. **FilePane 工具栏"收藏当前目录"**：作为 stretch 可选项（默认只做行内星标）；若做，放工具栏 mkdir 旁，状态跟随当前 path。
6. **接受的行为取舍（明示）**：标签栏常驻会固定占 40px 高度（0 标签时也占）；关闭收藏夹 tab 后再开回到列表视图（文件夹视图状态不保留）；miniMode 下标签栏与 Star 按钮仍隐藏（沿现状）。

## 实施步骤
- **P1**：`lib/favorites.ts` 纯函数 + 单测（`scripts/test-favorites.mjs`：toggle/去重/50 上限/置顶）；store 扩展（状态/动作/persist/TabKind/openFavorites）
- **P2**：FilePane（Star 按钮、recordRecent、initialPath）；FilesPanel 泛化（initial paths、singleSide + 切换按钮）
- **P3**：FavoritesPanel + Workspace 标签栏 Star 按钮 + TAB_ICON；`npm run typecheck`、`npm run build`、`git diff --check`
- **P4**：`scripts/test-favorites.mjs` 全绿；既有测试回归（player 10/10、disk-usage 32/32）；MODIFICATIONS.md 新增章节并如实登记未验证项（GUI 手测：星标、收藏夹列表、单双栏切换、最近记录、重启保留）

## 验证
1. 三项静态检查全绿 + 两套既有测试回归 + 新增 favorites 单测
2. 手测路径：FilePane 目录点星 → 标签栏 Star → 收藏夹显示该路径 → Open 进文件夹视图（默认单栏）→ 切双栏传一个文件 → 回列表看 Recent 置顶 → 重启 app 收藏/最近仍在 → 50 条上限

## 明确不做
- 收藏分组/排序/重命名、云同步、vault 内存储
- 最近打开"文件"记录（只记文件夹）、收藏夹内搜索
- 独立弹窗形态（已被 Workspace 标签页决策取代）
