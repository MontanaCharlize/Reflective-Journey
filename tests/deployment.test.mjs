import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { backupDatabase } from '../scripts/database-backup.mjs'
import { restoreDatabase } from '../scripts/database-restore.mjs'
import { createApplication } from '../server/application.mjs'
import { APPLICATION_VERSION } from '../server/version.mjs'

async function area(t) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'rj-deploy-'))
  t.after(async () => { if (!path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Invalid temporary test path');await fs.rm(folder, { recursive: true, force: true }) })
  return { folder, filename: path.join(folder, 'community.sqlite'), backups: path.join(folder, 'backups') }
}
const makeDb = (filename) => { const db = new DatabaseSync(filename);db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sample(value TEXT);');return db }
const values = (filename) => { const db = new DatabaseSync(filename, { readOnly: true });try { return db.prepare('SELECT value FROM sample ORDER BY rowid').all().map((row) => row.value) } finally { db.close() } }

test('健康检查读取真实版本并探测数据库，不泄露密钥、路径或消耗模型额度', async () => {
  const app = createApplication({ dbPath: ':memory:', env: { DEEPSEEK_API_KEY: 'SECRET_NEVER_RETURN', AI_GLOBAL_DAILY_LIMIT: '1' } })
  const server = http.createServer((req, res) => app.handle(req, res));await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health`), data = await response.json()
      assert.equal(response.status, 200);assert.equal(data.version, APPLICATION_VERSION);assert.equal(data.database, 'ready')
      assert.doesNotMatch(JSON.stringify(data), /SECRET_NEVER_RETURN|:memory:|API_KEY/)
    }
    assert.doesNotThrow(() => app.store.reserveGlobalAi(1))
  } finally { server.closeAllConnections();await new Promise((resolve) => server.close(resolve));app.close() }
})

test('在线备份包含已提交的 WAL 内容，源连接仍可继续写入', async (t) => {
  const f = await area(t), db = makeDb(f.filename)
  try {
    db.exec("INSERT INTO sample VALUES ('first'); INSERT INTO sample VALUES ('second')")
    const result = await backupDatabase({ database: f.filename, directory: f.backups })
    assert.deepEqual(values(result.backup), ['first', 'second'])
    db.exec("INSERT INTO sample VALUES ('after-backup')")
    assert.deepEqual(values(result.backup), ['first', 'second'])
    assert.equal(db.prepare('SELECT count(*) AS n FROM sample').get().n, 3)
  } finally { db.close() }
})

test('停服恢复找回旧状态，同时留存恢复前的数据副本', async (t) => {
  const f = await area(t), db = makeDb(f.filename)
  db.exec("INSERT INTO sample VALUES ('saved')")
  const snapshot = await backupDatabase({ database: f.filename, directory: f.backups })
  db.exec("INSERT INTO sample VALUES ('later')");db.close()
  await assert.rejects(restoreDatabase({ backupFile: snapshot.backup, database: f.filename }), /停止/)
  const restored = await restoreDatabase({ backupFile: snapshot.backup, database: f.filename, confirmStopped: true })
  assert.deepEqual(values(f.filename), ['saved'])
  assert.deepEqual(values(restored.previousBackup), ['saved', 'later'])
})

test('无效备份在触碰目标前拒绝，不会覆盖现有数据', async (t) => {
  const f = await area(t), db = makeDb(f.filename);db.exec("INSERT INTO sample VALUES ('keep')");db.close()
  const invalid = path.join(f.folder, 'invalid.sqlite');await fs.writeFile(invalid, 'not-a-database')
  await assert.rejects(restoreDatabase({ backupFile: invalid, database: f.filename, confirmStopped: true }))
  assert.deepEqual(values(f.filename), ['keep'])
  await assert.rejects(restoreDatabase({ backupFile: f.filename, database: f.filename, confirmStopped: true }), /相同/)
})

test('备份保留规则只清理本工具同源备份，不删除其他文件', async (t) => {
  const f = await area(t), db = makeDb(f.filename);db.close()
  await fs.mkdir(f.backups);await fs.writeFile(path.join(f.backups, 'user-notes.txt'), 'keep');await fs.writeFile(path.join(f.backups, 'other.sqlite'), 'keep')
  for (let i = 0; i < 4; i++) await backupDatabase({ database: f.filename, directory: f.backups, keep: 2, now: new Date(Date.UTC(2026, 9, 19, 0, 0, i)) })
  const files = await fs.readdir(f.backups)
  assert.equal(files.filter((name) => name.startsWith('community.sqlite-')).length, 2)
  assert.equal(await fs.readFile(path.join(f.backups, 'user-notes.txt'), 'utf8'), 'keep')
  assert.ok(files.includes('other.sqlite'))
})
