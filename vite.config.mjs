import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createAiHandler } from './server/ai-handler.mjs'
import { loadProjectEnv } from './server/env.mjs'

function aiApiPlugin() {
  const env = loadProjectEnv(process.cwd())
  const handler = createAiHandler(env)
  const middleware = async (req, res, next) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname
    if (!pathname.startsWith('/api/ai/')) return next()
    const handled = await handler(req, res, pathname)
    if (!handled && !res.writableEnded) next()
  }

  return {
    name: 'reflective-journey-ai-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => { middleware(req, res, next).catch(next) })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => { middleware(req, res, next).catch(next) })
    },
  }
}

export default defineConfig({
  plugins: [react(), aiApiPlugin()],
})
