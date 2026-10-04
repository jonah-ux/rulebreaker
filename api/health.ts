import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleHealth } from '../server/api.js'

export default function health(request: IncomingMessage, response: ServerResponse) {
  return handleHealth(request, response)
}
