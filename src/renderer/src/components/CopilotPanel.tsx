import { useRef, useState, useEffect } from 'react'
import { Sparkles, Send, Loader2, Copy, Check, Settings2, Server, Trash2, Paperclip, X, ArrowDown } from 'lucide-react'
import { useStore } from '../store'
import type { AiMessage } from '@shared/types'

const SUGGESTIONS = [
  'Explain the last error',
  'What is using the most disk space?',
  'Safe reload command for nginx',
  'How do I harden this server?'
]

const CTX_ESTIMATE = 100_000 // rough soft window for the usage bar

export default function CopilotPanel({ dock = false }: { dock?: boolean }): JSX.Element {
  const { vault, selectedServerId, setSidePanel, toggleCopilot } = useStore()
  const wrap = dock ? '' : 'mx-auto max-w-2xl'
  const server = vault?.servers.find((s) => s.id === selectedServerId)
  const ai = vault?.settings.ai
  const configured = !!ai && (ai.provider === 'custom' || !!ai.apiKey)
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [rateLimit, setRateLimit] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<{ name: string; content: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  const tokenEstimate = Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4)

  async function ask(history: AiMessage[]): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const system =
        'You are Janus Copilot — an expert Linux/DevOps/SSH/database assistant embedded in Janus (an SSH & server manager desktop app). ' +
        'Answer briefly, clearly, and directly in English. Use triple-backtick + bash blocks when suggesting shell commands. Warn before destructive commands. ' +
        (server
          ? `The user's currently selected server: "${server.name}" — ${server.username}@${server.host}:${server.port}.`
          : 'No server is currently selected.')
      const reply = await window.janus.ai.chat(history, system)
      setMessages([...history, { role: 'assistant', content: reply.text }])
      setTruncated(reply.truncated)
      setRateLimit(reply.rateLimit ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function send(text: string): Promise<void> {
    let q = text.trim()
    if ((!q && !attachment) || busy) return
    if (attachment) q = `[Attached file: ${attachment.name}]\n\`\`\`\n${attachment.content}\n\`\`\`\n\n${q}`
    setInput('')
    setAttachment(null)
    await ask([...messages, { role: 'user', content: q }])
  }

  async function continueReply(): Promise<void> {
    if (busy) return
    await ask([...messages, { role: 'user', content: 'Continue from where you left off.' }])
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > 200_000) {
      setError('File is larger than 200KB — attach a text file.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setAttachment({ name: f.name, content: String(reader.result || '').slice(0, 200_000) })
    reader.readAsText(f)
  }

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <div className={`flex items-center justify-between border-b border-ink-600 ${dock ? 'px-3 py-2.5' : 'px-6 py-4'}`}>
        <div className="min-w-0">
          <h1 className={`flex items-center gap-2 font-bold text-white ${dock ? 'text-sm' : 'text-lg'}`}>
            <Sparkles size={dock ? 15 : 20} className="text-accent" /> AI Copilot
          </h1>
          <p className="flex items-center gap-1.5 truncate text-xs text-slate-500">
            {server ? (
              <>
                <Server size={11} /> {server.name}
              </>
            ) : (
              'general assistant'
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} className="rounded p-1.5 text-slate-400 hover:bg-ink-600 hover:text-white" title="Clear">
              <Trash2 size={15} />
            </button>
          )}
          {dock && (
            <button onClick={toggleCopilot} className="rounded p-1.5 text-slate-400 hover:bg-ink-600 hover:text-white" title="Close (⌘I)">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {!configured ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-slate-500">
          <Sparkles size={40} className="opacity-40" />
          <p className="max-w-sm px-4 text-sm">
            Connect a provider to enable AI Copilot. The easiest options: <b className="text-accent">OpenRouter</b> (one
            key → all models) or <b className="text-accent">Ollama</b> (local, no key needed). Your key is stored in the
            encrypted vault.
          </p>
          <button onClick={() => setSidePanel('settings')} className="btn-primary">
            <Settings2 size={15} /> Settings → AI Copilot
          </button>
        </div>
      ) : (
        <>
          <div className={`min-h-0 flex-1 overflow-y-auto ${dock ? 'p-3' : 'p-6'}`}>
            {messages.length === 0 && (
              <div className={wrap}>
                <p className="mb-3 text-sm text-slate-500">Ask something or get started quickly:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => send(s)} className="chip hover:border-accent hover:text-accent">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className={`${wrap} space-y-4`}>
              {messages.map((m, i) => (
                <Message key={i} msg={m} />
              ))}
              {busy && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 size={15} className="animate-spin" /> thinking…
                </div>
              )}
              {truncated && !busy && (
                <button onClick={continueReply} className="btn-ghost border border-ink-500 text-xs">
                  <ArrowDown size={13} /> Continue (reply was cut off)
                </button>
              )}
              {error && <div className="rounded-md bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}
              <div ref={bottomRef} />
            </div>
          </div>

          <div className={`border-t border-ink-600 ${dock ? 'p-3' : 'p-4'}`}>
            <div className={wrap}>
              {/* context + limit indicator */}
              <div className="mb-1.5 flex items-center gap-2 text-[10px] text-slate-600">
                <span>context ~{(tokenEstimate / 1000).toFixed(1)}k tokens</span>
                <div className="h-1 w-20 overflow-hidden rounded-full bg-ink-600">
                  <div
                    className={`h-full ${tokenEstimate / CTX_ESTIMATE > 0.8 ? 'bg-warn' : 'bg-accent'}`}
                    style={{ width: `${Math.min(100, (tokenEstimate / CTX_ESTIMATE) * 100)}%` }}
                  />
                </div>
                {rateLimit && <span className="ml-auto">{rateLimit}</span>}
              </div>

              {attachment && (
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-md border border-ink-500 bg-ink-800 px-2 py-1 text-xs text-slate-300">
                  <Paperclip size={12} className="text-accent" /> {attachment.name}
                  <button onClick={() => setAttachment(null)} className="text-slate-500 hover:text-bad">
                    <X size={12} />
                  </button>
                </div>
              )}

              <div className="flex items-end gap-2">
                <input ref={fileRef} type="file" className="hidden" onChange={onFile} />
                <button
                  onClick={() => fileRef.current?.click()}
                  className="btn-ghost shrink-0 border border-ink-500 px-2.5 py-2"
                  title="Attach file (log, config, code)"
                >
                  <Paperclip size={16} />
                </button>
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      send(input)
                    }
                  }}
                  rows={1}
                  placeholder="Ask Copilot…"
                  title="Enter to send, Shift+Enter for a new line"
                  className="field max-h-32 flex-1 resize-none"
                />
                <button onClick={() => send(input)} disabled={busy || (!input.trim() && !attachment)} className="btn-primary shrink-0">
                  {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Message({ msg }: { msg: AiMessage }): JSX.Element {
  const isUser = msg.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
          isUser ? 'bg-accent/15 text-slate-100' : 'border border-ink-600 bg-ink-800 text-slate-200'
        }`}
      >
        {parseBlocks(msg.content)}
      </div>
    </div>
  )
}

function parseBlocks(text: string): JSX.Element[] {
  const parts: JSX.Element[] = []
  const re = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={key++} className="whitespace-pre-wrap">{text.slice(last, m.index)}</span>)
    parts.push(<CodeBlock key={key++} code={m[2].trimEnd()} />)
    last = re.lastIndex
  }
  if (last < text.length) parts.push(<span key={key++} className="whitespace-pre-wrap">{text.slice(last)}</span>)
  return parts
}

function CodeBlock({ code }: { code: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-ink-600 bg-black/40">
      <div className="flex items-center justify-between border-b border-ink-600 px-2 py-1">
        <span className="text-[10px] uppercase tracking-wide text-slate-600">shell</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-ink-600 hover:text-white"
        >
          {copied ? <Check size={11} className="text-good" /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-xs text-good">{code}</pre>
    </div>
  )
}
