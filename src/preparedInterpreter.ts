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

const collisionWords = /\b(?:collisions?|impacts?|hits?|crashes?|contacts?)\b/
const soundWords = /\b(?:notes?|sounds?|tones?|music|play)\b/
const upwardWords = /\b(?:upwards?|up|rise|rising|float|reverse gravity|invert gravity)\b/
const ordinaryWords = /\b(?:ordinary|normal|restore gravity|downwards?)\b/
const freezeWords = /\b(?:freeze|hold|stop|pause)\b/

export function interpretPreparedPrompt(prompt: string, value: unknown, selectedId?: string | null): PreparedInterpretation {
  const scene = SceneSchema.parse(value)
  const normalized = prompt.trim().toLowerCase().replace(/[.,!?]/g, ' ')
  if (normalized.length < 3) throw new PreparedInterpreterError('Describe a law first.')
  if (normalized.length > 500) throw new PreparedInterpreterError('Keep the law prompt under 500 characters.')
  if (/\b(?:do not|don't|never|not)\b/.test(normalized)) throw new PreparedInterpreterError('Prepared mode needs a direct request. Describe the one change you want to make.')
  const categories = [collisionWords.test(normalized) && soundWords.test(normalized), freezeWords.test(normalized), /\bblue\b/.test(normalized) && (upwardWords.test(normalized) || ordinaryWords.test(normalized))]
  if (categories.filter(Boolean).length > 1) throw new PreparedInterpreterError('Apply one law at a time, then compose it with another. Which change should happen first?')
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
  if (/\bblue\b/.test(normalized) && (upwardWords.test(normalized) || ordinaryWords.test(normalized))) {
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
