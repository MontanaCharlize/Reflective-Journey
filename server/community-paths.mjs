import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { ApiError } from './community-store.mjs'

const uuid = (value) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
const invalid = () => { throw new ApiError(400, 'BAD_PATH_CURSOR', '来源路径已变化或分页位置失效，请重新展开。') }
const MAX_DEPTH = 256

export class CommunityPaths {
  constructor(store) { this.store = store; this.secret = randomBytes(32) }
  signature(body) { return createHmac('sha256', this.secret).update(body).digest('base64url') }
  cursor(cardId, viewerId, nextId, depth) {
    const body = Buffer.from(JSON.stringify({ cardId, viewerId, nextId, depth })).toString('base64url')
    return body + '.' + this.signature(body)
  }
  readCursor(value, cardId, viewerId) {
    if (typeof value !== 'string' || value.length > 1024) invalid()
    const parts = value.split('.')
    if (parts.length !== 2 || !/^[\w-]+$/.test(parts[0]) || !/^[\w-]{43}$/.test(parts[1])) invalid()
    const expected = Buffer.from(this.signature(parts[0])), actual = Buffer.from(parts[1])
    if (!timingSafeEqual(actual, expected)) invalid()
    try {
      const body = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
      if (body.cardId !== cardId || body.viewerId !== viewerId || !uuid(body.nextId) || !Number.isInteger(body.depth) || body.depth < 1 || body.depth >= MAX_DEPTH) invalid()
      return body
    } catch { invalid() }
  }
  ancestors(id, { viewerId = null, cursor = '', limit = 8 } = {}) {
    const card = this.store.card(id, viewerId)
    const size = Number(limit)
    if (!Number.isInteger(size) || size < 1 || size > 20) throw new ApiError(400, 'BAD_PATH_LIMIT', '每次可读取 1–20 层来源。')
    const continuation = cursor ? this.readCursor(cursor, id, viewerId) : null
    let nextId = card.sourceCardId
    const ancestors = [], seen = new Set([id])
    // 签名不能证明关系仍然公开；继续前重新走过近端路径，遇撤回立即拒绝旧游标。
    for (let depth = 0; continuation && depth < continuation.depth; depth++) {
      if (!nextId || seen.has(nextId)) invalid()
      seen.add(nextId)
      try { nextId = this.store.card(nextId).sourceCardId }
      catch (error) { if (error instanceof ApiError && error.status === 404) invalid();throw error }
    }
    if (continuation && nextId !== continuation.nextId) invalid()
    let traversed = continuation?.depth || 0
    let stopped = null
    for (let depth = 0; nextId && depth < size && traversed < MAX_DEPTH; depth++) {
      if (seen.has(nextId)) { stopped = 'cycle';nextId = null;break }
      seen.add(nextId)
      try {
        // 来源始终按公开权限读取，即使浏览者恰好是已撤回来源的作者。
        const source = this.store.card(nextId)
        ancestors.unshift({ id: source.id, question: source.question, author: source.author, status: 'public' })
        nextId = source.sourceCardId
        traversed++
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error
        ancestors.unshift({ id: nextId, status: 'unavailable' })
        stopped = 'unavailable';nextId = null;break
      }
    }
    if (nextId && seen.has(nextId)) { stopped = 'cycle';nextId = null }
    if (nextId && traversed >= MAX_DEPTH) { stopped = 'limit';nextId = null }
    return { ancestors, nextCursor: nextId ? this.cursor(id, viewerId, nextId, traversed) : null, stopped }
  }
}
