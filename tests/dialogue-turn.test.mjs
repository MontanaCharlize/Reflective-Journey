import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { normalizeDialogueTurn, generateDialogueTurn } from '../server/dialogue-turn.mjs'
import { callJsonModel } from '../server/providers.mjs'
import { loadTs } from './load-ts.mjs'
const engine = await loadTs('src/lib/engine.ts')
function fixture(answer = '我的决定是只参加上午的摄影活动，下午留给休息。') {
  const initial = engine.createSession('周末要不要参加摄影活动？')
  return engine.appendUserTrace(initial, answer)
}
function output(session, overrides = {}) {
  const user = session.trace.filter((item) => item.kind === 'user').at(-1)
  return { understanding: { assessment: 'answered', position: { quote: user.content, traceId: user.id, relation: 'initial' }, completedEvidence: [], extracts: [], ...overrides.understanding }, decision: { move: 'formulate_test', title: '检验半天安排', goal: '把条件明确的选择落实成可观察的小尝试', whyNow: '已经有选择，可以直接检查怎样护住下午的休息。', anchor: user.content, reply: '上午参加与下午休息可以兼容，关键是有一个能实际执行的结束安排。', question: '你会用哪一个具体的离场时间检验这次半天安排？', ...overrides.decision } }
}

test('AI 可以直接选择验证动作，无须按本地清单走完标准与取舍', () => {
  const { session } = fixture(), normalized = normalizeDialogueTurn(output(session), session)
  assert.equal(normalized.decision.move, 'formulate_test')
  assert.notEqual(engine.selectNextMove(session), normalized.decision.move)
  assert.equal(normalized.analysis.stateAfter.currentPosition, session.trace.at(-1).content)
  assert.ok(normalized.analysis.stateAfter.completedMoves.includes('state_position'))
  assert.ok(!normalized.analysis.stateAfter.completedMoves.includes('define_criteria'))
})

test('长的自然选择与短的明确选择都可由真实原话支持，无需命中特定开头', () => {
  for (const answer of ['我的决定是只参加上午的摄影活动，下午留给休息。', '不参加。']) {
    const { session } = fixture(answer), normalized = normalizeDialogueTurn(output(session), session)
    assert.equal(normalized.analysis.stateAfter.currentPosition, answer)
  }
})

test('系统提问和虚构原话不能作为用户立场、证据或条件', () => {
  const { session } = fixture(), guide = session.trace.find((item) => item.kind === 'guide')
  const data = output(session, { understanding: { position: { quote: guide.content, traceId: guide.id, relation: 'initial' }, completedEvidence: [{ move: 'request_evidence', quote: '根本没说过的证据', traceId: session.trace.at(-1).id }], extracts: [{ field: 'goals', quote: guide.content, traceId: guide.id }] } })
  const state = normalizeDialogueTurn(data, session).analysis.stateAfter
  assert.equal(state.currentPosition, '')
  assert.deepEqual(state.completedMoves, [])
  assert.deepEqual(state.goals, [])
})

test('旧本地推测不能继续冒充用户自己表达的前提', () => {
  const { session } = fixture()
  session.cognitiveState.assumptions = ['用户是个懒惰的人']
  const state = normalizeDialogueTurn(output(session), session).analysis.stateAfter
  assert.deepEqual(state.assumptions, [])
})

test('未知和拒绝方向不虚构动作完成，下一步仍由 AI 选择帮助方式', () => {
  const previous = engine.appendUserResponse(engine.createSession('周末要不要参加摄影活动？'), '我选择只参加上午的活动。')
  const { session } = engine.appendUserTrace(previous, '我不知道需要什么证据，也不想讨论别人怎么看。')
  const data = output(session, { understanding: { assessment: 'declined', position: null, completedEvidence: [{ move: 'request_evidence', quote: session.trace.at(-1).content, traceId: session.trace.at(-1).id }], extracts: [] }, decision: { move: 'clarify_focus', question: '先把别人的看法放下，你更希望这段思考帮你解决哪一个实际困难？' } })
  const result = normalizeDialogueTurn(data, session)
  assert.equal(result.analysis.stateAfter.currentPosition, previous.cognitiveState.currentPosition)
  assert.ok(!result.analysis.stateAfter.completedMoves.includes('request_evidence'))
  assert.equal(result.decision.move, 'clarify_focus')
})

