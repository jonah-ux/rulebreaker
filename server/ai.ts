import { z } from 'zod'
import { SceneSchema, validateLaw } from '../src/domain.js'
import type { Law, Scene } from '../src/domain.js'

const InterpreterRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(500),
  scene: SceneSchema,
}).strict()

type FetchLike = typeof fetch
type Environment = Record<string, string | undefined>

export type LiveProposal = {
  mode: 'live-ai'
  provider: string
  model: string
  interpretation: string
  law: Law
}

export class LiveProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiveProviderError'
  }
}

function providerConfig(environment: Environment) {
  const apiKey = environment.RULEBREAKER_AI_API_KEY
  const baseUrl = environment.RULEBREAKER_AI_BASE_URL ?? 'https://api.openai.com/v1'
  const model = environment.RULEBREAKER_AI_MODEL ?? 'gpt-4o-mini'
  if (!apiKey) return null
  try {
    const parsed = new URL(baseUrl)
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('provider URL must use http or https')
  } catch {
    throw new LiveProviderError('live provider configuration has an invalid base URL')
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), model }
}

function systemPrompt() {
  return [
    'You are the Rulebreaker law interpreter.',
    'Return one JSON object with exactly these keys: interpretation (short string) and law (typed rulebreaker/law/v1 object).',
    'Allowed operations are set-gravity-scale, collision-note, and temporary-freeze only.',
    'Targets must be IDs from the supplied scene. Use finite bounded numbers.',
    'Never return JavaScript, shell commands, tools, URLs, or provider metadata.',
    'For collision-note use threshold, cooldownTicks, and maxVoices. For temporary-freeze use durationTicks.',
  ].join(' ')
}

function responseText(payload: unknown) {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => typeof part === 'object' && part && 'text' in part ? String(part.text) : '').join('')
  throw new LiveProviderError('live provider returned no text proposal')
}

function parseProposal(text: string, scene: Scene): { interpretation: string; law: Law } {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new LiveProviderError('live provider returned malformed JSON')
  }
  const envelope = z.object({ interpretation: z.string().trim().min(1).max(500), law: z.unknown() }).strict().safeParse(parsed)
  if (!envelope.success) throw new LiveProviderError('live provider response is missing an interpretation or law')
  try {
    return { interpretation: envelope.data.interpretation, law: validateLaw(scene, envelope.data.law) }
  } catch {
    throw new LiveProviderError('live provider returned an unsupported or out-of-scope law')
  }
}

export async function interpretLaw(value: unknown, options: { environment?: Environment; fetcher?: FetchLike; signal?: AbortSignal } = {}): Promise<LiveProposal> {
  const request = InterpreterRequestSchema.parse(value)
  const config = providerConfig(options.environment ?? process.env)
  if (!config) throw new LiveProviderError('live provider is not configured; use prepared mode')
  const fetcher = options.fetcher ?? fetch
  const controller = new AbortController()
  const abortExternal = () => controller.abort()
  options.signal?.addEventListener('abort', abortExternal, { once: true })
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetcher(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: JSON.stringify({ prompt: request.prompt, scene: request.scene }) },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new LiveProviderError(`live provider request failed with HTTP ${response.status}`)
    const parsed = parseProposal(responseText(await response.json()), request.scene)
    return { mode: 'live-ai', provider: config.baseUrl, model: config.model, ...parsed }
  } catch (error) {
    if (error instanceof LiveProviderError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new LiveProviderError('live provider request timed out or was cancelled')
    throw new LiveProviderError('live provider request failed')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortExternal)
  }
}

export async function readJsonBody(request: AsyncIterable<Uint8Array>, limit = 32768) {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.byteLength
    if (size > limit) throw new LiveProviderError('request body exceeds the 32 KB limit')
    chunks.push(chunk)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(body)) as unknown
}
