# Janus Disk Usage：技术设计与实施交接

> 日期：2026-09-12。状态：**设计方案，尚未实现**。
> 适用仓库：`/Users/zhaojian/bin/macmini/janus`，开发分支 `zhaojian`。
> 实施前先读 `AGENTS.md` 和 `MODIFICATIONS.md`，重新检查 Git 状态与代码。
> 本文是实施规格；已实现功能与验证状态仍以 `MODIFICATIONS.md` 为唯一事实来源。

## 1. 最终产品决策

用户希望为 Janus 添加类似 DiskUsage 的磁盘分析工具：左侧矩形树图，右侧文件/文件夹列表，支持批量删除及进入文件管理。

**采用最新入口设计：服务器详情页操作按钮 → 独立 Disk Usage 窗口。**

- `ServerDetail.tsx` 中紧接 `Files` 添加 `Disk Usage` 按钮。
- 点开即绑定该服务器，不再要求重新选择服务器。
- 独立窗口没有服务器切换下拉框；主窗口切换服务器不影响它。
- 同一设备只开一个分析窗口；再次点击恢复并聚焦已有窗口。
- 不同设备可各自打开窗口，任务和选择状态隔离。
- 文件管理目录菜单增加 `Analyze Disk Usage`，打开同一窗口并携带目录。
- 本地 FilePane 的入口绑定 `local`，远程入口绑定该 FilePane 的 serverId。
- 第一版不增加左侧全局导航入口，不把分析页塞进现有 TabKind。
- 主窗文件管理保持现有上下/左右布局，分析窗固定为左图右列表。
- 所有应用文案使用英文；技术说明可以使用中文。

**所有入口都不自动开始分析。** 首次从服务器详情页进入默认解析 SSH 用户家目录；目录右键入口仅预填选中目录。用户可手动输入路径，或点击 `Browse` 在当前设备上选择目录，最后点击 `Start Analysis` 才创建扫描任务。目录浏览仅列出直接子目录，不递归统计大小。
已有窗口若正在扫描或有删除任务，不直接替换路径；显示新路径请求，用户停止当前扫描并切换后仍须手动点击 `Start Analysis`。修改输入框、选择目录、打开窗口、重新连接、收到新入口请求都不能隐式触发扫描。

## 2. 范围与分阶段交付

### V1 必须完成

1. 独立窗口及两个入口，固定设备上下文。
2. Ubuntu/Python 3.8+ 远程扫描；Mac mini 本地扫描。
3. 树图、分页/虚拟列表、下钻、面包屑、大小排序、名称过滤、多选。
4. 流式进度、取消、权限错误、部分结果、内存限制、断线处理。
5. 批量移至本地系统废纸篓；远程批量永久删除，明确预览和确认。
6. 复制路径、在主窗口文件管理打开目录；删除后跨窗口刷新。
7. 类型检查、构建、回归测试、隔离测试目录真机验证。

先交付只读闭环，再启用删除。不能用“只读完成”冒充整个 V1 完成。

### V2 再做

历史扫描、SQLite 持久化、扫描结果对比、远程回收站、重复文件检测、扩展名统计、实际磁盘块占用、Windows 本地支持、无 Python 的 SFTP 扫描回退。

V1 不安装服务端常驻 Agent，不改服务器权限，不引入 rsync，不改现有传输协议。

## 3. 当前代码事实与复用边界

| 现有文件 | 本次接入方式 |
|---|---|
| `src/renderer/src/components/ServerDetail.tsx` | 主入口；捕获按钮点击当时的服务器 ID |
| `FilePane.tsx` / `FilesPanel.tsx` | 目录快捷入口、定位与文件变更刷新；不复用其递归大小测量 |
| `src/renderer/src/store.ts` | 主窗选中服务器、openSftp、导航请求；不存分析完整树 |
| `src/main/ipc.ts` | 组装窗口、任务管理器；复用 findServer/jumpFor；增加专用校验 handler |
| `src/main/ssh-manager.ts` | 保留共享 SFTP 修复；新增受控、可写 stdin 的 exec stream 能力 |
| `src/main/local-fs.ts` | 普通浏览可复用；现有递归删除不直接当成批量删除边界 |
| `src/main/index.ts` | app lifecycle / 主窗口恢复；关闭主窗时清理分析窗 |
| `src/main/media.ts` | 仅参考独立窗口创建；不复制 data: HTML 播放器实现 |
| `src/shared/ipc.ts` | 只新增 disk:* 通道；不得重命名已有通道 |
| `src/preload/index.ts` | 主窗仅暴露 openWindow 与文件变化事件 |
| `electron.vite.config.ts` | 新增 analysis preload、renderer HTML、worker 构建入口；保留 es2022 |
| `electron-builder.yml` | 确认新 HTML、worker、preload 和扫描脚本进入安装包 |

注意：现有 App.tsx 会初始化 vault、注册主窗快捷键和轮询。**独立分析窗不能直接挂载 App，也不能复制整个主窗 store/vault。**
现有 `startStream` 把 stdout/stderr 混发为日志，且没有向调用者暴露 stdin，不适合直接读取结构化扫描协议。
现有 `handle()` 丢弃了 IPC sender，分析窗 handler 必须保留 event 并验证调用窗口。

