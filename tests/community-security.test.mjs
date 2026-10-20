import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createApplication } from '../server/application.mjs'
import { CommunityStore } from '../server/community-store.mjs'
import { CommunityFeatures } from '../server/community-features.mjs'
import { createModerationAccess } from '../server/moderation-access.mjs'

const password = 'isolated-community-security-password'
const registration = (username) => ({ username, displayName: username, password })
const payload = (key) => ({ question: '合成验收问题', fields: { keyDiscovery: '合成验收发现' }, clientKey: key })
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function temporary() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'rj-community-security-'))
}
function removeAfter(t, directory) {
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()))
    await fs.rm(directory, { recursive: true, force: true })
  })
}

async function serve(t, options = {}) {
  const app = createApplication({ dbPath: ':memory:', ...options })
  const server = http.createServer((req, res) => app.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); app.close() })
  const origin = 'http://127.0.0.1:' + server.address().port
  const client = () => ({ cookie: '', user: null,
    async request(route, body) {
      const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
      if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0]
      return { status: response.status, body: await response.json() }
    },
    async authenticate(username, mode = 'register') {
      const result = await this.request('/api/account/' + mode, registration(username))
      assert.equal(result.status, 200)
      this.user = result.body.user
      return this
    },
  })
  return { app, client }
}

test('未建立的旧运营用户名禁止公众抢注，稍后建立同名账户也不会自动获权', async (t) => {
  const f = await serve(t, { env: { COMMUNITY_MODERATOR_USERS: 'operator' } })
  const publicClient = f.client()
  for (const username of ['operator', ' OPERATOR ']) {
    const result = await publicClient.request('/api/account/register', registration(username))
    assert.equal(result.status, 409)
    assert.equal(result.body.code, 'RESERVED_ACCOUNT')
  }
  assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM users').get().n, 0)
  // 模拟启动后由持有数据库权限的操作员建号，验证旧配置不会动态匹配它。
  await f.app.store.register(registration('operator'))
  const late = await f.client().authenticate('operator', 'login')
  assert.equal(late.user.canModerate, false)
  assert.equal((await late.request('/api/community/moderation/reports')).status, 403)
  const ordinary = await f.client().authenticate('ordinary')
  assert.equal(ordinary.user.canModerate, false)
})

test('旧用户名配置只绑定启动时已有账户的 ID，不随之后的用户名变化转移权限', async () => {
  const store = new CommunityStore(':memory:')
  try {
    const operator = await store.register(registration('operator'))
    const access = createModerationAccess(store, { COMMUNITY_MODERATOR_USERS: ' OPERATOR ,future' })
    assert.equal(access.isModerator(operator), true)
    store.db.prepare('UPDATE users SET username=? WHERE id=?').run('renamed_operator', operator.id)
    const replacement = await store.register(registration('operator'))
    const late = await store.register(registration('future'))
    assert.equal(access.isModerator({ ...operator, username: 'renamed_operator' }), true)
    assert.equal(access.isModerator(replacement), false)
    assert.equal(access.isModerator(late), false)
    assert.equal(access.isReservedUsername(' FUTURE '), true)
  } finally { store.close() }
})

test('固定账户 ID 授权只允许指定的已有账户，公开注册不能指定身份取得权限', async (t) => {
  const directory = await temporary()
  const dbPath = path.join(directory, 'community.sqlite')
  const bootstrap = new CommunityStore(dbPath)
  let operator
  try { operator = await bootstrap.register(registration('actual_operator')) }
  finally { bootstrap.close() }
  const f = await serve(t, { dbPath, env: { COMMUNITY_MODERATOR_IDS: operator.id.toUpperCase() } })
  removeAfter(t, directory)
  const moderator = await f.client().authenticate('actual_operator', 'login')
  assert.equal(moderator.user.canModerate, true)
  assert.equal((await moderator.request('/api/community/moderation/reports')).status, 200)
  const ordinary = f.client()
  const registrationResult = await ordinary.request('/api/account/register', { ...registration('ordinary'), id: operator.id, canModerate: true })
  assert.equal(registrationResult.status, 200)
  assert.notEqual(registrationResult.body.user.id, operator.id)
  assert.equal(registrationResult.body.user.canModerate, false)
  assert.equal((await ordinary.request('/api/community/moderation/reports')).status, 403)
})

test('运营 ID 配置格式错误时拒绝启动，不把用户名误作固定身份', () => {
  assert.throws(() => createApplication({ dbPath: ':memory:', env: { COMMUNITY_MODERATOR_IDS: 'operator' } }), /COMMUNITY_MODERATOR_IDS/)
})

