import { useState } from 'react'
import { getBookmarks, getFeed, getMyCards } from '../lib/community'
import type { ThoughtCard } from '../lib/community-types'
import { usePagedList } from '../lib/use-paged-list'
import { CommunityNav } from './CommunityNav'
import type { CommunitySection } from './CommunityNav'
import { ThoughtCardRow } from './ThoughtCardRow'

export function CommunityView({ mode = 'discover', signedIn, onOpen, onAuthor, onNew, onAccount, onNavigate }: {
  mode?: 'discover' | 'shares' | 'bookmarks'; signedIn: boolean; onOpen: (id: string) => void; onAuthor: (id: string) => void; onNew: () => void; onAccount: () => void; onNavigate: (view: CommunitySection) => void
}) {
  const [query, setQuery] = useState(''), [applied, setApplied] = useState(''), [filter, setFilter] = useState('all')
  const mine = mode === 'shares', saved = mode === 'bookmarks', needsAccount = mode !== 'discover' && !signedIn
  const list = usePagedList<ThoughtCard>([mode, applied, filter].join(':'), async (cursor) => {
    const result = mine ? await getMyCards(applied, cursor, filter) : saved ? await getBookmarks(applied, cursor) : await getFeed(applied, cursor, filter)
    return { items: result.cards, nextCursor: result.nextCursor }
  }, !needsAccount)
  const updateBookmark = (card: ThoughtCard) => list.setItems((previous) => saved && !card.bookmarked ? previous.filter((item) => item.id !== card.id) : previous.map((item) => item.id === card.id ? card : item))
  const filters = mine ? [['all', '全部分享'], ['public', '公开中'], ['withdrawn', '已撤回']] : [['all', '全部思考'], ['original', '从问题开始'], ['branch', '接续的思考']]
  return <main className="community-shell">
    <CommunityNav active={mode} onNavigate={onNavigate} />
    <div className="community-head"><div><p className="eyebrow">一个问题，可以有不同的思考路径</p><h1>{mine ? '我的分享' : saved ? '留待再想' : '发现思考'}</h1><p>{mine ? '管理你确认过的公开成果，看见从这里展开的新分支。' : saved ? '先把触动你的问题留下，等有空时，再形成自己的判断。收藏仅自己可见。' : '看见一个判断怎样形成，再从同一个问题出发，留下自己的思考。'}</p></div><button className="secondary-action" onClick={onNew}>开始自己的思考 ↗</button></div>
    {needsAccount ? <section className="community-empty"><p>登录后，{saved ? '可以保存感兴趣的思考卡。' : '可以管理自己的分享。'}</p><button className="primary-action" onClick={onAccount}>进入账户</button></section> : <>
      <form className="community-search" onSubmit={(event) => { event.preventDefault(); setApplied(query.trim()) }}><input aria-label="搜索思考卡" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="搜索问题、想法或作者" /><button className="text-action" type="submit">搜索</button>{applied && <button className="text-action" type="button" onClick={() => { setQuery(''); setApplied('') }}>清除</button>}</form>
      {!saved && <div className="community-filters" aria-label="筛选思考卡">{filters.map(([value, title]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{title}</button>)}</div>}
      {list.error && <div className="community-error"><p className="inline-error" role="alert">{list.error}</p><button className="text-action" onClick={() => void list.refresh()}>重新读取</button></div>}
      {list.loading && !list.items.length && <p className="community-loading" role="status">正在读取思考卡…</p>}
      {!list.loading && !list.error && !list.items.length && <section className="community-empty"><p>{applied ? '暂时没有找到相关思考。' : mine ? (filter === 'withdrawn' ? '还没有撤回的思考卡。' : '你还没有这样的分享。') : saved ? '还没有留待再想的思考。' : filter === 'branch' ? '还没有公开的接续成果。' : '第一条思考，可以从你开始。'}</p><span>{saved ? '在思考卡旁点“留待再想”即可收藏。已撤回的内容不会出现在这里。' : '完成一次思考后，再由你决定要不要把其中的一部分分享出来。'}</span><div className="empty-community-actions"><button className="secondary-action" onClick={saved ? () => onNavigate('discover') : onNew}>{saved ? '去发现一个问题' : '从我的问题开始'}</button></div></section>}
      <div className="thought-card-list">{list.items.map((card) => <ThoughtCardRow key={card.id} card={card} signedIn={signedIn} onOpen={onOpen} onAuthor={onAuthor} onAccount={onAccount} onBookmark={updateBookmark} />)}</div>
      {list.cursor && <button className="secondary-action" disabled={list.loading} onClick={() => void list.more()}>{list.loading ? '正在读取…' : '再看一些思考'}</button>}
    </>}
  </main>
}