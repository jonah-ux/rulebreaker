import { z } from 'zod'

const id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)
const coordinate = z.number().finite().min(-16).max(16)

export const SceneSchema = z.object({
  schema: z.literal('rulebreaker/scene/v1'),
  objects: z.array(z.object({
    id,
    color: z.enum(['blue', 'red', 'gold']),
    position: z.tuple([coordinate, coordinate, coordinate]),
  }).strict()).min(1).max(24),
}).strict().refine(scene => new Set(scene.objects.map(object => object.id)).size === scene.objects.length, 'object ids must be unique')

export const LawSchema = z.object({
  schema: z.literal('rulebreaker/law/v1'),
  operation: z.literal('set-gravity-scale'),
  targets: z.array(id).min(1).max(24),
  scale: z.number().finite().min(-2).max(2),
}).strict().refine(law => new Set(law.targets).size === law.targets.length, 'targets must be unique')

export type Scene = z.infer<typeof SceneSchema>
export type Law = z.infer<typeof LawSchema>

export function validateLaw(scene: Scene, value: unknown): Law {
  const law = LawSchema.parse(value)
  const ids = new Set(scene.objects.map(object => object.id))
  if (law.targets.some(target => !ids.has(target))) throw new Error('law refers to an unknown object')
  return law
}
