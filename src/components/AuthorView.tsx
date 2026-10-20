import { useEffect, useState } from 'react'
import { getAuthor, getAuthorCards } from '../lib/community'
import type { AuthorProfile, ThoughtCard } from '../lib/community-types'
import { usePagedList } from '../lib/use-paged-list'
import { CommunityNav } from './CommunityNav'
import type { CommunitySection } from './CommunityNav'
import { ThoughtCardRow } from './ThoughtCardRow'

export function AuthorView({ id, viewerId, onOpen, onAuthor, onAccount, onNavigate }: {
  id: string; viewerId: string | null; onOpen: (id: string) => void; onAuthor: (id: string) => void; onAccount: () => void; onNavigate: (view: CommunitySection) => void
}) {
  const [profile, setProfile] = useState<AuthorProfile | null>(null), [error, setError] = useState('')
  useEffect(() => { let alive = true; setProfile(null); setError(''); getAuthor(id).then((value) => { if (alive) setProfile(value.profile) }).catch((failure) => { if (alive) setError(failure instanceof Error ? failure.message : '暂时无法读取作者主页。') }); return () => { alive = false } }, [id])
  const list = usePagedList<ThoughtCard>(id, async (cursor) => { const page = await getAuthorCards(id, cursor); return { items: page.cards, nextCursor: page.nextCursor } }, Boolean(profile))
  return <main className="community-shell"><CommunityNav active="author" onNavigate={onNavigate} />
    {error ? <p className="inline-error" role="alert">{error}</p> : !profile ? <p role="status">正在打开作者主页…</p> : <>
      <header className="author-profile"><span className="author-avatar" aria-hidden="true">{Array.from(profile.displayName)[0]}</span><div><p className="eyebrow">一个人的思考足迹</p><h1>{profile.displayName}</h1><p>{profile.bio || '把想清楚的部分留下，也为还没想清楚的地方留一点空间。'}</p><span>{profile.shares} 张公开成果 · {profile.branches} 次接续思考</span>{viewerId === id && <button className="text-action" onClick={onAccount}>编辑我的公开资料</button>}</div></header>
      <h2 className="section-title">公开的思考</h2>
      {list.error && <div><p className="inline-error" role="alert">{list.error}</p><button className="text-action" onClick={() => void list.refresh()}>重新读取</button></div>}
      {list.loading && !list.items.length && <p role="status" className="community-loading">正在读取…</p>}
      {!list.loading && !list.error && !list.items.length && <p className="branch-empty">这位作者暂时没有公开的思考卡。个人记录默认保留在自己的工作区。</p>}
      <div className="thought-card-list">{list.items.map((card) => <ThoughtCardRow key={card.id} card={card} signedIn={Boolean(viewerId)} onOpen={onOpen} onAuthor={onAuthor} onAccount={onAccount} onBookmark={(updated) => list.setItems((previous) => previous.map((item) => item.id === updated.id ? updated : item))} />)}</div>
      {list.cursor && <button className="secondary-action" disabled={list.loading} onClick={() => void list.more()}>再看一些思考</button>}
    </>}
  </main>
}
