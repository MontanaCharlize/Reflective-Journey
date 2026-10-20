import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createApplication } from '../server/application.mjs'
import { loadTs, memoryStorage } from './load-ts.mjs'

const engine = await loadTs('src/lib/engine.ts')
const storage = await loadTs('src/lib/storage.ts')
const workspace = await loadTs('src/lib/workspace.ts')
const notes = await loadTs('src/lib/quick-notes.ts')
const password = 'local-test-password-42'
async function fixture(options = {}) {
  const app = createApplication({ dbPath: ':memory:', ...options })
  const server = http.createServer((req, res) => { app.handle(req, res).then((handled) => { if (!handled) { res.statusCode = 404; res.end() } }) })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  let closed = false
  return { app, base, close: async () => { if (closed) return; closed = true; server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); app.close() } }
}
function client(base) {
  return {
    cookie: '',
    async request(route, body, extraHeaders = {}) {
      const response = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: base }), ...(this.cookie ? { Cookie: this.cookie } : {}), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) })
      const cookie = response.headers.get('set-cookie')
      if (cookie) this.cookie = cookie.split(';')[0]
      return { status: response.status, headers: response.headers, body: await response.json() }
    },
    register(username) { return this.request('/api/account/register', { username, displayName: username === 'alice' ? '甲的展示名称' : '乙的展示名称', password }) },
  }
}
const cardBody = (clientKey, sourceCardId) => ({ question: 'AI 怎样帮助独立思考？', fields: { currentJudgment: '先尝试再求助值得验证。', openQuestion: '能否独立完成类似任务？' }, clientKey, ...(sourceCardId ? { sourceCardId } : {}) })

test('账号持久会话采用 HttpOnly Cookie，口令与会话令牌不以明文入库', async () => {
  const f = await fixture()
  try {
    const a = client(f.base)
    const signup = await a.register('alice')
    assert.equal(signup.status, 200)
    assert.match(signup.headers.get('set-cookie'), /HttpOnly/)
    assert.match(signup.headers.get('set-cookie'), /SameSite=Lax/)
    const row = f.app.store.db.prepare('SELECT * FROM users').get()
    assert.notEqual(row.password_hash, password)
    assert.equal(row.password_hash.length, 128)
    assert.equal(f.app.store.db.prepare('SELECT token_hash FROM sessions').get().token_hash === a.cookie.split('=')[1], false)
    assert.equal((await a.request('/api/account/me')).body.user.id, signup.body.user.id)
    const oldCookie = a.cookie
    await a.request('/api/account/logout', {})
    a.cookie = oldCookie
    assert.equal((await a.request('/api/account/me')).body.user, null)
    assert.equal((await a.request('/api/account/login', { username: 'alice', password: 'wrong-password' })).status, 401)
    assert.equal((await a.request('/api/account/login', { username: 'ALICE', password })).status, 200)
  } finally { await f.close() }
})

test('跨站写入被拒绝；未登录只能读公开内容，不能发布', async () => {
  const f = await fixture()
  try {
    const guest = client(f.base)
    assert.equal((await guest.request('/api/community/cards')).status, 200)
    assert.equal((await guest.request('/api/community/cards', cardBody('guest'))).status, 401)
    assert.equal((await guest.request('/api/account/register', { username: 'alice', displayName: '甲', password }, { Origin: 'https://other.invalid' })).status, 403)
    assert.equal(f.app.store.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0)
  } finally { await f.close() }
})

test('两个独立客户端完成 A 分享、B 发现、B 带回关联成果', async () => {
  const f = await fixture()
  try {
    const a = client(f.base), b = client(f.base), guest = client(f.base)
    const au = (await a.register('alice')).body.user
    const bu = (await b.register('bob')).body.user
    assert.notEqual(a.cookie, b.cookie)
    const first = (await a.request('/api/community/cards', cardBody('a-first'))).body.card
    const feed = (await b.request('/api/community/cards')).body.cards
    assert.equal(feed[0].id, first.id)
    assert.equal(feed[0].author.id, au.id)
    assert.deepEqual(Object.keys(feed[0].fields).sort(), ['currentJudgment', 'openQuestion'])
    assert.ok(!JSON.stringify(feed).includes('password'))
    assert.ok(!JSON.stringify(feed).includes('username'))
    assert.ok(!JSON.stringify(feed).includes('cognitiveState'))
    const own = engine.createSessionBase(first.question)
    assert.equal(own.cognitiveState.currentPosition, '')
    assert.deepEqual(own.cognitiveState.completedMoves, [])
    const secondBody = cardBody('b-branch', first.id)
    secondBody.fields.currentJudgment = '我更想检查是否保留了最后的判断责任。'
    const second = (await b.request('/api/community/cards', secondBody)).body.card
    assert.equal(second.author.id, bu.id)
    const details = (await a.request('/api/community/cards/' + first.id)).body
    assert.equal(details.branches[0].id, second.id)
    assert.equal((await guest.request('/api/community/cards/' + second.id)).body.source.id, first.id)
  } finally { await f.close() }
})

