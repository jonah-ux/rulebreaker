export type RuntimeMetrics = {
  sampleWindowMs: number
  frameMs: number
  fps: number
  physicsHz: number
  tickDelta: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  pixelRatio: number
  objectCount: number
}

type RuntimeMetricWindow = {
  elapsedMs: number
  frameCount: number
  tickDelta: number
  drawCalls: number
  triangles: number
  geometries: number
  textures: number
  pixelRatio: number
  objectCount: number
}

export function summarizeRuntimeWindow(window: RuntimeMetricWindow): RuntimeMetrics {
  const elapsedMs = Math.max(window.elapsedMs, 1)
  const frameCount = Math.max(window.frameCount, 1)
  const seconds = elapsedMs / 1000
  return {
    sampleWindowMs: elapsedMs,
    frameMs: elapsedMs / frameCount,
    fps: frameCount / seconds,
    physicsHz: Math.max(window.tickDelta, 0) / seconds,
    tickDelta: Math.max(window.tickDelta, 0),
    drawCalls: Math.max(window.drawCalls, 0),
    triangles: Math.max(window.triangles, 0),
    geometries: Math.max(window.geometries, 0),
    textures: Math.max(window.textures, 0),
    pixelRatio: Math.max(window.pixelRatio, 0),
    objectCount: Math.max(window.objectCount, 0),
  }
}
