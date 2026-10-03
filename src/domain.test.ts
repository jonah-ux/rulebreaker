import { describe, expect, it } from 'vitest'
import sample from './scene.json'
import { SceneSchema, validateLaw } from './domain'
import { createSimulation } from './simulation'

const law = { schema: 'rulebreaker/law/v1', operation: 'set-gravity-scale', targets: ['blue-a'], scale: -1 }
const allTargets = sample.objects.map(object => object.id)

describe('typed law boundary', () => {
  it('accepts the shipped scene and a scoped prepared law', () => {
    expect(validateLaw(SceneSchema.parse(sample), law).targets).toEqual(['blue-a'])
  })
  it('refuses an unknown object', () => {
    expect(() => validateLaw(SceneSchema.parse(sample), { ...law, targets: ['missing'] })).toThrow()
  })
  it('refuses duplicate identities, unknown operations, and non-finite values', () => {
    expect(() => SceneSchema.parse({ ...sample, objects: [sample.objects[0], sample.objects[0]] })).toThrow()
    expect(() => validateLaw(SceneSchema.parse(sample), { ...law, operation: 'execute-code' })).toThrow()
    expect(() => validateLaw(SceneSchema.parse(sample), { ...law, scale: Infinity })).toThrow()
  })
  it('accepts typed collision-note and temporary-freeze laws with bounded policies', () => {
    expect(validateLaw(SceneSchema.parse(sample), {
      schema: 'rulebreaker/law/v1',
      operation: 'collision-note',
      targets: allTargets,
      threshold: 1.2,
      cooldownTicks: 24,
      maxVoices: 4,
    }).operation).toBe('collision-note')
    expect(validateLaw(SceneSchema.parse(sample), {
      schema: 'rulebreaker/law/v1',
      operation: 'temporary-freeze',
      targets: ['blue-a'],
      durationTicks: 180,
    }).operation).toBe('temporary-freeze')
    expect(() => validateLaw(SceneSchema.parse(sample), {
      schema: 'rulebreaker/law/v1',
      operation: 'collision-note',
      targets: allTargets,
      threshold: 1.2,
      cooldownTicks: 0,
      maxVoices: 4,
    })).toThrow()
  })
  it('changes selected-body motion in the actual engine', async () => {
    const simulation = await createSimulation(sample)
    try {
      simulation.apply(law)
      for (let tick = 0; tick < 30; tick++) simulation.step()
      expect(simulation.bodies.get('blue-a')!.translation().y).toBeGreaterThan(4)
      expect(simulation.bodies.get('red-a')!.translation().y).toBeLessThan(5)
    } finally { simulation.dispose() }
  })
  it('refuses a mixed valid/invalid selection without changing a body', async () => {
    const simulation = await createSimulation(sample)
    try {
      expect(() => simulation.apply({ ...law, targets: ['blue-a', 'missing'] })).toThrow()
      for (let tick = 0; tick < 30; tick++) simulation.step()
      expect(simulation.bodies.get('blue-a')!.translation().y).toBeLessThan(4)
    } finally { simulation.dispose() }
  })
  it('lifts a selected body after it has settled on the floor', async () => {
    const simulation = await createSimulation(sample)
    try {
      for (let tick = 0; tick < 300; tick++) simulation.step()
      const before = simulation.bodies.get('blue-a')!.translation().y
      simulation.apply(law)
      for (let tick = 0; tick < 60; tick++) simulation.step()
      expect(simulation.bodies.get('blue-a')!.translation().y).toBeGreaterThan(before + 0.2)
    } finally { simulation.dispose() }
  })
  it('emits bounded collision notes from real impact events', async () => {
    const simulation = await createSimulation(sample)
    try {
      simulation.apply({
        schema: 'rulebreaker/law/v1',
        operation: 'collision-note',
        targets: allTargets,
        threshold: 0.5,
        cooldownTicks: 24,
        maxVoices: 4,
      })
      const events = []
      for (let tick = 0; tick < 360; tick++) events.push(...simulation.step())
      const notes = events.filter(event => event.type === 'collision-note')
      expect(notes.length).toBeGreaterThan(0)
      for (let index = 1; index < notes.length; index++) {
        if (notes[index].first === notes[index - 1].first && notes[index].second === notes[index - 1].second) {
          expect(notes[index].tick - notes[index - 1].tick).toBeGreaterThanOrEqual(24)
        }
      }
      const laterEvents = []
      for (let tick = 0; tick < 120; tick++) laterEvents.push(...simulation.step())
      expect(laterEvents.filter(event => event.type === 'collision-note').length).toBeLessThanOrEqual(4)
    } finally { simulation.dispose() }
  })
  it('freezes selected bodies for simulation ticks and preserves a gravity law after expiry', async () => {
    const simulation = await createSimulation(sample)
    try {
      const body = simulation.bodies.get('blue-a')!
      const initialHeight = body.translation().y
      simulation.apply({ ...law, targets: ['blue-a'], scale: -1 })
      simulation.apply({
        schema: 'rulebreaker/law/v1',
        operation: 'temporary-freeze',
        targets: ['blue-a'],
        durationTicks: 180,
      })
      for (let tick = 0; tick < 120; tick++) simulation.step()
      expect(body.translation().y).toBeCloseTo(initialHeight, 5)
      expect(simulation.frozenTargets.has('blue-a')).toBe(true)
      for (let tick = 0; tick < 60; tick++) simulation.step()
      expect(simulation.frozenTargets.has('blue-a')).toBe(false)
      expect(body.gravityScale()).toBe(-1)
      const releasedHeight = body.translation().y
      simulation.step()
      expect(body.translation().y).toBeGreaterThan(releasedHeight)
    } finally { simulation.dispose() }
  })
  it('round-trips a complete experiment snapshot and replays a branch without a provider call', async () => {
    const simulation = await createSimulation(sample)
    try {
      simulation.apply({
        schema: 'rulebreaker/law/v1',
        operation: 'set-gravity-scale',
        targets: ['blue-a'],
        scale: -1,
      })
      simulation.apply({
        schema: 'rulebreaker/law/v1',
        operation: 'collision-note',
        targets: allTargets,
        threshold: 0.5,
        cooldownTicks: 24,
        maxVoices: 4,
      })
      for (let tick = 0; tick < 24; tick++) simulation.step()
      const branch = simulation.snapshot('blue-a')
      simulation.apply({ schema: 'rulebreaker/law/v1', operation: 'temporary-freeze', targets: ['blue-a'], durationTicks: 180 })
      for (let tick = 0; tick < 18; tick++) simulation.step()
      simulation.restore(branch)
      expect(simulation.tick).toBe(branch.tick)
      expect(simulation.activeCollisionNoteLaw?.cooldownTicks).toBe(24)
      expect(simulation.frozenTargets.has('blue-a')).toBe(false)
      expect(simulation.bodies.get('blue-a')!.gravityScale()).toBe(-1)
      expect(simulation.snapshot('blue-a')).toEqual(branch)

      simulation.apply({ schema: 'rulebreaker/law/v1', operation: 'set-gravity-scale', targets: ['blue-a'], scale: -1 })
      for (let tick = 0; tick < 30; tick++) simulation.step()
      const firstReplayHeight = simulation.bodies.get('blue-a')!.translation().y
      simulation.restore(branch)
      simulation.apply({ schema: 'rulebreaker/law/v1', operation: 'set-gravity-scale', targets: ['blue-a'], scale: -1 })
      for (let tick = 0; tick < 30; tick++) simulation.step()
      expect(simulation.bodies.get('blue-a')!.translation().y).toBeCloseTo(firstReplayHeight, 6)
    } finally { simulation.dispose() }
  })
  it('refuses invalid experiment versions and broken body references atomically', async () => {
    const simulation = await createSimulation(sample)
    try {
      const snapshot = simulation.snapshot()
      const before = simulation.bodies.get('blue-a')!.translation().y
      expect(() => simulation.restore({ ...snapshot, schema: 'rulebreaker/experiment/v0' })).toThrow()
      expect(() => simulation.restore({ ...snapshot, bodies: snapshot.bodies.map((body, index) => index === 0 ? { ...body, id: 'missing' } : body) })).toThrow()
      expect(simulation.bodies.get('blue-a')!.translation().y).toBe(before)
    } finally { simulation.dispose() }
  })
})
