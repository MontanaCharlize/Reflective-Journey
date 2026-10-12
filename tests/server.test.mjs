import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createAiHandler } from '../server/ai-handler.mjs'
import { callJsonModel } from '../server/providers.mjs'
import { loadTs } from './load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts')
let fake, api, providerBase, apiBase
let modelOutput = {}, holdRequest = false, entered, disconnected
before(async () => {
  fake = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* 接收请求，完全在本机模拟模型。 */ }
    if (holdRequest) {
      res.once('close', () => disconnected?.())
      entered?.()
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelOutput), reasoning_content: '这个字段不应进入产品数据' } }] }))
  })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  providerBase = 'http://127.0.0.1:' + fake.address().port
  const handler = createAiHandler({ DEEPSEEK_API_KEY: 'local-test-key', DEEPSEEK_BASE_URL: providerBase, DEEPSEEK_MODEL: 'test-model' })
  api = http.createServer((req, res) => {
    handler(req, res, new URL(req.url, 'http://localhost').pathname).then((handled) => { if (!handled) { res.statusCode = 404; res.end() } }).catch((error) => { res.statusCode = 500; res.end(error.message) })
  })
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve))
  apiBase = 'http://127.0.0.1:' + api.address().port
})
after(async () => {
  for (const server of [api, fake]) {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})
const post = async (route, body) => {
  const response = await fetch(apiBase + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return response.json()
}

test('Provider 元信息不包含密钥', async () => {
  const response = await fetch(apiBase + '/api/ai/providers')
  const raw = await response.text()
  assert.ok(!raw.includes('local-test-key'))
  assert.equal(JSON.parse(raw).activeProvider, 'deepseek')
})

test('只有引用本轮真实表达的动作完成记录才被接受', async () => {
  const { session, userItem } = engine.appendUserTrace(engine.createSession('AI 会不会影响学习？'), '我觉得会，因为练习可能减少。')
  modelOutput = {
    currentPosition: userItem.content, observations: ['你提供了一个理由。'],
    completedMoves: ['synthesize'],
    completedMoveEvidence: [{ move: 'state_position', excerpt: '我觉得会' }, { move: 'synthesize', excerpt: '我已经全部想清楚' }, { move: 'made_up_move', excerpt: '我觉得会' }],
  }
  const result = await post('/api/ai/analyze', { session, responseId: userItem.id })
  assert.equal(result.ok, true)
  assert.deepEqual(result.analysis.stateAfter.completedMoves, ['state_position'])
  assert.equal(result.analysis.completedMoveEvidence.length, 1)
  assert.ok(!JSON.stringify(result).includes('这个字段不应进入产品数据'))
})



test('模型回答局部动作时不能覆盖原问题的 currentPosition', async () => {
  let session = engine.appendUserResponse(engine.createSession('AI 会不会影响学习？'), '我觉得会，因为独立练习可能减少。')
  const previousPosition = session.cognitiveState.currentPosition
  const appended = engine.appendUserTrace(session, '通过跳过自己的尝试，使得练习量变少。')
  modelOutput = {
    currentPosition: '通过跳过自己的尝试，使得练习量变少。',
    observations: ['你补充了一个机制。'],
    completedMoveEvidence: [{ move: 'specify_mechanism', excerpt: '通过跳过自己的尝试' }],
  }
  const result = await post('/api/ai/analyze', { session: appended.session, responseId: appended.userItem.id })
  assert.equal(result.ok, true)
  assert.equal(result.analysis.stateAfter.currentPosition, previousPosition)
  assert.ok(result.analysis.stateAfter.completedMoves.includes('specify_mechanism'))
})

test('模型判定卡住时，不接受新的完成动作', async () => {
  const { session, userItem } = engine.appendUserTrace(engine.createSession('AI 会不会影响学习？'), '我不知道如何说明这个观点。')
  modelOutput = { engagement: 'stuck', completedMoveEvidence: [{ move: 'state_position', excerpt: '我不知道如何说明' }] }
  const result = await post('/api/ai/analyze', { session, responseId: userItem.id })
  assert.deepEqual(result.analysis.stateAfter.completedMoves, [])
  assert.equal(result.analysis.engagement, 'stuck')
})

test('多个问题或问题清单不能直接展示给用户', async () => {
  const session = engine.createSessionBase('AI 会不会影响学习？')
  for (const question of ['你怎么看？为什么？', '请分别回答：\n1. 观点\n2. 理由']) {
    modelOutput = { question }
    const result = await post('/api/ai/question', { session, move: 'state_position' })
    assert.equal(result.ok, false)
  }
  modelOutput = { question: '你现在更倾向哪一种判断？', contextAnchor: '当前问题' }
  assert.equal((await post('/api/ai/question', { session, move: 'state_position' })).ok, true)
})

test('非法 JSON 及请求类型得到明确错误', async () => {
  for (const body of ['{oops', 'null', '[]']) {
    const response = await fetch(apiBase + '/api/ai/question', { method: 'POST', body })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).code, 'BAD_REQUEST')
  }
})