test('公开快照拒绝私密字段与伪造作者，重试发布不会生成重复卡片', async () => {
  const f = await fixture()
  try {
    const a = client(f.base)
    await a.register('alice')
    assert.equal((await a.request('/api/community/cards', { ...cardBody('private'), trace: ['private'] })).status, 400)
    assert.equal((await a.request('/api/community/cards', { ...cardBody('author'), authorId: 'another-user' })).status, 400)
    assert.equal((await a.request('/api/community/cards', { ...cardBody('field'), fields: { aiEvents: 'private' } })).status, 400)
    const body = cardBody('stable-request')
    const first = await a.request('/api/community/cards', body)
    const repeated = await a.request('/api/community/cards', body)
    assert.equal(repeated.body.card.id, first.body.card.id)
    assert.equal((await a.request('/api/community/cards')).body.cards.length, 1)
  } finally { await f.close() }
})

test('只有作者可撤回；撤回后公众不可读，子分支不泄露撤回来源的内容', async () => {
  const f = await fixture()
  try {
    const a = client(f.base), b = client(f.base), guest = client(f.base)
    await a.register('alice'); await b.register('bob')
    const first = (await a.request('/api/community/cards', cardBody('a-first'))).body.card
    const second = (await b.request('/api/community/cards', cardBody('b-first', first.id))).body.card
    assert.equal((await b.request('/api/community/cards/' + first.id + '/withdraw', {})).status, 403)
    assert.equal((await a.request('/api/community/cards/' + first.id + '/withdraw', {})).body.card.status, 'withdrawn')
    assert.equal((await guest.request('/api/community/cards/' + first.id)).status, 404)
    assert.equal((await b.request('/api/community/cards/' + second.id)).body.source.status, 'unavailable')
    assert.equal((await b.request('/api/community/cards/' + second.id)).body.source.question, undefined)
    assert.equal((await a.request('/api/community/mine')).body.cards[0].fields.currentJudgment, first.fields.currentJudgment)
    assert.equal((await b.request('/api/community/mine')).body.cards.length, 1)
  } finally { await f.close() }
})

test('分页与搜索可用，游标错误得到明确回复', async () => {
  const f = await fixture({ clock: () => 1790000000000 })
  try {
    const a = client(f.base)
    await a.register('alice')
    for (let n = 0; n < 3; n++) await a.request('/api/community/cards', { ...cardBody('p-' + n), question: '独立思考问题 ' + n })
    const first = await a.request('/api/community/cards?limit=1')
    const second = await a.request('/api/community/cards?limit=1&cursor=' + encodeURIComponent(first.body.nextCursor))
    assert.notEqual(first.body.cards[0].id, second.body.cards[0].id)
    assert.equal((await a.request('/api/community/cards?q=' + encodeURIComponent('问题 2'))).body.cards.length, 1)
    assert.equal((await a.request('/api/community/cards?cursor=invalid')).status, 400)
  } finally { await f.close() }
})

test('账户在其他页面切换后，旧页面不能把内容发成新用户的分享', async () => {
  const f = await fixture()
  try {
    const a = client(f.base), b = client(f.base)
    const aid = (await a.register('alice')).body.user.id
    await b.register('bob')
    assert.equal((await b.request('/api/community/cards', cardBody('stale'), { 'X-RJ-User': aid })).body.code, 'ACCOUNT_CHANGED')
    assert.equal((await b.request('/api/account/logout', {}, { 'X-RJ-User': aid })).status, 409)
    assert.ok((await b.request('/api/account/me')).body.user)
  } finally { await f.close() }
})