test('局部反例不更新总体立场，明确修订才记录新的原话', () => {
  const previous = engine.appendUserResponse(engine.createSession('周末要不要参加摄影活动？'), '我的选择是参加摄影活动。')
  const { session } = engine.appendUserTrace(previous, '上次类似活动第二天也有精神不错的时候。')
  const data = output(session, { understanding: { position: { quote: session.trace.at(-1).content, traceId: session.trace.at(-1).id, relation: 'unchanged' } } })
  assert.equal(normalizeDialogueTurn(data, session).analysis.stateAfter.currentPosition, previous.cognitiveState.currentPosition)
  const revised = engine.appendUserTrace(previous, '我改变主意了，现在决定不参加。').session
  const changed = normalizeDialogueTurn(output(revised, { understanding: { position: { quote: revised.trace.at(-1).content, traceId: revised.trace.at(-1).id, relation: 'revised' } } }), revised)
  assert.equal(changed.analysis.stateAfter.currentPosition, revised.trace.at(-1).content)
  assert.match(changed.analysis.stateAfter.changedIdeas.join('\n'), /判断修订/)
})

test('明确撤回的依据会撤销完成标记并保留撤回记录', () => {
  let session = fixture('上次活动后我第二天很累。').session
  const original = session.trace.at(-1)
  session.cognitiveState.evidenceSignals = [original.content]
  session.cognitiveState.completedMoves = ['request_evidence']
  session = engine.appendUserTrace(session, '前面那次经历不能说明这次情况，我撤回这个依据。').session
  const user = session.trace.at(-1)
  const data = output(session, { understanding: { position: null, withdrawals: [{ field: 'evidenceSignals', quote: user.content, traceId: user.id, targetQuote: original.content }] } })
  const state = normalizeDialogueTurn(data, session).analysis.stateAfter
  assert.deepEqual(state.evidenceSignals, [])
  assert.ok(!state.completedMoves.includes('request_evidence'))
  assert.match(state.changedIdeas.join('\n'), /撤回/)
})

test('已有条件立场不能被后来误标为 initial 的宽泛陈述覆盖', () => {
  const previous = engine.appendUserResponse(engine.createSession('周末要不要参加摄影活动？'), '我的选择是只参加上午的活动。')
  const { session } = engine.appendUserTrace(previous, '摄影确实能让我放松。')
  const state = normalizeDialogueTurn(output(session), session).analysis.stateAfter
  assert.equal(state.currentPosition, previous.cognitiveState.currentPosition)
})

test('指代不明的简略回答不能变成已确认能力或完成证据', () => {
  const { session } = fixture('都可以。'), user = session.trace.at(-1)
  const data = output(session, { understanding: { assessment: 'partial', answerClarity: 'ambiguous', completedEvidence: [{ move: 'request_evidence', quote: user.content, traceId: user.id }], extracts: [{ field: 'evidenceSignals', quote: user.content, traceId: user.id }] }, decision: { reply: '如果你指的是两种安排都能接受，可以先比较它们各自占用的时间。', question: '你说的都可以，指的是哪两种安排？' } })
  assert.deepEqual(normalizeDialogueTurn(data, session).analysis.stateAfter.completedMoves, [])
  assert.equal(normalizeDialogueTurn(data, session).analysis.stateAfter.currentPosition, '')
  assert.deepEqual(normalizeDialogueTurn(data, session).analysis.stateAfter.evidenceSignals, [])
  data.decision.reply = '你已经确认两种安排都有效，这就说明结果没问题。'
  assert.throws(() => normalizeDialogueTurn(data, session), (error) => error.code === 'AI_TURN_QUALITY')
})

test('跑题内容不会被写入认知状态', () => {
  const { session } = fixture('我跑题了，先说点别的。')
  const data = output(session, { understanding: { assessment: 'off_topic', position: null, extracts: [{ field: 'goals', quote: session.trace.at(-1).content, traceId: session.trace.at(-1).id }] } })
  assert.deepEqual(normalizeDialogueTurn(data, session).analysis.stateAfter.goals, [])
})

