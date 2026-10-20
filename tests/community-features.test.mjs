import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createApplication } from '../server/application.mjs'
import { CommunityStore } from '../server/community-store.mjs'
import { loadTs } from './load-ts.mjs'

const password = 'community-feature-test-password'
const bodyFor = (clientKey, sourceCardId) => ({ question: '如何把 AI 用在独立思考之后？', fields: { currentJudgment: '先自己尝试，再检查遗漏。' }, clientKey, ...(sourceCardId ? { sourceCardId } : {}) })
async function setup(options = {}) {
  const { existingUsers = [], ...applicationOptions } = options
  let fixtureDir
  if (existingUsers.length) {
    assert.equal(applicationOptions.dbPath, undefined)
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rj-moderators-'))
    applicationOptions.dbPath = path.join(fixtureDir, 'community.sqlite')
    const bootstrap = new CommunityStore(applicationOptions.dbPath)
    try { for (const username of existingUsers) await bootstrap.register({ username, displayName: '作者' + username, password }) }
    finally { bootstrap.close() }
  }
  const app = createApplication({ dbPath: ':memory:', ...applicationOptions })
  const server = http.createServer((req, res) => app.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = 'http://127.0.0.1:' + server.address().port
  function client() {
    return { cookie: '', user: null,
      async request(route, body, headers = {}) {
        const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
        if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0]
        return { status: response.status, body: await response.json() }
      },
      async register(username) { const result = await this.request('/api/account/register', { username, displayName: '作者' + username, password }); assert.equal(result.status, 200); this.user = result.body.user; return this },
      async login(username) { const result = await this.request('/api/account/login', { username, password }); assert.equal(result.status, 200); this.user = result.body.user; return this },
      async publish(key, source) { const result = await this.request('/api/community/cards', bodyFor(key, source)); assert.equal(result.status, 200); return result.body.card },
    }
  }
  return { app, client, async close() { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); app.close(); if (fixtureDir) { assert.equal(path.dirname(fixtureDir), path.resolve(os.tmpdir())); await fs.rm(fixtureDir, { recursive: true, force: true }) } } }
}

test('收藏服务端持久且仅自己可见，撤回卡片不会从收藏泄露', async () => {
  const f = await setup()
  try {
    const a = await f.client().register('alice'), b = await f.client().register('bob'), guest = f.client()
    const card = await a.publish('original')
    const url = '/api/community/cards/' + card.id
    assert.equal((await guest.request(url + '/bookmark', { saved: true })).status, 401)
    assert.equal((await b.request(url + '/bookmark', { saved: true })).body.bookmarked, true)
    await b.request(url + '/bookmark', { saved: true })
    assert.equal((await b.request('/api/community/bookmarks')).body.cards.length, 1)
    assert.equal((await a.request('/api/community/bookmarks')).body.cards.length, 0)
    assert.equal((await guest.request(url)).body.card.bookmarked, false)
    assert.equal((await b.request(url)).body.card.bookmarked, true)
    await a.request(url + '/withdraw', {})
    assert.equal((await b.request('/api/community/bookmarks')).body.cards.length, 0)
    assert.equal((await b.request(url)).status, 404)
    assert.equal((await b.request(url + '/bookmark', { saved: false })).status, 200)
  } finally { await f.close() }
})

