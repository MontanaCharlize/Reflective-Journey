import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { localGuestAiAllowed } from '../server/ai-access.mjs'
import { createApplication } from '../server/application.mjs'

test('本机访客许可同时校验地址、Host、Origin 和配置，转发头不能伪造', () => {
  const request = (address = '127.0.0.1', host = '127.0.0.1:5174', origin = 'http://127.0.0.1:5174') => ({ socket: { remoteAddress: address }, headers: { host, origin } })
  assert.equal(localGuestAiAllowed(request(), {}), true)
  assert.equal(localGuestAiAllowed(request('203.0.113.8'), {}), false)
  assert.equal(localGuestAiAllowed(request('127.0.0.1', 'example.com', 'https://example.com'), {}), false)
  assert.equal(localGuestAiAllowed(request('127.0.0.1', '127.0.0.1.example.com', 'https://127.0.0.1.example.com'), {}), false)
  assert.equal(localGuestAiAllowed(request(), { APP_ORIGIN: 'https://example.com' }), false)
  assert.equal(localGuestAiAllowed(request(), { AI_ALLOW_LOCAL_GUEST: 'false' }), false)
  assert.equal(localGuestAiAllowed(request('::1', '[::1]:5174', 'http://[::1]:5174'), {}), true)
  const proxied = request(); proxied.headers['x-forwarded-for'] = '203.0.113.8'
  assert.equal(localGuestAiAllowed(proxied, {}), false)
})

test('本机访客能调用已配置模型且受限额约束，公网 Host 仍须登录', async () => {
  let calls = 0
  const fake = http.createServer(async (req, res) => { for await (const _ of req) {}; calls++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })) })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const app = createApplication({ dbPath: ':memory:', env: { DEEPSEEK_API_KEY: 'fake-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + fake.address().port, AI_MINUTE_LIMIT: '2', AI_GLOBAL_DAILY_LIMIT: '2' } })
  const server = http.createServer((req, res) => app.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  const post = async (headers = {}) => { const response = await fetch(base + '/api/ai/check', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, ...headers }, body: '{}' }); return { status: response.status, data: await response.json() } }
  try {
    const metadata = await (await fetch(base + '/api/ai/providers')).json()
    assert.equal(metadata.access.localGuest, true)
    assert.equal(metadata.localFallback, false)
    assert.equal(metadata.planning, 'ai-participatory')
    const publicStatus = await new Promise((resolve, reject) => { const request = http.request(base + '/api/ai/check', { method: 'POST', headers: { Host: 'example.test', Origin: 'http://example.test', 'Content-Type': 'application/json' } }, (response) => { response.resume(); resolve(response.statusCode) }); request.on('error', reject); request.end('{}') })
    assert.equal(publicStatus, 401)
    assert.equal((await post({ 'X-RJ-User': 'expired-owner' })).status, 401)
    assert.equal((await post()).data.ok, true)
    assert.equal((await post()).data.ok, true)
    assert.equal((await post()).status, 429)
    assert.equal(calls, 2)
  } finally { for (const item of [server, fake]) { item.closeAllConnections(); await new Promise((resolve) => item.close(resolve)) }; app.close() }
})