## 4. 窗口行为与布局

### 4.1 窗口参数

- 建议初始 1280×800，最小 960×640，实际尺寸限定于当前屏幕可用区域。
- 非模态顶层窗口，不使用阻塞主窗的 modal。
- 标题：`Disk Usage · 台式机服务器`；正文常驻 `zhaojian@192.168.2.2:22`。
- 本机标题 `Disk Usage · This Mac`。
- 路径输入、Browse/Start Analysis/Stop、扫描状态在顶部；扫描根和当前浏览目录分开显示。
- 默认左右 60/40，可拖动分隔线；列表最小 340px；只记忆尺寸与分栏比例。
- 不把文件路径、扫描索引或凭据写入普通 localStorage。

```text
Disk Usage · Desktop Server                 zhaojian@192.168.2.2:22
Root [/data                         ] [Browse] [Start Analysis] [Stop]
Scanned 42,381 files · 235 GiB · 3 warnings · Scanning…
/data > media > movies
┌────────────────────────────────┬─────────────────────────────┐
│                                │ Search current folder       │
│        Treemap                 │ □ Name    Size   %   Status │
│    面积 = 已统计逻辑大小         │ □ movies  180GiB 77%        │
│                                │ □ backup   40GiB 17%        │
│                                │ □ cache    15GiB  6%        │
├────────────────────────────────┴─────────────────────────────┤
│ 3 selected · 15 GiB  [Copy Paths] [Open in Files] [Delete…]    │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 联动

- `Browse` 打开当前设备的目录选择弹窗：路径栏、Home/Up、直接子目录列表和 `Select Folder`；远程使用远程目录查询，本地使用本机目录查询，不能把 Mac 原生选择框当作远程选择框。
- 目录选择不计算容量，不发起递归扫描；权限错误留在弹窗内显示，可返回上级。
- 状态区分 `draftRootPath`（待分析路径）、`scanRootPath`（已有结果对应路径）和 `viewNodeId`（图表下钻位置）。修改待分析路径不把旧图冒充新路径的结果。
- Start Analysis 点击后才验证路径、分配任务并禁用重复提交；starting/scanning/canceling 期间禁用修改根目录与开始按钮，Stop 可用。仅已扫描结果内下钻不启动新扫描。
- 目录读取与 Python 能力探测可以在 Browse/Start Analysis 时进行，但不得在组件挂载 useEffect 中调用 start。

- 单击树图 = 在当前列表选中一个真实节点并滚动到它；Ctrl/Cmd 点击可追加。
- 双击目录 = 下钻；文件双击首版显示详情，不自动播放或打开可执行文件。
- 树图禁止自身独立导航（配置 nodeClick=false，由 React 统一处理）。
- 单击和双击要消除冲突；同一双击不产生两次 IPC 导航。
- 面包屑只允许到扫描根，不能通过返回上级越出结果范围。
- 列表显示所有直接子项，不只文件夹。零字节项、链接、错误项可在列表看到。
- 占比 = 当前节点 knownBytes / 当前目录 knownBytes；分母为 0 显示 `—`。
- 扫描未完成时标注 `Partial`，显示已扫描数量，不伪造百分比或剩余时间。
- 初版删除仅在扫描成功结束（允许带非致命 warnings）且结果未过期时启用；canceled/failed/limited 禁止删除。

### 4.3 生命周期

| 事件 | 行为 |
|---|---|
| 点击同一设备 Disk Usage | 恢复最小化、show/focus，不重复建任务 |
| 主窗选择别的服务器 | 分析窗设备不变 |
| 关分析窗 | 取消其扫描；等待停止确认后销毁；删除中提示“停止剩余操作并关闭”，不能撤销已删文件 |
| 关主窗 | 先协调取消分析任务并关分析窗，避免出现无主窗的孤儿管理窗口 |
| vault lock | 立即撤销新操作资格，关闭分析窗并取消扫描/删除，再按既有流程锁定；不改变密码或加密机制 |
| 删除/修改绑定的服务器配置 | 使已有上下文过期、停止任务并关闭窗口；重新打开后用新配置 |
| 系统睡眠/断线 | 任务失败或中断，保留已得部分结果；不自动重放删除 |
| renderer reload/crash | worker/主进程是任务事实来源；reload 重新拉 snapshot；crash 取消任务 |
| app quit | 统一 shutdown，所有 worker/SSH exec 有界退出 |

V1 主窗现有自动锁定计时不被分析窗“绕过”：若主窗锁定，分析窗一起关闭。先沿用计时口径，后续若要跨窗活动重置，单独设计，不静默禁用自动锁定。

## 5. 模块结构

```text
src/shared/disk-usage.ts
src/main/disk-usage/
  window-manager.ts          BrowserWindow、owner 绑定、设备窗口去重
  manager.ts                 任务状态、权限、限流、IPC 调度、删除计划
  remote-adapter.ts          Python 探测、SSH exec/stdin、取消
  worker.ts                  本地遍历或远程协议解析、树索引、查询
  index-store.ts             节点索引/汇总/排序/分页（不依赖 Electron）
  protocol.ts                请求/响应校验、序号、长度限制
  delete-manager.ts          预览/确认/串行执行/结果
  path-guards.ts             canonical root、身份检查、越界拒绝
