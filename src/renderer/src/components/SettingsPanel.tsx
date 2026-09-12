import { useEffect, useState } from 'react'
import {
  Settings,
  Type,
  ShieldCheck,
  Download,
  Upload,
  KeyRound,
  Check,
  AlertCircle,
  RefreshCw,
  Linkedin,
  Palette,
  Clock,
  Cloud,
  Plug,
  FileUp,
  FileDown,
  Bell,
  Loader2,
  Sparkles
} from 'lucide-react'
import { useStore } from '../store'
import type { ThemeId, AiProvider } from '@shared/types'

export default function SettingsPanel(): JSX.Element {
  const { vault, updateSettings } = useStore()
  const s = vault?.settings
  if (!s) return <div />

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className="border-b border-ink-600 px-6 py-4">
        <h1 className="flex items-center gap-2 text-lg font-bold text-white">
          <Settings size={20} className="text-accent" /> Settings
        </h1>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* Theme */}
          <ThemeSection current={s.theme} onPick={(t) => updateSettings({ theme: t })} />

          {/* AI Copilot */}
          <AiSection />

          {/* Session & security */}
          <SessionSection />

          {/* Terminal appearance */}
          <Section icon={Type} title="Terminal Appearance">
            <Row label="Font family">
              <input
                value={s.fontFamily}
                onChange={(e) => updateSettings({ fontFamily: e.target.value })}
                className="field"
              />
            </Row>
            <Row label="Font size">
              <input
                type="number"
                min={8}
                max={32}
                value={s.fontSize}
                onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
                className="field"
              />
            </Row>
            <Row label="Cursor style">
              <select value={s.cursorStyle} onChange={(e) => updateSettings({ cursorStyle: e.target.value as never })} className="field">
                <option value="bar">Bar</option>
                <option value="block">Block</option>
                <option value="underline">Underline</option>
              </select>
            </Row>
            <Row label="Scrollback lines">
              <input
                type="number"
                value={s.scrollback}
                onChange={(e) => updateSettings({ scrollback: Number(e.target.value) })}
                className="field"
              />
            </Row>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={s.cursorBlink}
                onChange={(e) => updateSettings({ cursorBlink: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              Cursor blink
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={s.autoReconnect}
                onChange={(e) => updateSettings({ autoReconnect: e.target.checked })}
                className="h-4 w-4 accent-accent"
              />
              Automatically reconnect if the connection drops
            </label>
          </Section>

          {/* Integrations */}
          <IntegrationsSection />

          {/* Vault */}
          <VaultSection />

          <CloudSoon />

          <AboutSection />
        </div>
      </div>
    </div>
  )
}

function AboutSection(): JSX.Element {
  const [version, setVersion] = useState('—')
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    window.janus.updates.version().then(setVersion).catch(() => undefined)
    const off = window.janus.updates.onStatus((s) => {
      if (s.phase === 'checking') setNote('Checking…')
      else if (s.phase === 'not-available') setNote("You're on the latest version ✓")
      else if (s.phase === 'available') setNote(`New version available: v${s.version}`)
      else if (s.phase === 'error') setNote(`Error: ${s.error}`)
      else setNote(null)
      if (s.phase !== 'checking') setChecking(false)
    })
    return off
  }, [])

  async function check(): Promise<void> {
    setChecking(true)
    setNote('Checking…')
    try {
      await window.janus.updates.check()
    } catch (e) {
      setNote(`Error: ${(e as Error).message}`)
      setChecking(false)
    }
  }

  return (
    <Section icon={ShieldCheck} title="About & Updates">
      <p className="text-sm text-slate-400">
        <strong className="text-slate-200">Janus</strong> — professional SSH and server manager.
        <br />
        All your data is stored in a single AES-256-GCM encrypted file. Your password never leaves your device.
      </p>
      <div className="mt-3 flex items-center justify-between rounded-lg border border-ink-600 bg-ink-900/50 px-4 py-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Installed version</div>
          <div className="font-mono text-sm text-slate-200">v{version}</div>
        </div>
        <button onClick={check} disabled={checking} className="btn-ghost border border-ink-500">
          <RefreshCw size={15} className={checking ? 'animate-spin' : ''} /> Check for updates
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}

      <div className="mt-4 flex items-center justify-between border-t border-ink-600 pt-4">
        <span className="text-xs text-slate-500">
          a product of <span className="font-semibold text-slate-300">The Asaf Effect</span>
        </span>
        <button
          onClick={() => window.open('https://www.linkedin.com/in/asaf-üdürgücü-a55a4a1b8/')}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-400 transition-colors hover:bg-ink-600 hover:text-accent"
          title="LinkedIn"
        >
          <Linkedin size={14} /> asaf üdürgücü
        </button>
      </div>
    </Section>
  )
}

