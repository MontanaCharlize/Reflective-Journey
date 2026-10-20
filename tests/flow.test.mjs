import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createAiHandler } from '../server/ai-handler.mjs'
import { loadTs, memoryStorage } from './load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts'), ai = await loadTs('src/lib/ai.ts'), storage = await loadTs('src/lib/storage.ts')
const originalFetch = globalThis.fetch
let server, base, requests = [], providerEnv = {}
before(async () => {
  const handler = createAiHandler(providerEnv)
  server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://localhost').pathname).then((handled) => { if (!handled) { res.statusCode = 404; res.end() } }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + server.address().port
  globalThis.window = { setTimeout, clearTimeout }
})
beforeEach(() => {
  for (const key of Object.keys(providerEnv)) delete providerEnv[key]
  requests = []; globalThis.localStorage = memoryStorage()
  globalThis.fetch = (url, options) => {
    if (String(url).startsWith('/')) { requests.push({ url, body: options?.body ? JSON.parse(options.body) : null }); return originalFetch(new URL(url, base), options) }
    return originalFetch(url, options)
  }
})
after(async () => { globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) })

test('问题在等待模型前保存，未配置 AI 时明确失败而不追加模板', async () => {
  let first = true
  await assert.rejects(ai.createSessionSmart('周末要不要参加摄影活动？', { onProgress: (checkpoint) => {
    if (first) { assert.equal(requests.length, 0); first = false }
    storage.saveSession(checkpoint)
  } }), (error) => error.code === 'NO_PROVIDER')
  const saved = storage.loadSessions()[0]
  assert.equal(saved.trace.length, 1)
  assert.equal(saved.aiRuntime.status, 'failed')
  assert.equal(saved.aiEvents.at(-1).status, 'error')
  assert.equal(saved.aiEvents.some((event) => event.status === 'fallback'), false)
})

test('只有主动选择本地提纲时才不调用模型，界面数据保留明确来源', async () => {
  const session = await ai.createSessionSmart('周末要不要参加摄影活动？', { dialogueMode: 'local' })
  assert.equal(requests.length, 0)
  assert.equal(session.dialogueMode, 'local')
  assert.equal(session.aiRuntime.status, 'local')
  assert.equal(session.trace.at(-1).source, 'local_engine')
})

test('提交原话先保存为待处理状态，不需要等待模型', () => {
  const session = storage.saveSession(ai.prepareUserResponse(engine.createSession('周末要不要参加摄影活动？'), '只参加上午的场次。'))
  assert.equal(requests.length, 0)
  assert.equal(session.pendingResponseId, session.trace.at(-1).id)
  assert.throws(() => ai.prepareUserResponse(session, '第二条'), /上一条回答/)
})

test('本地模式恢复待处理回答时保留一次原话和一次分析', async () => {
  const pending = ai.prepareUserResponse({ ...engine.createSession('周末要不要参加摄影活动？'), dialogueMode: 'local' }, '我选择参加上午的场次。')
  const next = await ai.completePendingResponseSmart(pending)
  assert.equal(next.trace.filter((item) => item.kind === 'user').length, 1)
  assert.equal(next.analyses.length, 1)
  assert.ok(!next.pendingResponseId)
  assert.equal(requests.length, 0)
})

test('暂停后继续不重复本地分析或用户原话', async () => {
  const pending = ai.prepareUserResponse({ ...engine.createSession('周末要不要参加摄影活动？'), dialogueMode: 'local' }, '我选择参加上午的场次。')
  const controller = new AbortController()
  await assert.rejects(ai.completePendingResponseSmart(pending, { signal: controller.signal, onProgress: (checkpoint) => { storage.saveSession(checkpoint); controller.abort() } }), { name: 'AbortError' })
  const checkpoint = storage.getSession(pending.id)
  assert.equal(checkpoint.analyses.length, 1)
  const next = await ai.completePendingResponseSmart(checkpoint)
  assert.equal(next.analyses.length, 1)
  assert.equal(next.trace.filter((item) => item.kind === 'user').length, 1)
})

test('取消 AI 请求不伪装成模型故障，不损坏已保存原话', async () => {
  const pending = storage.saveSession(ai.prepareUserResponse(engine.createSession('周末要不要参加摄影活动？'), '我选择参加上午的场次。'))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(ai.completePendingResponseSmart(pending, { signal: controller.signal, onProgress: storage.saveSession }), { name: 'AbortError' })
  assert.equal(storage.getSession(pending.id).aiEvents.length, 0)
  assert.equal(storage.getSession(pending.id).pendingResponseId, pending.pendingResponseId)
})