resources/disk-usage/remote.py
src/preload/disk-usage.ts
src/renderer/disk-usage.html
src/renderer/src/disk-usage/
  main.tsx
  DiskUsageApp.tsx
  store.ts                   独立轻量状态，不引用主窗 vault store
  DiskToolbar.tsx
  DiskTreemap.tsx
  DiskDirectoryList.tsx
  DiskDeleteDialog.tsx
  DiskWarnings.tsx
scripts/test-disk-usage.mjs
tests/disk-usage/             单元、协议、边界和夹具测试
```

仅新增图表依赖 `echarts`，使用按需导入（TreemapChart、TooltipComponent、CanvasRenderer）。首版可手写固定行高虚拟列表，避免增加不必要依赖；若使用成熟虚拟列表库，先核实 React 18 兼容并锁定版本。

## 6. 类型和数据契约

下面为规范骨架。实现时补齐泛型响应和事件联合类型，不用 any 替代。

```ts
export type DiskTarget =
  | { kind: 'local' }
  | { kind: 'ssh'; serverId: string }

export type ScanState =
  | 'starting' | 'scanning' | 'canceling'
  | 'completed' | 'canceled' | 'failed' | 'limited'

export type Coverage = 'pending' | 'complete' | 'partial' | 'excluded'

export interface DiskNode {
  id: string                 // 仅在当前 scanId 中有效
  parentId: string | null
  name: string
  relativePath: string       // 根用空字符串；不接受前端提交此字段来删除
  kind: 'directory' | 'file' | 'symlink' | 'other'
  knownBytes: number         // 已知普通文件逻辑大小，安全整数
  coverage: Coverage
  childCount: number
  fileCount: number
  mtimeMs: number | null
  issueCount: number
  selectable: boolean
}

export interface ScanSnapshot {
  scanId: string
  target: DiskTarget
  rootPath: string            // 后端规范化绝对路径
  rootNodeId: string
  state: ScanState
  revision: number
  eventSeq: number
  startedAt: number
  finishedAt?: number
  scannedFiles: number
  scannedDirs: number
  knownBytes: number
  warningCount: number
  currentPath?: string
  stale: boolean
  limitReason?: 'entries' | 'memory' | 'depth' | 'protocol'
}

export interface DirectoryQuery {
  scanId: string
  nodeId: string
  expectedRevision?: number
  offset: number
  limit: number              // 默认 200，最大 500
  sortBy: 'size' | 'name' | 'mtime'
  order: 'asc' | 'desc'
  nameFilter?: string        // 当前目录内不区分大小写的文字包含，不是正则
}

export interface DirectoryView {
  scanId: string
  revision: number
  directory: DiskNode
  breadcrumbs: Array<{ id: string; name: string }>
  entries: DiskNode[]
  totalMatches: number
  treemap: Array<{
    id: string
    name: string
    knownBytes: number
    synthetic: boolean
  }>
}

