import RAPIER from '@dimforge/rapier3d-compat'
import { SceneSchema, validateLaw } from './domain'

const ready = RAPIER.init()

export async function createSimulation(value: unknown) {
  const scene = SceneSchema.parse(value)
  await ready
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = 1 / 60
  const bodies = new Map<string, RAPIER.RigidBody>()
  world.createCollider(RAPIER.ColliderDesc.cuboid(8, 0.1, 8))
  world.createCollider(RAPIER.ColliderDesc.cuboid(8, 0.1, 8).setTranslation(0, 10, 0))
  for (const object of scene.objects) {
    const [x, y, z] = object.position
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).setCanSleep(false))
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.4).setRestitution(0.35), body)
    bodies.set(object.id, body)
  }
  return {
    scene,
    bodies,
    step: () => world.step(),
    apply: (value: unknown) => {
      const law = validateLaw(scene, value)
      const selected = law.targets.map(target => {
        const body = bodies.get(target)
        if (!body) throw new Error('missing physics body')
        return body
      })
      for (const body of selected) body.setGravityScale(law.scale, true)
    },
    dispose: () => world.free(),
  }
}
