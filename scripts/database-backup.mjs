import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DatabaseSync, backup } from 'node:sqlite'
import { loadProjectEnv } from '../server/env.mjs'

export function verifyDatabase(filename) {
  const db = new DatabaseSync(filename, { readOnly: true, timeout: 5000 })
  try {
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('数据库完整性检查未通过。')
  } finally { db.close() }
}

export async function backupDatabase({ database, directory, keep = 30, now = new Date() }) {
  if (!database || database === ':memory:') throw new Error('备份需要一个已存在的数据库文件。')
  if (!Number.isInteger(keep) || keep < 1 || keep > 10000) throw new Error('保留数量应为 1 至 10000 的整数。')
  const source = path.resolve(database), destination = path.resolve(directory || path.join(path.dirname(source), 'backups'))
  await fs.access(source)
  await fs.mkdir(destination, { recursive: true, mode: 0o700 })
  const stamp = now.toISOString().replace(/[-:.]/g, '')
  const prefix = path.basename(source).replace(/[^\p{L}\p{N}_.-]/gu, '_')
  const filename = `${prefix}-${stamp}-${randomUUID().slice(0, 8)}.sqlite`
  const target = path.join(destination, filename), partial = target + '.partial'
  const db = new DatabaseSync(source, { readOnly: true, timeout: 5000 })
  try {
    // node:sqlite exports backup() at module level. It includes committed WAL data.
    await backup(db, partial)
    // Seal the snapshot into one standalone file before renaming/retaining it.
    const snapshot = new DatabaseSync(partial, { timeout: 5000 })
    try { snapshot.exec('PRAGMA journal_mode=DELETE') }
    finally { snapshot.close() }
    verifyDatabase(partial)
    await fs.rename(partial, target)
  } catch (error) {
    await fs.unlink(partial).catch(() => {})
    throw error
  } finally { db.close() }
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const ownedName = new RegExp(`^${escaped}-\\d{8}T\\d{9}Z-[a-f0-9]{8}\\.sqlite$`)
  const entries = (await fs.readdir(destination, { withFileTypes: true })).filter((entry) => entry.isFile() && ownedName.test(entry.name)).map((entry) => entry.name).sort().reverse()
  const removed = []
  for (const name of entries.slice(keep)) {
    const candidate = path.resolve(destination, name)
    if (path.dirname(candidate) !== destination) throw new Error('备份清理路径越界。')
    await fs.unlink(candidate); removed.push(name)
  }
  return { backup: target, kept: Math.min(entries.length, keep), removed: removed.length }
}

export function commandOptions(args) {
  const out = {}
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === '--confirm-stopped') out.confirmStopped = true
    else if (['--database', '--out', '--keep', '--backup'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--')) out[key.slice(2)] = args[++i]
    else throw new Error(`无法识别参数：${key}`)
  }
  return out
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), env = loadProjectEnv(root), options = commandOptions(process.argv.slice(2))
    const database = path.resolve(root, options.database || env.COMMUNITY_DB_PATH || 'data/community.sqlite')
    console.log(JSON.stringify(await backupDatabase({ database, directory: options.out && path.resolve(root, options.out), keep: options.keep ? Number(options.keep) : 30 }), null, 2))
  } catch (error) { console.error('备份失败：' + error.message); process.exitCode = 1 }
}
