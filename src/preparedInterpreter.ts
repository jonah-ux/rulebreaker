import { SceneSchema, validateLaw } from './domain'
import type { Law } from './domain'

export type PreparedInterpretation = {
  mode: 'prepared'
  interpretation: string
  law: Law
}

export class PreparedInterpreterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PreparedInterpreterError'
  }
}

const collisionWords = /collision|impact|hit|crash|contact/
const soundWords = /note|sound|tone|music|play/
const upwardWords = /upward|up|rise|rising|float|reverse gravity|invert gravity/
const ordinaryWords = /ordinary|normal|restore gravity|downward/
const freezeWords = /freeze|hold|stop|pause/

export function interpretPreparedPrompt(prompt: string, value: unknown, selectedId?: string | null): PreparedInterpretation {
  const scene = SceneSchema.parse(value)
  const normalized = prompt.trim().toLowerCase().replace(/[.,!?]/g, ' ')
  if (normalized.length < 3) throw new PreparedInterpreterError('Describe a law first.')
  const blueTargets = scene.objects.filter(object => object.color === 'blue').map(object => object.id)
  const allTargets = scene.objects.map(object => object.id)

  if (collisionWords.test(normalized) && soundWords.test(normalized)) {
    const law = validateLaw(scene, {
      schema: 'rulebreaker/law/v1',
      operation: 'collision-note',
      targets: allTargets,
      threshold: 1.2,
      cooldownTicks: 24,
      maxVoices: 4,
    })
    return { mode: 'prepared', interpretation: 'Meaningful impacts become short notes. The room uses a 1.2 m/s threshold, 24-tick pair cooldown, and four-voice cap.', law }
  }
  if (freezeWords.test(normalized)) {
    if (!selectedId) throw new PreparedInterpreterError('Select an object first, then ask to freeze it for three seconds.')
    const law = validateLaw(scene, {
      schema: 'rulebreaker/law/v1',
      operation: 'temporary-freeze',
      targets: [selectedId],
      durationTicks: 180,
    })
    return { mode: 'prepared', interpretation: `Freeze ${selectedId} for 180 simulation ticks, then restore dynamic motion.`, law }
  }
  if (normalized.includes('blue') && (upwardWords.test(normalized) || ordinaryWords.test(normalized))) {
    const scale = ordinaryWords.test(normalized) && !upwardWords.test(normalized) ? 1 : -1
    const law = validateLaw(scene, {
      schema: 'rulebreaker/law/v1',
      operation: 'set-gravity-scale',
      targets: blueTargets,
      scale,
    })
    return { mode: 'prepared', interpretation: scale < 0 ? 'Blue prisms fall upward while red and gold remain ordinary.' : 'Blue prisms return to ordinary downward gravity.', law }
  }
  throw new PreparedInterpreterError('Try “blue objects fall upward”, “every collision plays a note”, or “freeze the selected object”.')
}
