import { describe, expect, it } from 'vitest'
import sample from './scene.json'
import { createSimulation } from './simulation'
import { branchReplay, checkpointAtIndex, MAX_REPLAY_CHECKPOINTS, upsertReplayCheckpoint } from './replay'

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

  it('keeps the future while browsing and discards it only when continuing a branch', async () => {
    const simulation = await createSimulation(sample)
    try {
      let checkpoints = upsertReplayCheckpoint([], simulation.snapshot())
      for (let tick = 0; tick < 90; tick++) {
        simulation.step()
        if (simulation.tick % 30 === 0) checkpoints = upsertReplayCheckpoint(checkpoints, simulation.snapshot())
      }
      const past = checkpointAtIndex(checkpoints, 1)!
      simulation.restore(past.snapshot)
      expect(checkpointAtIndex(checkpoints, 3)?.tick).toBe(90)
      expect(simulation.snapshot()).toEqual(past.snapshot)
      const branch = branchReplay(checkpoints, past.tick)
      expect(branch.map(point => point.tick)).toEqual([0, 30])
      simulation.apply({ schema: 'rulebreaker/law/v1', operation: 'set-gravity-scale', targets: ['blue-a'], scale: -1 })
      for (let tick = 0; tick < 30; tick++) simulation.step()
      expect(upsertReplayCheckpoint(branch, simulation.snapshot()).map(point => point.tick)).toEqual([0, 30, 60])
    } finally { simulation.dispose() }
  })

  it('bounds the recording without corrupting stored snapshots', async () => {
    const simulation = await createSimulation(sample)
    try {
      let checkpoints = upsertReplayCheckpoint([], simulation.snapshot())
      for (let tick = 0; tick < 1500; tick++) {
        simulation.step()
        if (simulation.tick % 30 === 0) checkpoints = upsertReplayCheckpoint(checkpoints, simulation.snapshot())
      }
      expect(checkpoints).toHaveLength(MAX_REPLAY_CHECKPOINTS)
      expect(checkpoints[0]?.tick).toBe(90)
      expect(checkpoints.at(-1)?.tick).toBe(1500)
    } finally { simulation.dispose() }
  })
})
