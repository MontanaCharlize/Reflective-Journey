import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createApplication } from './server/application.mjs'
import { loadProjectEnv } from './server/env.mjs'

function applicationApiPlugin() {
  const install = (server) => {
    const app = createApplication({ env: loadProjectEnv(process.cwd()) })
    server.httpServer?.once('close', () => app.close())
    server.middlewares.use((req, res, next) => {
      app.handle(req, res).then((handled) => { if (!handled && !res.writableEnded) next() }).catch(next)
    })
  }
  return {
    name: 'reflective-journey-application-api',
    configureServer: install,
    configurePreviewServer: install,
  }
}

export default defineConfig({
  plugins: [react(), applicationApiPlugin()],
})