test('公开主页只提供展示资料和公开成果，账号及运营权限不公开', async () => {
  const f = await setup({ existingUsers: ['alice'], env: { COMMUNITY_MODERATOR_USERS: 'alice' } })
  try {
    const a = await f.client().login('alice'), guest = f.client()
    const card = await a.publish('one')
    const saved = await a.request('/api/account/profile', { displayName: '新的展示名称', bio: '我关注怎样独立形成判断。' })
    assert.equal(saved.body.user.canModerate, true)
    const profile = (await guest.request('/api/community/authors/' + a.user.id)).body.profile
    assert.equal(profile.displayName, '新的展示名称')
    assert.equal(profile.bio, '我关注怎样独立形成判断。')
    assert.equal(profile.shares, 1)
    assert.ok(!JSON.stringify(profile).includes('username'))
    assert.ok(!JSON.stringify(profile).includes('canModerate'))
    assert.equal((await guest.request('/api/community/cards/' + card.id)).body.card.author.displayName, profile.displayName)
    assert.equal((await a.request('/api/account/profile', { displayName: '改名', bio: '', canModerate: true })).status, 400)
    await a.request('/api/community/cards/' + card.id + '/withdraw', {})
    assert.equal((await guest.request('/api/community/authors/' + a.user.id)).body.profile.shares, 0)
    assert.equal((await guest.request('/api/community/authors/' + a.user.id + '/cards')).body.cards.length, 0)
  } finally { await f.close() }
})

test('发现可按独立与接续筛选，搜索成果和作者，特殊字符按字面匹配', async () => {
  const f = await setup()
  try {
    const a = await f.client().register('alice'), b = await f.client().register('bob')
    const first = await a.publish('root')
    await b.request('/api/community/cards', { ...bodyFor('branch', first.id), question: '100% 的 test_name 是否可靠？', fields: { keyDiscovery: '先检查边界条件。' } })
    assert.equal((await b.request('/api/community/cards?kind=original')).body.cards.length, 1)
    assert.equal((await a.request('/api/community/cards?kind=branch')).body.cards.length, 1)
    for (const query of ['%', '_', '边界条件', '作者bob']) assert.equal((await a.request('/api/community/cards?q=' + encodeURIComponent(query))).body.cards.length, 1)
    assert.equal((await a.request('/api/community/cards?kind=invalid')).status, 400)
    assert.equal((await a.request('/api/community/cards?q=' + encodeURIComponent("' OR 1=1 --"))).body.cards.length, 0)
  } finally { await f.close() }
})

test('我的分享和作者主页分页不会在一百条处截断，筛选游标不能混用', async () => {
  let now = 1790000000000
  const f = await setup({ clock: () => now })
  try {
    const a = await f.client().register('alice')
    for (let n = 0; n < 105; n++) { now += n > 0 && n % 20 === 0 ? 86400001 : 1; f.app.store.publish(a.user.id, bodyFor('page-' + n)) }
    for (const route of ['/api/community/mine', '/api/community/authors/' + a.user.id + '/cards']) {
      const ids = new Set(); let cursor = ''
      do { const page = (await a.request(route + '?limit=40&cursor=' + encodeURIComponent(cursor))).body; page.cards.forEach((card) => ids.add(card.id)); cursor = page.nextCursor } while (cursor)
      assert.equal(ids.size, 105)
    }
    const page = await a.request('/api/community/mine?limit=1')
    assert.equal((await a.request('/api/community/mine?status=withdrawn&cursor=' + encodeURIComponent(page.body.nextCursor))).status, 400)
  } finally { await f.close() }
})

test('分享接续事务生成一条提醒，幂等重试和接续自己不会重复提醒', async () => {
  const f = await setup()
  try {
    const a = await f.client().register('alice'), b = await f.client().register('bob')
    const first = await a.publish('root'), branch = await b.publish('branch', first.id)
    await b.publish('branch', first.id)
    await a.publish('self-branch', first.id)
    const notifications = (await a.request('/api/community/notifications')).body
    assert.equal(notifications.unread, 1)
    assert.equal(notifications.notifications.length, 1)
    assert.equal(notifications.notifications[0].cardId, branch.id)
    const id = notifications.notifications[0].id
    await b.request('/api/community/notifications/read', { ids: [id] })
    assert.equal((await a.request('/api/account/me')).body.unreadNotifications, 1)
    await a.request('/api/community/notifications/read', { all: true })
    assert.equal((await a.request('/api/community/notifications')).body.unread, 0)
    await b.request('/api/community/cards/' + branch.id + '/withdraw', {})
    assert.equal((await a.request('/api/community/notifications')).body.notifications.length, 0)
  } finally { await f.close() }
})

