import { describe, expect, it } from 'vitest'
import sample from './scene.json'
import { ExperimentSchema } from './domain'
import { createExperimentShareUrl, decodeExperimentShare, encodeExperimentShare, hasExperimentShare } from './share'

const experiment = ExperimentSchema.parse({
  schema: 'rulebreaker/experiment/v1',
  engine: 'rulebreaker/engine/v1',
  scene: sample,
  tick: 42,
  bodies: sample.objects.map(object => ({
    id: object.id,
    position: [...object.position] as [number, number, number],
    rotation: [0, 0, 0, 1] as [number, number, number, number],
    linearVelocity: [0, 0, 0] as [number, number, number],
    angularVelocity: [0, 0, 0] as [number, number, number],
    gravityScale: object.color === 'blue' ? -1 : 1,
    frozenUntilTick: null,
  })),
  collisionNoteLaw: null,
  pendingEvents: [],
  noteCooldowns: [],
  noteSequence: 0,
  selectedId: 'blue-a',
})

describe('experiment share links', () => {
  it('round-trips a validated experiment through a URL-safe fragment', () => {
    const hash = encodeExperimentShare(experiment)
    expect(hasExperimentShare(hash)).toBe(true)
    expect(hash.slice('#experiment='.length)).not.toMatch(/[+/=]/u)
    expect(decodeExperimentShare(hash)).toEqual(experiment)
  })

  it('preserves the current route while replacing only the fragment', () => {
    const url = createExperimentShareUrl(experiment, 'https://rulebreaker.vercel.app/play?mode=prepared#old')
    expect(url.startsWith('https://rulebreaker.vercel.app/play?mode=prepared#experiment=')).toBe(true)
    expect(decodeExperimentShare(new URL(url).hash)).toEqual(experiment)
  })

  it('refuses malformed fragments without throwing', () => {
    expect(hasExperimentShare('#experiment=')).toBe(true)
    expect(decodeExperimentShare('#experiment=%%%')).toBeNull()
    expect(decodeExperimentShare('#other=value')).toBeNull()
  })
})
