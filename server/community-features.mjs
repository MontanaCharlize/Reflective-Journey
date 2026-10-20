import { randomUUID, createHash } from 'node:crypto'
import { ApiError, CARD_FIELDS } from './community-store.mjs'

const fail = (status, code, message) => { throw new ApiError(status, code, message) }
const uuid = (id) => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id)
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const take = (limit) => Number.isInteger(Number(limit)) && Number(limit) > 0 ? Math.min(Number(limit), 40) : 20
const escaped = (text) => `%${text.replace(/[\\%_]/g, '\\$&')}%`
function afterCursor(cursor, scope) {
  if (!cursor) return null
  try {
    if (cursor.length > 1024) throw new Error()
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (!Number.isSafeInteger(value.at) || !uuid(value.id) || value.scope !== scope) throw new Error()
    return value
  } catch { fail(400, 'BAD_CURSOR', '分页位置已失效，请刷新列表。') }
}
const cursorFor = (row, scope) => Buffer.from(JSON.stringify({ at: row.page_at, id: row.id, scope })).toString('base64url')

export class CommunityFeatures {
  constructor(store) {
    this.store = store; this.db = store.db
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),bio TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS bookmarks(user_id TEXT NOT NULL REFERENCES users(id),card_id TEXT NOT NULL REFERENCES cards(id),created_at INTEGER NOT NULL,PRIMARY KEY(user_id,card_id));
      CREATE INDEX IF NOT EXISTS bookmarks_page ON bookmarks(user_id,created_at,card_id);
      CREATE INDEX IF NOT EXISTS cards_author_page ON cards(author_id,created_at,id);
      CREATE TABLE IF NOT EXISTS card_meta(card_id TEXT PRIMARY KEY REFERENCES cards(id),revision INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS community_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),card_id TEXT NOT NULL REFERENCES cards(id),source_card_id TEXT NOT NULL REFERENCES cards(id),created_at INTEGER NOT NULL,read_at INTEGER,UNIQUE(user_id,card_id));
      CREATE INDEX IF NOT EXISTS notifications_page ON community_notifications(user_id,created_at,id);
      CREATE TABLE IF NOT EXISTS report_reviews(report_id TEXT PRIMARY KEY REFERENCES reports(id),resolution TEXT NOT NULL CHECK(resolution IN ('keep','withdraw')),note TEXT NOT NULL,moderator_id TEXT REFERENCES users(id),reviewed_at INTEGER NOT NULL);
    `)
    store.afterPublish = ({ id, userId, source }) => {
      if (!source) return
      const parent = this.db.prepare("SELECT author_id FROM cards WHERE id=? AND status='public'").get(source)
      if (parent && parent.author_id !== userId) this.db.prepare('INSERT OR IGNORE INTO community_notifications VALUES(?,?,?,?,?,NULL)').run(randomUUID(), parent.author_id, id, source, store.clock())
    }
  }
  list({ viewerId = null, mine = false, saved = false, authorId = '', sourceId = '', query = '', kind = 'all', status = 'all', cursor = '', limit = 20 } = {}) {
    if (typeof query !== 'string' || query.length > 100) fail(400, 'BAD_QUERY', '搜索词最多 100 个字符。')
    if (!['all', 'original', 'branch'].includes(kind) || !['all', 'public', 'withdrawn'].includes(status)) fail(400, 'BAD_FILTER', '这个筛选方式暂不可用。')
    if ((mine || saved) && !viewerId) fail(401, 'LOGIN_REQUIRED', '请先登录。')
    if (authorId && !uuid(authorId)) fail(400, 'BAD_AUTHOR', '作者地址无效。')
    if (sourceId) this.store.card(sourceId, viewerId)
    const scope = hash({ viewerId: mine || saved ? viewerId : null, mine, saved, authorId, sourceId, query, kind, status: mine ? status : 'public' })
    const after = afterCursor(cursor, scope), size = take(limit)
    const conditions = [], args = [viewerId || '']
    if (saved) args.push(viewerId)
    if (mine) { conditions.push('c.author_id=?'); args.push(viewerId); if (status !== 'all') { conditions.push('c.status=?'); args.push(status) } }
    else conditions.push("c.status='public'")
    if (authorId) { conditions.push('c.author_id=?'); args.push(authorId) }
    if (sourceId) { conditions.push('c.source_card_id=?'); args.push(sourceId) }
    if (kind !== 'all') conditions.push(kind === 'original' ? 'c.source_card_id IS NULL' : 'c.source_card_id IS NOT NULL')
    if (query.trim()) { conditions.push("(c.question LIKE ? ESCAPE '\\' OR c.fields_json LIKE ? ESCAPE '\\' OR u.display_name LIKE ? ESCAPE '\\')"); args.push(escaped(query.trim()), escaped(query.trim()), escaped(query.trim())) }
    const orderAt = saved ? 'b.created_at' : 'c.created_at'
    if (after) { conditions.push(`(${orderAt}<? OR (${orderAt}=? AND c.id<?))`); args.push(after.at, after.at, after.id) }
    args.push(size + 1)
    const rows = this.db.prepare(`SELECT c.*,u.display_name,COALESCE(m.revision,1) revision,COALESCE(m.updated_at,c.created_at) updated_at,
      EXISTS(SELECT 1 FROM bookmarks bx WHERE bx.card_id=c.id AND bx.user_id=?) saved,
      (SELECT COUNT(*) FROM cards child WHERE child.source_card_id=c.id AND child.status='public') branch_count,${orderAt} page_at
      FROM cards c JOIN users u ON u.id=c.author_id LEFT JOIN card_meta m ON m.card_id=c.id
      ${saved ? 'JOIN bookmarks b ON b.card_id=c.id AND b.user_id=?' : ''}
      WHERE ${conditions.join(' AND ')} ORDER BY ${orderAt} DESC,c.id DESC LIMIT ?`).all(...args)
    return { cards: rows.slice(0, size).map((row) => this.store.project(row)), nextCursor: rows.length > size ? cursorFor(rows[size - 1], scope) : null }
  }
  hydrate(card, viewerId) {
    const meta = this.db.prepare('SELECT revision,updated_at FROM card_meta WHERE card_id=?').get(card.id)
    return { ...card, revision: meta?.revision || 1, updatedAt: meta?.updated_at || card.createdAt,
      bookmarked: Boolean(viewerId && this.db.prepare('SELECT 1 FROM bookmarks WHERE user_id=? AND card_id=?').get(viewerId, card.id)),
      branchCount: this.db.prepare("SELECT COUNT(*) n FROM cards WHERE source_card_id=? AND status='public'").get(card.id).n }
  }
  details(id, viewerId = null) {
    const card = this.hydrate(this.store.card(id, viewerId), viewerId)
    const page = this.list({ viewerId, sourceId: id })
    const ancestors = []
    let sourceId = card.sourceCardId
    for (let depth = 0; sourceId && depth < 8; depth++) {
      try {
        const source = this.store.card(sourceId)
        ancestors.unshift({ id: source.id, question: source.question, author: source.author, status: 'public' })
        sourceId = source.sourceCardId
      } catch { ancestors.unshift({ id: sourceId, status: 'unavailable' }); break }
    }
    return { card, source: card.sourceCardId ? ancestors.at(-1) : null, ancestors, branches: page.cards, nextBranchCursor: page.nextCursor }
  }
  bookmark(id, userId, saved) {
    if (typeof saved !== 'boolean') fail(400, 'BAD_BOOKMARK', '请选择收藏或取消收藏。')
    if (saved) {
      this.store.card(id)
      this.db.prepare('INSERT OR IGNORE INTO bookmarks VALUES(?,?,?)').run(userId, id, this.store.clock())
    } else this.db.prepare('DELETE FROM bookmarks WHERE user_id=? AND card_id=?').run(userId, id)
    return saved
  }
  profile(id) {
    if (!uuid(id)) fail(404, 'AUTHOR_NOT_FOUND', '这个作者主页不存在。')
    const row = this.db.prepare('SELECT u.id,u.display_name,p.bio FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id=?').get(id)
    if (!row) fail(404, 'AUTHOR_NOT_FOUND', '这个作者主页不存在。')
    const stats = this.db.prepare("SELECT COUNT(*) shares,SUM(CASE WHEN source_card_id IS NOT NULL THEN 1 ELSE 0 END) branches FROM cards WHERE author_id=? AND status='public'").get(id)
    return { id: row.id, displayName: row.display_name, bio: row.bio || '', shares: stats.shares, branches: stats.branches || 0 }
  }
  updateProfile(userId, body) {
    if (!body || Object.keys(body).some((key) => !['displayName', 'bio'].includes(key))) fail(400, 'BAD_PROFILE', '只接受展示名称和个人简介。')
    const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
    const bio = typeof body.bio === 'string' ? body.bio.trim() : ''
    if (!displayName || displayName.length > 30 || /[\u0000-\u001f]/.test(displayName) || bio.length > 240) fail(400, 'BAD_PROFILE', '展示名称需为 1–30 字，个人简介最多 240 字。')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare('UPDATE users SET display_name=? WHERE id=?').run(displayName, userId)
      this.db.prepare('INSERT INTO profiles VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET bio=excluded.bio').run(userId, bio)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return this.profile(userId)
  }
  edit(id, userId, body) {
    if (!body || Object.keys(body).some((key) => !['question', 'fields', 'revision'].includes(key))) fail(400, 'BAD_CARD', '只接受预览中的公开卡片字段。')
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question || question.length > 600 || !Number.isInteger(body.revision)) fail(400, 'BAD_CARD', '公开的问题或卡片版本无效，请重新预览。')
    if (!body.fields || typeof body.fields !== 'object' || Array.isArray(body.fields) || Object.keys(body.fields).some((name) => !CARD_FIELDS.includes(name))) fail(400, 'PRIVATE_FIELD', '请只保留允许公开的成果字段。')
    const fields = {}
    for (const name of CARD_FIELDS) if (name in body.fields) {
      if (typeof body.fields[name] !== 'string' || body.fields[name].trim().length > 2400) fail(400, 'BAD_FIELD', '每项公开内容最多 2400 个字符。')
      if (body.fields[name].trim()) fields[name] = body.fields[name].trim()
    }
    if (!Object.keys(fields).length) fail(400, 'EMPTY_CARD', '至少保留一项想公开的成果。')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const card = this.store.card(id, userId)
      if (card.author.id !== userId) fail(403, 'NOT_OWNER', '只有作者可以编辑这张卡。')
      if (card.status !== 'public') fail(409, 'CARD_WITHDRAWN', '已撤回公开的卡片保留为副本，不能继续编辑公开内容。')
      const current = this.db.prepare('SELECT revision FROM card_meta WHERE card_id=?').get(id)?.revision || 1
      if (current !== body.revision) fail(409, 'EDIT_CONFLICT', '这张卡已在其他页面更新，请关闭预览并刷新后再编辑。')
      const payloadHash = hash({ question, fields, source: card.sourceCardId })
      this.db.prepare('UPDATE cards SET question=?,fields_json=?,payload_hash=? WHERE id=?').run(question, JSON.stringify(fields), payloadHash, id)
      this.db.prepare('INSERT INTO card_meta VALUES(?,?,?) ON CONFLICT(card_id) DO UPDATE SET revision=excluded.revision,updated_at=excluded.updated_at').run(id, current + 1, this.store.clock())
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    return this.details(id, userId).card
  }
  unread(userId) {
    return this.db.prepare("SELECT COUNT(*) n FROM community_notifications n JOIN cards c ON c.id=n.card_id JOIN cards p ON p.id=n.source_card_id WHERE n.user_id=? AND n.read_at IS NULL AND c.status='public' AND p.status='public'").get(userId).n
  }
  notifications(userId, { cursor = '', limit = 20 } = {}) {
    const scope = hash({ notifications: userId }), after = afterCursor(cursor, scope), size = take(limit)
    const rows = this.db.prepare(`SELECT n.*,n.created_at page_at,c.question,u.id actor_id,u.display_name,p.question source_question
      FROM community_notifications n JOIN cards c ON c.id=n.card_id JOIN cards p ON p.id=n.source_card_id JOIN users u ON u.id=c.author_id
      WHERE n.user_id=? AND c.status='public' AND p.status='public' ${after ? 'AND (n.created_at<? OR (n.created_at=? AND n.id<?))' : ''}
      ORDER BY n.created_at DESC,n.id DESC LIMIT ?`).all(userId, ...(after ? [after.at, after.at, after.id] : []), size + 1)
    return { notifications: rows.slice(0, size).map((row) => ({ id: row.id, cardId: row.card_id, sourceCardId: row.source_card_id, question: row.question, sourceQuestion: row.source_question, actor: { id: row.actor_id, displayName: row.display_name }, createdAt: row.created_at, readAt: row.read_at })), unread: this.unread(userId), nextCursor: rows.length > size ? cursorFor(rows[size - 1], scope) : null }
  }
  readNotifications(userId, ids) {
    if (ids === 'all') { this.db.prepare('UPDATE community_notifications SET read_at=COALESCE(read_at,?) WHERE user_id=?').run(this.store.clock(), userId); return this.unread(userId) }
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => !uuid(id))) fail(400, 'BAD_NOTIFICATIONS', '请选择有效的提醒。')
    const update = this.db.prepare('UPDATE community_notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?')
    this.db.exec('BEGIN IMMEDIATE')
    try { for (const id of ids) update.run(this.store.clock(), id, userId); this.db.exec('COMMIT') }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
    return this.unread(userId)
  }
  report(id, userId, reason) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.store.report(id, userId, reason)
      this.db.prepare('DELETE FROM report_reviews WHERE report_id=(SELECT id FROM reports WHERE card_id=? AND user_id=?)').run(id, userId)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  reports({ userId = null, status = 'pending', cursor = '', limit = 20 } = {}) {
    if (!['all', 'pending', 'resolved'].includes(status)) fail(400, 'BAD_FILTER', '反馈筛选无效。')
    const scope = hash({ reports: userId || 'moderation', status }), after = afterCursor(cursor, scope), size = take(limit)
    const conditions = [], args = []
    if (userId) { conditions.push('r.user_id=?'); args.push(userId) }
    if (status !== 'all') conditions.push(status === 'pending' ? 'v.report_id IS NULL' : 'v.report_id IS NOT NULL')
    if (after) { conditions.push('(r.created_at<? OR (r.created_at=? AND r.id<?))'); args.push(after.at, after.at, after.id) }
    args.push(size + 1)
    const rows = this.db.prepare(`SELECT r.*,r.created_at page_at,c.question,c.status card_status,COALESCE(m.revision,1) card_revision,u.display_name author,v.resolution,v.note,v.reviewed_at
      FROM reports r JOIN cards c ON c.id=r.card_id JOIN users u ON u.id=c.author_id LEFT JOIN report_reviews v ON v.report_id=r.id LEFT JOIN card_meta m ON m.card_id=c.id
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`).all(...args)
    return { reports: rows.slice(0, size).map((row) => ({ id: row.id, cardId: row.card_id, reason: row.reason, createdAt: row.created_at, question: userId && row.card_status !== 'public' ? null : row.question, cardStatus: row.card_status, cardRevision: row.card_revision, author: userId ? undefined : row.author, resolution: row.resolution || null, note: row.note || '', reviewedAt: row.reviewed_at })), nextCursor: rows.length > size ? cursorFor(rows[size - 1], scope) : null }
  }
  resolveReport(reportId, moderatorId, { resolution, note, expectedAt, expectedRevision }) {
    if (!['keep', 'withdraw'].includes(resolution) || typeof note !== 'string' || note.trim().length < 4 || note.trim().length > 500) fail(400, 'BAD_REVIEW', '请选择处理方式，并填写 4–500 字的处理说明。')
    if (!Number.isSafeInteger(expectedAt) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail(400, 'BAD_REVIEW', '请重新读取反馈和卡片版本后处理。')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const report = this.db.prepare('SELECT r.*,COALESCE(m.revision,1) card_revision FROM reports r LEFT JOIN card_meta m ON m.card_id=r.card_id WHERE r.id=?').get(reportId)
      if (!report) fail(404, 'REPORT_NOT_FOUND', '这条反馈不存在。')
      if (report.created_at !== expectedAt || this.db.prepare('SELECT 1 FROM report_reviews WHERE report_id=?').get(reportId)) fail(409, 'REVIEW_CONFLICT', '反馈已更新或处理，请刷新后重试。')
      if (report.card_revision !== expectedRevision) fail(409, 'REVIEW_CONFLICT', '这张卡的公开内容已经更新，请重新核查后处理。')
      if (resolution === 'withdraw') {
        this.db.prepare("UPDATE cards SET status='withdrawn',withdrawn_at=? WHERE id=?").run(this.store.clock(), report.card_id)
        this.db.prepare('INSERT INTO moderation_actions VALUES(?,?,?,?)').run(randomUUID(), report.card_id, note.trim(), this.store.clock())
      }
      this.db.prepare('INSERT INTO report_reviews VALUES(?,?,?,?,?)').run(reportId, resolution, note.trim(), moderatorId, this.store.clock())
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