test('卡片编辑后旧运营决定被事务拒绝，刷新并核查新版本后才能处理', async (t) => {
  const directory = await temporary()
  const dbPath = path.join(directory, 'community.sqlite')
  const bootstrap = new CommunityStore(dbPath)
  let operator
  try { operator = await bootstrap.register(registration('operator')) }
  finally { bootstrap.close() }
  const f = await serve(t, { dbPath, env: { COMMUNITY_MODERATOR_IDS: operator.id } })
  removeAfter(t, directory)
  const moderator = await f.client().authenticate('operator', 'login')
  const author = await f.client().authenticate('author')
  const reporter = await f.client().authenticate('reporter')
  const card = (await author.request('/api/community/cards', payload('review-card'))).body.card
  const route = '/api/community/cards/' + card.id
  await reporter.request(route + '/report', { reason: '需要核查的合成内容' })
  const originalReport = (await moderator.request('/api/community/moderation/reports')).body.reports[0]
  assert.equal(originalReport.cardRevision, 1)
  const changed = await author.request(route + '/edit', { question: '已修正后的合成问题', fields: { currentJudgment: '已经修正的合成判断' }, revision: 1 })
  assert.equal(changed.body.card.revision, 2)
  const reviewRoute = '/api/community/moderation/reports/' + originalReport.id + '/resolve'
  const decision = { resolution: 'withdraw', note: '经过核查的处理说明', expectedAt: originalReport.createdAt }
  assert.equal((await moderator.request(reviewRoute, decision)).status, 400)
  for (const resolution of ['withdraw', 'keep']) {
    const stale = await moderator.request(reviewRoute, { ...decision, resolution, expectedRevision: 1 })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'REVIEW_CONFLICT')
  }
  assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM report_reviews').get().n, 0)
  assert.equal(f.app.store.db.prepare('SELECT COUNT(*) n FROM moderation_actions').get().n, 0)
  assert.equal((await reporter.request(route)).body.card.revision, 2)
  const current = (await moderator.request('/api/community/moderation/reports')).body.reports[0]
  assert.equal(current.cardRevision, 2)
  assert.equal(current.question, changed.body.card.question)
  assert.equal((await moderator.request(reviewRoute, { ...decision, expectedRevision: current.cardRevision })).status, 200)
  assert.equal((await reporter.request(route)).status, 404)
  assert.equal((await author.request(route)).body.card.status, 'withdrawn')
  assert.equal((await reporter.request('/api/community/my-feedback')).body.reports[0].resolution, 'withdraw')
})

test('离线运营 CLI 读取当前卡片版本并记录处理结果，不依赖私人环境文件', async (t) => {
  const directory = await temporary()
  removeAfter(t, directory)
  await fs.mkdir(path.join(directory, 'scripts'))
  await fs.mkdir(path.join(directory, 'server'))
  await fs.copyFile(path.join(project, 'scripts', 'moderate.mjs'), path.join(directory, 'scripts', 'moderate.mjs'))
  for (const file of await fs.readdir(path.join(project, 'server'))) if (file.endsWith('.mjs')) await fs.copyFile(path.join(project, 'server', file), path.join(directory, 'server', file))
  const dbPath = path.join(directory, 'community.sqlite')
  let store = new CommunityStore(dbPath)
  let reportId
  try {
    const author = await store.register(registration('author')), reporter = await store.register(registration('reporter'))
    const features = new CommunityFeatures(store)
    const card = store.publish(author.id, payload('cli-card'))
    features.report(card.id, reporter.id, '需要本机核查的合成内容')
    reportId = features.reports().reports[0].id
    features.edit(card.id, author.id, { question: '本机核查前已更新的问题', fields: card.fields, revision: 1 })
  } finally { store.close() }
  const result = spawnSync(process.execPath, [path.join(directory, 'scripts', 'moderate.mjs'), 'review', reportId, 'keep', '已经核查当前内容'], { cwd: directory, env: { ...process.env, COMMUNITY_DB_PATH: dbPath }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /处理结果已保存/)
  store = new CommunityStore(dbPath)
  try {
    const feedback = new CommunityFeatures(store).reports({ status: 'resolved' }).reports[0]
    assert.equal(feedback.id, reportId)
    assert.equal(feedback.cardRevision, 2)
    assert.equal(feedback.resolution, 'keep')
    assert.equal(feedback.cardStatus, 'public')
  } finally { store.close() }
})