export interface DeletePlan {
  planId: string
  scanId: string
  revision: number
  mode: 'local-trash' | 'remote-permanent'
  expiresAt: number
  targets: Array<{ nodeId: string; path: string; knownBytes: number; partial: boolean }>
  rejected: Array<{ nodeId: string; reason: string }>
  estimatedBytes: number
}
```

内部另外保存 dev/ino（十进制字符串）、原始路径表示、lstat 类型与 mtime/size 指纹，不能仅依赖前端路径。禁止把 SSH password/privateKey 放入窗口上下文、事件、任务 JSON。

数值规则：字节计数每次累加检查 Number.isSafeInteger，溢出则终止为 limited，而不是默默丢精度。格式化使用 B/KiB/MiB/GiB/TiB。

非 UTF-8 文件名：V1 不提供破坏性操作，显示转义名称和 Unsupported filename warning；不能经过有损编码后再拿显示路径删除。扫描程序需检测 surrogate 编码并标记不可操作。

## 7. IPC 与窗口授权

### 7.1 主窗桥接

```ts
window.janus.diskUsage.openWindow({ target, initialPath? }): Promise<void>
window.janus.diskUsage.onFilesChanged(callback): () => void
window.janus.diskUsage.onOpenInFiles(callback): () => void
```

### 7.2 分析窗专用桥接

```ts
window.diskUsage.getContext()
window.diskUsage.browse({ path })
window.diskUsage.start({ rootPath })
window.diskUsage.cancel({ scanId })
window.diskUsage.snapshot({ scanId? })
window.diskUsage.directory(query)
window.diskUsage.warnings({ scanId, offset, limit })
window.diskUsage.prepareDelete({ scanId, revision, nodeIds })
window.diskUsage.executeDelete({ planId })
window.diskUsage.cancelDelete({ operationId })
window.diskUsage.deleteSnapshot({ operationId })
window.diskUsage.openInFiles({ scanId, nodeId })
window.diskUsage.onEvent(callback) // 返回 unsubscribe
```

新通道命名：`disk:open-window`、`disk:context`、`disk:browse`、`disk:start`、`disk:cancel`、`disk:snapshot`、`disk:directory`、`disk:warnings`、`disk:prepare-delete`、`disk:execute-delete`、`disk:cancel-delete`、`disk:delete-snapshot`、`disk:open-in-files`、`disk:event`、`disk:files-changed`、`disk:open-in-files-request`。

只添加新常量，不重命名旧 IPC，不改变旧响应格式。响应继续使用 IpcResult<T> 包装；常见失败有稳定 errorCode 和英文文案，避免前端解析自然语言。

### 7.3 强制边界

- window-manager 维护 `webContents.id → {target, generation, window}`，renderer 不能自行切换 target。
- 所有新 handler 检查 sender 是已登记窗口、senderFrame 是主 frame、页面来源符合 dev/prod 预期、vault 未锁定。
- 主窗只能发起 openWindow；分析窗只能访问归属于自身的 scanId/planId/operationId。
- 现有主窗 handler 没有 sender 检查：必须在注册分析窗前增加集中保护，让分析窗不能直接调用 vault:read、ssh:exec 等旧通道。可以在现有 handle 包装中增加主窗 sender 检查而不改函数业务和通道名，并审查 ipcMain.on 的 send 类通道。
- 这属于 IPC 调用边界，不改变 vault schema、加密或 SSH 认证。视频窗若依赖旧 IPC，应逐项确认，不能盲目放开全量调用。
- preload 不暴露 ipcRenderer、任意 shell、fs、服务器完整 profile 或完整 vault。

### 7.4 事件顺序

事件 envelope：`{version:1, scanId, seq, revision, type, payload}`。start 先分配 scanId 并返回，再异步发事件。
分析窗先订阅再 start，随后拉 snapshot；snapshot 包含 eventSeq，丢弃 <= eventSeq 的旧事件。StrictMode 下订阅必须可重复清理，不重复开始扫描。
主进程只向 owner 的 webContents.send 推送；不要把扫描数据广播到所有 BrowserWindow。

## 8. 扫描架构与统计口径

### 8.1 明确展示什么

V1 只统计普通文件的逻辑长度之和（Logical size）：
- 目录 own bytes 不计入；目录总量由子文件递归汇总。
- 不跟随 symlink；link 记录为 0 knownBytes，不能显示成真实目标大小。
- 硬链接按路径累计，可能重复。界面提供说明，不声称能准确释放该大小。
- 稀疏文件、压缩、APFS 克隆、快照与打开但已删除文件会使该统计不同于磁盘实占。
- 不额外输出分区已用空间卡片作为本次扫描总量；V2 再独立接入 statvfs/statfs。
- 遇到权限错误，目录是 Partial/Unreadable，不能显示“完整 0 B”。

### 8.2 遍历策略

统一迭代式 DFS，后序汇总。不要每个父目录各跑一次递归大小测量，确保每个节点仅扫描一次。
本地以 fs.opendir/lstat 异步遍历；远程以 os.scandir/stat(follow_symlinks=False) 遍历。
保留显式栈，默认最大深度 512；达到深度上限标记 excluded/depth warning，不崩溃。
不同目录之间不承诺一致性快照，说明 `Files may change during a scan`。

默认 Stay on this filesystem：使用 st_dev/dev 与扫描根比较。Linux 额外解析 /proc/self/mountinfo 排除嵌套挂载点（包括同设备 bind mount）；最小可用版若仅按 st_dev，必须明确同设备 bind mount 不保证去重，禁止称为完整挂载隔离。
Linux 根目录扫描默认跳过 /proc、/sys、/dev、/run 及嵌套挂载，显示原因；用户可将真实数据挂载点作为新的扫描根。
本地对无法可靠判定的挂载点只保证“不跨 dev”，不承诺 APFS 特殊卷去重。
维护祖先目录 dev/ino 集合避免异常循环，但不全局去重普通硬链接。

扫描根可由用户输入，但先解析为绝对 canonical 目录并显示最终路径。根本身为链接时解析一次并提示最终根；根以下不跟随链接。

### 8.3 工作进程与索引

每个活动设备最多一个扫描；全应用最多两个同时扫描任务，多余返回 Busy 或排队（V1 选 Busy，文案说明）。
每个任务拥有一个 Node worker：
- local 模式：worker 扫描并建立索引。
- remote 模式：SSH 主进程只转发原始字节块，worker 解析协议并建立索引。
- worker 处理 directory/query/sort，主进程不对十万节点排序。
- 树索引 `Map<nodeId, record>` 和 `Map<parentId, childIds>`；单份 node 数据；避免复制完整嵌套树。
- 主进程只保存任务摘要、owner、worker/SSH handle、删除计划。
- 更新采用 upsert 替换节点已知汇总，不将相同 delta 重复累加。协议 seq 检测重复、丢序。
- 遍历定期 yield，local 每 200 条检查取消；worker 有界消息队列。

V1 硬上限：每个结果 200,000 节点、UTF-8 字符串总量 64 MiB、worker heap 约 256 MiB；全局最多保留两个完整结果。达到任一阈值状态 limited，保留明确部分结果并提示选择更小目录。数字可基于实测下调，但不能移除上限。
用户打开第三台设备的窗口可以保持未扫描状态；需要新结果时明确释放旧结果，不偷偷丢弃活动窗口数据。
不要把“200k 个节点”作为已通过的性能承诺，需按测试章节记录实测。

## 9. 远程执行协议

### 9.1 运行方式

在目标服务器检查 Python 3.8+，失败显示 `Python 3.8 or later is required on this server`，不自动安装，不偷偷回退昂贵 SFTP 全盘扫描。

新增 SSHManager 方法（保持 connectClient 内部私有）：

```ts
openExecChannel(profile, fixedCommand, jump, abortSignal): Promise<{
  stream: ClientChannel;
  close(): void;
}>
```

此方法复用现有 profile、jump host 和认证实现，但为扫描建立独立连接；stdout 与 stderr 分离；客户端关闭/错误、channel open 失败与取消均结束 pending Promise。不要从 renderer 暴露 fixedCommand。
独立连接是为了能只取消扫描，不打断传输、视频或终端。

远程运行固定可信 bootstrap：`python3 -u -c '<固定 bootstrap>'`。扫描源码来自应用打包资源，作为 base64 信封的一部分写 stdin；rootPath/options 是 JSON 数据。绝不把路径拼接到 shell/执行代码。
bootstrap 读取首行 `{version, codeB64, request}`，执行应用自带 helper 的 main(request)，随后另一个控制线程读取 `cancel`。不要使用 `python3 -` 把 stdin 同时当源码和控制流。

协议请求示例：

```json
{"version":1,"action":"scan","rootPath":"/data","stayOnFilesystem":true,"maxNodes":200000}
```

输出为 NDJSON，版本固定 1：
- hello：Python 版本、root canonical、root identity、支持能力。
- nodes：最多 256 条节点/更新；批次序号，父节点先于子节点。
- progress：计数与当前目录，最大 4 次/秒。
- warning：结构化 code + path；保留前 1000 条详情但累计总数。
- terminal：completed/canceled/limited/failed，最终摘要。

正常扫描退出必须收到 terminal 且退出码匹配；只有退出码 0 不算完整结果。部分 JSON 行、SSH 字节块边界、stderr 都要独立处理。
UTF-8 使用 StringDecoder 或 streaming TextDecoder；单行最大 1 MiB，stderr 只保留末尾 64 KiB；malformed JSON/超长行立即终止。
Python ensure_ascii=True 支持控制字符/换行等名称；仍要对不可无损表示的原始文件名禁用操作。

### 9.2 背压和取消

主进程发给 worker 的未确认字节累计达到 4 MiB 时 pause SSH readable，低于 1 MiB resume。worker 回 ACK 表示已入索引，不是收到消息就无条件 ACK。避免输出快于索引导致无界内存。
Stop：状态先进入 canceling → stdin 写 cancel → helper 设置线程安全停止标记，在每个遍历步骤检查 → 发 canceled 并退出。
3 秒无响应则发送 SSH channel TERM（支持时）；再过 2 秒关闭该扫描连接并记录“remote stop not confirmed”。不要承诺 SSH 断开必定终止远端阻塞 I/O。helper 还需监听 stdin EOF 并设置取消标记。
对不可中断的网络文件系统调用，允许 UI 结束等待但明确远端停止未确认；不得杀其他同用户进程或整台服务器的 Python。

## 10. 构建与资源路径

新增独立 renderer HTML + `main.tsx`，不用 data URL，也不加载主 App。
renderer build.rollupOptions.input 增加 `diskUsage` HTML；主页面 input 保留。
preload build 输入增加 `disk-usage.ts`，保留现有 index。
main build 增加 worker entry，并强制输出格式和实际文件名可预测；通过构建产物验证，不假设构建自动保留 src 目录。
推荐产物约定：

```text
out/main/index.js
out/main/disk-usage-worker.js
out/preload/index.js
out/preload/disk-usage.js
out/renderer/index.html
out/renderer/disk-usage.html
resources/disk-usage/remote.py   # 打包用 extraResources 复制
```

开发窗口 URL：以 ELECTRON_RENDERER_URL 为基准追加 `/disk-usage.html`；生产 loadFile 指向实际 out/renderer/disk-usage.html。
remote.py 开发从 app.getAppPath()/resources/... 读取；打包从 process.resourcesPath/disk-usage/remote.py 读取。electron-builder 新增相应 extraResources 条目，不把开发服务器依赖带入包。
worker 模块在构建后可直接启动；npm run dev 下修改扫描 worker 源码，应重启该 worker，不能继续运行过期产物。

分析窗 `nodeIntegration:false`、`contextIsolation:true`、优先 `sandbox:true`，preload 只打包纯类型/IPC 常量与 Electron bridge；兼容性问题不能通过暴露 Node/fs 解决。禁用任意导航和新窗口，不以文件名生成 HTML。Tooltip 用纯文本/richText，避免恶意文件名注入 HTML。
主窗主题只传 theme 值，分析窗设置 dataset.theme；不为主题读取完整 vault。

## 11. 树图与目录查询

ECharts 按需导入：

```ts
import * as echarts from 'echarts/core'
import { TreemapChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
echarts.use([TreemapChart, TooltipComponent, CanvasRenderer])
```

- 每次展示当前目录直接子节点，不传全部目录树；目录方块进入后查询下一层。
- 最多 300 个图形节点：保留最大的 299 个，余项汇总为 `Other (N items)`。这是视觉节点，不分配真实 nodeId，不允许删除。
- 合并项只覆盖正大小项；0 大小项留列表。
- 名称过滤仅筛列表；树图仍展示完整当前目录，并提示 `List filter active`，避免无意改变空间占比解释。
- 颜色按扫描根的第一级目录稳定分配；更深层继承色系；扫描进度刷新不随机换色。
- ResizeObserver 调 chart.resize；卸载 dispose，移除事件。
- 动画关闭或 <=150ms；扫描中最多每秒刷新一次图表。
- 单次 directory 响应包含当前分页列表和全目录 top-N 图表；不能从当前 200 行列表生成“全目录树图”。
- worker 缓存 `(nodeId, revision, sort, filter)` 的子项排序；新 revision 后失效。
- 用户选中 nodeId 集合，不选中行号；翻页可保留同目录选择；进入其他目录清空选择。
- `Select all` V1 仅选当前页，并明确文案；不暗中选中未加载的几万项。

## 12. 批量删除与文件操作

### 12.1 V1 的确定行为

- 本地按钮 `Move to Trash…`，使用主进程 shell.trashItem，失败时不自动改永久删除。
- 远程按钮 `Delete Permanently…`，无远程回收站，不支持撤销。
- 一次最多 500 个选中顶层项；同设备删除串行，不能与扫描并行。
- 选中目录表示其当前全部内容，包括隐藏文件、扫描时未读到的内容；确认框明确说明。若无法验证挂载/路径边界则拒绝该目录删除。
- `Copy Paths` 支持多选；`Open in Files` 仅单选，目录打开自身，文件打开父目录并尽量选中文件。
- 首版不在分析窗重复实现上传/下载/编辑/重命名，统一进入 Files。

### 12.2 两阶段 API

1. prepareDelete：只接收 scanId/revision/nodeIds，后端解析路径，不信任 renderer 提供的绝对路径。
2. 后端去重、剔除父子重复、检查 root/类型/身份、活动传输和路径限制。
3. 返回 DeletePlan；plan 绑定 owner、target、scan revision，有效期 60 秒，server 端保存，前端不得修改 targets。
4. 弹窗完整显示设备、根目录、每项目标、估计逻辑大小、partial 提示、永久删除说明。
5. 用户点击明确的最终按钮才 executeDelete(planId)。计划过期或 revision 变化要求重新预览。
6. operationId 在执行前分配并返回；plan 原子地标记 consumed。重复 execute 同一 plan 返回同 operationId，不能重复删除。
7. 每项输出 succeeded/failed/not-found/skipped/unknown；失败不中止其他独立项。
8. 取消只阻止剩余操作；目录内部可能已部分删除，必须说明，不回滚、不自动重试。
9. 丢失远程连接时最后一项标 unknown，重连后只检查现状，不自动重放 destructive 操作。

### 12.3 路径与竞态

- 允许删除的对象必须是 scan root 的严格后代。根本身、`/`、`.`、`..`、空路径一律拒绝。
- 用 path.relative/目录组件判断 containment，不能用字符串 startsWith('/data') 判断，否则 /data2 会误通过。
- 重新 lstat，检查 dev/ino/type 与计划一致；文件 size/mtime 变化要求重新预览。检查父路径 canonical 与保存的 root 一致。
- 远程递归删除拒绝跨设备和任何嵌套挂载点，包括同设备 bind mount；扫描允许排除不意味着可以把包含排除点的父目录删除。
- 删除链接只 unlink 链接，绝不 realpath 后删目标。
- 不通过 `rm -rf ${path}` 或 shell 拼接实现。
- Linux remote helper 用目录 fd + os.open(O_DIRECTORY|O_NOFOLLOW, dir_fd=...) + fstat 身份验证，逐层打开，os.unlink/os.rmdir 使用 dir_fd，避免符号链接替换导致越出目标。
- 若用 shutil.rmtree，必须检测 avoids_symlink_attacks，并补挂载边界和身份验证；不能仅依据该标志声称解决全部竞态。
- 本地 Trash 前校验真实父路径和 identity；shell.trashItem 不提供完全原子的身份条件删除，目录被其他进程并发替换仍有竞态，需文档说明。V1 不支持对不可信并发写入者提供强安全隔离，不声称绝对无竞态。
- 对权限错误保留真实原因，不使用 force:true 吞掉错误，不申请 sudo。

远程删除可沿用同一个 remote.py 的 `action:'delete'`，但 stdin plan 由主进程生成。helper 不接受任意 shell，扫描 action 绝不能意外执行删除。

### 12.4 与传输/视频并存

- 主进程在 prepare 与 execute 均检查该设备传输任务的 source/destination 是否与选择路径存在相同/祖先/后代关系；有冲突则拒绝，并显示先停止传输。
- 必要时给 TransferManager 新增只读 activePaths 查询，不改变传输流程。
- 播放中的文件被删除在不同系统行为不同；V1 提示可能仍被占用，不承诺回收空间，必要时要求先关闭播放窗口。
- 删除不关闭共享 SFTP wrapper，不打断无关终端/视频/传输。

### 12.5 删除后更新

发送 `{target, affectedPaths, operationId}` 到主窗登记接收者，FilePane 在同设备且当前目录相关时重新 list，并使目录大小缓存失效。
分析结果立即 stale；清空选择与删除计划，暂停进一步删除。成功/失败清单保持在操作结果区。
V1 不做复杂的局部增量重建：操作结束提示 `Results are outdated. Click Start Analysis to refresh.`；由用户手动点击 Start Analysis 重扫原根，新 scanId 完成后替换旧结果。重扫失败保留旧图并标记 Outdated，不伪造释放空间。

## 13. 跨窗口打开 Files

分析窗发 `{scanId,nodeId}`，主进程解析出 target + canonical path，发送新的 `disk:open-in-files-request` 给主窗并聚焦主窗。
主窗 renderer 收到后调用 openSftp(serverId)，同时传递一次性导航请求 `{requestId,target,path,selectName?}`。
为 FilesPanel/FilePane 增加可选 navigationRequest；useEffect 消费 requestId，调用现有 load(path)，成功后 ack，重复事件不重复导航。
不能只 openSftp 而不定位；不能依赖 window 间共享 Zustand，它们是不同 renderer 进程。
本地入口来自已有 FilesPanel 时保留来源 serverId 作为“返回文件页上下文”，分析 target 仍为 local。若主窗不存在该 Files tab，则打开对应服务器的 Files 并只导航 Local pane；不要用假 serverId 创建本机 SSH。

## 14. 状态、限制与错误码

扫描状态：starting → scanning → completed；任意活动态 → canceling → canceled；异常 → failed；达到预算 → limited。
终态不可被迟到 progress 改回 scanning。重新扫描新 scanId，generation 防旧事件污染新任务。
关闭窗口/锁定同时处理 Promise、worker、channel、监听器及后台计时器；使用 finally 确保释放。

至少定义：
`VAULT_LOCKED`、`INVALID_OWNER`、`INVALID_TARGET`、`PYTHON_UNAVAILABLE`、`PATH_NOT_FOUND`、`NOT_DIRECTORY`、`PERMISSION_DENIED`、`SCAN_BUSY`、`SCAN_LIMIT`、`PROTOCOL_ERROR`、`CONNECTION_LOST`、`RESULT_STALE`、`PLAN_EXPIRED`、`PATH_CHANGED`、`OUTSIDE_ROOT`、`MOUNT_BOUNDARY`、`TRANSFER_CONFLICT`、`TRASH_FAILED`。

warning 保留 code/path/message，但日志不记录密码、完整 server profile、扫描源码信封。后台详情最多 1000 条；UI warning 列表分页。默认不把完整文件名列表永久写盘。

## 15. 性能目标与验收方法

以下是目标，不是已测结果：
- 10 万项本地夹具扫描时，主界面仍可点击和拖动；明显卡顿必须定位。
- Stop 点击后的视觉反馈 <200ms；通常任务 <3 秒停止，远程阻塞情况按取消策略明确提示。
- 当前目录 1 万项列表使用虚拟渲染；DOM 行数不随总项数线性增长。
- 树图最多 300 节点；目录查询无扫描 I/O 时目标 <300ms（记录机器与样本）。
- 20 万节点结果不突破设定上限；达到上限能稳定退出并显示部分结果。
- 20 次打开/扫描/取消/关闭后无持续增长的 worker、SSH client、事件监听器。

不以大量随机视频填满磁盘来测试；使用小文件、受控 sparse 文件和临时目录构造夹具。真实数据只做只读扫描。

## 16. 测试清单

### 自动化（建议 node:test + 现有 esbuild，Python unittest）

- 汇总：多层目录、空文件、零目录、硬链接重复口径、稀疏文件逻辑长度。
- 路径：空格、中文、引号、换行、美元符号、分号、前导短横；不能触发命令执行。
- 边界：符号链接循环、扫描根链接、兄弟前缀路径、挂载点、权限拒绝、扫描中消失。
- 协议：任意拆分 UTF-8 和 JSON 行、重复 seq、超长行、无 terminal、非零退出、stderr 噪音、背压。
- 并发：两个设备不串结果；旧 scan 事件丢弃；并发 start 合并/拒绝；停止不关闭其他会话。
- 删除：过期计划、不同窗口盗用计划、重复 execute、父子去重、root 拒绝、身份变化、link 替换、挂载拒绝、部分失败、unknown 禁止重放。
- 跨窗：仅主窗可创建，分析窗不能 vault:read/ssh:exec，锁定后拒绝访问并关闭。
- React：StrictMode 不重复扫描/订阅，窗口 resize 不泄漏 ECharts，选择和排序一致。

### GUI / 真机（仅测试目录有写操作）

1. 台式机建立唯一测试目录，放普通文件、嵌套目录、链接；记录清单。
2. 从详情页打开 Disk Usage；从目录右键打开；重复入口聚焦同一窗。三种情形均不得自动扫描；浏览和输入目录也不扫描，仅 Start Analysis 创建任务。
3. 同时开本机/台式机窗口，主窗切服务器，确认分析对象不变。
4. 测试下钻、返回、搜索、多选、分页和 Other 节点不可删除。
5. 测试停止、断网、重连后重新扫描，终端和视频保持可用。
6. 仅删除测试夹具；测试部分权限拒绝、取消删除和跨窗刷新。
7. 锁定主窗，所有分析窗关闭，不能继续操作；验证主窗正常解锁。
8. 生产打包后打开分析窗，确认 worker、preload、remote.py 路径有效。

必跑 `npm run typecheck`、`npm run build`、`git diff --check`。记录新增测试命令与输出，GUI 未测就明确写未测。

## 17. 实施顺序与每步完成定义

### P0：基线与契约
- 阅读仓库文档和当前差异，保留其他模型修改。
- 添加 shared 类型、模块骨架、新 IPC 常量、测试夹具。
- 确认 Python 执行协议和脚本资源路径；不删除真实文件。

### P1：独立窗口
- ServerDetail 添加 Disk Usage、专用 preload/HTML、owner 绑定、去重和关闭/锁定。
- 显示真实设备名称与路径输入；此阶段扫描按钮可暂时 disabled，但标记未完成。
- 新旧窗口都能正常打开、锁定、关闭，IPC 越权测试通过。

### P2：远程只读闭环
- exec channel + Python helper + worker index + snapshot/query。
- 先用表格展示真实统计；验证扫描取消、限制、错误。

### P3：树图与文件入口
- ECharts、目录联动、多选、虚拟列表、Files 右键及定位回传。
- 没有 ECharts mock 数据残留，没有重复目录递归测量。

### P4：本地扫描
- worker 本地适配、与远程相同的数据口径；Local 文件入口。
- Mac 权限问题明确显示，不绕过系统授权。

### P5：批量操作
- 两阶段计划、确认、remote permanent/local trash、部分结果、取消、刷新。
- 启用前先通过删除边界测试，再在隔离目录真机验证。

### P6：打包、性能与交接
- 检查开发与打包运行、性能指标、泄漏；补文档和真实验证状态。
- 更新 MODIFICATIONS.md：新增 Disk Usage 章节，列出文件、入口、限制、验证和待办。
- 不提交 Git，除非用户明确要求。

## 18. 不应采用的实现

- 为每个目录调用一次现有 dirSize，然后把结果当作完整磁盘索引。
- 扫描所有文件时逐个新建 SFTP 通道或 SSH 连接。
- 把全部树和每个文件进度广播到所有 renderer。
- 在独立窗初始化主 App、读取完整 vault 或默认跟随主窗 selectedServerId。
- 通过 window.open/file URL 参数传递密码、完整路径授权或服务器 profile。
- 用 `du` 的空格/换行输出拼出可删除路径；用 shell 字符串执行删除。
- 忽略扫描错误但显示“扫描完成且完全准确”；将逻辑大小等同释放空间。
- 删除断线后自动重试；远程 Trash 失败静默 fallback rm。
- 打开窗口、选择目录、删除结束即自动扫描，或在未经确认时替换正在分析的目录。

## 19. 官方参考与核实范围

以下参考用于 API 行为，本文中的布局、阈值、任务契约和实现路线是针对本项目的设计选择，不代表依赖已提供现成实现。实施时以当前安装版本类型和构建结果为准，不能直接假设最新文档的 API 全部适用于 Electron 33。

- [ECharts 按需导入](https://echarts.apache.org/handbook/en/basics/import/)：仅注册必要图表与 renderer，减少包体。
- [Electron BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)：独立窗口和窗口生命周期参考。
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)：上下文隔离、限制导航和 IPC sender 校验。
- [ssh2 官方 API](https://github.com/mscdex/ssh2)：exec channel、stdin/stdout/stderr 与连接控制。
- [Node worker_threads](https://nodejs.org/api/worker_threads.html)：独立工作线程和消息通信；纯 I/O 不会因线程自动变快，此处主要隔离索引与排序负载。
- [Python os](https://docs.python.org/3/library/os.html)：scandir/lstat、文件名和 dir_fd 操作；远程实现限定 Python 3.8+ 可用 API。
- [Python shutil.rmtree](https://docs.python.org/3/library/shutil.html#shutil.rmtree)：不同平台的抗符号链接攻击能力差异，不能忽略支持条件。

## 20. 可直接发给实施模型的任务

请先读取 janus/AGENTS.md、MODIFICATIONS.md 和 docs/disk-usage-implementation-plan.md。在 zhaojian 分支按本方案实现 Disk Usage：服务器详情页 Files 旁新增按钮，打开固定绑定设备的独立窗口，左侧 Treemap、右侧可多选文件列表；添加文件管理目录快捷入口。所有入口仅预填目录，用户可输入或 Browse 选择目录，只有手动点击 Start Analysis 才扫描，删除结束也不得自动重扫。按 P0–P6 完成远程/本地扫描、流式进度、取消、限制、批量操作、跨窗刷新和打包验证。不要改 vault schema、认证或已有 IPC 名称，不覆盖其他修改；新 UI 一律英文。先完成只读扫描，再实现有确认和后端路径校验的删除，真实删除只测试隔离夹具。每阶段验证并最终更新 MODIFICATIONS.md，明确未验证项；未经用户要求不要提交 Git。