test('模型接口须登录，按账户限制每日次数，超额继续允许本地流程', async () => {
  let calls = 0
  const fake = http.createServer(async (req, res) => {
    for await (const _ of req) {}
    calls++
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ question: '你现在最接近哪一个判断？' }) } }] }))
  })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const f = await fixture({ env: { DEEPSEEK_API_KEY: 'local-test-key', DEEPSEEK_BASE_URL: 'http://127.0.0.1:' + fake.address().port, AI_DAILY_LIMIT: '2', AI_MINUTE_LIMIT: '10', AI_ALLOW_LOCAL_GUEST: 'false' } })
  try {
    const a = client(f.base), b = client(f.base), guest = client(f.base)
    const body = { session: engine.createSessionBase('AI 会不会影响学习？'), move: 'state_position' }
    assert.equal((await guest.request('/api/ai/question', body)).status, 401)
    assert.equal(calls, 0)
    await a.register('alice'); await b.register('bob')
    assert.equal((await a.request('/api/ai/question', body)).body.ok, true)
    assert.equal((await a.request('/api/ai/question', body)).body.ok, true)
    assert.equal((await a.request('/api/ai/question', body)).body.code, 'AI_DAILY_LIMIT')
    assert.equal((await a.request('/api/account/me')).body.limits.remaining, 0)
    assert.equal((await b.request('/api/ai/question', body)).status, 200)
    assert.equal(calls, 3)
  } finally { await f.close(); fake.closeAllConnections(); await new Promise((resolve) => fake.close(resolve)) }
})

test('重启服务后账户、会话和公开卡仍保留', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rj-community-'))
  assert.equal(path.dirname(dir), path.resolve(os.tmpdir()))
  const filename = path.join(dir, 'data.sqlite')
  const first = await fixture({ dbPath: filename })
  let second
  try {
    const a = client(first.base)
    await a.register('alice')
    const card = (await a.request('/api/community/cards', cardBody('persist'))).body.card
    const cookie = a.cookie
    await first.close()
    second = await fixture({ dbPath: filename })
    const reopened = client(second.base); reopened.cookie = cookie
    assert.equal((await reopened.request('/api/account/me')).body.user.displayName, '甲的展示名称')
    assert.equal((await reopened.request('/api/community/cards/' + card.id)).body.card.id, card.id)
  } finally { await first.close(); if (second) await second.close(); await fs.rm(dir, { recursive: true, force: true }) }
})

test('本机工作区按账号隔离，主动带入访客记录时保留原记录及草稿', () => {
  globalThis.localStorage = memoryStorage()
  globalThis.window = { innerWidth: 1000, innerHeight: 800, dispatchEvent: () => true }
  workspace.setWorkspaceOwner(null)
  const guest = storage.saveSession(engine.createSession('我该不该参加活动？'))
  storage.saveDraft(guest.id, { ...storage.emptyDraft(), response: '访客的原草稿' })
  notes.saveQuickNote({ ...notes.defaultQuickNote({ width: 1000, height: 800 }), text: '访客笔记' })
  workspace.setWorkspaceOwner('alice')
  assert.equal(storage.loadSessions().length, 0)
  assert.equal(notes.loadQuickNote({ width: 1000, height: 800 }).text, '')
  assert.equal(storage.importGuestSessions([guest.id]), 1)
  assert.equal(storage.loadDraft(guest.id).response, '访客的原草稿')
  workspace.setWorkspaceOwner('bob')
  assert.equal(storage.loadSessions().length, 0)
  assert.equal(storage.loadDraft(guest.id).response, '')
  workspace.setWorkspaceOwner(null)
  assert.equal(storage.loadSessions()[0].id, guest.id)
  assert.equal(notes.loadQuickNote({ width: 1000, height: 800 }).text, '访客笔记')
})

test('邀请码仅在配置后要求，配置内容不会返回给客户端', async () => {
  const f = await fixture({ env: { COMMUNITY_INVITE_CODE: 'test-invite-only' } })
  try {
    const a = client(f.base)
    const info = await a.request('/api/account/me')
    assert.equal(info.body.registrationRequiresInvite, true)
    assert.ok(!JSON.stringify(info.body).includes('test-invite-only'))
    assert.equal((await a.register('alice')).status, 403)
    assert.equal((await a.request('/api/account/register', { username: 'alice', displayName: '甲', password, inviteCode: 'test-invite-only' })).status, 200)
  } finally { await f.close() }
})