test('超过四十条接续仍可分页，根卡撤回后提醒与来源路径不再公开根内容', async () => {
  let now = 1790000000000
  const f = await setup({ clock: () => now })
  try {
    const a = await f.client().register('alice'), b = await f.client().register('bob')
    const root = f.app.store.publish(a.user.id, { ...bodyFor('root'), question: '要撤回的独特根问题' })
    let last
    for (let n = 0; n < 45; n++) { now += n > 0 && n % 20 === 0 ? 86400001 : 1; last = f.app.store.publish(b.user.id, bodyFor('b-' + n, root.id)) }
    const details = (await a.request('/api/community/cards/' + root.id)).body
    assert.equal(details.card.branchCount, 45)
    assert.ok(details.nextBranchCursor)
    const ids = new Set(details.branches.map((card) => card.id)); let cursor = details.nextBranchCursor
    do { const page = (await a.request('/api/community/cards/' + root.id + '/branches?cursor=' + encodeURIComponent(cursor))).body; page.cards.forEach((card) => ids.add(card.id)); cursor = page.nextCursor } while (cursor)
    assert.equal(ids.size, 45)
    const grand = f.app.store.publish(a.user.id, bodyFor('grand', last.id))
    await a.request('/api/community/cards/' + root.id + '/withdraw', {})
    const response = (await b.request('/api/community/cards/' + grand.id)).body
    assert.equal(response.ancestors[0].status, 'unavailable')
    assert.equal(response.source.id, last.id)
    assert.ok(!JSON.stringify(response).includes('要撤回的独特根问题'))
    assert.equal((await a.request('/api/account/me')).body.unreadNotifications, 0)
  } finally { await f.close() }
})

test('编辑仅改变确认的公开副本，移除字段真实生效，旧版本不会覆盖新版本', async () => {
  const f = await setup()
  try {
    const a = await f.client().register('alice'), b = await f.client().register('bob')
    const card = await a.publish('root'), url = '/api/community/cards/' + card.id
    const edit = { question: '修改后的公开问题', fields: { keyDiscovery: '只留下这一项发现。' }, revision: 1 }
    assert.equal((await b.request(url + '/edit', edit)).status, 403)
    assert.equal((await a.request(url + '/edit', { ...edit, trace: ['private'] })).status, 400)
    const changed = await a.request(url + '/edit', edit)
    assert.equal(changed.body.card.revision, 2)
    assert.equal(changed.body.card.fields.currentJudgment, undefined)
    assert.equal((await a.request(url + '/edit', edit)).body.code, 'EDIT_CONFLICT')
    assert.equal((await b.request(url)).body.card.question, edit.question)
    assert.equal((await a.request('/api/community/cards', bodyFor('root'))).status, 409)
    await a.request(url + '/withdraw', {})
    assert.equal((await a.request(url + '/edit', { ...edit, revision: 2 })).status, 409)
    assert.equal((await a.request('/api/community/mine')).status, 200)
  } finally { await f.close() }
})

test('只有服务器配置的运营账户可处理反馈，处理结果只对反馈本人可见', async () => {
  const f = await setup({ existingUsers: ['operator'], env: { COMMUNITY_MODERATOR_USERS: 'operator' } })
  try {
    const a = await f.client().register('alice'), b = await f.client().register('bob'), moderator = await f.client().login('operator')
    assert.equal(a.user.canModerate, false); assert.equal(moderator.user.canModerate, true)
    const card = await a.publish('root')
    await b.request('/api/community/cards/' + card.id + '/report', { reason: '需要核查的具体测试内容' })
    assert.equal((await a.request('/api/community/moderation/reports')).status, 403)
    assert.equal((await a.request('/api/community/my-feedback')).body.reports.length, 0)
    const report = (await moderator.request('/api/community/moderation/reports')).body.reports[0]
    const decision = { resolution: 'keep', note: '已检查测试内容，保留公开。', expectedAt: report.createdAt, expectedRevision: report.cardRevision }
    assert.equal((await b.request('/api/community/moderation/reports/' + report.id + '/resolve', decision)).status, 403)
    assert.equal((await moderator.request('/api/community/moderation/reports/' + report.id + '/resolve', decision)).status, 200)
    const feedback = (await b.request('/api/community/my-feedback')).body.reports[0]
    assert.equal(feedback.note, decision.note)
    assert.equal(feedback.resolution, 'keep')
    const publicly = JSON.stringify((await a.request('/api/community/cards/' + card.id)).body)
    assert.ok(!publicly.includes(decision.note)); assert.ok(!publicly.includes(report.reason))
    assert.equal((await moderator.request('/api/community/moderation/reports/' + report.id + '/resolve', decision)).status, 409)
  } finally { await f.close() }
})

