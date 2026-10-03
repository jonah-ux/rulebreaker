import RAPIER from '@dimforge/rapier3d-compat'
import { SceneSchema, validateLaw } from './domain'
import type { Law } from './domain'

const ready = RAPIER.init()

export type SimulationEvent =
  | { type: 'collision-note'; tick: number; first: string; second: string; impact: number; frequency: number }
  | { type: 'freeze-applied'; target: string; expiresAtTick: number }
  | { type: 'freeze-expired'; target: string }

type CollisionNoteLaw = Extract<Law, { operation: 'collision-note' }>
type FreezeState = { expiresAtTick: number }

function pairKey(first: string, second: string) {
  return [first, second].sort().join('|')
}

export async function createSimulation(value: unknown) {
  const scene = SceneSchema.parse(value)
  await ready
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = 1 / 60
  const eventQueue = new RAPIER.EventQueue(true)
  const bodies = new Map<string, RAPIER.RigidBody>()
  const colliders = new Map<string, RAPIER.Collider>()
  const colliderObjects = new Map<number, string>()
  const eventCollider = () => RAPIER.ColliderDesc.cuboid(8, 0.1, 8).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
  world.createCollider(eventCollider())
  world.createCollider(eventCollider().setTranslation(0, 10, 0))
  for (const object of scene.objects) {
    const [x, y, z] = object.position
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(false))
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4)
      .setRestitution(0.35)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS), body)
    bodies.set(object.id, body)
    colliders.set(object.id, collider)
    colliderObjects.set(collider.handle, object.id)
  }
  let tick = 0
  let noteSequence = 0
  let collisionNoteLaw: CollisionNoteLaw | null = null
  const lastNoteTicks = new Map<string, number>()
  const frozen = new Map<string, FreezeState>()
  const pendingEvents: SimulationEvent[] = []

  const emit = (event: SimulationEvent) => {
    pendingEvents.push(event)
    if (pendingEvents.length > 64) pendingEvents.shift()
  }

  const impactSpeed = (first: string | undefined, second: string | undefined) => {
    const firstBody = first ? bodies.get(first) : undefined
    const secondBody = second ? bodies.get(second) : undefined
    const firstVelocity = firstBody?.linvel() ?? { x: 0, y: 0, z: 0 }
    const secondVelocity = secondBody?.linvel() ?? { x: 0, y: 0, z: 0 }
    const x = firstVelocity.x - secondVelocity.x
    const y = firstVelocity.y - secondVelocity.y
    const z = firstVelocity.z - secondVelocity.z
    return Math.sqrt(x * x + y * y + z * z)
  }

  const drainCollisionEvents = () => {
    eventQueue.drainCollisionEvents((firstHandle, secondHandle, started) => {
      if (!started || !collisionNoteLaw) return
      const first = colliderObjects.get(firstHandle)
      const second = colliderObjects.get(secondHandle)
      const firstTargeted = first ? collisionNoteLaw.targets.includes(first) : false
      const secondTargeted = second ? collisionNoteLaw.targets.includes(second) : false
      if (!firstTargeted && !secondTargeted) return
      const firstId = first ?? 'room'
      const secondId = second ?? 'room'
      const impact = impactSpeed(first, second)
      if (impact < collisionNoteLaw.threshold) return
      const key = pairKey(firstId, secondId)
      const lastTick = lastNoteTicks.get(key)
      if (lastTick !== undefined && tick - lastTick < collisionNoteLaw.cooldownTicks) return
      lastNoteTicks.set(key, tick)
      emit({
        type: 'collision-note',
        tick,
        first: firstId,
        second: secondId,
        impact,
        frequency: 220 + (noteSequence++ % 8) * 55,
      })
    })
  }

  const expireFreezes = () => {
    for (const [target, state] of frozen) {
      if (tick < state.expiresAtTick) continue
      const body = bodies.get(target)
      if (body) {
        body.setEnabledTranslations(true, true, true, true)
        body.setEnabledRotations(true, true, true, true)
        body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      }
      frozen.delete(target)
      emit({ type: 'freeze-expired', target })
    }
  }

  return {
    scene,
    bodies,
    colliders,
    get tick() { return tick },
    get activeCollisionNoteLaw() { return collisionNoteLaw },
    get frozenTargets() { return new Map(frozen) },
    clearCollisionNoteLaw: () => { collisionNoteLaw = null },
    step: () => {
      world.step(eventQueue)
      tick += 1
      drainCollisionEvents()
      expireFreezes()
      const events = pendingEvents.splice(0)
      return events
    },
    apply: (value: unknown) => {
      const law = validateLaw(scene, value)
      const selected = law.targets.map(target => {
        const body = bodies.get(target)
        if (!body) throw new Error('missing physics body')
        return body
      })
      if (law.operation === 'set-gravity-scale') {
        for (const body of selected) body.setGravityScale(law.scale, true)
      } else if (law.operation === 'collision-note') {
        collisionNoteLaw = law
      } else {
        for (const [index, body] of selected.entries()) {
          const target = law.targets[index]
          const existing = frozen.get(target)
          const expiresAtTick = Math.max(existing?.expiresAtTick ?? 0, tick + law.durationTicks)
          body.setLinvel({ x: 0, y: 0, z: 0 }, true)
          body.setAngvel({ x: 0, y: 0, z: 0 }, true)
          body.setEnabledTranslations(false, false, false, true)
          body.setEnabledRotations(false, false, false, true)
          frozen.set(target, { expiresAtTick })
          emit({ type: 'freeze-applied', target, expiresAtTick })
        }
      }
      return pendingEvents.splice(0)
    },
    dispose: () => { eventQueue.free(); world.free() },
  }
}
