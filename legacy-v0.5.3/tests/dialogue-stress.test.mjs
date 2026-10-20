import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadTs } from './load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts')
const scenarios = JSON.parse(fs.readFileSync(new URL('../evals/multi-turn-dialogue-cases.json', import.meta.url), 'utf8'))

function latestQuestion(session) {
  return [...session.trace].reverse().find((item) => item.move)
}

test('八类问题的 6~7 轮连续对话都能按认知路径推进，而不是中途卡在已回答动作', () => {
  for (const scenario of scenarios) {
    let session = engine.createSession(scenario.question)
    assert.equal(session.cognitiveType, scenario.expectedType, scenario.id)

    for (const [index, turn] of scenario.turns.entries()) {
      const before = latestQuestion(session)
      assert.equal(before?.move, turn.answeringMove, `${scenario.id} turn ${index + 1}: 回答前动作`)
      const previousQuestions = session.trace.filter((item) => item.move).map((item) => item.content)

      session = engine.appendUserResponse(session, turn.answer)
      const analysis = session.analyses.at(-1)
      const completedNow = new Set((analysis.completedMoveEvidence || []).map((item) => item.move))
      assert.equal(analysis.engagement, 'engaged', `${scenario.id} turn ${index + 1}: 不应误判卡住`)
      assert.ok(completedNow.has(turn.answeringMove), `${scenario.id} turn ${index + 1}: 应完成 ${turn.answeringMove}`)
      for (const evidence of analysis.completedMoveEvidence || []) {
        assert.equal(evidence.excerpt, turn.answer, `${scenario.id} turn ${index + 1}: 完成证据必须来自本轮原话`)
      }

      const next = latestQuestion(session)
      assert.equal(next?.move, turn.nextMove, `${scenario.id} turn ${index + 1}: 下一动作`)
      for (const oldQuestion of previousQuestions.slice(-5)) {
        assert.ok(engine.textSimilarity(next.content, oldQuestion) < 0.9, `${scenario.id} turn ${index + 1}: 不应近似重复旧追问`)
      }
    }
  }
})

test('局部边界回答不会覆盖总体判断，直到用户明确总结', () => {
  let session = engine.createSession('AI 会不会让大学生越来越不会思考？')
  session = engine.appendUserResponse(session, '我觉得会，因为很多人会直接拿答案。')
  const initial = session.cognitiveState.currentPosition
  session = engine.appendUserResponse(session, '直接拿答案会跳过自己尝试，久了可能减少独立练习。')
  session = engine.appendUserResponse(session, '也可能是课程太难，所以学生本来就更依赖外部帮助。')
  session = engine.appendUserResponse(session, '我的说法成立，前提是独立练习真的会影响以后独立解决问题的能力。')
  session = engine.appendUserResponse(session, '如果看到长期对照数据，我会重新考虑。')
  session = engine.appendUserResponse(session, '如果 AI 只用来检查自己的思路，而不是直接给答案，我觉得影响可能就不一样。')
  assert.equal(session.cognitiveState.currentPosition, initial)
  session = engine.appendUserResponse(session, '我现在觉得关键不是用不用 AI，而是 AI 在什么时候介入。')
  assert.notEqual(session.cognitiveState.currentPosition, initial)
})

test('证据、职业和写作语境中的“研究/报告/来源”不会被词面误判成证据进展', () => {
  let self = engine.createSession('我为什么总是拖延写作？')
  self = engine.appendUserResponse(self, '上周三我打开报告文档十分钟后就去刷视频了。')
  assert.ok(!self.analyses.at(-1).detectedSignals.includes('evidence_mentioned'))

  let decision = engine.createSession('我该不该继续读研？')
  decision = engine.appendUserResponse(decision, '我倾向继续。')
  decision = engine.appendUserResponse(decision, '我最看重能不能继续做研究。')
  assert.ok(!decision.analyses.at(-1).detectedSignals.includes('evidence_mentioned'))

  let job = engine.createSession('我该不该辞职？')
  job = engine.appendUserResponse(job, '暂时不辞。')
  job = engine.appendUserResponse(job, '我最看重稳定。')
  job = engine.appendUserResponse(job, '代价是继续加班。')
  job = engine.appendUserResponse(job, '前提是我有别的收入来源。')
  assert.ok(!job.analyses.at(-1).detectedSignals.includes('evidence_mentioned'))
})

