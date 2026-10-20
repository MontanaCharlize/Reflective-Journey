import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { CommunityStore } from '../server/community-store.mjs'
import { CommunityFeatures } from '../server/community-features.mjs'
import { CommunityPaths } from '../server/community-paths.mjs'
import { createApplication } from '../server/application.mjs'

async function fixture(t, length = 13) {
  const store = new CommunityStore(':memory:')
  t.after(() => store.close())
  new CommunityFeatures(store)
  const author = await store.register({ username: 'path_author', displayName: '路径验收作者', password: 'synthetic-path-password' })
  const chain = []
  for (let i = 0; i < length; i++) chain.push(store.publish(author.id, { question: `虚构问题第${i}层`, fields: { currentJudgment: `第${i}层独立判断` }, clientKey: `path-${i}`, ...(i ? { sourceCardId: chain[i - 1].id } : {}) }))
  return { store, author, chain, paths: new CommunityPaths(store) }
}

test('超过八层的思考来源可逐页读取，保持从早到近的顺序', async (t) => {
  const { paths, chain } = await fixture(t)
  const first = paths.ancestors(chain.at(-1).id)
  assert.equal(first.ancestors.length, 8);assert.ok(first.nextCursor)
  const older = paths.ancestors(chain.at(-1).id, { cursor: first.nextCursor })
  assert.equal(older.nextCursor, null)
  assert.deepEqual([...older.ancestors, ...first.ancestors].map((card) => card.id), chain.slice(0, -1).map((card) => card.id))
  assert.equal(new Set([...older.ancestors, ...first.ancestors].map((card) => card.id)).size, 12)
})

test('来源撤回后只留下不可用标记，不泄露原题目、作者或更早的关系', async (t) => {
  const { paths, chain, store, author } = await fixture(t)
  store.withdraw(chain[8].id, author.id)
  for (const viewerId of [null, author.id]) {
    const result = paths.ancestors(chain.at(-1).id, { viewerId })
    assert.equal(result.stopped, 'unavailable');assert.equal(result.nextCursor, null)
    assert.deepEqual(result.ancestors[0], { id: chain[8].id, status: 'unavailable' })
    assert.doesNotMatch(JSON.stringify(result), /虚构问题第8层|第8层独立判断|虚构问题第7层/)
    assert.equal(result.ancestors.length, 4)
  }
})

test('翻页期间撤回的来源重新校验权限，不通过旧游标重新公开', async (t) => {
  const { paths, chain, store, author } = await fixture(t)
  const first = paths.ancestors(chain.at(-1).id, { limit: 2 })
  store.withdraw(chain[9].id, author.id)
  const next = paths.ancestors(chain.at(-1).id, { cursor: first.nextCursor, limit: 2 })
  assert.deepEqual(next.ancestors, [{ id: chain[9].id, status: 'unavailable' }])
  assert.equal(next.nextCursor, null)
})

test('来源游标不能被篡改、跨卡片或跨身份使用，读取规模有上限', async (t) => {
  const { paths, chain, author } = await fixture(t)
  const cursor = paths.ancestors(chain.at(-1).id).nextCursor
  const [body, signature] = cursor.split('.')
  const forged = JSON.parse(Buffer.from(body, 'base64url').toString())
  forged.nextId = chain[1].id
  const changed = Buffer.from(JSON.stringify(forged)).toString('base64url') + '.' + signature
  for (const options of [{ cursor: changed }, { cursor, viewerId: author.id }, { limit: 100000 }]) assert.throws(() => paths.ancestors(chain.at(-1).id, options), (error) => error.status === 400)
  assert.throws(() => paths.ancestors(chain[10].id, { cursor }), (error) => error.status === 400)
  assert.throws(() => new CommunityPaths(paths.store).ancestors(chain.at(-1).id, { cursor }), (error) => error.status === 400)
})

test('已读的近端来源撤回后拒绝旧游标，不能越过撤回卡读取更早关系', async (t) => {
  const { paths, chain, store, author } = await fixture(t)
  const first = paths.ancestors(chain.at(-1).id, { limit: 2 })
  store.withdraw(chain[11].id, author.id)
  assert.throws(() => paths.ancestors(chain.at(-1).id, { cursor: first.nextCursor, limit: 2 }), (error) => error.status === 400 && error.code === 'BAD_PATH_CURSOR')
  assert.deepEqual(paths.ancestors(chain.at(-1).id).ancestors, [{ id: chain[11].id, status: 'unavailable' }])
})

test('异常环状来源有界结束，不产生无限请求路径', async (t) => {
  const { paths, chain, store } = await fixture(t, 3)
  store.db.prepare('UPDATE cards SET source_card_id=? WHERE id=?').run(chain[1].id, chain[0].id)
  const result = paths.ancestors(chain[2].id)
  assert.equal(result.stopped, 'cycle');assert.equal(result.nextCursor, null)
  assert.equal(result.ancestors.length, 2)
})

test('跨多页的异常大环同样结束，不会每页清空已见节点后无限继续', async (t) => {
  const { paths, chain, store } = await fixture(t, 6)
  store.db.prepare('UPDATE cards SET source_card_id=? WHERE id=?').run(chain[4].id, chain[0].id)
  let page = paths.ancestors(chain[5].id, { limit: 2 }), pages = 1
  while (page.nextCursor && pages < 10) { page = paths.ancestors(chain[5].id, { limit: 2, cursor: page.nextCursor });pages++ }
  assert.equal(page.stopped, 'cycle');assert.equal(page.nextCursor, null);assert.equal(pages, 3)
})

test('真实路径接口校验账户和根卡权限，并与子分支分页一起工作', async (t) => {
  const app = createApplication({ dbPath: ':memory:', env: { AI_LOCAL_ONLY: 'true' } })
  const server = http.createServer((req, res) => app.handle(req, res))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections();await new Promise((resolve) => server.close(resolve));app.close() })
  const author = await app.store.register({ username: 'http_path', displayName: '合成作者', password: 'synthetic-http-password' })
  const root = app.store.publish(author.id, { question: '怎样安排一次阅读？', fields: { currentJudgment: '先留出半小时。' }, clientKey: 'http-root' })
  const child = app.store.publish(author.id, { question: '先读纸书还是电子书？', fields: { currentJudgment: '先用手头已有的书。' }, clientKey: 'http-child', sourceCardId: root.id })
  const origin = `http://127.0.0.1:${server.address().port}`, url = `${origin}/api/community/cards/${child.id}/path`
  assert.equal((await (await fetch(url)).json()).ancestors[0].id, root.id)
  assert.equal((await (await fetch(`${origin}/api/community/cards/${root.id}/branches`)).json()).cards[0].id, child.id)
  const token = app.store.createSession(author.id).token
  assert.equal((await fetch(url, { headers: { Cookie: `rj_session=${token}`, 'X-RJ-User': 'other-workspace' } })).status, 409)
  app.store.withdraw(child.id, author.id)
  assert.equal((await fetch(url)).status, 404)
  assert.equal((await fetch(url, { headers: { Cookie: `rj_session=${token}`, 'X-RJ-User': author.id } })).status, 200)
})
