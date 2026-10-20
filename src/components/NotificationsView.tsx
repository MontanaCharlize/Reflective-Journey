import { useRef, useState, useEffect } from 'react'
import { getNotifications, readNotifications } from '../lib/community'
import type { CommunityNotification } from '../lib/community-types'
import { usePagedList } from '../lib/use-paged-list'
import { CommunityNav } from './CommunityNav'
import type { CommunitySection } from './CommunityNav'

export function NotificationsView({ signedIn, onOpen, onAccount, onUnread, onNavigate }: { signedIn: boolean; onOpen: (id: string) => void; onAccount: () => void; onUnread: (n: number) => void; onNavigate: (view: CommunitySection) => void }) {
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const list = usePagedList<CommunityNotification>('notifications', async (cursor) => { const page = await getNotifications(cursor); if (alive.current) onUnread(page.unread); return { items: page.notifications, nextCursor: page.nextCursor } }, signedIn)
  const read = async (id?: string, cardId?: string) => {
    if (busy) return
    setBusy(id || 'all'); setError('')
    try {
      const result = await readNotifications(id ? [id] : 'all')
      if (!alive.current) return
      onUnread(result.unread)
      list.setItems((items) => items.map((item) => !id || item.id === id ? { ...item, readAt: item.readAt || Date.now() } : item))
      if (cardId) onOpen(cardId)
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '提醒暂未标记。') }
    finally { if (alive.current) setBusy('') }
  }
  return <main className="community-shell"><CommunityNav active="notifications" onNavigate={onNavigate} /><div className="community-head"><div><p className="eyebrow">有人沿着你的问题，继续想了一点</p><h1>接续提醒</h1><p>只在有人选择分享接续成果后，告诉你思考从哪里有了新的分支。</p></div>{signedIn && <button className="text-action" disabled={Boolean(busy) || !list.items.length} onClick={() => void read()}>全部标为已读</button>}</div>
    {!signedIn ? <section className="community-empty"><p>登录后可以查看自己的接续提醒。</p><button className="primary-action" onClick={onAccount}>进入账户</button></section> : <>
      {(error || list.error) && <p className="inline-error" role="alert">{error || list.error}</p>}{list.error && <button className="text-action" onClick={() => void list.refresh()}>重新读取</button>}
      {list.loading && !list.items.length && <p className="community-loading" role="status">正在读取提醒…</p>}
      {!list.loading && !list.error && !list.items.length && <div className="community-empty"><p>还没有新的接续成果。</p><span>你的思考卡被他人接续并自愿分享后，会在这里留下提醒。</span><div className="empty-community-actions"><button className="secondary-action" onClick={() => onNavigate('shares')}>看看我的分享</button></div></div>}
      <div className="notification-list">{list.items.map((item) => <article key={item.id} className={'notification-row' + (!item.readAt ? ' unread' : '')}><div><span>{item.actor.displayName} 接续了你的思考</span><time>{new Date(item.createdAt).toLocaleString('zh-CN')}</time>{!item.readAt && <span className="unread-label">未读</span>}</div><p className="notification-source">从「{item.sourceQuestion}」出发</p><h2>{item.question}</h2><button className="text-action" disabled={Boolean(busy)} onClick={() => void read(item.id, item.cardId)}>查看接续成果 ↗</button></article>)}</div>
      {list.cursor && <button className="secondary-action" disabled={list.loading} onClick={() => void list.more()}>更早的提醒</button>}
    </>}
  </main>
}
