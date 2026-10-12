import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createAiHandler } from '../server/ai-handler.mjs'
import { loadTs, memoryStorage } from './load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts')
const ai = await loadTs('src/lib/ai.ts')
const storage = await loadTs('src/lib/storage.ts')
const originalFetch = globalThis.fetch
let server, base
let requests = []
const providerEnv = {}
before(async () => {
  const handler = createAiHandler(providerEnv)
  server = http.createServer((req, res) => {
    handler(req, res, new URL(req.url, 'http://localhost').pathname).then((handled) => { if (!handled) { res.statusCode = 404; res.end() } }).catch((error) => { res.statusCode = 500; res.end(error.message) })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + server.address().port
  globalThis.window = { setTimeout, clearTimeout }
})
beforeEach(() => {
  for (const key of Object.keys(providerEnv)) delete providerEnv[key]
  requests = []
  globalThis.localStorage = memoryStorage()
  globalThis.fetch = (url, options) => {
    requests.push(url)
    return originalFetch(new URL(url, base), options)
  }
})
after(async () => {
  globalThis.fetch = originalFetch
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

test('初始问题在等待模型前即可保存，未配置模型时正常回退', async () => {
  const session = await ai.createSessionSmart('AI 会不会影响学习？', { onProgress: (checkpoint) => {
    storage.saveSession(checkpoint)
    assert.equal(requests.length, 0)
    assert.equal(checkpoint.trace.length, 1)
  } })
  assert.equal(session.trace.at(-1).source, 'local_engine')
  assert.equal(session.aiEvents.at(-1).status, 'fallback')
  assert.deepEqual(session.cognitiveState.completedMoves, [])
})

test('已提交回答保存为待处理状态，不需要先等待 API', () => {
  const session = engine.createSession('AI 会不会影响学习？')
  const pending = storage.saveSession(ai.prepareUserResponse(session, '我觉得会，因为可能减少独立练习。'))
  assert.equal(requests.length, 0)
  assert.equal(storage.loadSessions()[0].pendingResponseId, pending.trace.at(-1).id)
  assert.throws(() => ai.prepareUserResponse(pending, '另一个回答'), /上一条回答/)
})

test('离开后重新处理待办回答，用户原话仅保存一次', async () => {
  const pending = storage.saveSession(ai.prepareUserResponse(engine.createSession('AI 会不会影响学习？'), '我觉得会，因为可能减少独立练习。'))
  const next = await ai.completePendingResponseSmart(storage.getSession(pending.id), { onProgress: storage.saveSession })
  storage.saveSession(next)
  assert.equal(next.trace.filter((item) => item.kind === 'user').length, 1)
  assert.equal(next.analyses.length, 1)
  assert.equal(next.plannerRecords.length, 2)
  assert.equal(next.trace.at(-1).move, 'specify_mechanism')
  assert.ok(!('pendingResponseId' in next))
})

test('分析完成后暂停再继续，不重复分析或重复存入用户回答', async () => {
  const pending = storage.saveSession(ai.prepareUserResponse(engine.createSession('AI 会不会影响学习？'), '我觉得会，因为可能减少独立练习。'))
  const controller = new AbortController()
  await assert.rejects(ai.completePendingResponseSmart(pending, { signal: controller.signal, onProgress: (checkpoint) => {
    storage.saveSession(checkpoint)
    controller.abort()
  } }), { name: 'AbortError' })
  const checkpoint = storage.getSession(pending.id)
  assert.equal(checkpoint.analyses.length, 1)
  assert.ok(checkpoint.pendingResponseId)
  const next = await ai.completePendingResponseSmart(checkpoint)
  assert.equal(requests.filter((url) => url === '/api/ai/analyze').length, 1)
  assert.equal(next.analyses.length, 1)
  assert.equal(next.trace.filter((item) => item.kind === 'user').length, 1)
})

test('取消分析保留待处理回答，取消不伪装成模型故障', async () => {
  const pending = storage.saveSession(ai.prepareUserResponse(engine.createSession('AI 会不会影响学习？'), '我觉得会，因为可能减少独立练习。'))
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(ai.completePendingResponseSmart(pending, { signal: controller.signal }), { name: 'AbortError' })
  const stored = storage.getSession(pending.id)
  assert.equal(stored.analyses.length, 0)
  assert.equal(stored.aiEvents.length, 0)
  assert.equal(stored.pendingResponseId, pending.pendingResponseId)
})

test('卡住时省去 AI 分析，既有判断不会被不知道覆盖', async () => {
  let session = engine.appendUserResponse(engine.createSession('AI 会不会影响学习？'), '我觉得会，因为可能减少独立练习。')
  const position = session.cognitiveState.currentPosition
  session = await ai.appendUserResponseSmart(session, '不知道')
  assert.deepEqual(requests, ['/api/ai/question'])
  assert.equal(session.cognitiveState.currentPosition, position)
  assert.equal(session.trace.at(-1).move, 'specify_mechanism')
  assert.equal(session.analyses.at(-1).engagement, 'stuck')
})

test('尚未生成第一问的已保存问题可以恢复', async () => {
  const baseSession = storage.saveSession(engine.createSessionBase('我该不该参加这个活动？'))
  const next = await ai.generateFirstQuestionSmart(storage.getSession(baseSession.id))
  assert.equal(next.trace.length, 2)
  assert.equal(next.plannerRecords.length, 1)
})

test('主动岔开另存新会话，保留来源和原回答草稿，不把随手记自动发给模型', async () => {
  const original = storage.saveSession(engine.createSession('AI 会不会影响学习？'))
  storage.saveDraft(original.id, { ...storage.emptyDraft(), response: '原问题尚未提交的回答', sideThought: '我想先弄清如何自主学习。' })
  localStorage.setItem('reflective-journey/v0.5/quick-note', JSON.stringify({ text: 'PRIVATE_NOTE_DO_NOT_SEND' }))
  const payloads = []
  const priorFetch = globalThis.fetch
  globalThis.fetch = (url, options) => { if (options?.body) payloads.push(JSON.parse(options.body)); return priorFetch(url, options) }
  try {
    const branched = storage.saveSession(await ai.createSessionSmart('我想先弄清如何自主学习。', {
      origin: { sessionId: original.id, question: original.question }, onProgress: storage.saveSession,
    }))
    assert.notEqual(branched.id, original.id)
    assert.equal(branched.origin.sessionId, original.id)
    assert.equal(storage.loadDraft(original.id).response, '原问题尚未提交的回答')
    assert.equal(storage.loadSessions().length, 2)
    assert.ok(!JSON.stringify(payloads).includes('PRIVATE_NOTE_DO_NOT_SEND'))
    assert.equal(payloads[0].session.origin.question, original.question)
  } finally { globalThis.fetch = priorFetch }
})

test('完整混合流程使用真实接口协议，模型不能覆盖引擎选定的动作', async () => {
  let modelCalls = 0
  const fake = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const prompt = body.messages[1].content
    const context = JSON.parse(prompt.slice(prompt.indexOf('{')))
    modelCalls++
    const output = context.latestUserResponse ? {
      currentPosition: context.latestUserResponse.content,
      observations: ['你把独立练习放在了判断的关键位置。'],
      completedMoveEvidence: [{ move: 'state_position', excerpt: '我觉得会' }],
    } : {
      question: context.nextAction === 'state_position' ? '你现在更倾向哪一种判断？' : '这个影响是通过哪个具体步骤发生的？',
      contextAnchor: '独立练习', move: 'synthesize',
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }))
  })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  Object.assign(providerEnv, { DEEPSEEK_API_KEY: 'local-test-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + fake.address().port, DEEPSEEK_MODEL: 'local-protocol-test' })
  try {
    let session = await ai.createSessionSmart('AI 会不会影响学习？')
    assert.equal(session.trace.at(-1).source, 'ai')
    assert.equal(session.trace.at(-1).move, 'state_position')
    session = await ai.appendUserResponseSmart(session, '我觉得会，因为可能减少独立练习。', { onProgress: storage.saveSession })
    assert.equal(session.aiRuntime.mode, 'hybrid')
    assert.equal(session.analyses[0].source, 'ai')
    assert.equal(session.trace.at(-1).move, 'specify_mechanism')
    assert.equal(session.plannerRecords.at(-1).generationSource, 'ai')
    assert.ok(session.aiEvents.every((event) => event.status === 'success'))
    assert.equal(modelCalls, 3)
  } finally {
    fake.closeAllConnections()
    await new Promise((resolve) => fake.close(resolve))
    for (const key of Object.keys(providerEnv)) delete providerEnv[key]
  }
})

test('混合模式下模型返回旧 currentPosition 时，不能覆盖本地已经识别的撤回', async () => {
  const fake = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const prompt = body.messages[1].content
    const context = JSON.parse(prompt.slice(prompt.indexOf('{')))
    const output = context.latestUserResponse ? {
      currentPosition: context.previousState.currentPosition,
      observations: ['用户撤回了前面的一个理由。'],
      detectedSignals: ['retraction'],
      completedMoveEvidence: [],
    } : {
      question: '除了刚才已经撤回的例子，还有没有另一种解释？',
      contextAnchor: '保留下来的当前判断',
    }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }))
  })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  Object.assign(providerEnv, { DEEPSEEK_API_KEY: 'local-test-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + fake.address().port, DEEPSEEK_MODEL: 'local-retraction-test' })
  try {
    let session = engine.createSession('AI 会不会让学生变懒？')
    session = engine.appendUserResponse(session, '我觉得会，因为我室友总是直接抄答案。')
    session = engine.appendUserResponse(session, '直接抄答案会跳过独立练习，久了会更依赖工具。')
    assert.match(session.cognitiveState.currentPosition, /室友/)

    session = await ai.appendUserResponseSmart(session, '前面我举的室友那个例子不能说明整体情况，我撤回这个理由。')
    assert.equal(session.cognitiveState.currentPosition, '我觉得会')
    assert.ok(session.analyses.at(-1).detectedSignals.includes('retraction'))
    assert.equal(session.trace.at(-1).move, 'generate_alternative')
    assert.ok(!session.trace.at(-1).content.includes('室友总是直接抄答案'))
  } finally {
    fake.closeAllConnections()
    await new Promise((resolve) => fake.close(resolve))
    for (const key of Object.keys(providerEnv)) delete providerEnv[key]
  }
})
