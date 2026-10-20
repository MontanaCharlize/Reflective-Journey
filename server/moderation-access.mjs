const values = (value) => String(value || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/

export function createModerationAccess(store, env = {}) {
  const ids = new Set(values(env.COMMUNITY_MODERATOR_IDS))
  if ([...ids].some((id) => !uuid.test(id))) throw new Error('COMMUNITY_MODERATOR_IDS 需要填写已有账户的完整 ID，多个 ID 用逗号分隔。')
  const reservedNames = new Set(values(env.COMMUNITY_MODERATOR_USERS))
  const account = store.db.prepare('SELECT id FROM users WHERE username=?')
  // 旧用户名配置仅在启动时绑定已有身份；稍后建立同名账户不会获得权限。
  for (const name of reservedNames) {
    const user = account.get(name)
    if (user) ids.add(user.id)
  }
  return {
    isModerator: (user) => Boolean(user && ids.has(user.id.toLowerCase())),
    isReservedUsername: (username) => typeof username === 'string' && reservedNames.has(username.trim().toLowerCase()),
  }
}