function VaultSection(): JSX.Element {
  const [oldP, setOldP] = useState('')
  const [newP, setNewP] = useState('')
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [importPw, setImportPw] = useState('')

  async function changePw(): Promise<void> {
    setMsg(null)
    try {
      await window.janus.vault.changePassword(oldP, newP)
      setMsg({ type: 'ok', text: 'Master password updated.' })
      setOldP('')
      setNewP('')
    } catch (e) {
      setMsg({ type: 'err', text: (e as Error).message })
    }
  }

  async function exportVault(): Promise<void> {
    setMsg(null)
    try {
      const path = await window.janus.vault.export()
      if (path) setMsg({ type: 'ok', text: `Exported: ${path}` })
    } catch (e) {
      setMsg({ type: 'err', text: (e as Error).message })
    }
  }

  async function importVault(): Promise<void> {
    setMsg(null)
    if (!importPw) return setMsg({ type: 'err', text: 'Enter the password of the file to import.' })
    try {
      const res = await window.janus.vault.import(importPw)
      if (res) {
        useStore.setState({ vault: res })
        setMsg({ type: 'ok', text: 'Vault imported.' })
        setImportPw('')
      }
    } catch (e) {
      setMsg({ type: 'err', text: (e as Error).message })
    }
  }

  return (
    <Section icon={KeyRound} title="Vault & Security">
      <div className="space-y-3">
        <p className="text-xs text-slate-500">Change master password:</p>
        <div className="grid grid-cols-2 gap-3">
          <input type="password" value={oldP} onChange={(e) => setOldP(e.target.value)} className="field" placeholder="Current password" />
          <input type="password" value={newP} onChange={(e) => setNewP(e.target.value)} className="field" placeholder="New password" />
        </div>
        <button onClick={changePw} disabled={!oldP || !newP} className="btn-ghost border border-ink-500">
          <KeyRound size={15} /> Update Password
        </button>
      </div>

      <div className="mt-4 border-t border-ink-600 pt-4">
        <p className="mb-2 text-xs text-slate-500">Backup — a single encrypted, portable file:</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportVault} className="btn-ghost border border-ink-500">
            <Download size={15} /> Export
          </button>
          <div className="flex gap-2">
            <input type="password" value={importPw} onChange={(e) => setImportPw(e.target.value)} className="field w-44" placeholder="File password" />
            <button onClick={importVault} className="btn-ghost border border-ink-500">
              <Upload size={15} /> Import
            </button>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-xs ${msg.type === 'ok' ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>
          {msg.type === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />} {msg.text}
        </div>
      )}
    </Section>
  )
}

const AI_DEFAULT_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-3-5-sonnet-latest',
  openai: 'gpt-4o-mini',
  google: 'gemini-1.5-flash',
  openrouter: 'anthropic/claude-3.5-sonnet',
  custom: 'llama3'
}
const AI_KEY_HINT: Record<AiProvider, string> = {
  anthropic: 'console.anthropic.com → API keys',
  openai: 'platform.openai.com → API keys',
  google: 'aistudio.google.com → API key',
  openrouter: 'openrouter.ai/keys — Claude, GPT, Gemini, Llama with a single key…',
  custom: 'No key required for Ollama/LM Studio'
}
const AI_KEY_URL: Partial<Record<AiProvider, string>> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/app/apikey',
  openrouter: 'https://openrouter.ai/keys'
}

