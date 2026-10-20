export type AppView = 'home' | 'session' | 'history' | 'completed' | 'lab' | 'discover' | 'card' | 'account' | 'shares' | 'bookmarks' | 'author' | 'notifications' | 'feedback' | 'moderation'
export function readRoute(hash: string): { view: AppView; cardId: string | null } {
  const part = hash.replace(/^#\/?/, '')
  if (part.startsWith('community/') || part.startsWith('people/')) {
    const author = part.startsWith('people/')
    try { const id = decodeURIComponent(part.slice(author ? 'people/'.length : 'community/'.length)); return { view: author ? 'author' : 'card', cardId: id.slice(0, 128) } }
    catch { return { view: author ? 'author' : 'card', cardId: 'invalid' } }
  }
  const routes: Record<string, AppView> = { community: 'discover', account: 'account', 'my-shares': 'shares', bookmarks: 'bookmarks', notifications: 'notifications', feedback: 'feedback', moderation: 'moderation', history: 'history', thinking: 'session', result: 'completed', lab: 'lab' }
  return { view: routes[part] || 'home', cardId: null }
}
export function routeHash(view: AppView, cardId?: string | null) {
  const paths: Partial<Record<AppView, string>> = { discover: 'community', account: 'account', shares: 'my-shares', bookmarks: 'bookmarks', notifications: 'notifications', feedback: 'feedback', moderation: 'moderation', history: 'history', session: 'thinking', completed: 'result', lab: 'lab' }
  if ((view === 'card' || view === 'author') && cardId) return '#/' + (view === 'card' ? 'community/' : 'people/') + encodeURIComponent(cardId)
  return '#/' + (paths[view] || '')
}
