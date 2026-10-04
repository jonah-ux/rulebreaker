import RAPIER from '@dimforge/rapier3d-compat'
import { SceneSchema, validateExperiment, validateLaw } from './domain'
import type { Experiment, Law, SimulationEvent } from './domain'

const ready = RAPIER.init()

type CollisionNoteLaw = Extract<Law, { operation: 'collision-note' }>
type FreezeState = { expiresAtTick: number }

export type { SimulationEvent } from './domain'

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
  let restoredPendingCount = 0

  const emit = (event: SimulationEvent) => {
    pendingEvents.push(event)
    if (pendingEvents.length > 64) {
      pendingEvents.shift()
      restoredPendingCount = Math.max(0, restoredPendingCount - 1)
    }
  }
  const takeEvents = () => {
    const events = pendingEvents.splice(0).slice(restoredPendingCount)
    restoredPendingCount = 0
    return events
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
        maxVoices: collisionNoteLaw.maxVoices,
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

  const snapshot = (selectedId: string | null = null): Experiment => ({
    schema: 'rulebreaker/experiment/v1',
    engine: 'rulebreaker/engine/v1',
    scene,
    tick,
    bodies: scene.objects.map(object => {
      const body = bodies.get(object.id)!
      const position = body.translation()
      const rotation = body.rotation()
      const linearVelocity = body.linvel()
      const angularVelocity = body.angvel()
      return {
        id: object.id,
        position: [position.x, position.y, position.z],
        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
        linearVelocity: [linearVelocity.x, linearVelocity.y, linearVelocity.z],
        angularVelocity: [angularVelocity.x, angularVelocity.y, angularVelocity.z],
        gravityScale: body.gravityScale(),
        frozenUntilTick: frozen.get(object.id)?.expiresAtTick ?? null,
      }
    }),
    collisionNoteLaw,
    pendingEvents: pendingEvents.slice(),
    noteCooldowns: [...lastNoteTicks.entries()],
    noteSequence,
    selectedId,
  })

  const restore = (value: unknown) => {
    const experiment = validateExperiment(scene, value)
    const restoredBodies = experiment.bodies.map(state => {
      const body = bodies.get(state.id)
      if (!body) throw new Error('experiment refers to a missing physics body')
      return { state, body }
    })
    for (const { state, body } of restoredBodies) {
      body.setTranslation({ x: state.position[0], y: state.position[1], z: state.position[2] }, true)
      body.setRotation({ x: state.rotation[0], y: state.rotation[1], z: state.rotation[2], w: state.rotation[3] }, true)
      body.setLinvel({ x: state.linearVelocity[0], y: state.linearVelocity[1], z: state.linearVelocity[2] }, true)
      body.setAngvel({ x: state.angularVelocity[0], y: state.angularVelocity[1], z: state.angularVelocity[2] }, true)
      body.setGravityScale(state.gravityScale, true)
      const isFrozen = state.frozenUntilTick !== null && state.frozenUntilTick > experiment.tick
      body.setEnabledTranslations(!isFrozen, !isFrozen, !isFrozen, true)
      body.setEnabledRotations(!isFrozen, !isFrozen, !isFrozen, true)
    }
    tick = experiment.tick
    collisionNoteLaw = experiment.collisionNoteLaw
    frozen.clear()
    for (const state of experiment.bodies) {
      if (state.frozenUntilTick !== null && state.frozenUntilTick > tick) frozen.set(state.id, { expiresAtTick: state.frozenUntilTick })
    }
    lastNoteTicks.clear()
    for (const [key, lastTick] of experiment.noteCooldowns) lastNoteTicks.set(key, lastTick)
    noteSequence = experiment.noteSequence
    pendingEvents.splice(0, pendingEvents.length, ...experiment.pendingEvents)
    // Preserve snapshot state, but do not play already-recorded events again.
    restoredPendingCount = pendingEvents.length
    eventQueue.clear()
    world.propagateModifiedBodyPositionsToColliders()
    return experiment
  }

  return {
    scene,
    bodies,
    colliders,
    get tick() { return tick },
    get activeCollisionNoteLaw() { return collisionNoteLaw },
    get frozenTargets() { return new Map(frozen) },
    snapshot,
    restore,
    clearCollisionNoteLaw: () => { collisionNoteLaw = null; lastNoteTicks.clear() },
    step: () => {
      world.step(eventQueue)
      tick += 1
      drainCollisionEvents()
      expireFreezes()
      return takeEvents()
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
        lastNoteTicks.clear()
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
      return takeEvents()
    },
    dispose: () => { eventQueue.free(); world.free() },
  }
}
