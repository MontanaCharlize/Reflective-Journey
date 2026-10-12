import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs, memoryStorage } from './load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts')
const storage = await loadTs('src/lib/storage.ts')
const exporter = await loadTs('src/lib/export.ts')

test('V0.4 迁移保留原记录并修正问过即完成的状态', () => {
  globalThis.localStorage = memoryStorage()
  const legacy = { ...engine.createSession('AI 会不会影响学习？'), schemaVersion: 4 }
  legacy.cognitiveState.completedMoves = ['state_position']
  delete legacy.supportRecords
  const oldJson = JSON.stringify([legacy])
  localStorage.setItem('reflective-journey/v0.4/sessions', oldJson)
  const session = storage.loadSessions()[0]
  assert.equal(session.schemaVersion, 5)
  assert.deepEqual(session.cognitiveState.completedMoves, [])
  assert.deepEqual(session.trace, legacy.trace)
  assert.equal(localStorage.getItem('reflective-journey/v0.4/sessions'), oldJson)
  assert.equal(storage.loadSessions()[0].id, session.id)
})

test('V0.3 和 V0.2 均可迁移并继续读取', () => {
  for (const version of [2, 3]) {
    globalThis.localStorage = memoryStorage()
    let legacy = engine.appendUserResponse(engine.createSession('我该不该参加这个活动？'), '我更看重自己的兴趣和时间。')
    if (version === 3) { legacy.schemaVersion = 3; delete legacy.aiEvents; delete legacy.aiRuntime; delete legacy.supportRecords }
    else legacy = { id: legacy.id, question: legacy.question, cognitiveType: legacy.cognitiveType, createdAt: legacy.createdAt, updatedAt: legacy.updatedAt, status: legacy.status, trace: legacy.trace, interventionIndex: legacy.interventionIndex }
    localStorage.setItem('reflective-journey/v0.' + version + '/sessions', JSON.stringify([legacy]))
    const session = storage.loadSessions()[0]
    assert.equal(session.schemaVersion, 5)
    assert.equal(session.trace.filter((item) => item.kind === 'user').length, 1)
    assert.ok(session.cognitiveState.completedMoves.includes('define_criteria'))
    assert.deepEqual(session.aiEvents, [])
  }
})

test('回答、成果和回看草稿按会话隔离，删除不会影响另一会话', () => {
  globalThis.localStorage = memoryStorage()
  const first = storage.saveSession(engine.createSession('AI 会不会影响学习？'))
  const second = storage.saveSession(engine.createSession('我该不该参加这个活动？'))
  storage.saveDraft(first.id, { ...storage.emptyDraft(), response: '未提交的想法', nextAction: '一次尝试', reviewOutcome: '一条观察' })
  storage.saveDraft(second.id, { ...storage.emptyDraft(), currentJudgment: '另一个判断' })
  assert.equal(storage.loadDraft(first.id).response, '未提交的想法')
  assert.equal(storage.loadDraft(first.id).reviewOutcome, '一条观察')
  storage.deleteSession(first.id)
  assert.equal(storage.loadDraft(first.id).response, '')
  assert.equal(storage.loadDraft(second.id).currentJudgment, '另一个判断')
  assert.equal(storage.loadSessions().length, 1)
})

test('存储空间不足时显式报告，不伪装为已保存', () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  assert.throws(() => storage.saveSession(engine.createSession('AI 会不会影响学习？')), /无法保存/)
  assert.throws(() => storage.saveDraft('one', storage.emptyDraft()), /无法保存/)
})

test('Markdown 导出保留用户确认的成果、使用过的提示和验证回看', () => {
  const session = engine.createSession('AI 会不会影响学习？')
  session.summary = { initialJudgment: '原来的想法', currentJudgment: '当前的想法', changed: '', keyDiscovery: '我确认的发现', openQuestion: '还要核对的事' }
  session.supportRecords = [{ id: 'support', questionId: session.trace.at(-1).id, kind: 'rephrase', content: '实际展示的另一问法', createdAt: Date.now() }]
  session.verification = { action: '一次真实尝试', expectedSignal: '观察的信号', status: 'reviewed', reviews: [{ id: 'r1', createdAt: Date.now(), outcome: '实际观察的结果', revisedJudgment: '回看后的想法' }] }
  const markdown = exporter.sessionToMarkdown(session)
  for (const content of ['我确认的发现', '还要核对的事', '实际展示的另一问法', '一次真实尝试', '观察的信号', '实际观察的结果', '回看后的想法']) assert.ok(markdown.includes(content), content)
})
