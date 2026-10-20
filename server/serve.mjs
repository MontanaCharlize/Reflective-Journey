import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApplication } from './application.mjs'
import { loadProjectEnv } from './env.mjs'
import { APPLICATION_VERSION } from './version.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = loadProjectEnv(root)
const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined }
const host = option('--host') || env.HOST || '127.0.0.1'
const port = Number(option('--port') || env.PORT || 4173)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效')
const dist = path.join(root, 'dist')
await fs.access(path.join(dist, 'index.html'))
const app = createApplication({ env, root })
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }
const server = http.createServer(async (req, res) => {
  try {
    if (await app.handle(req, res)) return
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return }
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
    const filename = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname))
    if (!filename.startsWith(dist + path.sep)) { res.writeHead(403); res.end(); return }
    let target = filename
    try { const info = await fs.stat(target); if (!info.isFile()) target = path.join(dist, 'index.html') }
    catch { if (path.extname(pathname)) { res.writeHead(404); res.end(); return } target = path.join(dist, 'index.html') }
    res.setHeader('Content-Type', types[path.extname(target)] || 'application/octet-stream')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'same-origin')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Cache-Control', path.extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600')
    if (req.method === 'HEAD') res.end()
    else res.end(await fs.readFile(target))
  } catch { if (!res.writableEnded) { res.writeHead(500); res.end('Service unavailable') } }
})
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `地址 ${host}:${port} 已在使用，请关闭先前启动的服务或更换端口。` : `服务启动失败：${error.message}`)
  app.close(); process.exitCode = 1
})
server.listen(port, host, () => console.log(`反思之旅 V${APPLICATION_VERSION}: http://${host}:${port}/`))
let stopping = false
const stop = () => {
  if (stopping) return
  stopping = true
  server.closeAllConnections()
  server.close(() => { app.close(); process.exit(0) })
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
