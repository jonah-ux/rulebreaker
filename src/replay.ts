import type { Experiment } from './domain'

export const REPLAY_CHECKPOINT_INTERVAL = 30
export const MAX_REPLAY_CHECKPOINTS = 48

export type ReplayCheckpoint = {
  tick: number
  snapshot: Experiment
}

export function upsertReplayCheckpoint(current: ReplayCheckpoint[], snapshot: Experiment): ReplayCheckpoint[] {
  const next = current.filter(checkpoint => checkpoint.tick !== snapshot.tick)
  next.push({ tick: snapshot.tick, snapshot })
  next.sort((left, right) => left.tick - right.tick)
  return next.slice(-MAX_REPLAY_CHECKPOINTS)
}

export function checkpointAtIndex(checkpoints: ReplayCheckpoint[], index: number) {
  if (checkpoints.length === 0) return null
  return checkpoints[Math.min(Math.max(index, 0), checkpoints.length - 1)] ?? null
}
