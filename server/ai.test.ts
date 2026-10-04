import { describe, expect, it } from 'vitest'
import { LiveProviderError, interpretLaw, liveAiAvailability, MAX_PROVIDER_OUTPUT_TOKENS } from './ai.js'

const sample = {
  schema: 'rulebreaker/scene/v1' as const,
  objects: [
    { id: 'blue-a', color: 'blue' as const, position: [-2, 4, 0] as [number, number, number] },
    { id: 'blue-b', color: 'blue' as const, position: [-0.5, 6, -1] as [number, number, number] },
    { id: 'red-a', color: 'red' as const, position: [1, 5, 0] as [number, number, number] },
    { id: 'gold-a', color: 'gold' as const, position: [2.5, 7, -1] as [number, number, number] },
  ],
}

const environment = {
  RULEBREAKER_LIVE_AI_ENABLED: 'true',
  RULEBREAKER_AI_API_KEY: 'test-key',
  RULEBREAKER_AI_BASE_URL: 'https://provider.test/v1',
  RULEBREAKER_AI_MODEL: 'test-model',
  RULEBREAKER_OPERATOR_BEARER_TOKEN: 'operator-test-token',
}

describe('live law adapter boundary', () => {
  it('validates a provider proposal before returning it to the engine', async () => {
    let requestBody = ''
    const result = await interpretLaw({ prompt: 'make blue objects fall upward', scene: sample }, {
      environment,
      operatorToken: environment.RULEBREAKER_OPERATOR_BEARER_TOKEN,
      fetcher: async (_url: string | URL | Request, init?: RequestInit) => {
        requestBody = String(init?.body)
        expect(init?.body).toContain(`"max_tokens":${MAX_PROVIDER_OUTPUT_TOKENS}`)
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
          interpretation: 'Blue objects use inverted gravity.',
          law: { schema: 'rulebreaker/law/v1', operation: 'set-gravity-scale', targets: ['blue-a', 'blue-b'], scale: -1 },
        }) } }] }), { status: 200 })
      },
    })
    expect(result.mode).toBe('live-ai')
    expect(result.provider).toBe('openai-compatible')
    expect(result.law.operation).toBe('set-gravity-scale')
    expect(result.law.targets).toEqual(['blue-a', 'blue-b'])
    expect(requestBody).toContain('make blue objects fall upward')
    expect(requestBody).not.toContain('test-key')
  })
  it('keeps provider absence and malformed output separate from prepared mode', async () => {
    await expect(interpretLaw({ prompt: 'make blue objects rise', scene: sample }, { environment: { RULEBREAKER_LIVE_AI_ENABLED: 'true' } })).rejects.toThrow('not configured')
    await expect(interpretLaw({ prompt: 'make blue objects rise', scene: sample }, {
      environment,
      operatorToken: environment.RULEBREAKER_OPERATOR_BEARER_TOKEN,
      fetcher: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), { status: 200 }),
    })).rejects.toEqual(expect.any(LiveProviderError))
  })
  it('refuses an out-of-scope provider target', async () => {
    await expect(interpretLaw({ prompt: 'do something unsafe', scene: sample }, {
      environment,
      operatorToken: environment.RULEBREAKER_OPERATOR_BEARER_TOKEN,
      fetcher: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        interpretation: 'Unsafe proposal',
        law: { schema: 'rulebreaker/law/v1', operation: 'set-gravity-scale', targets: ['missing'], scale: -1 },
      }) } }] }), { status: 200 }),
    })).rejects.toThrow('unsupported or out-of-scope')
  })
  it('stays disabled without explicit enablement or operator authorization', async () => {
    expect(liveAiAvailability({ RULEBREAKER_AI_API_KEY: 'test-key' })).toEqual({ enabled: false, reason: 'disabled' })
    await expect(interpretLaw({ prompt: 'make blue objects rise', scene: sample }, { environment: { ...environment, RULEBREAKER_LIVE_AI_ENABLED: 'false' }, operatorToken: environment.RULEBREAKER_OPERATOR_BEARER_TOKEN })).rejects.toThrow('disabled')
    await expect(interpretLaw({ prompt: 'make blue objects rise', scene: sample }, { environment, operatorToken: 'wrong-token' })).rejects.toThrow('authorization')
  })
  it('honors pre-abort before making a provider request', async () => {
    const controller = new AbortController()
    controller.abort()
    let called = false
    await expect(interpretLaw({ prompt: 'make blue objects rise', scene: sample }, {
      environment,
      operatorToken: environment.RULEBREAKER_OPERATOR_BEARER_TOKEN,
      signal: controller.signal,
      fetcher: async () => { called = true; return new Response('{}') },
    })).rejects.toThrow('cancelled')
    expect(called).toBe(false)
  })
})
