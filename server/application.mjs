import path from 'node:path'
import { timingSafeEqual } from 'node:crypto'
import { CommunityStore, ApiError } from './community-store.mjs'
import { createAiHandler, sendJson } from './ai-handler.mjs'
import { configuredProviders } from './providers.mjs'
import { CommunityFeatures } from './community-features.mjs'
import { localGuestAiAllowed } from './ai-access.mjs'
import { APPLICATION_VERSION } from './version.mjs'
import { CommunityPaths } from './community-paths.mjs'
import { createModerationAccess } from './moderation-access.mjs'

function readCookie(req, name) {
  const part = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(name + '='))
  return part?.slice(name.length + 1) || ''
}
async function bodyJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED', '请使用 JSON 请求。')
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 128000) throw new ApiError(413, 'BODY_TOO_LARGE', '请求内容过大。')
    chunks.push(chunk)
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch { throw new ApiError(400, 'BAD_JSON', '请求需要一个有效的 JSON 对象。') }
}
function guardOrigin(req, appOrigin) {
  const expected = appOrigin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`
  if (req.headers.origin !== expected) throw new ApiError(403, 'BAD_ORIGIN', '请求来源不匹配，请从当前网站操作。')
}
function equalSecret(actual, expected) {
  if (!expected || typeof actual !== 'string') return false
  const a = Buffer.from(actual), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
class RateGate {
  constructor(clock) { this.clock = clock; this.buckets = new Map() }
  take(key, limit, duration = 60000) {
    const now = this.clock()
    let entry = this.buckets.get(key)
    if (!entry || now >= entry.until) entry = { used: 0, until: now + duration }
    if (entry.used >= limit) throw new ApiError(429, 'RATE_LIMIT', '操作较频繁，请稍等再试。')
    entry.used++
    this.buckets.set(key, entry)
    if (this.buckets.size > 2000) for (const [id, bucket] of this.buckets) if (bucket.until <= now || this.buckets.size > 2000) this.buckets.delete(id)
  }
}

export function createApplication({ env = {}, root = process.cwd(), dbPath, clock = Date.now } = {}) {
  const requestedPath = dbPath || env.COMMUNITY_DB_PATH || path.join(root, 'data', 'community.sqlite')
  const appOrigin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : undefined
  if (appOrigin && !/^https?:\/\//.test(appOrigin)) throw new Error('APP_ORIGIN 必须是 HTTP 或 HTTPS 网站来源')
  const store = new CommunityStore(requestedPath === ':memory:' ? requestedPath : path.resolve(root, requestedPath), { clock, dailyAiLimit: env.AI_DAILY_LIMIT, minuteAiLimit: env.AI_MINUTE_LIMIT, globalAiLimit: env.AI_GLOBAL_DAILY_LIMIT })
  const community = new CommunityFeatures(store)
  const paths = new CommunityPaths(store)
  let moderation
  try { moderation = createModerationAccess(store, env) }
  catch (error) { store.close(); throw error }
  const decorate = (user) => user ? { ...user, canModerate: moderation.isModerator(user) } : null
  const effectiveAiEnv = env.AI_LOCAL_ONLY === 'true' ? {} : env
  const ai = createAiHandler(effectiveAiEnv, {
    access: (req) => ({ canUseAi: Boolean(configuredProviders(effectiveAiEnv).length && (userFor(req) || localGuestAiAllowed(req, env))), loginRequired: !userFor(req) && !localGuestAiAllowed(req, env), localGuest: !userFor(req) && localGuestAiAllowed(req, env) }),
    reserveExtra: (req) => { const user = userFor(req); if (user) store.reserveAi(requireUser(req).id); else { rates.take('local-ai:' + req.socket.remoteAddress, store.minuteAiLimit); store.reserveGlobalAi(1) } },
  })
  const rates = new RateGate(clock)
  const cookieName = env.COMMUNITY_COOKIE_NAME || 'rj_session'
  if (!/^[\w-]{1,40}$/.test(cookieName)) { store.close(); throw new Error('COMMUNITY_COOKIE_NAME 无效') }
  const secure = env.COOKIE_SECURE === 'true' || appOrigin?.startsWith('https://')
  const cookie = (token = '', maxAge = 0) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
  const userFor = (req) => decorate(store.authenticate(readCookie(req, cookieName)))
  const requireUser = (req) => {
    const user = userFor(req)
    if (!user) throw new ApiError(401, 'LOGIN_REQUIRED', '请先登录。个人思考仍可用本地流程继续。')
    if (req.headers['x-rj-user'] && req.headers['x-rj-user'] !== user.id) throw new ApiError(409, 'ACCOUNT_CHANGED', '账户已在其他页面改变，请刷新后再操作。')
    return user
  }
  const viewerFor = (req) => { const user = userFor(req); if (user && req.headers['x-rj-user']) requireUser(req); return user }
  const requireModerator = (req) => {
    const user = requireUser(req)
    if (!moderation.isModerator(user)) throw new ApiError(403, 'MODERATOR_REQUIRED', '只有被配置的社区运营账户可以处理反馈。')
    return user
  }
  const pageOptions = (url) => ({ cursor: url.searchParams.get('cursor') || '', limit: url.searchParams.get('limit') || 20 })
  const signIn = (res, user) => {
    const session = store.createSession(user.id)
    res.setHeader('Set-Cookie', cookie(session.token, 7 * 24 * 60 * 60))
    return sendJson(res, 200, { ok: true, user: decorate(user), limits: store.limits(user.id), unreadNotifications: community.unread(user.id) })
  }
  const handle = async (req, res, suppliedPath) => {
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = suppliedPath || url.pathname
    if (!pathname.startsWith('/api/')) return false
    const ip = req.socket.remoteAddress || 'local'
    try {
      if (req.method === 'GET' && pathname === '/api/health') {
        try { store.db.prepare('SELECT 1').get() }
        catch { return sendJson(res, 503, { ok: false, service: 'reflective-journey', version: APPLICATION_VERSION, database: 'unavailable' }) }
        return sendJson(res, 200, { ok: true, service: 'reflective-journey', version: APPLICATION_VERSION, uptime: Math.round(process.uptime()), database: 'ready' })
      }
      if (req.method === 'POST') guardOrigin(req, appOrigin)
      if (pathname.startsWith('/api/ai/')) {
        if (req.method === 'POST') {
          if (pathname === '/api/ai/arena' && equalSecret(req.headers['x-rj-arena-token'], env.RJ_ARENA_TOKEN)) {
            rates.take('arena:' + ip, 2)
            store.reserveGlobalAi(configuredProviders(effectiveAiEnv).length)
          }
          else {
            const providers = configuredProviders(effectiveAiEnv)
            const user = userFor(req)
            if (user) { requireUser(req); if (providers.length) store.reserveAi(user.id, pathname === '/api/ai/arena' ? providers.length : 1) }
            else if (pathname !== '/api/ai/arena' && !req.headers['x-rj-user'] && localGuestAiAllowed(req, env)) { rates.take('local-ai:' + ip, store.minuteAiLimit); if (providers.length) store.reserveGlobalAi(1) }
            else requireUser(req)
          }
        }
        const handled = await ai(req, res, pathname)
        return handled || sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '找不到这个接口。' })
      }
      if (req.method === 'GET' && pathname === '/api/account/me') {
        const user = userFor(req)
        return sendJson(res, 200, { ok: true, user, limits: user ? store.limits(user.id) : null, registrationRequiresInvite: Boolean(env.COMMUNITY_INVITE_CODE), unreadNotifications: user ? community.unread(user.id) : 0 })
      }
      if (req.method === 'POST' && pathname === '/api/account/register') {
        rates.take('register:' + ip, 5, 600000)
        const body = await bodyJson(req)
        if (env.COMMUNITY_INVITE_CODE && !equalSecret(body.inviteCode, env.COMMUNITY_INVITE_CODE)) throw new ApiError(403, 'INVITE_REQUIRED', '请填写有效的邀请码。')
        if (moderation.isReservedUsername(body.username)) throw new ApiError(409, 'RESERVED_ACCOUNT', '这个账号暂不可注册，请换一个账号。')
        return signIn(res, await store.register(body))
      }
      if (req.method === 'POST' && pathname === '/api/account/login') {
        rates.take('login:' + ip, 10, 300000)
        return signIn(res, await store.login(await bodyJson(req)))
      }
      if (req.method === 'POST' && pathname === '/api/account/logout') {
        if (userFor(req)) requireUser(req)
        store.logout(readCookie(req, cookieName))
        res.setHeader('Set-Cookie', cookie())
        return sendJson(res, 200, { ok: true })
      }
      if (req.method === 'POST' && pathname === '/api/account/profile') {
        const user = requireUser(req); rates.take('profile:' + user.id, 5)
        const profile = community.updateProfile(user.id, await bodyJson(req))
        return sendJson(res, 200, { ok: true, profile, user: { ...user, displayName: profile.displayName } })
      }
      if (req.method === 'GET' && pathname === '/api/community/cards') return sendJson(res, 200, { ok: true, ...community.list({ ...pageOptions(url), query: url.searchParams.get('q') || '', kind: url.searchParams.get('kind') || 'all', viewerId: viewerFor(req)?.id }) })
      if (req.method === 'GET' && ['/api/community/mine', '/api/community/bookmarks'].includes(pathname)) {
        const user = requireUser(req)
        return sendJson(res, 200, { ok: true, ...community.list({ ...pageOptions(url), viewerId: user.id, mine: pathname.endsWith('mine'), saved: pathname.endsWith('bookmarks'), query: url.searchParams.get('q') || '', status: url.searchParams.get('status') || 'all' }) })
      }
      const authorRoute = pathname.match(/^\/api\/community\/authors\/([a-f0-9-]{36})(\/cards)?$/i)
      if (req.method === 'GET' && authorRoute) {
        const profile = community.profile(authorRoute[1])
        return sendJson(res, 200, authorRoute[2] ? { ok: true, ...community.list({ ...pageOptions(url), authorId: profile.id, viewerId: viewerFor(req)?.id }) } : { ok: true, profile })
      }
      if (req.method === 'GET' && pathname === '/api/community/notifications') return sendJson(res, 200, { ok: true, ...community.notifications(requireUser(req).id, pageOptions(url)) })
      if (req.method === 'POST' && pathname === '/api/community/notifications/read') {
        const user = requireUser(req); rates.take('read:' + user.id, 30)
        const body = await bodyJson(req)
        return sendJson(res, 200, { ok: true, unread: community.readNotifications(user.id, body.all === true ? 'all' : body.ids) })
      }
      if (req.method === 'GET' && pathname === '/api/community/my-feedback') return sendJson(res, 200, { ok: true, ...community.reports({ ...pageOptions(url), userId: requireUser(req).id, status: 'all' }) })
      if (req.method === 'GET' && pathname === '/api/community/moderation/reports') {
        requireModerator(req)
        return sendJson(res, 200, { ok: true, ...community.reports({ ...pageOptions(url), status: url.searchParams.get('status') || 'pending' }) })
      }
      const reviewRoute = pathname.match(/^\/api\/community\/moderation\/reports\/([a-f0-9-]{36})\/resolve$/i)
      if (req.method === 'POST' && reviewRoute) {
        const moderator = requireModerator(req); rates.take('moderation:' + moderator.id, 20)
        community.resolveReport(reviewRoute[1], moderator.id, await bodyJson(req))
        return sendJson(res, 200, { ok: true })
      }
      if (req.method === 'POST' && pathname === '/api/community/cards') {
        const user = requireUser(req)
        rates.take('publish:' + user.id, 5)
        const card = store.publish(user.id, await bodyJson(req))
        return sendJson(res, 200, { ok: true, card: community.details(card.id, user.id).card })
      }
      const cardRoute = pathname.match(/^\/api\/community\/cards\/([a-f0-9-]{36})(?:\/(withdraw|report|bookmark|edit|branches|path))?$/i)
      if (cardRoute) {
        const [, id, action] = cardRoute
        if (req.method === 'GET' && !action) {
          return sendJson(res, 200, { ok: true, ...community.details(id, viewerFor(req)?.id) })
        }
        if (req.method === 'GET' && action === 'branches') return sendJson(res, 200, { ok: true, ...community.list({ ...pageOptions(url), sourceId: id, viewerId: viewerFor(req)?.id }) })
        if (req.method === 'GET' && action === 'path') return sendJson(res, 200, { ok: true, ...paths.ancestors(id, { viewerId: viewerFor(req)?.id || null, cursor: url.searchParams.get('cursor') || '', limit: url.searchParams.get('limit') || 8 }) })
        if (req.method === 'POST' && action === 'bookmark') {
          const user = requireUser(req); rates.take('bookmark:' + user.id, 30)
          return sendJson(res, 200, { ok: true, bookmarked: community.bookmark(id, user.id, (await bodyJson(req)).saved) })
        }
        if (req.method === 'POST' && action === 'edit') {
          const user = requireUser(req); rates.take('edit:' + user.id, 10)
          return sendJson(res, 200, { ok: true, card: community.edit(id, user.id, await bodyJson(req)) })
        }
        if (req.method === 'POST' && action === 'withdraw') return sendJson(res, 200, { ok: true, card: store.withdraw(id, requireUser(req).id) })
        if (req.method === 'POST' && action === 'report') {
          const user = requireUser(req)
          rates.take('report:' + user.id, 5)
          community.report(id, user.id, (await bodyJson(req)).reason)
          return sendJson(res, 200, { ok: true })
        }
      }
      return sendJson(res, 404, { ok: false, code: 'NOT_FOUND', message: '找不到这个接口。' })
    } catch (error) {
      if (res.destroyed) return true
      if (error.status === 429) res.setHeader('Retry-After', '60')
      return sendJson(res, error instanceof ApiError ? error.status : 500, { ok: false, code: error.code || 'SERVER_ERROR', message: error instanceof ApiError ? error.message : '服务暂时无法完成操作，请稍后再试。' })
    }
  }
  return { handle, store, community, close: () => store.close() }
}
