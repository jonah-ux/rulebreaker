import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { LiveProviderError, interpretLaw, readJsonBody } from './server/ai.js'

function liveAiApi(): Plugin {
  return {
    name: 'rulebreaker-live-ai-api',
    configureServer(server) {
      server.middlewares.use('/api/interpret', async (request, response, next) => {
        if (request.method === 'OPTIONS') {
          response.statusCode = 204
          response.end()
          return
        }
        if (request.method !== 'POST') {
          next()
          return
        }
        try {
          const proposal = await interpretLaw(await readJsonBody(request))
          response.statusCode = 200
          response.setHeader('content-type', 'application/json')
          response.setHeader('cache-control', 'no-store')
          response.end(JSON.stringify(proposal))
        } catch (error) {
          response.statusCode = error instanceof LiveProviderError ? 502 : 400
          response.setHeader('content-type', 'application/json')
          response.setHeader('cache-control', 'no-store')
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : 'live interpretation failed' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), liveAiApi()],
})