test('取消 Provider 请求会停止正在等待的连接', { timeout: 5000 }, async () => {
  holdRequest = true
  const received = new Promise((resolve) => { entered = resolve })
  const closed = new Promise((resolve) => { disconnected = resolve })
  const controller = new AbortController()
  const result = callJsonModel({ id: 'fake', label: 'Fake', baseUrl: providerBase, apiKey: 'local-test-key', model: 'fake-model', jsonMode: true }, { system: 'test', user: 'test', signal: controller.signal })
  const rejected = assert.rejects(result, { name: 'AbortError' })
  await received
  controller.abort()
  await rejected
  await closed
  holdRequest = false
})

test('浏览器断开 API 请求也会取消服务端模型请求', { timeout: 5000 }, async () => {
  holdRequest = true
  const received = new Promise((resolve) => { entered = resolve })
  const closed = new Promise((resolve) => { disconnected = resolve })
  const controller = new AbortController()
  const result = fetch(apiBase + '/api/ai/question', { method: 'POST', body: JSON.stringify({ session: engine.createSessionBase('AI 会不会影响学习？'), move: 'state_position' }), signal: controller.signal })
  const rejected = assert.rejects(result, { name: 'AbortError' })
  await received
  controller.abort()
  await rejected
  await closed
  holdRequest = false
})

test('模型不能把“我不知道 + 动作关键词”伪装成动作完成', async () => {
  const { session, userItem } = engine.appendUserTrace(engine.createSession('AI 会不会影响学习？'), '我不知道需要什么证据。')
  modelOutput = {
    engagement: 'engaged',
    observations: ['用户提到了证据。'],
    completedMoveEvidence: [{ move: 'request_evidence', excerpt: '我不知道需要什么证据' }],
  }
  const result = await post('/api/ai/analyze', { session, responseId: userItem.id })
  assert.equal(result.ok, true)
  assert.deepEqual(result.analysis.completedMoveEvidence, [])
  assert.ok(!result.analysis.stateAfter.completedMoves.includes('request_evidence'))
})

test('模型生成与最近追问近似重复的问题时拒绝展示', async () => {
  let session = engine.createSessionBase('我为什么写作时容易走神？')
  session = engine.appendIntervention(session, { move: 'specific_example', content: '最近一次具体发生了什么？', source: 'local' })
  modelOutput = { question: '最近一次具体发生了什么？', contextAnchor: '最近一次经历' }
  const result = await post('/api/ai/question', { session, move: 'specific_example' })
  assert.equal(result.ok, false)
  assert.match(result.message, /重复/)
})

test('不是所有相似主题追问都会被拦截，真正增加思考增量的问题可以通过', async () => {
  let session = engine.createSessionBase('我为什么写作时容易走神？')
  session = engine.appendIntervention(session, { move: 'specific_example', content: '最近一次具体发生了什么？', source: 'local' })
  modelOutput = { question: '那次事情发生时，哪个瞬间最先让你的注意力转走？', contextAnchor: '那次具体经历' }
  const result = await post('/api/ai/question', { session, move: 'identify_trigger' })
  assert.equal(result.ok, true)
  assert.match(result.result.question, /哪个瞬间/)
})

test('“可能不会”作为真实立场时，服务端不会把“不会”误判成无能力回答', async () => {
  const { session, userItem } = engine.appendUserTrace(engine.createSession('AI 会不会影响学习？'), '我觉得可能不会，取决于怎么使用。')
  modelOutput = {
    currentPosition: userItem.content,
    completedMoveEvidence: [{ move: 'state_position', excerpt: '我觉得可能不会' }],
  }
  const result = await post('/api/ai/analyze', { session, responseId: userItem.id })
  assert.equal(result.ok, true)
  assert.ok(result.analysis.stateAfter.completedMoves.includes('state_position'))
  assert.equal(result.analysis.stateAfter.currentPosition, userItem.content)
})
