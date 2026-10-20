import fs from 'node:fs/promises'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadProjectEnv } from '../server/env.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = loadProjectEnv(root), args = process.argv.slice(2), portIndex = args.indexOf('--port')
const port = Number(portIndex >= 0 ? args[portIndex + 1] : env.PORT || 5174)
const address = `http://127.0.0.1:${port}/`
function openPage() {
  if (args.includes('--no-open')) return
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const commandArgs = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', address] : [address]
  const browser = spawn(command, commandArgs, { stdio: 'ignore', windowsHide: true })
  browser.on('error', () => {});browser.unref()
}
async function run() {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  const runtime = metadata.reflectiveJourney?.distribution === 'runtime'
  if (args.includes('--help')) {
    console.log('双击「启动项目.bat」或运行 npm start。可用 --no-open 禁止自动打开页面，--port 5177 指定本机端口。')
    return
  }
  if (runtime) console.log('当前是已构建的 Windows 运行版，正在启动本地应用，无需安装依赖或重新构建。')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('本地端口需要是 1 至 65535 的整数。')
  await fs.access(path.join(root, 'dist', 'index.html')).catch(() => {
    throw new Error(runtime ? '运行包缺少构建文件。请重新完整解压 Windows 运行版，不要在这里执行构建命令。' : '没有找到构建文件，请先运行 npm ci 和 npm run build。')
  })
  const available = await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (error) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
  if (!available) {
    const health = await fetch(address + 'api/health', { signal: AbortSignal.timeout(1200) }).then((response) => response.ok ? response.json() : null).catch(() => null)
    if (health?.ok === true && health.service === 'reflective-journey' && health.database === 'ready') {
      console.log(`发现已有反思之旅 V${health.version} 服务：${address}`)
      console.log('本次打开已有服务，没有启动当前目录的新副本。若需要独立运行当前副本，可使用「启动项目.bat --port 5177」。')
      console.log('建议继续使用原地址和浏览器；不同端口的个人记录分别保存。')
      openPage();return
    }
    throw new Error(`端口 ${port} 被其他程序占用。请关闭该程序，或使用「启动项目.bat --port 5177」。`)
  }
  const child = spawn(process.execPath, ['server/serve.mjs', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: 'inherit', windowsHide: true })
  const stop = () => { if (!child.killed) child.kill('SIGTERM') }
  process.once('SIGINT', stop);process.once('SIGTERM', stop)
  child.once('error', (error) => { console.error('启动失败：' + error.message);process.exitCode = 1 })
  child.once('exit', (code) => { process.exitCode = code || 0 })
  for (let attempt = 0; attempt < 20 && child.exitCode === null; attempt++) {
    const ready = await fetch(address + 'api/health', { signal: AbortSignal.timeout(800) }).then((response) => response.ok).catch(() => false)
    if (ready) {
      console.log(`打开 ${address} 即可使用。关闭此窗口或按 Ctrl+C 停止服务。`)
      openPage();return
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (child.exitCode === null) { stop();throw new Error('服务未能就绪，请查看上方提示后重试。') }
}
try {
  await run()
} catch (error) { console.error(error.message);process.exitCode = 1 }
