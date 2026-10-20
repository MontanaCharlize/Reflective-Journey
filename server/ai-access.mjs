const loopback = (host) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)
export function localGuestAiAllowed(req, env) {
  if (env.AI_ALLOW_LOCAL_GUEST === 'false' || env.AI_LOCAL_ONLY === 'true') return false
  if (req.headers.forwarded || req.headers['x-forwarded-for'] || req.headers['x-real-ip']) return false
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return false
  try {
    const host = new URL('http://' + req.headers.host).hostname
    const origin = new URL(req.headers.origin || 'http://' + req.headers.host).hostname
    if (!loopback(host) || !loopback(origin)) return false
    if (env.APP_ORIGIN && !loopback(new URL(env.APP_ORIGIN).hostname)) return false
    return true
  } catch { return false }
}
