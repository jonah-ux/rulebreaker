import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleInterpret } from '../server/api.js'

export default function interpret(request: IncomingMessage, response: ServerResponse) {
  return handleInterpret(request, response)
}
