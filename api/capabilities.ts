import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleCapabilities } from '../server/api.js'

export default function capabilities(request: IncomingMessage, response: ServerResponse) {
  return handleCapabilities(request, response)
}
