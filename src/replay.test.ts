import { describe, expect, it } from 'vitest'
import sample from './scene.json'
import { createSimulation } from './simulation'
import { checkpointAtIndex, upsertReplayCheckpoint } from './replay'

describe('replay checkpoints', () => {
  it('replaces a checkpoint at the same simulation tick and keeps chronological order', async () => {
    const simulation = await createSimulation(sample)
    try {
      const first = simulation.snapshot()
      for (let tick = 0; tick < 30; tick++) simulation.step()
      const second = simulation.snapshot()
      const replacement = { ...second, selectedId: 'blue-a' as const }
      const checkpoints = upsertReplayCheckpoint(upsertReplayCheckpoint([{ tick: second.tick, snapshot: second }, { tick: first.tick, snapshot: first }], first), replacement)
      expect(checkpoints.map(checkpoint => checkpoint.tick)).toEqual([0, 30])
      expect(checkpoints[1]?.snapshot.selectedId).toBe('blue-a')
    } finally { simulation.dispose() }
  })

  it('clamps checkpoint selection and returns null for an empty timeline', async () => {
    const simulation = await createSimulation(sample)
    try {
      const checkpoint = { tick: 0, snapshot: simulation.snapshot() }
      expect(checkpointAtIndex([], 0)).toBeNull()
      expect(checkpointAtIndex([checkpoint], 99)).toEqual(checkpoint)
      expect(checkpointAtIndex([checkpoint], -1)).toEqual(checkpoint)
    } finally { simulation.dispose() }
  })
})
