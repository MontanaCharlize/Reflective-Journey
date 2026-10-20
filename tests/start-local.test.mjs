import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)

async function fixture(t, build = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rj-start-'))
  t.after(async () => {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    await fs.rm(root, { recursive: true, force: true })
  })
  await fs.mkdir(path.join(root, 'scripts'));await fs.mkdir(path.join(root, 'server'))
  await fs.copyFile(new URL('../scripts/start-local.mjs', import.meta.url), path.join(root, 'scripts/start-local.mjs'))
  await fs.copyFile(new URL('../server/env.mjs', import.meta.url), path.join(root, 'server/env.mjs'))
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ type: 'module', version: '0.9.1', reflectiveJourney: { distribution: 'runtime' } }))
  if (build) { await fs.mkdir(path.join(root, 'dist'));await fs.writeFile(path.join(root, 'dist/index.html'), '<html>fixture</html>') }
  return root
}
async function listen(t, body) {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' });res.end(JSON.stringify(body)) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => { server.closeAllConnections();server.close(resolve) }))
  return server.address().port
}
async function run(root, port) {
  return execute(process.execPath, ['scripts/start-local.mjs', '--no-open', '--port', String(port)], { cwd: root, timeout: 5000 })
}
test('重复启动识别已就绪服务并给出原地址，不启动另一份服务或漂移端口', async (t) => {
  const root = await fixture(t), port = await listen(t, { ok: true, service: 'reflective-journey', version: '0.9.0', database: 'ready' })
  const result = await run(root, port)
  assert.match(result.stdout, /发现已有反思之旅 V0\.9\.0/)
  assert.ok(result.stdout.includes(`http://127.0.0.1:${port}/`))
  assert.match(result.stdout, /没有启动当前目录的新副本/)
  assert.equal(result.stderr, '')
})
test('其他程序占用端口时明确失败，不把任意健康接口当成反思之旅', async (t) => {
  const root = await fixture(t), port = await listen(t, { ok: true, service: 'unrelated-app', database: 'ready' })
  const result = await run(root, port).then(() => null, (error) => error)
  assert.equal(result?.code, 1);assert.match(result.stderr, /被其他程序占用/)
})
test('运行包缺少构建文件时要求重新解压，不建议安装和构建源码', async (t) => {
  const result = await run(await fixture(t, false), 5174).then(() => null, (error) => error)
  assert.equal(result?.code, 1);assert.match(result.stderr, /重新完整解压/)
  assert.doesNotMatch(result.stderr, /npm install|npm ci|tsc/)
})