function AiSection(): JSX.Element {
  const { vault, updateSettings } = useStore()
  const ai = vault!.settings.ai

  return (
    <Section icon={Sparkles} title="AI Copilot">
      <p className="text-xs text-slate-500">
        Works with your own API key — the key is stored in the encrypted vault, requests go directly to the provider.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Provider</label>
          <select
            value={ai.provider}
            onChange={(e) => {
              const provider = e.target.value as AiProvider
              updateSettings({ ai: { ...ai, provider, model: AI_DEFAULT_MODEL[provider] } })
            }}
            className="field"
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI (GPT)</option>
            <option value="google">Google (Gemini)</option>
            <option value="openrouter">OpenRouter (most models)</option>
            <option value="custom">Custom / Ollama (OpenAI compatible)</option>
          </select>
        </div>
        <div>
          <label className="label">Model</label>
          <input value={ai.model} onChange={(e) => updateSettings({ ai: { ...ai, model: e.target.value } })} className="field" />
        </div>
      </div>
      {ai.provider === 'custom' && (
        <div>
          <label className="label">Base URL</label>
          <input
            value={ai.baseUrl ?? ''}
            onChange={(e) => updateSettings({ ai: { ...ai, baseUrl: e.target.value } })}
            className="field"
            placeholder="http://localhost:11434/v1"
          />
        </div>
      )}
      <div>
        <label className="label flex items-center justify-between">
          <span>API key {ai.provider === 'custom' && <span className="text-slate-600">(optional)</span>}</span>
          {AI_KEY_URL[ai.provider] && (
            <button onClick={() => window.open(AI_KEY_URL[ai.provider])} className="normal-case text-accent hover:underline">
              🔗 Get a key
            </button>
          )}
        </label>
        <input
          type="password"
          value={ai.apiKey}
          onChange={(e) => updateSettings({ ai: { ...ai, apiKey: e.target.value } })}
          className="field"
          placeholder={ai.provider === 'anthropic' ? 'sk-ant-…' : ai.provider === 'google' ? 'AIza…' : 'sk-…'}
        />
      </div>
      <p className="text-[11px] text-slate-600">Key: {AI_KEY_HINT[ai.provider]}</p>
      <div className="rounded-md border border-ink-600 bg-ink-900/40 px-3 py-2 text-[11px] text-slate-500">
        💡 <b className="text-slate-400">Easiest:</b> <b className="text-accent">OpenRouter</b> — Claude,
        GPT, Gemini, Llama, all with a single key. Or <b className="text-accent">Ollama</b> (Custom) — local on your machine, no key needed.
      </div>
    </Section>
  )
}

