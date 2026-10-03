import { describe, expect, it } from 'vitest'
import sample from './scene.json'
import { PreparedInterpreterError, interpretPreparedPrompt } from './preparedInterpreter'

describe('prepared natural-language interpreter', () => {
  it('maps alternate gravity phrasing to the typed blue scope', () => {
    const proposal = interpretPreparedPrompt('make the blue shapes rise', sample)
    expect(proposal.mode).toBe('prepared')
    expect(proposal.law).toMatchObject({ operation: 'set-gravity-scale', targets: ['blue-a', 'blue-b'], scale: -1 })
  })
  it('maps collision sound phrasing to the bounded note policy', () => {
    const proposal = interpretPreparedPrompt('turn impacts into little tones', sample)
    expect(proposal.law).toMatchObject({ operation: 'collision-note', cooldownTicks: 24, maxVoices: 4 })
  })
  it('requires a selected object for freeze phrasing and refuses unsupported laws', () => {
    expect(() => interpretPreparedPrompt('hold this object still', sample)).toThrow('Select an object first')
    expect(() => interpretPreparedPrompt('make the ceiling sing opera', sample)).toThrow(PreparedInterpreterError)
  })
})
