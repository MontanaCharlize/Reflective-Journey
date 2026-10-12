import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadTs } from './load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts')

function sessionAt(move, question = '测试问题', type = 'exploratory') {
  let session = engine.createSessionBase(question)
  session = { ...session, cognitiveType: type }
  return engine.appendIntervention(session, { move, content: '测试追问', source: 'local' })
}

test('短但明确的决策回答可以完成当前选择，不能按长度否定有效信息', () => {
  let session = engine.createSession('我该不该参加这个活动？')
  session = engine.appendUserResponse(session, '不参加')
  assert.equal(session.cognitiveState.currentPosition, '不参加')
  assert.ok(session.cognitiveState.completedMoves.includes('state_position'))
  assert.equal(session.trace.at(-1).move, 'define_criteria')
})

test('只给判断标准但没有回答选哪个时，只完成标准，不跳过当前选择', () => {
  let session = engine.createSession('我该不该参加这个活动？')
  session = engine.appendUserResponse(session, '我更看重时间和自己的兴趣。')
  assert.ok(session.cognitiveState.completedMoves.includes('define_criteria'))
  assert.ok(!session.cognitiveState.completedMoves.includes('state_position'))
  assert.equal(session.trace.at(-1).move, 'state_position')
})

test('把上一轮原话重复给新的追问，不会被误判成当前动作的新完成', () => {
  let session = engine.createSession('AI 会不会让学生变懒？')
  session = engine.appendUserResponse(session, '我觉得会，因为直接拿答案减少独立练习。')
  assert.equal(session.trace.at(-1).move, 'specify_mechanism')
  const repeated = engine.appendUserResponse(session, '我觉得会，因为直接拿答案减少独立练习。')
  assert.equal(repeated.analyses.at(-1).engagement, 'stuck')
  assert.ok(repeated.analyses.at(-1).detectedSignals.includes('repeats_previous'))
  assert.ok(!repeated.cognitiveState.completedMoves.includes('specify_mechanism'))
  assert.equal(repeated.trace.at(-1).move, 'specify_mechanism')
})

test('用户主动说明跑题时，不把跑题内容包装成认知进展', () => {
  const start = sessionAt('request_evidence')
  const next = engine.appendUserResponse(start, '我刚才跑题了，这和这个问题没关系。')
  assert.equal(next.analyses.at(-1).engagement, 'stuck')
  assert.ok(next.analyses.at(-1).detectedSignals.includes('off_topic'))
  assert.ok(!next.cognitiveState.completedMoves.includes('request_evidence'))
  assert.equal(next.trace.at(-1).move, 'request_evidence')
})

test('用户明确拒绝当前方向时，不算卡住或完成，而是回到重新选焦点', () => {
  const start = sessionAt('request_evidence', 'AI 会不会影响学习？', 'causal')
  const next = engine.appendUserResponse(start, '这个方向我不想继续讨论了，换个角度。')
  assert.equal(next.analyses.at(-1).engagement, 'engaged')
  assert.ok(next.analyses.at(-1).detectedSignals.includes('declines_direction'))
  assert.ok(!next.cognitiveState.completedMoves.includes('request_evidence'))
  assert.equal(next.trace.at(-1).move, 'clarify_focus')
})

test('一句话可同时贡献多个真实认知动作，但下一轮仍只选一个动作', () => {
  let session = engine.createSession('AI 会不会让学生变懒？')
  session = engine.appendUserResponse(session, '我觉得会，但也可能是课程太难；如果只是用 AI 检查自己的思路，可能就不会。')
  assert.ok(session.cognitiveState.completedMoves.includes('state_position'))
  assert.ok(session.cognitiveState.completedMoves.includes('generate_alternative'))
  assert.ok(session.cognitiveState.completedMoves.includes('test_boundary'))
  assert.equal(session.trace.at(-1).move, 'specify_mechanism')
  assert.equal((session.trace.at(-1).content.match(/[？?]/g) || []).length, 1)
})

test('明确修改总体判断时才更新 currentPosition，并记录判断修订', () => {
  let session = engine.createSession('AI 会不会让学生变懒？')
  session = engine.appendUserResponse(session, '我觉得会，因为直接拿答案减少独立练习。')
  const before = session.cognitiveState.currentPosition
  session = engine.appendUserResponse(session, '我刚才那个判断不太准确，我现在觉得关键不是用不用 AI，而是怎么用。')
  assert.notEqual(session.cognitiveState.currentPosition, before)
  assert.match(session.cognitiveState.currentPosition, /关键不是用不用 AI/)
  assert.ok(session.analyses.at(-1).detectedSignals.includes('position_revision'))
  assert.ok(session.cognitiveState.changedIdeas.some((item) => item.includes('当前判断更新为')))
})

test('提出反例但没有修改总体立场时，不把局部反例覆盖成 currentPosition', () => {
  let session = engine.createSession('AI 会不会让学生变懒？')
  session = engine.appendUserResponse(session, '我觉得会，因为直接拿答案减少独立练习。')
  const before = session.cognitiveState.currentPosition
  session = engine.appendUserResponse(session, '确实有些人用 AI 后学得更好，这可以算一个反例。')
  assert.equal(session.cognitiveState.currentPosition, before)
})

test('撤回旧理由会留下可审计的修正记录，而不是静默覆盖历史', () => {
  let session = engine.createSession('AI 会不会让学生变懒？')
  session = engine.appendUserResponse(session, '我觉得会，因为我室友总是直接抄答案。')
  session = engine.appendUserResponse(session, '前面我举的室友那个例子不能说明整体情况，我撤回这个理由。')
  const analysis = session.analyses.at(-1)
  assert.ok(analysis.detectedSignals.includes('retraction'))
  assert.ok(session.cognitiveState.changedIdeas.some((item) => item.startsWith('撤回/修正：')))
})

test('很长但只是在重复立场，不会因此完成证据动作', () => {
  let session = sessionAt('request_evidence', 'AI 会不会影响学习？', 'causal')
  session = engine.appendUserResponse(session, '反正我就是这么觉得，总之我还是这么认为，真的没有补充新的数据、调查或可以核对的证据。')
  assert.ok(!session.cognitiveState.completedMoves.includes('request_evidence'))
})

test('“不会”作为结论或卡点内容时不会被一律当成无能力回答', () => {
  let causal = engine.createSession('AI 会不会影响学习？')
  causal = engine.appendUserResponse(causal, '我觉得可能不会，取决于怎么使用。')
  assert.equal(causal.analyses.at(-1).engagement, 'engaged')
  assert.ok(causal.cognitiveState.completedMoves.includes('state_position'))
  assert.ok(causal.cognitiveState.completedMoves.includes('test_boundary'))

  let problem = sessionAt('isolate_blocker', '这道题怎么做？', 'problem')
  problem = engine.appendUserResponse(problem, '我不会的是第三步怎么把条件代进去。')
  assert.equal(problem.analyses.at(-1).engagement, 'engaged')
  assert.ok(problem.cognitiveState.completedMoves.includes('isolate_blocker'))
})

test('质量评估样例文件覆盖预定的高风险对话类型', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../evals/dialogue-quality-cases.json', import.meta.url), 'utf8'))
  const categories = new Set(cases.map((item) => item.category))
  for (const category of ['partial_answer', 'repetition', 'position_change', 'retraction', 'short_valid', 'decline_direction', 'off_topic', 'multi_move']) {
    assert.ok(categories.has(category), category)
  }
})
