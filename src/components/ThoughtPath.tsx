import { useEffect, useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { CommunityError, getAncestorPath, getBranches } from '../lib/community'
import type { AncestorPage, ThoughtCard } from '../lib/community-types'
import { usePagedList } from '../lib/use-paged-list'

function BranchNode({ card, onOpen, depth = 0 }: { card: ThoughtCard; onOpen: (id: string) => void; depth?: number }) {
  const [expanded, setExpanded] = useState(false)
  const list = usePagedList<ThoughtCard>(card.id, async (cursor) => {
    const page = await getBranches(card.id, cursor)
    return { items: page.cards, nextCursor: page.nextCursor }
  }, expanded)
  const excerpt = card.fields.currentJudgment || card.fields.keyDiscovery || card.fields.openQuestion
  return <li className="thought-path-node">
    <button className="path-card-link" onClick={() => onOpen(card.id)}><span>{card.author.displayName}</span><strong>{card.question}</strong>{excerpt && <small>{excerpt.length > 160 ? excerpt.slice(0, 160) + '…' : excerpt}</small>}</button>
    {card.branchCount > 0 && (depth < 5 ? <button className="text-action path-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '收起这条分支' : `展开后续思考 · ${card.branchCount}`}</button> : <button className="text-action" onClick={() => onOpen(card.id)}>打开这张卡，继续看后续路径 ↗</button>)}
    {expanded && <>
      {list.loading && !list.items.length && <p role="status">正在读取这条分支…</p>}
      {list.error && <div><p className="inline-error" role="alert">{list.error}</p><button className="text-action" onClick={() => void list.refresh()}>重新读取分支</button></div>}
      <ol>{list.items.map((child) => <BranchNode key={child.id} card={child} depth={depth + 1} onOpen={onOpen} />)}</ol>
      {!list.loading && !list.error && !list.items.length && <p className="path-empty">目前没有可公开的后续成果。</p>}
      {list.cursor && <button className="text-action" disabled={list.loading} onClick={() => void list.more()}>更多同层思考</button>}
    </>}
  </li>
}

export function ThoughtPath({ card, onOpen }: { card: ThoughtCard; onOpen: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [path, setPath] = useState<AncestorPage | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const mounted = useRef(true), generation = useRef(0), busy = useRef(false)
  useEffect(() => { mounted.current = true;return () => { mounted.current = false;generation.current++ } }, [])
  const children = usePagedList<ThoughtCard>(card.id, async (cursor) => {
    const page = await getBranches(card.id, cursor)
    return { items: page.cards, nextCursor: page.nextCursor }
  }, expanded)
  const load = async (cursor = '') => {
    if (busy.current) return
    busy.current = true;setLoading(true);setError('')
    const at = ++generation.current
    try {
      const page = await getAncestorPath(card.id, cursor)
      if (mounted.current && at === generation.current) setPath((previous) => cursor && previous ? { ...page, ancestors: [...page.ancestors.filter((item) => !previous.ancestors.some((old) => old.id === item.id)), ...previous.ancestors] } : page)
    } catch (failure) { if (mounted.current && at === generation.current) { if (failure instanceof CommunityError && ['BAD_PATH_CURSOR', 'CARD_NOT_FOUND'].includes(failure.code)) setPath(null);setError(failure instanceof Error ? failure.message : '来源路径暂时无法读取。') } }
    finally { busy.current = false;if (mounted.current && at === generation.current) setLoading(false) }
  }
  return <section className="community-path" aria-label="公开思考路径">
    <div className="community-path-head"><div><p className="eyebrow"><GitBranch size={14} /> 一个问题，怎样被继续</p><p>每个分支都是独立形成的判断。这里只显示愿意公开的成果。</p></div><button className="secondary-action" aria-expanded={expanded} onClick={() => { setExpanded(!expanded);if (!expanded && !path) void load() }}>{expanded ? '收起思考路径' : '展开思考路径'}</button></div>
    {expanded && <div className="thought-path-content">
      {error && <div><p className="inline-error" role="alert">{error}</p><button className="text-action" disabled={loading} onClick={() => void load()}>重新读取来源路径</button></div>}
      {loading && <p role="status">正在读取来源路径…</p>}
      {path?.nextCursor && <button className="text-action" disabled={loading} onClick={() => void load(path.nextCursor || '')}>继续查看更早的来源</button>}
      {path?.ancestors.length ? <ol className="path-ancestors">{path.ancestors.map((source) => <li key={source.id}>{source.status === 'public' ? <button className="path-card-link" onClick={() => onOpen(source.id)}><span>{source.author?.displayName}</span><strong>{source.question}</strong></button> : <p className="path-unavailable">此前一张卡已停止公开，来源路径到此为止。</p>}</li>)}</ol> : path && <p className="path-empty">这次思考从一个新问题开始。</p>}
      {path?.stopped === 'cycle' && <p className="path-unavailable">这段来源关系暂时无法继续读取，可以打开已有卡片查看。</p>}
      {path?.stopped === 'limit' && <p className="path-unavailable">这条来源路径较长，可以打开最早显示的卡片，继续向前查看。</p>}
      <div className="path-current" aria-current="page"><span>你正在看 · {card.author.displayName}</span><strong>{card.question}</strong></div>
      <ol className="path-descendants">{children.items.map((child) => <BranchNode key={child.id} card={child} onOpen={onOpen} />)}</ol>
      {children.loading && <p role="status">正在读取接续成果…</p>}
      {children.error && <div><p className="inline-error" role="alert">{children.error}</p><button className="text-action" onClick={() => void children.refresh()}>重新读取接续成果</button></div>}
      {!children.loading && !children.error && !children.items.length && <p className="path-empty">还没有公开的接续成果，可以先从这里形成自己的判断。</p>}
      {children.cursor && <button className="text-action" disabled={children.loading} onClick={() => void children.more()}>更多同层思考</button>}
    </div>}
  </section>
}
