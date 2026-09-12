import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Columns2, Loader2, Rows2, Save } from 'lucide-react'
import { useStore } from '../store'
import Modal from './Modal'
import FilePane, { joinPath } from './FilePane'
import TransferQueue from './TransferQueue'
import ConflictModal from './ConflictModal'
import type { Tab } from '../store'
import type { SftpEntry } from '@shared/types'

export default function FilesPanel({ tab }: { tab: Tab }): JSX.Element {
  const {
    setTabStatus,
    initTransferListeners,
    initDiskUsageListeners,
    startTransfer,
    transfers,
    conflicts,
    filesNavigation,
    clearFilesNavigation,
    filesChangedToken
  } = useStore()
  const serverId = tab.serverId

  const [leftPath, setLeftPath] = useState('')
  const [rightPath, setRightPath] = useState('')
  const [leftSel, setLeftSel] = useState<SftpEntry | null>(null)
  const [rightSel, setRightSel] = useState<SftpEntry | null>(null)
  const [leftRefresh, setLeftRefresh] = useState(0)
  const [rightRefresh, setRightRefresh] = useState(0)
  const [editing, setEditing] = useState<SftpEntry | null>(null)
  const [layout, setLayout] = useState<'vertical' | 'horizontal'>('vertical')
  const vertical = layout === 'vertical'
  const [nav, setNav] = useState<{ pane: 'local' | 'remote'; path: string; selectName?: string; token: number } | null>(null)

  useEffect(() => {
    initTransferListeners()
    initDiskUsageListeners()
  }, [initTransferListeners, initDiskUsageListeners])

  // Consume "Open in Files" navigation requests targeted at this tab.
  useEffect(() => {
    if (!filesNavigation) return
    const req = filesNavigation
    if (req.target.kind === 'ssh' && req.target.serverId !== serverId) return
    setNav({
      pane: req.target.kind === 'ssh' ? 'remote' : 'local',
      path: req.path,
      selectName: req.selectName,
      token: Date.now()
    })
    clearFilesNavigation()
  }, [filesNavigation, serverId, clearFilesNavigation])

  // Files changed elsewhere (Disk Usage delete) → refresh both panes.
  const lastChangeToken = useRef(filesChangedToken)
  useEffect(() => {
    if (filesChangedToken === lastChangeToken.current) return
    lastChangeToken.current = filesChangedToken
    setLeftRefresh((n) => n + 1)
    setRightRefresh((n) => n + 1)
  }, [filesChangedToken])

  // Refresh both panes whenever a transfer reaches a terminal state.
  const prevStatus = useRef(new Map<string, string>())
  useEffect(() => {
    let changed = false
    for (const t of transfers) {
      const prev = prevStatus.current.get(t.id)
      if (prev !== t.status) {
        prevStatus.current.set(t.id, t.status)
        if (['done', 'canceled', 'interrupted', 'error'].includes(t.status)) changed = true
      }
    }
    if (changed) {
      setLeftRefresh((n) => n + 1)
      setRightRefresh((n) => n + 1)
    }
  }, [transfers])

  function upload(entry: SftpEntry): void {
    if (!rightPath) return
    void startTransfer({
      serverId,
      direction: 'upload',
      localPath: entry.path,
      remotePath: joinPath(rightPath, entry.name),
      isDir: entry.type === 'directory'
    })
    setLeftSel(null)
  }

  function download(entry: SftpEntry): void {
    if (!leftPath) return
    void startTransfer({
      serverId,
      direction: 'download',
      localPath: joinPath(leftPath, entry.name),
      remotePath: entry.path,
      isDir: entry.type === 'directory'
    })
    setRightSel(null)
  }

  const layoutToggle = (
    <button
      onClick={() => setLayout(vertical ? 'horizontal' : 'vertical')}
      className="btn-ghost border border-ink-500 p-1.5"
      title={vertical ? 'Switch to side-by-side layout' : 'Switch to stacked layout'}
    >
      {vertical ? <Columns2 size={14} /> : <Rows2 size={14} />}
    </button>
  )

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className={`flex min-h-0 flex-1 ${vertical ? 'flex-col' : ''}`}>
        <FilePane
          kind="local"
          serverId={serverId}
          selected={leftSel}
          onSelect={setLeftSel}
          onPathChange={setLeftPath}
          onTransferEntry={upload}
          refreshToken={leftRefresh}
          showSizes={vertical}
          nav={nav?.pane === 'local' ? nav : null}
        />

        {/* Divider with transfer buttons + layout toggle */}
        {vertical ? (
          <div className="flex h-9 shrink-0 items-center justify-center gap-4 border-y border-ink-600 bg-ink-800">
            <button
              onClick={() => leftSel && upload(leftSel)}
              disabled={!leftSel || !rightPath}
              className="btn-primary flex items-center gap-1.5 px-3 py-1 text-xs disabled:opacity-30"
              title={leftSel ? `Upload "${leftSel.name}"` : 'Select a local file or folder'}
            >
              <ArrowDown size={13} /> Upload
            </button>
            {layoutToggle}
            <button
              onClick={() => rightSel && download(rightSel)}
              disabled={!rightSel || !leftPath}
              className="btn-primary flex items-center gap-1.5 px-3 py-1 text-xs disabled:opacity-30"
              title={rightSel ? `Download "${rightSel.name}"` : 'Select a remote file or folder'}
            >
              <ArrowUp size={13} /> Download
            </button>
          </div>
        ) : (
          <div className="flex w-12 shrink-0 flex-col items-center justify-center gap-3 border-x border-ink-600 bg-ink-800">
            <button
              onClick={() => leftSel && upload(leftSel)}
              disabled={!leftSel || !rightPath}
              className="btn-primary p-2 disabled:opacity-30"
              title={leftSel ? `Upload "${leftSel.name}"` : 'Select a local file or folder'}
            >
              <ArrowRight size={15} />
            </button>
            {layoutToggle}
            <button
              onClick={() => rightSel && download(rightSel)}
              disabled={!rightSel || !leftPath}
              className="btn-primary p-2 disabled:opacity-30"
              title={rightSel ? `Download "${rightSel.name}"` : 'Select a remote file or folder'}
            >
              <ArrowLeft size={15} />
            </button>
          </div>
        )}

        <FilePane
          kind="remote"
          serverId={serverId}
          selected={rightSel}
          onSelect={setRightSel}
          onPathChange={setRightPath}
          onTransferEntry={download}
          onEditFile={setEditing}
          refreshToken={rightRefresh}
          onStatus={(ok) => setTabStatus(tab.id, ok ? 'connected' : 'error')}
          showSizes={vertical}
          nav={nav?.pane === 'remote' ? nav : null}
        />
      </div>

      <TransferQueue />

      {conflicts.length > 0 && <ConflictModal conflict={conflicts[0]} />}
      {editing && <FileEditor serverId={serverId} entry={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function FileEditor({ serverId, entry, onClose }: { serverId: string; entry: SftpEntry; onClose: () => void }): JSX.Element {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const tooBig = entry.size > 2 * 1024 * 1024

  useEffect(() => {
    if (tooBig) {
      setErr('File is larger than 2MB — not supported by the editor. Use download instead.')
      setLoading(false)
      return
    }
    window.janus.sftp
      .readFile(serverId, entry.path)
      .then((c) => setContent(c))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(): Promise<void> {
    setSaving(true)
    setErr(null)
    try {
      await window.janus.sftp.writeFile(serverId, entry.path, content)
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Edit · ${entry.name}`}
      onClose={onClose}
      width={720}
      footer={
        <>
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} disabled={saving || loading || tooBig} className="btn-primary">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
          </button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading file…
        </div>
      ) : (
        <>
          {err && <div className="mb-2 rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            className="field h-[52vh] resize-none font-mono text-xs leading-relaxed"
            placeholder="(empty)"
          />
          <p className="mt-1.5 font-mono text-[10px] text-slate-600">{entry.path}</p>
        </>
      )}
    </Modal>
  )
}