test('运营停止公开同时收回发现、作者页、收藏、提醒及来源可见性', async () => {
  const f = await setup({ existingUsers: ['operator'], env: { COMMUNITY_MODERATOR_USERS: 'operator' } })
  try {
    const a = await f.client().register('alice'), b = await f.client().register('bob'), moderator = await f.client().login('operator')
    const parent = await a.publish('root'), branch = await b.publish('branch', parent.id)
    await b.request('/api/community/cards/' + parent.id + '/bookmark', { saved: true })
    await b.request('/api/community/cards/' + parent.id + '/report', { reason: '测试停止公开的操作闭环' })
    const report = (await moderator.request('/api/community/moderation/reports')).body.reports[0]
    assert.equal((await moderator.request('/api/community/moderation/reports/' + report.id + '/resolve', { resolution: 'withdraw', note: '已核查，测试停止公开。', expectedAt: report.createdAt, expectedRevision: report.cardRevision })).status, 200)
    assert.equal((await b.request('/api/community/cards/' + parent.id)).status, 404)
    assert.equal((await b.request('/api/community/bookmarks')).body.cards.length, 0)
    assert.equal((await b.request('/api/community/authors/' + a.user.id + '/cards')).body.cards.length, 0)
    assert.equal((await a.request('/api/community/notifications')).body.notifications.length, 0)
    assert.equal((await b.request('/api/community/cards/' + branch.id)).body.source.status, 'unavailable')
    assert.equal((await a.request('/api/community/mine')).body.cards[0].status, 'withdrawn')
    assert.equal((await b.request('/api/community/my-feedback')).body.reports[0].question, null)
  } finally { await f.close() }
})

test('反馈被更新后重新进入待处理队列，旧处理页面会提示冲突', async () => {
  let now = 1790000000000
  const f = await setup({ existingUsers: ['alice'], clock: () => now, env: { COMMUNITY_MODERATOR_USERS: 'alice' } })
  try {
    const a = await f.client().login('alice'), b = await f.client().register('bob'), card = await a.publish('root')
    const url = '/api/community/cards/' + card.id + '/report'
    await b.request(url, { reason: '最初需要核对的地方' })
    const report = (await a.request('/api/community/moderation/reports')).body.reports[0]
    now++
    await b.request(url, { reason: '补充后的新反馈内容' })
    assert.equal((await a.request('/api/community/moderation/reports/' + report.id + '/resolve', { resolution: 'keep', note: '旧页面的处理说明', expectedAt: report.createdAt, expectedRevision: report.cardRevision })).status, 409)
    const updated = (await a.request('/api/community/moderation/reports')).body.reports[0]
    await a.request('/api/community/moderation/reports/' + report.id + '/resolve', { resolution: 'keep', note: '已根据补充内容核查', expectedAt: updated.createdAt, expectedRevision: updated.cardRevision })
    now++; await b.request(url, { reason: '再次发现需要核对的内容' })
    assert.equal((await a.request('/api/community/moderation/reports')).body.reports.length, 1)
    assert.equal((await b.request('/api/community/my-feedback')).body.reports[0].resolution, null)
  } finally { await f.close() }
})