test('全站模型上限不会被新增账户绕过，额度失败不会污染后续事务', async () => {
  const f = await fixture({ env: { AI_GLOBAL_DAILY_LIMIT: '2', AI_DAILY_LIMIT: '10', AI_MINUTE_LIMIT: '10' } })
  try {
    const a = (await client(f.base).register('alice')).body.user
    const b = (await client(f.base).register('bob')).body.user
    f.app.store.reserveAi(a.id)
    f.app.store.reserveAi(a.id)
    assert.throws(() => f.app.store.reserveAi(b.id), (error) => error.code === 'AI_GLOBAL_LIMIT')
    assert.equal(f.app.store.limits(b.id).used, 0)
    assert.equal(f.app.store.publish(b.id, cardBody('still-working')).author.id, b.id)
  } finally { await f.close() }
})

test('接续会话从空状态开始，公开来源只保留来源信息', async () => {
  const ai = await loadTs('src/lib/ai.ts')
  const oldFetch = globalThis.fetch
  globalThis.window = { setTimeout, clearTimeout }
  globalThis.localStorage = memoryStorage()
  workspace.setWorkspaceOwner(null)
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, message: 'local test' }), { headers: { 'Content-Type': 'application/json' } })
  try {
    const source = { cardId: 'public-card', question: 'AI 会不会影响学习？', authorName: '作者甲' }
    const session = await ai.createSessionSmart(source.question, { communitySource: source, dialogueMode: 'local' })
    assert.deepEqual(session.communitySource, source)
    assert.equal(session.cognitiveState.currentPosition, '')
    assert.deepEqual(session.cognitiveState.completedMoves, [])
    assert.equal(session.trace.at(-1).move, 'state_position')
  } finally { globalThis.fetch = oldFetch; workspace.setWorkspaceOwner(null) }
})

test('分钟额度到期后恢复，拒绝请求不会消耗每日额度', async () => {
  let now = 1790000000000
  const f = await fixture({ clock: () => now, env: { AI_MINUTE_LIMIT: '1' } })
  try {
    const a = (await client(f.base).register('alice')).body.user
    f.app.store.reserveAi(a.id)
    assert.throws(() => f.app.store.reserveAi(a.id), (error) => error.code === 'AI_RATE_LIMIT')
    assert.equal(f.app.store.limits(a.id).used, 1)
    now += 60000
    f.app.store.reserveAi(a.id)
    assert.equal(f.app.store.limits(a.id).used, 2)
  } finally { await f.close() }
})

test('内容反馈只进入运营队列，处理后公众不可读但作者副本仍在', async () => {
  const f = await fixture()
  try {
    const a = client(f.base), b = client(f.base), guest = client(f.base)
    await a.register('alice'); await b.register('bob')
    const card = (await a.request('/api/community/cards', cardBody('reported'))).body.card
    const route = '/api/community/cards/' + card.id + '/report'
    assert.equal((await guest.request(route, { reason: '测试内容反馈' })).status, 401)
    assert.equal((await b.request(route, { reason: '短' })).status, 400)
    assert.equal((await b.request(route, { reason: '测试内容反馈' })).status, 200)
    assert.equal((await b.request(route, { reason: '更新测试内容反馈' })).status, 200)
    const queue = f.app.store.moderationReports()
    assert.equal(queue.length, 1)
    assert.equal(queue[0].reason, '更新测试内容反馈')
    assert.ok(!JSON.stringify(queue).includes('username'))
    assert.equal((await guest.request('/api/community/reports')).status, 404)
    f.app.store.moderateWithdraw(card.id, '测试运营停止公开')
    assert.equal((await guest.request('/api/community/cards/' + card.id)).status, 404)
    assert.equal((await a.request('/api/community/mine')).body.cards[0].status, 'withdrawn')
    assert.equal(f.app.store.db.prepare('SELECT COUNT(*) AS n FROM moderation_actions').get().n, 1)
  } finally { await f.close() }
})
