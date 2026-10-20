import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs, memoryStorage } from './load-ts.mjs'
const engine = await loadTs('src/lib/engine.ts')
const storage = await loadTs('src/lib/storage.ts')
const workspace = await loadTs('src/lib/workspace.ts')
const links = await loadTs('src/lib/community-links.ts')

test('分享后回看链接跨读取保留，不改写私人表达或认知状态', () => {
  globalThis.localStorage = memoryStorage();workspace.setWorkspaceOwner('owner-a')
  const session = engine.appendUserResponse(engine.createSession('怎样安排阅读？'), '先读半小时，再记一个问题。')
  const before = JSON.stringify(session)
  const next = links.rememberPublishedCard(session, { id: 'card-link-one', createdAt: 100 })
  storage.saveSession(next)
  const restored = storage.loadSessions()[0]
  assert.deepEqual(restored.publishedCards, [{ cardId: 'card-link-one', createdAt: 100 }])
  assert.deepEqual(restored.trace, session.trace);assert.deepEqual(restored.cognitiveState, session.cognitiveState)
  assert.equal(JSON.stringify(session), before)
  workspace.setWorkspaceOwner('owner-b');assert.equal(storage.loadSessions().length, 0)
  workspace.setWorkspaceOwner('owner-a');assert.equal(storage.loadSessions()[0].publishedCards[0].cardId, 'card-link-one')
})

test('发布重试不重复记录链接，旧来源与独立思考保持各自状态', () => {
  const session = engine.createSession('怎样安排阅读？')
  session.communitySource = { cardId: 'source-card', question: session.question, authorName: '来源作者' }
  const once = links.rememberPublishedCard(session, { id: 'my-card', createdAt: 100 })
  const retried = links.rememberPublishedCard(once, { id: 'my-card', createdAt: 100 })
  assert.equal(retried.publishedCards.length, 1)
  assert.deepEqual(retried.communitySource, session.communitySource)
  assert.deepEqual(retried.cognitiveState, session.cognitiveState)
  assert.equal(engine.createSession(session.question).publishedCards, undefined)
})
