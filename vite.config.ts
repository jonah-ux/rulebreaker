import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { handleCapabilities, handleHealth, handleInterpret } from './server/api.js'

type Environment = Record<string, string | undefined>

function liveAiApi(environment: Environment): Plugin {
  return {
    name: 'rulebreaker-live-ai-api',
    configureServer(server) {
      server.middlewares.use('/api/interpret', (request, response) => {
        void handleInterpret(request, response, environment)
      })
      server.middlewares.use('/api/capabilities', (request, response) => {
        handleCapabilities(request, response, environment)
      })
      server.middlewares.use('/api/health', (request, response) => {
        handleHealth(request, response, environment)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const environment = { ...process.env, ...loadEnv(mode, process.cwd(), 'RULEBREAKER_') }
  return {
    plugins: [react(), liveAiApi(environment)],
  }
})