test('AI 失败保留待处理状态和已有判断，不追加新的假回应', async () => {
  const initial = engine.appendUserResponse(engine.createSession('周末要不要参加摄影活动？'), '我选择参加上午的场次。')
  const pending = storage.saveSession(ai.prepareUserResponse(initial, '这个我还不知道。'))
  await assert.rejects(ai.completePendingResponseSmart(pending, { onProgress: storage.saveSession }), (error) => error.code === 'NO_PROVIDER')
  const saved = storage.getSession(pending.id)
  assert.equal(saved.cognitiveState.currentPosition, initial.cognitiveState.currentPosition)
  assert.equal(saved.trace.length, pending.trace.length)
  assert.equal(saved.pendingResponseId, pending.pendingResponseId)
  assert.equal(requests[0].url, '/api/ai/turn')
})

test('未生成第一问的问题可明确选择本地方式恢复', async () => {
  const baseSession = engine.createSessionBase('我该不该参加这个活动？')
  const next = await ai.generateFirstQuestionSmart(baseSession, { dialogueMode: 'local' })
  assert.equal(next.trace.length, 2)
  assert.equal(next.plannerRecords.length, 1)
})

test('新分支保留来源但不携带笔记，本地模式也不擅自发出模型请求', async () => {
  const original = storage.saveSession(engine.createSession('周末要不要参加摄影活动？'))
  storage.saveDraft(original.id, { ...storage.emptyDraft(), response: '原问题的草稿' })
  localStorage.setItem('reflective-journey/v0.5/quick-note', JSON.stringify({ text: 'PRIVATE_NOTE_DO_NOT_SEND' }))
  const branch = storage.saveSession(await ai.createSessionSmart('我想先弄清周末怎样休息。', { dialogueMode: 'local', origin: { sessionId: original.id, question: original.question } }))
  assert.equal(branch.origin.sessionId, original.id)
  assert.equal(storage.loadDraft(original.id).response, '原问题的草稿')
  assert.equal(storage.loadSessions().length, 2)
  assert.equal(requests.length, 0)
})

test('完整 AI 流程由模型选择目标，允许跳过本地路径，单轮一次联合调用', async () => {
  let calls = 0
  const fake = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString())
    const context = JSON.parse(body.messages[1].content).context
    const user = context.history.length > 1 ? context.history.filter((item) => item.role === 'user').at(-1) : null
    calls++
    const output = { understanding: { assessment: 'answered', position: user ? { quote: user.content, traceId: user.id, relation: 'initial' } : null, completedEvidence: [], extracts: [] }, decision: {
      move: user ? 'formulate_test' : 'state_position', title: user ? '验证半天安排' : '先留下自己的想法', goal: user ? '将上午参加变成可观察的小尝试' : '了解个人选择', whyNow: user ? '已经有条件明确的选择，值得直接检查执行安排。' : '当前只有问题，没有用户自己的判断。', anchor: user?.content || '', reply: user ? '上午参加与下午休息并不冲突，关键在于如何确保真的能及时结束。' : '这可以从你想保住的一件事开始，不必先把所有因素都列完。', question: user ? '你会用哪一个具体的离场时间，检验这次安排是否保住了下午的休息？' : '参加和不参加之间，你此刻最接近哪一种选择？' } }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(output) } }] }))
  })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  Object.assign(providerEnv, { DEEPSEEK_API_KEY: 'local-test-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + fake.address().port, DEEPSEEK_MODEL: 'fake-protocol' })
  try {
    let session = await ai.createSessionSmart('我该不该参加这个活动？')
    session = await ai.appendUserResponseSmart(session, '我的决定是只参加上午的活动。')
    assert.equal(session.trace.at(-1).move, 'formulate_test')
    assert.equal(session.plannerRecords.at(-1).decisionSource, 'ai')
    assert.equal(session.analyses.at(-1).source, 'ai')
    assert.equal(session.cognitiveState.currentPosition, '我的决定是只参加上午的活动。')
    assert.equal(calls, 2)
    assert.deepEqual(requests.map((item) => item.url), ['/api/ai/turn','/api/ai/turn'])
    assert.ok(requests.every((item) => !('move' in item.body) && !('objective' in item.body)))
    assert.ok(session.aiEvents.every((event) => event.phase === 'dialogue_decision' && event.status === 'success'))
  } finally { fake.closeAllConnections(); await new Promise((resolve) => fake.close(resolve)) }
})