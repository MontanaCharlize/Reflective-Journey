import { DatabaseSync } from 'node:sqlite'
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const derive = promisify(scrypt)
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
export const CARD_FIELDS = ['initialJudgment', 'currentJudgment', 'keyDiscovery', 'openQuestion', 'changed', 'nextAction', 'expectedSignal']
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const fail = (status, code, message) => { throw new ApiError(status, code, message) }
const hash = (value) => createHash('sha256').update(value).digest('hex')
const userView = (row) => ({ id: row.id, username: row.username, displayName: row.display_name })
const countLimit = (value, fallback, max) => Number.isInteger(Number(value)) && Number(value) >= 1 ? Math.min(Number(value), max) : fallback

export class CommunityStore {
  constructor(filename, { dailyAiLimit = 80, minuteAiLimit = 8, globalAiLimit = 500, clock = Date.now } = {}) {
    if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true, mode: 0o700 })
    this.clock = clock
    this.dailyAiLimit = countLimit(dailyAiLimit, 80, 2000)
    this.minuteAiLimit = countLimit(minuteAiLimit, 8, 120)
    this.globalAiLimit = countLimit(globalAiLimit, 500, 50000)
    this.db = new DatabaseSync(filename)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cards(id TEXT PRIMARY KEY, author_id TEXT NOT NULL REFERENCES users(id), question TEXT NOT NULL, fields_json TEXT NOT NULL, source_card_id TEXT REFERENCES cards(id), status TEXT NOT NULL CHECK(status IN ('public','withdrawn')), client_key TEXT NOT NULL, payload_hash TEXT NOT NULL, created_at INTEGER NOT NULL, withdrawn_at INTEGER, UNIQUE(author_id,client_key));
      CREATE INDEX IF NOT EXISTS cards_feed ON cards(status,created_at,id);
      CREATE INDEX IF NOT EXISTS cards_source ON cards(source_card_id,status);
      CREATE TABLE IF NOT EXISTS ai_usage(user_id TEXT NOT NULL REFERENCES users(id), day TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY(user_id,day));
      CREATE TABLE IF NOT EXISTS ai_minutes(user_id TEXT PRIMARY KEY REFERENCES users(id), window_at INTEGER NOT NULL, used INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS global_ai_usage(day TEXT PRIMARY KEY, used INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), user_id TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(card_id,user_id));
      CREATE TABLE IF NOT EXISTS moderation_actions(id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), reason TEXT NOT NULL, created_at INTEGER NOT NULL);`)
  }
  close() { this.db.close() }
  async register({ username, displayName, password }) {
    username = typeof username === 'string' ? username.trim().toLowerCase() : ''
    displayName = typeof displayName === 'string' ? displayName.trim() : ''
    if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) fail(400, 'BAD_ACCOUNT', '账号需为 3–32 位字母、数字、下划线或短横线。')
    if (displayName.length < 1 || displayName.length > 30 || /[\u0000-\u001f]/.test(displayName)) fail(400, 'BAD_NAME', '请填写 1–30 个字符的展示名称。')
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'BAD_PASSWORD', '密码需要 12–128 个字符。')
    if (this.db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail(409, 'ACCOUNT_EXISTS', '这个账号已经有人使用。')
    const salt = randomBytes(16).toString('hex')
    const key = await derive(password, salt, 64, SCRYPT)
    const row = { id: randomUUID(), username, display_name: displayName }
    try { this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(row.id, username, displayName, salt, key.toString('hex'), this.clock()) }
    catch (error) { if (error.message.includes('UNIQUE')) fail(409, 'ACCOUNT_EXISTS', '这个账号已经有人使用。'); throw error }
    return userView(row)
  }
  async login({ username, password }) {
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128) fail(401, 'INVALID_LOGIN', '账号或密码不正确。')
    const row = this.db.prepare('SELECT * FROM users WHERE username=?').get(username.trim().toLowerCase())
    const key = await derive(password, row?.salt || 'unknown-account-fixed-salt', 64, SCRYPT)
    const stored = row ? Buffer.from(row.password_hash, 'hex') : Buffer.alloc(64)
    if (!timingSafeEqual(key, stored) || !row) fail(401, 'INVALID_LOGIN', '账号或密码不正确。')
    return userView(row)
  }
  createSession(userId) {
    const token = randomBytes(32).toString('hex')
    const expiresAt = this.clock() + 7 * 24 * 60 * 60 * 1000
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(this.clock())
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), userId, expiresAt)
    return { token, expiresAt }
  }
  authenticate(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null
    const row = this.db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token), this.clock())
    return row ? userView(row) : null
  }
  logout(token) { if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token)) }
  limits(userId) {
    const date = new Date(this.clock())
    const day = date.toISOString().slice(0, 10)
    const used = this.db.prepare('SELECT used FROM ai_usage WHERE user_id=? AND day=?').get(userId, day)?.used || 0
    return { dailyLimit: this.dailyAiLimit, used, remaining: Math.max(0, this.dailyAiLimit - used), resetsAt: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) }
  }
  reserveAi(userId, amount = 1) {
    const now = this.clock()
    const day = new Date(now).toISOString().slice(0, 10)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const daily = this.limits(userId)
      if (daily.remaining < amount) fail(429, 'AI_DAILY_LIMIT', '今日模型调用额度已用完，仍可使用本地思考流程。')
      const globalUsed = this.db.prepare('SELECT used FROM global_ai_usage WHERE day=?').get(day)?.used || 0
      if (globalUsed + amount > this.globalAiLimit) fail(429, 'AI_GLOBAL_LIMIT', '今天的共享模型额度已用完，仍可使用本地思考流程。')
      const minute = this.db.prepare('SELECT * FROM ai_minutes WHERE user_id=?').get(userId)
      const reset = !minute || now - minute.window_at >= 60000
      const used = reset ? 0 : minute.used
      if (used + amount > this.minuteAiLimit) fail(429, 'AI_RATE_LIMIT', '这一分钟的模型调用较多，请稍等片刻；本轮会使用本地流程。')
      this.db.prepare('INSERT INTO ai_usage VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET used=used+excluded.used').run(userId, day, amount)
      this.db.prepare('INSERT INTO global_ai_usage VALUES(?,?) ON CONFLICT(day) DO UPDATE SET used=used+excluded.used').run(day, amount)
      this.db.prepare('INSERT INTO ai_minutes VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET window_at=excluded.window_at,used=excluded.used').run(userId, reset ? now : minute.window_at, used + amount)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  reserveGlobalAi(amount) {
    if (!amount) return
    const day = new Date(this.clock()).toISOString().slice(0, 10)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const used = this.db.prepare('SELECT used FROM global_ai_usage WHERE day=?').get(day)?.used || 0
      if (used + amount > this.globalAiLimit) fail(429, 'AI_GLOBAL_LIMIT', '今天的共享模型额度已用完。')
      this.db.prepare('INSERT INTO global_ai_usage VALUES(?,?) ON CONFLICT(day) DO UPDATE SET used=used+excluded.used').run(day, amount)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  publish(userId, body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['question', 'fields', 'sourceCardId', 'clientKey'].includes(key))) fail(400, 'BAD_CARD', '只接受预览中的公开卡片字段。')
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question || question.length > 600) fail(400, 'BAD_QUESTION', '公开的问题需要 1–600 个字符。')
    if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields) || Object.keys(body.fields).some((key) => !CARD_FIELDS.includes(key))) fail(400, 'PRIVATE_FIELD', '请只选择允许公开的成果字段。')
    const fields = {}
    for (const name of CARD_FIELDS) {
      if (!(name in body.fields)) continue
      const text = body.fields[name]
      if (typeof text !== 'string' || text.trim().length > 2400) fail(400, 'BAD_FIELD', '每项公开内容最多 2400 个字符。')
      if (text.trim()) fields[name] = text.trim()
    }
    if (!Object.keys(fields).length) fail(400, 'EMPTY_CARD', '至少选择一项想公开的成果。')
    if (typeof body.clientKey !== 'string' || !/^[\w-]{1,96}$/.test(body.clientKey)) fail(400, 'BAD_REQUEST_KEY', '发布请求无效，请重新打开预览。')
    const source = body.sourceCardId || null
    if (source && (typeof source !== 'string' || !this.db.prepare('SELECT id FROM cards WHERE id=?').get(source))) fail(400, 'BAD_SOURCE', '找不到这次接续的来源。')
    const payloadHash = hash(JSON.stringify({ question, fields, source }))
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.db.prepare('SELECT * FROM cards WHERE author_id=? AND client_key=?').get(userId, body.clientKey)
      if (previous) {
        if (previous.payload_hash !== payloadHash || previous.status !== 'public') fail(409, 'PUBLISH_CONFLICT', '这次发布请求已经使用，请重新预览后发布。')
        this.db.exec('COMMIT')
        return this.card(previous.id, userId)
      }
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE author_id=? AND created_at>=?').get(userId, this.clock() - 86400000).n
      if (count >= 20) fail(429, 'PUBLISH_LIMIT', '最近 24 小时已分享 20 张成果，稍后再继续吧。')
      const id = randomUUID()
      this.db.prepare('INSERT INTO cards(id,author_id,question,fields_json,source_card_id,status,client_key,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, userId, question, JSON.stringify(fields), source, 'public', body.clientKey, payloadHash, this.clock())
      this.afterPublish?.({ id, userId, source })
      this.db.exec('COMMIT')
      return this.card(id, userId)
    } catch (error) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw error }
  }
  project(row) {
    return { id: row.id, question: row.question, fields: JSON.parse(row.fields_json), author: { id: row.author_id, displayName: row.display_name }, sourceCardId: row.source_card_id, status: row.status, createdAt: row.created_at, withdrawnAt: row.withdrawn_at, revision: row.revision || 1, updatedAt: row.updated_at || row.created_at, bookmarked: Boolean(row.saved), branchCount: row.branch_count || 0 }
  }
  card(id, viewerId = null) {
    const row = this.db.prepare('SELECT c.*,u.display_name FROM cards c JOIN users u ON u.id=c.author_id WHERE c.id=?').get(id)
    if (!row || (row.status !== 'public' && row.author_id !== viewerId)) fail(404, 'CARD_NOT_FOUND', '这张思考卡已撤回或不存在。')
    return this.project(row)
  }
  feed({ query = '', cursor = '', limit = 20 } = {}) {
    if (query.length > 100) fail(400, 'BAD_QUERY', '搜索词最多 100 个字符。')
    let after = null
    if (cursor) {
      try { after = JSON.parse(Buffer.from(cursor, 'base64url').toString()); if (!Number.isSafeInteger(after.at) || typeof after.id !== 'string' || after.id.length > 64) throw new Error() }
      catch { fail(400, 'BAD_CURSOR', '分页位置无效，请刷新列表。') }
    }
    limit = countLimit(limit, 20, 40)
    const rows = this.db.prepare(`SELECT c.*,u.display_name FROM cards c JOIN users u ON u.id=c.author_id WHERE c.status='public' AND c.question LIKE ? ESCAPE '\\' ${after ? 'AND (c.created_at<? OR (c.created_at=? AND c.id<?))' : ''} ORDER BY c.created_at DESC,c.id DESC LIMIT ?`).all(`%${query.replace(/[\\%_]/g, '\\$&')}%`, ...(after ? [after.at, after.at, after.id] : []), limit + 1)
    const cards = rows.slice(0, limit).map((row) => this.project(row))
    const last = cards.at(-1)
    return { cards, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ at: last.createdAt, id: last.id })).toString('base64url') : null }
  }
  mine(userId) {
    return this.db.prepare('SELECT c.*,u.display_name FROM cards c JOIN users u ON u.id=c.author_id WHERE c.author_id=? ORDER BY c.created_at DESC LIMIT 100').all(userId).map((row) => this.project(row))
  }
  details(id, viewerId) {
    const card = this.card(id, viewerId)
    let source = null
    if (card.sourceCardId) {
      try { const parent = this.card(card.sourceCardId); source = { id: parent.id, question: parent.question, author: parent.author, status: 'public' } }
      catch { source = { id: card.sourceCardId, status: 'unavailable' } }
    }
    const branches = this.db.prepare("SELECT c.*,u.display_name FROM cards c JOIN users u ON u.id=c.author_id WHERE c.source_card_id=? AND c.status='public' ORDER BY c.created_at DESC LIMIT 40").all(id).map((row) => this.project(row))
    return { card, source, branches }
  }
  withdraw(id, userId) {
    const row = this.db.prepare('SELECT author_id FROM cards WHERE id=?').get(id)
    if (!row) fail(404, 'CARD_NOT_FOUND', '找不到这张思考卡。')
    if (row.author_id !== userId) fail(403, 'NOT_OWNER', '只有作者可以撤回这张卡。')
    this.db.prepare("UPDATE cards SET status='withdrawn',withdrawn_at=? WHERE id=?").run(this.clock(), id)
    return this.card(id, userId)
  }
  report(id, userId, reason) {
    this.card(id)
    if (typeof reason !== 'string' || reason.trim().length < 4 || reason.length > 500) fail(400, 'BAD_REPORT', '请用 4–500 个字符描述需要关注的问题。')
    this.db.prepare('INSERT INTO reports VALUES(?,?,?,?,?) ON CONFLICT(card_id,user_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at').run(randomUUID(), id, userId, reason.trim(), this.clock())
  }
  // 仅供持有服务器数据库权限的本机运营脚本使用，不提供公共管理接口。
  moderationReports() {
    return this.db.prepare(`SELECT r.id AS reportId,r.card_id AS cardId,r.reason,r.created_at AS createdAt,c.question,c.status,u.display_name AS author
      FROM reports r JOIN cards c ON c.id=r.card_id JOIN users u ON u.id=c.author_id ORDER BY r.created_at DESC LIMIT 200`).all()
  }
  moderateWithdraw(id, reason) {
    if (typeof reason !== 'string' || reason.trim().length < 4 || reason.trim().length > 500) fail(400, 'BAD_REASON', '请填写 4–500 字的处理原因。')
    if (!this.db.prepare('SELECT id FROM cards WHERE id=?').get(id)) fail(404, 'CARD_NOT_FOUND', '找不到这张思考卡。')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare("UPDATE cards SET status='withdrawn',withdrawn_at=? WHERE id=?").run(this.clock(), id)
      this.db.prepare('INSERT INTO moderation_actions VALUES(?,?,?,?)').run(randomUUID(), id, reason.trim(), this.clock())
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
