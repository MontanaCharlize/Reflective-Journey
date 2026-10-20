import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadTs } from './load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts')
const reflection = await loadTs('src/lib/reflection.ts')

test('八类真实问题的分类和下一步符合评估样例', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../evals/cognitive-cases.json', import.meta.url), 'utf8'))
  for (const sample of cases) {
    const session = engine.createSession(sample.question)
    assert.equal(session.cognitiveType, sample.type, sample.question)
    assert.equal(session.trace.at(-1).move, sample.initialMove, sample.question)
    assert.equal(engine.appendUserResponse(session, sample.answer).trace.at(-1).move, sample.nextMove, sample.question)
  }
})



test('第一人称行为模式不会被“选择”等关键词抢成决策题', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../evals/cognitive-edge-cases.json', import.meta.url), 'utf8'))
  for (const sample of cases) assert.equal(engine.classifyQuestion(sample.question), sample.type, sample.question)
})

test('带动作关键词的“我不知道”不会被误判为已经完成动作', () => {
  const cases = {
    clarify_focus: '我还不知道最想先弄清什么', state_position: '我不知道该怎么判断',
    specify_mechanism: '我不知道中间到底是怎么导致的', surface_assumption: '我不知道需要什么前提',
    generate_alternative: '我想不到另一种解释', seek_counterexample: '我想不到反例',
    request_source: '我没有找到原文', request_evidence: '我不知道需要什么证据',
    test_boundary: '我不知道取决于什么条件', define_criteria: '我不知道最重要的标准是什么',
    expose_tradeoff: '我不知道会有什么代价', isolate_blocker: '我不知道卡在哪一步',
    predict_next_step: '我不知道下一步是什么', clarify_concept: '我的理解是我还不懂',
    distinguish_fact_value: '我分不清事实和价值', specific_example: '我想不起最近一次具体发生什么',
    identify_trigger: '我不知道是什么触发的', find_exception: '我想不到例外',
    formulate_test: '我不知道怎么验证', synthesize: '我现在还不知道怎么总结',
  }
  for (const [move, answer] of Object.entries(cases)) {
    let session = engine.createSessionBase('测试问题')
    session = engine.appendIntervention(session, { move, content: '测试追问', source: 'local' })
    const appended = engine.appendUserTrace(session, answer)
    const analysis = engine.analyzeResponse(appended.session, appended.userItem)
    assert.equal(analysis.engagement, 'stuck', `${move}: ${answer}`)
    assert.deepEqual(analysis.completedMoveEvidence, [], `${move}: ${answer}`)
  }
})

test('“不知道，但我有一个判断”仍可算作有效立场', () => {
  const session = engine.appendUserResponse(engine.createSession('AI 会不会影响学习？'), '不知道，但我猜可能会。')
  assert.equal(session.analyses.at(-1).engagement, 'engaged')
  assert.ok(session.cognitiveState.completedMoves.includes('state_position'))
})

test('回答局部追问不会覆盖对原问题的当前判断', () => {
  let session = engine.createSession('AI 会不会让学生变懒？')
  session = engine.appendUserResponse(session, '我觉得会，因为直接拿答案减少独立练习。')
  const position = session.cognitiveState.currentPosition
  session = engine.appendUserResponse(session, '通过跳过自己尝试，使得练习量变少。')
  session = engine.appendUserResponse(session, '也可能是课程太难，让人更依赖工具。')
  assert.equal(session.cognitiveState.currentPosition, position)
  const draft = reflection.reflectionDraft(session)
  assert.equal(draft.currentJudgment, position)
  assert.equal(draft.openQuestion, '')
})

test('首次提问不代表用户完成了思考', () => {
  const session = engine.createSession('AI 会不会让大学生越来越不会思考？')
  assert.equal(session.schemaVersion, 5)
  assert.equal(session.trace.at(-1).move, 'state_position')
  assert.deepEqual(session.cognitiveState.completedMoves, [])
})

test('不知道时保持原动作，降低问题难度，不虚构进展', () => {
  const initial = engine.createSession('AI 会不会让大学生越来越不会思考？')
  const session = engine.appendUserResponse(initial, '不知道')
  assert.equal(session.analyses.at(-1).engagement, 'stuck')
  assert.equal(session.trace.at(-1).move, 'state_position')
  assert.notEqual(session.trace.at(-1).content, initial.trace.at(-1).content)
  assert.equal(session.cognitiveState.currentPosition, '')
  assert.deepEqual(session.cognitiveState.completedMoves, [])
})