test('新增私人接口同样拒绝过期页面的账户身份和跨站写入', async () => {
  const f = await setup()
  try {
    const a = await f.client().register('alice'), b = await f.client().register('bob'), guest = f.client()
    for (const route of ['/api/community/bookmarks', '/api/community/notifications', '/api/community/my-feedback']) {
      assert.equal((await b.request(route, undefined, { 'X-RJ-User': a.user.id })).status, 409)
      assert.equal((await guest.request(route)).status, 401)
    }
    assert.equal((await b.request('/api/account/profile', { displayName: '试改名字', bio: '' }, { Origin: 'https://other.invalid' })).status, 403)
    assert.equal((await b.request('/api/account/profile', { displayName: '试改名字', bio: '' }, { 'X-RJ-User': a.user.id })).status, 409)
  } finally { await f.close() }
})

test('旧数据库无损升级，重启后收藏、资料、编辑版本与提醒仍保留', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rj-v07-'))
  const filename = path.join(dir, 'community.sqlite')
  let f
  try {
    const legacy = new CommunityStore(filename), user = await legacy.register({ username: 'legacy', displayName: '旧用户', password })
    const oldCard = legacy.publish(user.id, bodyFor('legacy'))
    legacy.close()
    f = await setup({ dbPath: filename })
    const a = f.client(), b = await f.client().register('bob')
    await a.request('/api/account/login', { username: 'legacy', password })
    assert.equal((await a.request('/api/community/cards/' + oldCard.id)).body.card.question, oldCard.question)
    await b.request('/api/community/cards/' + oldCard.id + '/bookmark', { saved: true })
    await b.publish('branch', oldCard.id)
    await a.request('/api/account/profile', { displayName: '新名字', bio: '保存下来的简介' })
    await a.request('/api/community/cards/' + oldCard.id + '/edit', { question: '已更新的旧思考', fields: oldCard.fields, revision: 1 })
    const ac = a.cookie, bc = b.cookie
    await f.close(); f = null
    f = await setup({ dbPath: filename })
    const aa = f.client(), bb = f.client(); aa.cookie = ac; bb.cookie = bc
    assert.equal((await bb.request('/api/community/bookmarks')).body.cards[0].revision, 2)
    assert.equal((await aa.request('/api/community/authors/' + user.id)).body.profile.bio, '保存下来的简介')
    assert.equal((await aa.request('/api/community/notifications')).body.unread, 1)
  } finally { if (f) await f.close(); assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }) }
})

test('作者与社区私人页面支持独立地址，坏编码不会让路由崩溃', async () => {
  const routes = await loadTs('src/lib/navigation.ts')
  for (const view of ['discover', 'shares', 'bookmarks', 'notifications', 'feedback', 'moderation']) assert.equal(routes.readRoute(routes.routeHash(view)).view, view)
  assert.deepEqual(routes.readRoute(routes.routeHash('author', 'a-user-id')), { view: 'author', cardId: 'a-user-id' })
  assert.equal(routes.readRoute('#/people/%wrong').cardId, 'invalid')
})

test('社区连接中断和超时提供可重试提示，并保留服务端的权限错误', async () => {
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window
  let pending, cleared = 0, scheduled = 0
  globalThis.window = { setTimeout(callback) { pending = callback; return ++scheduled }, clearTimeout() { cleared++ } }
  const api = await loadTs('src/lib/community.ts')
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
    await assert.rejects(api.getFeed(), (error) => error.code === 'CONNECTION_FAILED' && /网络/.test(error.message))
    globalThis.fetch = async (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); queueMicrotask(() => pending()) })
    await assert.rejects(api.getBookmarks(), (error) => error.code === 'REQUEST_TIMEOUT' && /超时/.test(error.message))
    globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, code: 'NOT_OWNER', message: '只有作者可以编辑。' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
    await assert.rejects(api.getFeed(), (error) => error.status === 403 && error.code === 'NOT_OWNER' && error.message === '只有作者可以编辑。')
    assert.equal(cleared, scheduled)
  } finally { globalThis.fetch = oldFetch; globalThis.window = oldWindow }
})
