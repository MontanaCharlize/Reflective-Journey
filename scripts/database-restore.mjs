import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { DatabaseSync, backup } from 'node:sqlite'
import { loadProjectEnv } from '../server/env.mjs'
import { backupDatabase, commandOptions, verifyDatabase } from './database-backup.mjs'

export async function restoreDatabase({ backupFile, database, confirmStopped = false }) {
  if (!confirmStopped) throw new Error('请先停止所有访问该数据库的服务，再显式指定 --confirm-stopped。')
  if (!backupFile || !database || database === ':memory:') throw new Error('请明确提供备份文件与目标数据库。')
  const source = path.resolve(backupFile), target = path.resolve(database)
  if (source === target) throw new Error('备份文件不能与目标数据库相同。')
  await fs.access(source)
  verifyDatabase(source)
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  let previousBackup = null
  try { await fs.access(target); previousBackup = (await backupDatabase({ database: target, directory: path.join(path.dirname(target), 'before-restore') })).backup }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const db = new DatabaseSync(source, { readOnly: true, timeout: 5000 })
  try {
    // SQLite manages the destination transaction and WAL. Do not delete sidecar files by hand.
    await backup(db, target)
    verifyDatabase(target)
  } finally { db.close() }
  return { database: target, previousBackup, restored: true }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), env = loadProjectEnv(root), options = commandOptions(process.argv.slice(2))
    console.log(JSON.stringify(await restoreDatabase({ backupFile: options.backup && path.resolve(root, options.backup), database: path.resolve(root, options.database || env.COMMUNITY_DB_PATH || 'data/community.sqlite'), confirmStopped: options.confirmStopped }), null, 2))
  } catch (error) { console.error('恢复失败：' + error.message); process.exitCode = 1 }
}
