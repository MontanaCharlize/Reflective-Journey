import { Bookmark, GitBranch } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { saveBookmark } from '../lib/community'
import type { ThoughtCard } from '../lib/community-types'
import { getWorkspaceOwner } from '../lib/workspace'

export function ThoughtCardRow({ card, signedIn, onOpen, onAuthor, onAccount, onBookmark }: {
  card: ThoughtCard; signedIn: boolean; onOpen: (id: string) => void; onAuthor: (id: string) => void; onAccount: () => void; onBookmark?: (card: ThoughtCard) => void
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const mounted = useRef(true), owner = useRef(getWorkspaceOwner())
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const toggle = async () => {
    if (!signedIn) { onAccount(); return }
    if (busy) return
    setBusy(true); setError('')
    try { const result = await saveBookmark(card.id, !card.bookmarked); if (mounted.current && owner.current === getWorkspaceOwner()) onBookmark?.({ ...card, bookmarked: result.bookmarked }) }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '收藏暂未保存。') }
    finally { if (mounted.current) setBusy(false) }
  }
  return <article className="community-card-row">
    <div className="thought-card-meta"><button className="author-link" onClick={() => onAuthor(card.author.id)}>{card.author.displayName}</button><time dateTime={new Date(card.createdAt).toISOString()}>{new Date(card.createdAt).toLocaleDateString('zh-CN')}</time>{card.sourceCardId && <span>接续的思考</span>}{card.status === 'withdrawn' && <span>已撤回公开</span>}</div>
    <button className="community-card-main" onClick={() => onOpen(card.id)}><h2>{card.question}</h2><p>{card.fields.keyDiscovery || card.fields.currentJudgment || card.fields.openQuestion || card.fields.initialJudgment || card.fields.nextAction}</p><span>看看这次思考 ↗</span></button>
    {card.status === 'public' && <div className="community-card-footer"><span>{card.branchCount > 0 && <><GitBranch size={13} />{card.branchCount} 条接续成果</>}</span><button className="bookmark-action" aria-label={(card.bookmarked ? '取消收藏：' : '收藏：') + card.question} aria-pressed={card.bookmarked} disabled={busy} onClick={() => void toggle()}><Bookmark size={14} fill={card.bookmarked ? 'currentColor' : 'none'} />{busy ? '正在保存…' : card.bookmarked ? '已收藏' : '留待再想'}</button></div>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </article>
}
