// Android AI engine — direct fetch to provider APIs, no Go proxy needed.

export interface AiMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
const OPENAI_API    = 'https://api.openai.com/v1/chat/completions'
const GEMINI_API    = 'https://generativeai.googleapis.com/v1beta/models'
const OPENROUTER_API = 'https://openrouter.ai/api/v1/chat/completions'

export async function handleAiChat(
  messages: AiMessage[],
  apiKey: string,
  model: string,
  system: string,
  provider: string,
): Promise<{ content: string; error?: string }> {
  try {
    switch (provider) {
      case 'anthropic': {
        const res = await fetch(ANTHROPIC_API, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: model || 'claude-haiku-4-5-20251001',
            max_tokens: 4096,
            system: system || undefined,
            messages,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error?.message ?? res.statusText)
        return { content: data.content?.[0]?.text ?? '' }
      }

      case 'openai': {
        const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages
        const res = await fetch(OPENAI_API, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model || 'gpt-4o-mini', messages: msgs }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error?.message ?? res.statusText)
        return { content: data.choices?.[0]?.message?.content ?? '' }
      }

      case 'openrouter': {
        const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages
        const res = await fetch(OPENROUTER_API, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://sanction.app',
          },
          body: JSON.stringify({ model: model || 'meta-llama/llama-3-8b-instruct:free', messages: msgs }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error?.message ?? res.statusText)
        return { content: data.choices?.[0]?.message?.content ?? '' }
      }

      case 'ollama': {
        const ollamaBase = 'http://localhost:11434'
        const msgs = system ? [{ role: 'system', content: system }, ...messages] : messages
        const res = await fetch(`${ollamaBase}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model || 'llama3', messages: msgs, stream: false }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error ?? res.statusText)
        return { content: data.message?.content ?? '' }
      }

      default:
        return { content: '', error: `Unknown provider: ${provider}` }
    }
  } catch (e: any) {
    return { content: '', error: String(e?.message ?? e) }
  }
}

export async function handleOllamaModels(host: string) {
  try {
    const res = await fetch(`${host}/api/tags`)
    const data = await res.json()
    return { models: (data.models ?? []).map((m: any) => m.name) }
  } catch {
    return { models: [] }
  }
}
