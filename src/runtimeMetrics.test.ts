import { describe, expect, it } from 'vitest'
import { summarizeRuntimeWindow } from './runtimeMetrics'

describe('runtime metric sampling', () => {
  it('converts a measured window into frame, physics, and resource rates', () => {
    expect(summarizeRuntimeWindow({
      elapsedMs: 500,
      frameCount: 30,
      tickDelta: 30,
      drawCalls: 8,
      triangles: 192,
      geometries: 7,
      textures: 2,
      pixelRatio: 2,
      objectCount: 4,
    })).toEqual({
      sampleWindowMs: 500,
      frameMs: 500 / 30,
      fps: 60,
      physicsHz: 60,
      tickDelta: 30,
      drawCalls: 8,
      triangles: 192,
      geometries: 7,
      textures: 2,
      pixelRatio: 2,
      objectCount: 4,
    })
  })

  it('clamps unavailable counters without inventing a negative rate', () => {
    expect(summarizeRuntimeWindow({
      elapsedMs: 0,
      frameCount: 0,
      tickDelta: -2,
      drawCalls: -1,
      triangles: -1,
      geometries: -1,
      textures: -1,
      pixelRatio: -1,
      objectCount: -1,
    })).toMatchObject({
      sampleWindowMs: 1,
      frameMs: 1,
      fps: 1000,
      physicsHz: 0,
      tickDelta: 0,
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
      pixelRatio: 0,
      objectCount: 0,
    })
  })
})