test('“不知道怎么做”可以是问题求解的有效卡点，不应把 isolate_blocker 误判为 stuck', () => {
  let session = engine.createSession('这道概率题我该怎么做？')
  session = engine.appendUserResponse(session, '我卡在第三步，不知道怎么把条件代进公式。')
  assert.equal(session.analyses.at(-1).engagement, 'engaged')
  assert.ok(session.analyses.at(-1).completedMoveEvidence.some((item) => item.move === 'isolate_blocker'))
  assert.equal(latestQuestion(session).move, 'predict_next_step')
})

test('回答“证据会让我改观”不能顺便跳过边界动作，反例也不能顺便完成边界', () => {
  let session = engine.createSession('这个新闻靠谱吗？')
  session = { ...session, cognitiveType: 'evidence' }
  session = engine.appendIntervention(session, { move: 'request_evidence', content: '什么证据会改变你的判断？', source: 'local' })
  session = engine.appendUserResponse(session, '如果有长期对照研究的数据，我会更相信。')
  const evidenceMoves = new Set(session.analyses.at(-1).completedMoveEvidence.map((item) => item.move))
  assert.ok(evidenceMoves.has('request_evidence'))
  assert.ok(!evidenceMoves.has('test_boundary'))

  let counter = engine.createSessionBase('这个新闻靠谱吗？')
  counter = { ...counter, cognitiveType: 'evidence' }
  counter = engine.appendIntervention(counter, { move: 'seek_counterexample', content: '找一个反例。', source: 'local' })
  counter = engine.appendUserResponse(counter, '反例是，如果不喝咖啡的人本来健康更差，那相关性就不一定是咖啡造成的。')
  const counterMoves = new Set(counter.analyses.at(-1).completedMoveEvidence.map((item) => item.move))
  assert.ok(counterMoves.has('seek_counterexample'))
  assert.ok(!counterMoves.has('test_boundary'))
})

test('综合动作不能因为用户只补了一条条件句就被草率判定完成', () => {
  let session = engine.createSessionBase('我该不该辞职？')
  session = {
    ...session,
    cognitiveType: 'decision',
    cognitiveState: {
      ...session.cognitiveState,
      currentPosition: '暂时不辞。',
      completedMoves: ['state_position', 'define_criteria', 'expose_tradeoff', 'surface_assumption', 'request_evidence', 'test_boundary'],
    },
  }
  session = engine.appendIntervention(session, { move: 'synthesize', content: '你现在的整体判断是什么？', source: 'local' })
  session = engine.appendUserResponse(session, '如果公司能让我转组并减少加班，我可能就不会想辞。')
  assert.ok(!session.analyses.at(-1).completedMoveEvidence.some((item) => item.move === 'synthesize'))
  assert.equal(session.cognitiveState.currentPosition, '暂时不辞。')
  assert.equal(latestQuestion(session).move, 'synthesize')
})


test('撤回支持理由会从当前判断中去掉已撤回理由；撤回整个判断会重新要求形成立场', () => {
  let support = engine.createSession('AI 会不会让学生变懒？')
  support = engine.appendUserResponse(support, '我觉得会，因为我室友总是直接抄答案。')
  support = engine.appendUserResponse(support, '直接抄答案会跳过独立练习，久了会更依赖工具。')
  support = engine.appendUserResponse(support, '前面我举的室友那个例子不能说明整体情况，我撤回这个理由。')
  assert.equal(support.cognitiveState.currentPosition, '我觉得会')
  assert.ok(support.analyses.at(-1).detectedSignals.includes('retraction'))
  assert.ok(!support.analyses.at(-1).detectedSignals.includes('evidence_mentioned'))
  assert.equal(latestQuestion(support).move, 'generate_alternative')
  assert.ok(!latestQuestion(support).content.includes('室友总是直接抄答案'))

  let position = engine.createSession('AI 会不会让学生变懒？')
  position = engine.appendUserResponse(position, '我觉得会。')
  position = engine.appendUserResponse(position, '刚才那个判断不对，我撤回这个判断。')
  assert.equal(position.cognitiveState.currentPosition, '')
  assert.ok(!position.cognitiveState.completedMoves.includes('state_position'))
  assert.equal(latestQuestion(position).move, 'state_position')
})

