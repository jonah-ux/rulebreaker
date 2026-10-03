import { describe, expect, it } from 'vitest'
import sample from './scene.json'
import { SceneSchema, validateLaw } from './domain'
import { createSimulation } from './simulation'

const law = { schema: 'rulebreaker/law/v1', operation: 'set-gravity-scale', targets: ['blue-a'], scale: -1 }

describe('starter law boundary', () => {
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
})
