import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { SceneSchema, validateLaw } from '../src/domain.js'
import type { Law, Scene } from '../src/domain.js'

const InterpreterRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(500),
  scene: SceneSchema,
}).strict()

export const MAX_REQUEST_BYTES = 32 * 1024
export const MAX_PROVIDER_RESPONSE_BYTES = 32 * 1024
export const MAX_PROVIDER_OUTPUT_TOKENS = 256
export const PROVIDER_TIMEOUT_MS = 8_000
export const REQUEST_BODY_TIMEOUT_MS = 8_000
export const LIVE_AI_ENABLED_ENV = 'RULEBREAKER_LIVE_AI_ENABLED'
export const OPERATOR_TOKEN_ENV = 'RULEBREAKER_OPERATOR_BEARER_TOKEN'

type FetchLike = typeof fetch
export type Environment = Record<string, string | undefined>

export type LiveProposal = {
  mode: 'live-ai'
  provider: string
  model: string
  interpretation: string
  law: Law
}

export type LiveAiAvailability = {
  enabled: boolean
  reason: 'disabled' | 'missing-api-key' | 'missing-operator-token' | 'invalid-base-url' | 'ready'
}

export class LiveProviderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LiveProviderError'
  }
}

export class RequestValidationError extends LiveProviderError {
  readonly status: 400 | 408 | 413
  readonly code: string
  constructor(message: string, status: 400 | 408 | 413 = 400, code = 'bad_request') {
    super(message)
    this.name = 'RequestValidationError'
    this.status = status
    this.code = code
  }
}

function matchesSecret(actual: string | undefined, expected: string | undefined) {
  if (!actual || !expected) return false
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
}

export function isExplicitlyEnabled(environment: Environment) {
  return environment[LIVE_AI_ENABLED_ENV]?.trim().toLowerCase() === 'true'
}

export function liveAiAvailability(environment: Environment): LiveAiAvailability {
  if (!isExplicitlyEnabled(environment)) return { enabled: false, reason: 'disabled' }
  if (!environment.RULEBREAKER_AI_API_KEY) return { enabled: false, reason: 'missing-api-key' }
  if (!environment[OPERATOR_TOKEN_ENV]) return { enabled: false, reason: 'missing-operator-token' }
  const baseUrl = environment.RULEBREAKER_AI_BASE_URL ?? 'https://api.openai.com/v1'
  try {
    const parsed = new URL(baseUrl)
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      && environment.RULEBREAKER_AI_ALLOW_LOCAL_HTTP === 'true' && environment.NODE_ENV !== 'production' && environment.VERCEL !== '1'
    if (parsed.protocol !== 'https:' && !localHttp) throw new Error('provider URL requires HTTPS')
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('provider URL must not contain credentials, query, or fragment')
  } catch {
    return { enabled: false, reason: 'invalid-base-url' }
  }
  return { enabled: true, reason: 'ready' }
}

export function isOperatorTokenValid(token: string | undefined, environment: Environment) {
  return matchesSecret(token, environment[OPERATOR_TOKEN_ENV])
}

function providerConfig(environment: Environment, operatorToken?: string) {
  const availability = liveAiAvailability(environment)
  if (availability.reason === 'disabled') throw new LiveProviderError('live AI is disabled; use prepared mode')
  if (availability.reason === 'missing-api-key') throw new LiveProviderError('live provider is not configured; use prepared mode')
  if (availability.reason === 'missing-operator-token') throw new LiveProviderError('live AI operator authorization is not configured')
  if (availability.reason === 'invalid-base-url') throw new LiveProviderError('live provider configuration has an invalid base URL')
  if (!isOperatorTokenValid(operatorToken, environment)) throw new LiveProviderError('live AI operator authorization is required')

  const apiKey = environment.RULEBREAKER_AI_API_KEY!
  const baseUrl = environment.RULEBREAKER_AI_BASE_URL ?? 'https://api.openai.com/v1'
  const model = environment.RULEBREAKER_AI_MODEL ?? 'gpt-4o-mini'
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
  const outputBytes = new TextEncoder().encode(text).byteLength
  if (outputBytes > MAX_PROVIDER_RESPONSE_BYTES) throw new LiveProviderError('live provider response exceeded the output limit')
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

async function readBoundedResponse(response: Response, limit: number) {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && Number.isFinite(Number(declaredLength)) && Number(declaredLength) > limit) {
    await response.body?.cancel('response exceeded the output limit')
    throw new LiveProviderError('live provider response exceeded the output limit')
  }
  if (!response.body) {
    const body = await response.text()
    if (new TextEncoder().encode(body).byteLength > limit) throw new LiveProviderError('live provider response exceeded the output limit')
    return body
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) {
        await reader.cancel('response exceeded the output limit')
        throw new LiveProviderError('live provider response exceeded the output limit')
      }
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(body)
}

export async function interpretLaw(value: unknown, options: { environment?: Environment; fetcher?: FetchLike; signal?: AbortSignal; operatorToken?: string } = {}): Promise<LiveProposal> {
  if (options.signal?.aborted) throw new LiveProviderError('live provider request was cancelled')
  const request = InterpreterRequestSchema.parse(value)
  const environment = options.environment ?? process.env
  const config = providerConfig(environment, options.operatorToken)
  const fetcher = options.fetcher ?? fetch
  const controller = new AbortController()
  const abortExternal = () => controller.abort()
  options.signal?.addEventListener('abort', abortExternal, { once: true })
  const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetcher(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        max_tokens: MAX_PROVIDER_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'user', content: JSON.stringify({ prompt: request.prompt, scene: request.scene }) },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      await response.body?.cancel('provider request failed')
      throw new LiveProviderError('live provider request failed')
    }
    const body = await readBoundedResponse(response, MAX_PROVIDER_RESPONSE_BYTES)
    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      throw new LiveProviderError('live provider returned malformed JSON')
    }
    const parsed = parseProposal(responseText(payload), request.scene)
    return { mode: 'live-ai', provider: 'openai-compatible', model: config.model, ...parsed }
  } catch (error) {
    if (error instanceof LiveProviderError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') throw new LiveProviderError('live provider request timed out or was cancelled')
    throw new LiveProviderError('live provider request failed')
  } finally {
    controller.abort()
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortExternal)
  }
}

export async function readJsonBody(request: AsyncIterable<Uint8Array>, limit = MAX_REQUEST_BYTES, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  const chunks: Uint8Array[] = []
  let size = 0
  if (options.signal?.aborted) throw new RequestValidationError('request was cancelled', 408, 'request_cancelled')
  let rejectRead: (error: Error) => void = () => {}
  const interrupted = new Promise<never>((_, reject) => { rejectRead = reject })
  const abort = () => rejectRead(new RequestValidationError('request was cancelled', 408, 'request_cancelled'))
  options.signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => rejectRead(new RequestValidationError('request body timed out', 408, 'request_timeout')), options.timeoutMs ?? REQUEST_BODY_TIMEOUT_MS)
  const iterator = request[Symbol.asyncIterator]()
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), interrupted])
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) throw new RequestValidationError('request body exceeds the 32 KB limit', 413, 'request_too_large')
      chunks.push(next.value)
    }
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    // IncomingMessage sockets are closed by the API response on a read error;
    // returning their iterator here would destroy the socket before the JSON reply.
    if (!('destroy' in request)) void Promise.resolve(iterator.return?.()).catch(() => {})
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    throw new RequestValidationError('request body is invalid JSON')
  }
}
