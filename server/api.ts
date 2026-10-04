import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  interpretLaw,
  isOperatorTokenValid,
  liveAiAvailability,
  LiveProviderError,
  MAX_PROVIDER_OUTPUT_TOKENS,
  MAX_PROVIDER_RESPONSE_BYTES,
  MAX_REQUEST_BYTES,
  PROVIDER_TIMEOUT_MS,
  REQUEST_BODY_TIMEOUT_MS,
  readJsonBody,
  RequestValidationError,
} from './ai.js'

type ApiRequest = IncomingMessage & AsyncIterable<Uint8Array>
type ApiResponse = ServerResponse
type Environment = Record<string, string | undefined>
const RELEASE_VERSION = '0.1.0'

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

function environment() {
  return process.env as Environment
}

function sendJson(response: ApiResponse, status: number, body: unknown) {
  if (response.writableEnded) return
  response.statusCode = status
  for (const [name, value] of Object.entries(jsonHeaders)) response.setHeader(name, value)
  response.end(JSON.stringify(body))
}

function methodNotAllowed(response: ApiResponse, allow: string) {
  response.setHeader('allow', allow)
  sendJson(response, 405, { error: 'method not allowed', code: 'method_not_allowed' })
}

function bearerToken(request: ApiRequest) {
  const header = request.headers.authorization
  if (typeof header !== 'string') return undefined
  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim())
  return match?.[1]
}

function attachDisconnectSignal(request: ApiRequest, response: ApiResponse) {
  const controller = new AbortController()
  let disconnected = false
  const abort = () => {
    disconnected = true
    controller.abort()
  }
  const requestClose = () => {
    if (!request.complete) abort()
  }
  const responseClose = () => {
    if (!response.writableFinished) abort()
  }
  request.once('aborted', abort)
  request.once('close', requestClose)
  response.once('close', responseClose)
  return {
    signal: controller.signal,
    get disconnected() { return disconnected },
    cleanup() {
      request.removeListener('aborted', abort)
      request.removeListener('close', requestClose)
      response.removeListener('close', responseClose)
    },
  }
}

function errorResponse(error: unknown) {
  if (error instanceof RequestValidationError) return { status: error.status, body: { error: 'request could not be processed', code: error.code } }
  if (error instanceof LiveProviderError) return { status: 502, body: { error: 'live AI request failed; use prepared mode', code: 'provider_unavailable' } }
  return { status: 400, body: { error: 'request could not be processed', code: 'bad_request' } }
}

export async function handleInterpret(request: ApiRequest, response: ApiResponse, env = environment()) {
  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return
  }
  if (request.method !== 'POST') {
    methodNotAllowed(response, 'POST, OPTIONS')
    return
  }

  const availability = liveAiAvailability(env)
  if (!availability.enabled) {
    sendJson(response, 503, { error: 'live AI is disabled; use prepared mode', code: 'live_ai_disabled' })
    return
  }
  const operatorToken = bearerToken(request)
  if (!isOperatorTokenValid(operatorToken, env)) {
    sendJson(response, 401, { error: 'live AI operator authorization required', code: 'operator_authorization_required' })
    return
  }

  const disconnect = attachDisconnectSignal(request, response)
  try {
    const body = await readJsonBody(request, MAX_REQUEST_BYTES, { signal: disconnect.signal })
    const proposal = await interpretLaw(body, { environment: env, operatorToken, signal: disconnect.signal })
    if (disconnect.disconnected) return
    sendJson(response, 200, proposal)
  } catch (error) {
    if (disconnect.disconnected) return
    const result = errorResponse(error)
    response.setHeader('connection', 'close')
    sendJson(response, result.status, result.body)
  } finally {
    disconnect.cleanup()
  }
}

export function capabilitiesPayload(env = environment()) {
  const availability = liveAiAvailability(env)
  return {
    service: 'rulebreaker',
    schema: 'rulebreaker/api/v1',
    capabilities: {
      prepared: true,
      liveAi: availability.enabled,
    },
    limits: {
      requestBytes: MAX_REQUEST_BYTES,
      providerResponseBytes: MAX_PROVIDER_RESPONSE_BYTES,
      providerOutputTokens: MAX_PROVIDER_OUTPUT_TOKENS,
      providerTimeoutMs: PROVIDER_TIMEOUT_MS,
      requestBodyTimeoutMs: REQUEST_BODY_TIMEOUT_MS,
    },
  }
}

export function handleCapabilities(request: ApiRequest, response: ApiResponse, env = environment()) {
  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return
  }
  if (request.method !== 'GET') {
    methodNotAllowed(response, 'GET, OPTIONS')
    return
  }
  sendJson(response, 200, capabilitiesPayload(env))
}

export function healthPayload(env = environment()) {
  return {
    ...capabilitiesPayload(env),
    schema: 'rulebreaker/health/v1',
    status: 'ok',
    version: RELEASE_VERSION,
    revision: env.VERCEL_GIT_COMMIT_SHA ?? null,
  }
}

export function handleHealth(request: ApiRequest, response: ApiResponse, env = environment()) {
  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return
  }
  if (request.method !== 'GET') {
    methodNotAllowed(response, 'GET, OPTIONS')
    return
  }
  sendJson(response, 200, healthPayload(env))
}