test('本地模式六轮卡住时不强制整合，也不一直重复索要立场', () => {
  let session = engine.createSession('AI 会不会让大学生越来越不会思考？')
  for (let round = 0; round < 6; round++) session = engine.appendUserResponse(session, '我还不知道')
  assert.notEqual(session.trace.at(-1).move, 'synthesize')
  assert.ok(!session.cognitiveState.completedMoves.includes('state_position'))
  assert.ok(new Set(session.trace.filter((item) => item.move).map((item) => item.move)).size > 1)
})

test('回答给出立场和机制后，才推进到下一项缺失动作', () => {
  let session = engine.createSession('AI 会不会让大学生越来越不会思考？')
  session = engine.appendUserResponse(session, '我觉得会，因为很多人遇到问题直接问 AI。')
  assert.equal(session.trace.at(-1).move, 'specify_mechanism')
  assert.ok(!session.cognitiveState.completedMoves.includes('specify_mechanism'))
  session = engine.appendUserResponse(session, '通过跳过独立尝试，使得必要的练习变少。')
  assert.equal(session.trace.at(-1).move, 'generate_alternative')
  assert.ok(session.cognitiveState.completedMoves.includes('specify_mechanism'))
})

test('主动提出替代解释后，不重复要求同一个动作', () => {
  let session = engine.createSession('AI 会不会让大学生越来越不会思考？')
  session = engine.appendUserResponse(session, '我觉得可能会，但也可能是原来的学习习惯让人直接找答案。')
  assert.ok(session.cognitiveState.completedMoves.includes('generate_alternative'))
  assert.notEqual(session.trace.at(-1).move, 'generate_alternative')
})

test('纯应答词和较长未知表达不算完成；不会可以作为因果问题的立场', () => {
  for (const answer of ['嗯', '好的', '我不知道怎么回答', '暂时想不出来']) {
    const session = engine.appendUserResponse(engine.createSession('AI 会不会影响学习？'), answer)
    assert.deepEqual(session.cognitiveState.completedMoves, [], answer)
  }
  const session = engine.appendUserResponse(engine.createSession('AI 会不会影响学习？'), '不会')
  assert.ok(session.cognitiveState.completedMoves.includes('state_position'))
})

test('一句回答就可以主动整理，观点无需改变', () => {
  const initial = engine.createSession('我该不该参加这个活动？')
  assert.equal(engine.isReadyToSynthesize(initial), false)
  const session = engine.appendUserResponse(initial, '我还不知道')
  assert.equal(engine.isReadyToSynthesize(session), true)
  assert.match(engine.generateQuestionLocal('synthesize', session), /不变/)
})

test('二十种动作都有提示和单一追问', () => {
  const session = engine.createSession('我想弄清楚一个问题？')
  for (const move of engine.allCognitiveMoves) {
    const support = engine.getQuestionSupport(move, session)
    assert.ok(support.hint.length > 8, move)
    assert.equal((support.rephrase.match(/[？?]/g) || []).length, 1, move)
    assert.equal((engine.generateQuestionLocal(move, session).match(/[？?]/g) || []).length, 1, move)
  }
})

test('使用提示保存真实展示记录，不推动认知状态；重复点击不会重复归档', () => {
  const session = engine.createSession('我该不该参加这个活动？')
  const question = session.trace.at(-1)
  const supported = reflection.recordSupport(session, question.id, 'hint', '一个提示')
  assert.deepEqual(supported.cognitiveState, session.cognitiveState)
  assert.equal(supported.supportRecords.length, 1)
  assert.equal(reflection.recordSupport(supported, question.id, 'hint', '一个提示').supportRecords.length, 1)
})

test('成果草稿不替用户宣称收获，也不将不知道写作初始判断', () => {
  let session = engine.createSession('AI 会不会影响学习？')
  session = engine.appendUserResponse(session, '不知道')
  session = engine.appendUserResponse(session, '我觉得取决于是否先独立尝试。')
  const draft = reflection.reflectionDraft(session)
  assert.equal(draft.initialJudgment, '我觉得取决于是否先独立尝试。')
  assert.equal(draft.keyDiscovery, '')
})

test('验证结果追加存档，保留原有判断与之前的回看', () => {
  const session = { ...engine.createSession('AI 会不会影响学习？'), status: 'completed', summary: { currentJudgment: '暂时无法判断', changed: '' }, verification: { action: '先自己尝试再问 AI', status: 'planned', reviews: [] } }
  assert.throws(() => reflection.reviewVerification(session, '  '))
  const first = reflection.reviewVerification(session, '这次可以独立完成类似题', '求助也可能帮助学习')
  const second = reflection.reviewVerification(first, '另一题仍然需要帮助')
  assert.equal(second.verification.status, 'reviewed')
  assert.equal(second.verification.reviews.length, 2)
  assert.equal(second.summary.currentJudgment, '暂时无法判断')
  assert.equal(session.verification.reviews.length, 0)
})
