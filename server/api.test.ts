import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'
import { capabilitiesPayload, handleCapabilities, handleHealth, handleInterpret } from './api.js'
import { MAX_REQUEST_BYTES } from './ai.js'

class FakeRequest extends EventEmitter {
  method: string
  headers: Record<string, string>
  complete = true
  private readonly chunks: Uint8Array[]

  constructor(method: string, body = '', authorization?: string) {
    super()
    this.method = method
    this.headers = authorization ? { authorization } : {}
    this.chunks = [new TextEncoder().encode(body)]
  }

  async *[Symbol.asyncIterator]() {
    for (const chunk of this.chunks) yield chunk
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200
  writableEnded = false
  writableFinished = false
  headers: Record<string, string | number> = {}
  body = ''

  setHeader(name: string, value: string | number) {
    this.headers[name.toLowerCase()] = value
  }

  end(body?: string) {
    this.body = body ?? ''
    this.writableEnded = true
    this.writableFinished = true
  }
}

const savedEnvironment = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, savedEnvironment)
})

describe('same-origin API boundary', () => {
  it('reports prepared capability while live AI is disabled by default', () => {
    const payload = capabilitiesPayload({})
    expect(payload.capabilities).toEqual({ prepared: true, liveAi: false })
    expect(payload.limits.requestBytes).toBe(MAX_REQUEST_BYTES)
  })

  it('serves health and capability routes as read-only JSON', () => {
    const healthRequest = new FakeRequest('GET')
    const healthResponse = new FakeResponse()
    handleHealth(healthRequest as never, healthResponse as never)
    expect(healthResponse.statusCode).toBe(200)
    expect(JSON.parse(healthResponse.body)).toMatchObject({ schema: 'rulebreaker/health/v1', status: 'ok', version: '0.1.0', revision: null })

    const optionsResponse = new FakeResponse()
    handleCapabilities(new FakeRequest('OPTIONS') as never, optionsResponse as never)
    expect(optionsResponse.statusCode).toBe(204)
  })

  it('refuses provider work and sanitizes the disabled response', async () => {
    process.env.RULEBREAKER_AI_API_KEY = 'provider-secret'
    const response = new FakeResponse()
    await handleInterpret(new FakeRequest('POST', JSON.stringify({ prompt: 'make blue shapes rise' })) as never, response as never)
    expect(response.statusCode).toBe(503)
    expect(response.body).toBe(JSON.stringify({ error: 'live AI is disabled; use prepared mode', code: 'live_ai_disabled' }))
    expect(response.body).not.toContain('provider-secret')
  })

  it('checks the operator bearer token before reading oversized input', async () => {
    process.env.RULEBREAKER_LIVE_AI_ENABLED = 'true'
    process.env.RULEBREAKER_AI_API_KEY = 'provider-secret'
    process.env.RULEBREAKER_OPERATOR_BEARER_TOKEN = 'operator-secret'
    const oversized = 'x'.repeat(MAX_REQUEST_BYTES + 1)
    const response = new FakeResponse()
    await handleInterpret(new FakeRequest('POST', oversized, 'Bearer wrong-token') as never, response as never)
    expect(response.statusCode).toBe(401)
    expect(response.body).not.toContain('operator-secret')
    expect(response.body).not.toContain(oversized)
  })
})
