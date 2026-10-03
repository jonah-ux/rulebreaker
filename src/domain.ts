import { z } from 'zod'

const id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
const coordinate = z.number().finite().min(-16).max(16)
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

const CollisionNoteLawSchema = z.object({
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

export type Scene = z.infer<typeof SceneSchema>
export type Law = z.infer<typeof LawSchema>

export function validateLaw(scene: Scene, value: unknown): Law {
  const law = LawSchema.parse(value)
  const ids = new Set(scene.objects.map(object => object.id))
  if (law.targets.some(target => !ids.has(target))) throw new Error('law refers to an unknown object')
  return law
}