function IntegrationsSection(): JSX.Element {
  const { vault, updateSettings, importSshConfig } = useStore()
  const s = vault!.settings
  const [busy, setBusy] = useState<'imp' | 'exp' | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function doImport(): Promise<void> {
    setBusy('imp')
    setMsg(null)
    try {
      const { added, skipped } = await importSshConfig()
      setMsg(`Imported: ${added} server(s) added${skipped ? `, ${skipped} already existed` : ''}.`)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }
  async function doExport(): Promise<void> {
    setBusy('exp')
    setMsg(null)
    try {
      const path = await window.janus.sshConfig.export()
      setMsg(`Exported: ${path}`)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section icon={Plug} title="Integrations">
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={s.notifications}
          onChange={(e) => updateSettings({ notifications: e.target.checked })}
          className="h-4 w-4 accent-accent"
        />
        <Bell size={14} className="text-slate-500" /> Desktop notifications (when a command finishes, when a server goes down)
      </label>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={s.backgroundMonitor}
          onChange={(e) => updateSettings({ backgroundMonitor: e.target.checked })}
          className="h-4 w-4 accent-accent"
        />
        Monitor all servers in the background — history charts + 90% threshold alerts (every 60s)
      </label>

      <div className="mt-2 border-t border-ink-600 pt-3">
        <p className="mb-2 text-xs text-slate-500">
          Sync with <span className="font-mono">~/.ssh/config</span>:
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={doImport} disabled={!!busy} className="btn-ghost border border-ink-500">
            {busy === 'imp' ? <Loader2 size={15} className="animate-spin" /> : <FileDown size={15} />} Import
          </button>
          <button onClick={doExport} disabled={!!busy} className="btn-ghost border border-ink-500">
            {busy === 'exp' ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />} Export
          </button>
        </div>
      </div>
      {msg && <p className="mt-2 break-all text-xs text-slate-400">{msg}</p>}
    </Section>
  )
}

function Section({ icon: Icon, title, children }: { icon: typeof Type; title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl border border-ink-600 bg-ink-800 p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold text-slate-200">
        <Icon size={16} className="text-accent" /> {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-3">
      <label className="text-sm text-slate-400">{label}</label>
      {children}
    </div>
  )
}

const THEMES: { id: ThemeId; name: string; bg: string; accent: string }[] = [
  { id: 'midnight', name: 'Midnight', bg: '#0a0b0d', accent: '#6366f1' },
  { id: 'slate', name: 'Slate', bg: '#16191f', accent: '#6366f1' },
  { id: 'carbon', name: 'Carbon', bg: '#0d0d0f', accent: '#3b82f6' },
  { id: 'ocean', name: 'Ocean', bg: '#080c14', accent: '#06b6d4' },
  { id: 'plum', name: 'Plum', bg: '#0e0a12', accent: '#a855f7' },
  { id: 'forest', name: 'Forest', bg: '#090e0b', accent: '#10b981' },
  { id: 'coffee', name: 'Coffee', bg: '#1c1612', accent: '#c7925c' },
  { id: 'claude', name: 'Claude', bg: '#201c19', accent: '#cc7857' },
  { id: 'sand', name: 'Sand', bg: '#24211c', accent: '#84a97a' }
]

function ThemeSection({ current, onPick }: { current: ThemeId; onPick: (t: ThemeId) => void }): JSX.Element {
  return (
    <Section icon={Palette} title="Theme">
      <div className="grid grid-cols-5 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => onPick(t.id)}
            className={`rounded-lg border p-2 transition-colors ${
              current === t.id ? 'border-accent ring-1 ring-accent' : 'border-ink-500 hover:border-ink-400'
            }`}
          >
            <div className="mb-2 flex h-12 items-end rounded-md p-1.5" style={{ background: t.bg }}>
              <span className="h-2 w-full rounded-full" style={{ background: t.accent }} />
            </div>
            <div className={`text-center text-xs ${current === t.id ? 'text-white' : 'text-slate-400'}`}>{t.name}</div>
          </button>
        ))}
      </div>
    </Section>
  )
}

function SessionSection(): JSX.Element {
  const { vault, updateSettings } = useStore()
  const s = vault!.settings
  const [remembered, setRemembered] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.janus.vault.status().then((st) => setRemembered(st.hasRemembered)).catch(() => undefined)
  }, [])

  async function toggleRemember(on: boolean): Promise<void> {
    setBusy(true)
    try {
      if (on) await window.janus.vault.remember()
      else await window.janus.vault.forget()
      setRemembered(on)
    } catch {
      /* ignore */
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section icon={Clock} title="Session & Security">
      <Row label="Auto-lock when idle">
        <select
          value={s.lockAfterMinutes}
          onChange={(e) => updateSettings({ lockAfterMinutes: Number(e.target.value) })}
          className="field"
        >
          <option value={0}>Off</option>
          <option value={5}>After 5 minutes</option>
          <option value={15}>After 15 minutes</option>
          <option value={30}>After 30 minutes</option>
          <option value={60}>After 1 hour</option>
        </select>
      </Row>
      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          disabled={busy}
          checked={remembered}
          onChange={(e) => toggleRemember(e.target.checked)}
          className="h-4 w-4 accent-accent"
        />
        Sign in automatically on this device (password stored encrypted in the OS keychain)
      </label>
      <p className="text-xs text-slate-500">
        If turned off, the master password is asked on every launch. When on, you sign in on this device without a password.
      </p>
    </Section>
  )
}

function CloudSoon(): JSX.Element {
  return (
    <div className="rounded-xl border border-dashed border-accent/40 bg-accent/5 p-5">
      <div className="mb-1.5 flex items-center gap-2">
        <Cloud size={17} className="text-accent" />
        <span className="font-semibold text-slate-200">Cloud Sync & Accounts</span>
        <span className="rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent">
          Coming soon
        </span>
      </div>
      <p className="text-sm leading-relaxed text-slate-400">
        Coming soon: <span className="text-slate-300">sign in with a user account</span>, encrypted
        sync across devices, and server sharing within your team. Your servers, safely with you on every device.
      </p>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
        <Plug size={12} /> Coming with The Asaf Effect ecosystem.
      </p>
    </div>
  )
}
