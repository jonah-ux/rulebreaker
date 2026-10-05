import { ExperimentSchema } from './domain'
import type { Experiment } from './domain'

const SHARE_PREFIX = '#experiment='

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64ToBytes(value: string) {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function hasExperimentShare(hash: string) {
  return hash.startsWith(SHARE_PREFIX)
}

/** Encode only a validated experiment; the URL carries no credentials or provider state. */
export function encodeExperimentShare(experiment: Experiment) {
  const validated = ExperimentSchema.parse(experiment)
  return `${SHARE_PREFIX}${bytesToBase64(new TextEncoder().encode(JSON.stringify(validated)))}`
}

/** Decode the fragment into untrusted JSON. The engine validates it before mutation. */
export function decodeExperimentShare(hash: string): unknown | null {
  if (!hasExperimentShare(hash)) return null
  try {
    return JSON.parse(new TextDecoder().decode(base64ToBytes(hash.slice(SHARE_PREFIX.length)))) as unknown
  } catch {
    return null
  }
}

export function createExperimentShareUrl(experiment: Experiment, href: string) {
  const url = new URL(href)
  url.hash = encodeExperimentShare(experiment).slice(1)
  return url.toString()
}
