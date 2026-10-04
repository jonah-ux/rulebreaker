import { z } from 'zod'

const id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
const coordinate = z.number().finite().min(-16).max(16)
const finiteVectorComponent = z.number().finite().min(-100).max(100)
const vector3 = z.tuple([finiteVectorComponent, finiteVectorComponent, finiteVectorComponent])
const quaternion = z.tuple([finiteVectorComponent, finiteVectorComponent, finiteVectorComponent, finiteVectorComponent])
  .refine(values => Math.abs(Math.hypot(...values) - 1) < 0.001, 'rotation must be a unit quaternion')
const targets = z.array(id).min(1).max(24).refine(values => new Set(values).size === values.length, 'law targets must be unique')

export const SceneSchema = z.object({
  schema: z.literal('rulebreaker/scene/v1'),
  objects: z.array(z.object({
    id,
    color: z.enum(['blue', 'red', 'gold']),
    position: z.tuple([coordinate, coordinate, coordinate]),
  }).strict()).min(1).max(24),
}).strict().refine(scene => new Set(scene.objects.map(object => object.id)).size === scene.objects.length, 'object ids must be unique')

const GravityLawSchema = z.object({
  schema: z.literal('rulebreaker/law/v1'),
  operation: z.literal('set-gravity-scale'),
  targets,
  scale: z.number().finite().min(-2).max(2),
}).strict().refine(law => new Set(law.targets).size === law.targets.length, 'targets must be unique')

export const CollisionNoteLawSchema = z.object({
  schema: z.literal('rulebreaker/law/v1'),
  operation: z.literal('collision-note'),
  targets,
  threshold: z.number().finite().min(0.1).max(40),
  cooldownTicks: z.number().int().min(1).max(600),
  maxVoices: z.number().int().min(1).max(16),
}).strict()

const TemporaryFreezeLawSchema = z.object({
  schema: z.literal('rulebreaker/law/v1'),
  operation: z.literal('temporary-freeze'),
  targets,
  durationTicks: z.number().int().min(1).max(600),
}).strict()

export const LawSchema = z.discriminatedUnion('operation', [
  GravityLawSchema,
  CollisionNoteLawSchema,
  TemporaryFreezeLawSchema,
])

export const SimulationEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('collision-note'),
    tick: z.number().int().min(0),
    first: z.string().min(1).max(40),
    second: z.string().min(1).max(40),
    impact: z.number().finite().min(0).max(100),
    frequency: z.number().finite().min(20).max(20000),
    maxVoices: z.number().int().min(1).max(16).optional(),
  }).strict(),
  z.object({
    type: z.literal('freeze-applied'),
    target: id,
    expiresAtTick: z.number().int().min(0),
  }).strict(),
  z.object({
    type: z.literal('freeze-expired'),
    target: id,
  }).strict(),
])

export const ExperimentSchema = z.object({
  schema: z.literal('rulebreaker/experiment/v1'),
  engine: z.literal('rulebreaker/engine/v1'),
  scene: SceneSchema,
  tick: z.number().int().min(0).max(60 * 60 * 24 * 365),
  bodies: z.array(z.object({
    id,
    position: vector3,
    rotation: quaternion,
    linearVelocity: vector3,
    angularVelocity: vector3,
    gravityScale: z.number().finite().min(-2).max(2),
    frozenUntilTick: z.number().int().min(0).nullable(),
  }).strict()).min(1).max(24),
  collisionNoteLaw: CollisionNoteLawSchema.nullable(),
  pendingEvents: z.array(SimulationEventSchema).max(64),
  noteCooldowns: z.array(z.tuple([z.string().min(1).max(80), z.number().int().min(0)])).max(256),
  noteSequence: z.number().int().min(0).max(1000000),
  selectedId: id.nullable(),
}).strict()

export type Scene = z.infer<typeof SceneSchema>
export type Law = z.infer<typeof LawSchema>
export type SimulationEvent = z.infer<typeof SimulationEventSchema>
export type Experiment = z.infer<typeof ExperimentSchema>

export function validateLaw(scene: Scene, value: unknown): Law {
  const law = LawSchema.parse(value)
  const ids = new Set(scene.objects.map(object => object.id))
  if (law.targets.some(target => !ids.has(target))) throw new Error('law refers to an unknown object')
  return law
}

export function validateExperiment(scene: Scene, value: unknown): Experiment {
  const experiment = ExperimentSchema.parse(value)
  const expectedIds = new Set(scene.objects.map(object => object.id))
  const actualIds = new Set(experiment.bodies.map(body => body.id))
  if (JSON.stringify(experiment.scene) !== JSON.stringify(scene)) throw new Error('experiment scene does not match the current room')
  if (actualIds.size !== experiment.bodies.length || actualIds.size !== expectedIds.size || [...expectedIds].some(id => !actualIds.has(id))) throw new Error('experiment body identities do not match the current room')
  if (experiment.selectedId && !expectedIds.has(experiment.selectedId)) throw new Error('experiment selection refers to an unknown object')
  if (experiment.bodies.some(body => body.frozenUntilTick !== null && body.frozenUntilTick <= experiment.tick)) throw new Error('experiment contains an expired freeze')
  if (experiment.bodies.some(body => body.frozenUntilTick !== null && body.frozenUntilTick > experiment.tick + 600)) throw new Error('experiment freeze exceeds the 600-tick limit')
  if (experiment.collisionNoteLaw) validateLaw(scene, experiment.collisionNoteLaw)
  if (experiment.pendingEvents.some(event => event.type === 'collision-note' && ((event.first !== 'room' && !expectedIds.has(event.first)) || (event.second !== 'room' && !expectedIds.has(event.second))))) throw new Error('experiment event refers to an unknown object')
  if (experiment.pendingEvents.some(event => event.type !== 'collision-note' && !expectedIds.has(event.target))) throw new Error('experiment freeze event refers to an unknown object')
  if (experiment.pendingEvents.some(event => event.type === 'collision-note' && event.tick > experiment.tick)) throw new Error('experiment event is ahead of the simulation clock')
  const validPair = (key: string) => {
    const ids = key.split('|')
    return ids.length === 2 && ids[0] !== ids[1] && ids.every(id => id === 'room' || expectedIds.has(id)) && [...ids].sort().join('|') === key
  }
  if (new Set(experiment.noteCooldowns.map(([key]) => key)).size !== experiment.noteCooldowns.length || experiment.noteCooldowns.some(([key, tick]) => !validPair(key) || tick > experiment.tick)) throw new Error('experiment collision cooldowns are invalid')
  return experiment
}