test('重复问题和换动作名称的重复确认都被拒绝', () => {
  const { session } = fixture('不参加。')
  const guide = session.trace.find((item) => item.kind === 'guide')
  assert.throws(() => normalizeDialogueTurn(output(session, { decision: { question: guide.content } }), session), (error) => error.code === 'AI_TURN_QUALITY')
  assert.throws(() => normalizeDialogueTurn(output(session, { decision: { move: 'clarify_focus', question: '不参加对你来说是已经定下的决定，还是目前偏向、但还可以再看看？' } }), session), (error) => error.code === 'AI_TURN_QUALITY')
  assert.throws(() => normalizeDialogueTurn(output(session, { decision: { move: 'state_position', question: '你到底想选择哪一个方向呢？' } }), session), (error) => error.code === 'AI_TURN_QUALITY')
})

test('联合模型回应不接受只有原话复述或一次多个问题', () => {
  const { session } = fixture()
  assert.throws(() => normalizeDialogueTurn(output(session, { decision: { reply: session.trace.at(-1).content } }), session))
  assert.throws(() => normalizeDialogueTurn(output(session, { decision: { question: '你想几点离场？又想拍到什么？' } }), session))
  assert.throws(() => normalizeDialogueTurn(output(session, { decision: { reply: '半天安排可以先做一次小尝试，你会选几点离场？' } }), session))
})

async function modelFixture(answer) {
  let calls = 0, received = []
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString()); received.push(body); calls++
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(answer(calls, body)))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, env: { DEEPSEEK_API_KEY: 'fake-key', DEEPSEEK_MODEL: 'fake', DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + server.address().port }, calls: () => calls, received, close: async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)) } }
}
const wrapper = (data) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data), reasoning_content: 'PRIVATE_REASONING_DO_NOT_SAVE' } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })

test('重复候选交还 AI 修正，计入额外调用，不用本地模板替代', async () => {
  const { session } = fixture(), guide = session.trace.find((item) => item.kind === 'guide')
  guide.reflection = '上一轮已解释过如何给下午的休息保留时间。'
  const f = await modelFixture((call) => wrapper(output(session, call === 1 ? { decision: { question: guide.content } } : {})))
  let reserved = 0
  try {
    const result = await generateDialogueTurn(f.env, { session }, undefined, () => reserved++)
    assert.equal(result.ok, true); assert.equal(result.attempts, 2); assert.equal(reserved, 1)
    assert.equal(f.calls(), 2); assert.equal(result.usage.totalTokens, 60)
    assert.ok(JSON.parse(f.received[1].messages[1].content).repair)
    assert.equal(JSON.parse(f.received[0].messages[1].content).context.history.find((item) => item.id === guide.id).reply, guide.reflection)
    assert.equal(f.received[0].thinking.type, 'disabled')
    assert.ok(!JSON.stringify(result).includes('PRIVATE_REASONING_DO_NOT_SAVE'))
  } finally { await f.close() }
})

test('两次不合格候选明确失败，不返回假进展和模板问题', async () => {
  const { session } = fixture(), guide = session.trace.find((item) => item.kind === 'guide')
  const f = await modelFixture(() => wrapper(output(session, { decision: { question: guide.content } })))
  try {
    const result = await generateDialogueTurn(f.env, { session })
    assert.equal(result.ok, false); assert.equal(result.code, 'AI_TURN_QUALITY')
    assert.equal(result.decision, undefined); assert.equal(result.analysis, undefined)
    assert.equal(f.calls(), 2)
  } finally { await f.close() }
})

test('输出截断不会被当成可展示的 JSON，隐藏推理不进入错误信息', async () => {
  const f = await modelFixture(() => ({ choices: [{ finish_reason: 'length', message: { content: '', reasoning_content: 'PRIVATE_REASONING_DO_NOT_SAVE' } }] }))
  try {
    await assert.rejects(callJsonModel({ id: 'deepseek', label: 'Fake', baseUrl: f.env.DEEPSEEK_BASE_URL, apiKey: 'fake-key', model: 'fake', jsonMode: true }, { system: 'JSON', user: 'JSON' }), (error) => error.code === 'MODEL_OUTPUT_TRUNCATED' && !error.message.includes('PRIVATE_REASONING_DO_NOT_SAVE'))
  } finally { await f.close() }
})
