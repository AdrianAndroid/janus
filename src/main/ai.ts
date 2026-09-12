import type { AiConfig, AiMessage, AiReply } from '@shared/types'

/** Base URL for OpenAI-compatible providers. */
function openaiBase(cfg: AiConfig): string {
  if (cfg.provider === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (cfg.provider === 'custom') return (cfg.baseUrl || 'http://localhost:11434/v1').replace(/\/$/, '')
  return 'https://api.openai.com/v1'
}

/**
 * Chat completion against the user's configured provider using their own key.
 * Supports Anthropic (Claude), Google (Gemini), OpenAI, OpenRouter (most models),
 * and any OpenAI-compatible endpoint (Ollama, LM Studio, …).
 */
export async function aiChat(cfg: AiConfig, messages: AiMessage[], system: string): Promise<AiReply> {
  if (cfg.provider !== 'custom' && !cfg.apiKey) {
    throw new Error('AI API key is not configured (Settings → AI Copilot).')
  }
  if (!cfg.model) throw new Error('AI model name is not configured.')

  // ---- Anthropic ----
  if (cfg.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages })
    })
    const j = (await res.json()) as {
      content?: { text?: string }[]
      stop_reason?: string
      usage?: { input_tokens?: number; output_tokens?: number }
      error?: { message?: string }
    }
    if (!res.ok) throw new Error(j.error?.message || `Anthropic HTTP ${res.status}`)
    const reqRem = res.headers.get('anthropic-ratelimit-requests-remaining')
    const tokRem = res.headers.get('anthropic-ratelimit-tokens-remaining')
    return {
      text: (j.content ?? []).map((c) => c.text ?? '').join(''),
      truncated: j.stop_reason === 'max_tokens',
      rateLimit: reqRem ? `${reqRem} requests · ${tokRem ?? '?'} tokens left` : undefined,
      usage: { input: j.usage?.input_tokens, output: j.usage?.output_tokens }
    }
  }

  // ---- Google Gemini ----
  if (cfg.provider === 'google') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
        generationConfig: { maxOutputTokens: 4096 }
      })
    })
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
      error?: { message?: string }
    }
    if (!res.ok) throw new Error(j.error?.message || `Google HTTP ${res.status}`)
    const cand = j.candidates?.[0]
    return {
      text: (cand?.content?.parts ?? []).map((p) => p.text ?? '').join(''),
      truncated: cand?.finishReason === 'MAX_TOKENS',
      usage: { input: j.usageMetadata?.promptTokenCount, output: j.usageMetadata?.candidatesTokenCount }
    }
  }

  // ---- OpenAI-compatible (openai / openrouter / custom) ----
  const res = await fetch(`${openaiBase(cfg)}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
      ...(cfg.provider === 'openrouter' ? { 'HTTP-Referer': 'https://asafudurgucu.github.io/janus', 'X-Title': 'Janus' } : {})
    },
    body: JSON.stringify({ model: cfg.model, max_tokens: 4096, messages: [{ role: 'system', content: system }, ...messages] })
  })
  const j = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    error?: { message?: string }
  }
  if (!res.ok) throw new Error(j.error?.message || `HTTP ${res.status}`)
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    truncated: j.choices?.[0]?.finish_reason === 'length',
    usage: { input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens }
  }
}
