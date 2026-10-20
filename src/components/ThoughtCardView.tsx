import { useEffect, useRef, useState } from 'react'
import { Bookmark } from 'lucide-react'
import { cardUrl, getBranches, getCard, reportCard, saveBookmark, withdrawCard } from '../lib/community'
import { sharedFieldLabels } from '../lib/community-types'
import type { AccountUser, CardDetails, SharedField, ThoughtCard } from '../lib/community-types'
import { CommunityNav } from './CommunityNav'
import type { CommunitySection } from './CommunityNav'
import { ThoughtCardRow } from './ThoughtCardRow'
import { ShareDialog } from './ShareDialog'
import { ThoughtPath } from './ThoughtPath'

export function ThoughtCardView({ id, user, onOpen, onAuthor, onStart, onDiscover, onAccount, onNavigate }: {
  id: string; user: AccountUser | null; onOpen: (id: string) => void; onAuthor: (id: string) => void; onStart: (card: ThoughtCard, mode: 'ai' | 'local') => Promise<void>; onDiscover: () => void; onAccount: () => void; onNavigate: (view: CommunitySection) => void
}) {
  const [details, setDetails] = useState<CardDetails | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false), [confirmWithdraw, setConfirmWithdraw] = useState(false), [withdrawing, setWithdrawing] = useState(false)
  const [showLink, setShowLink] = useState(false), [notice, setNotice] = useState(''), [reason, setReason] = useState(''), [reporting, setReporting] = useState(false)
  const [saving, setSaving] = useState(false), [editing, setEditing] = useState(false), [loadingMore, setLoadingMore] = useState(false)
  const [dialogueMode, setDialogueMode] = useState<'ai' | 'local'>('ai')
  const alive = useRef(true), version = useRef(0), editingRef = useRef(false)
  editingRef.current = editing
  const load = async () => {
    const at = ++version.current
    setLoading(true); setError('')
    try { const value = await getCard(id); if (alive.current && at === version.current) setDetails(value) }
    catch (failure) { if (alive.current && at === version.current) { setDetails(null); setError(failure instanceof Error ? failure.message : '暂时无法读取这张卡。') } }
    finally { if (alive.current && at === version.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true; void load()
    const focus = () => { if (document.visibilityState === 'visible' && !editingRef.current) void load() }
    window.addEventListener('focus', focus)
    return () => { alive.current = false; version.current++; window.removeEventListener('focus', focus) }
  }, [id, user?.id])
  const start = async () => {
    if (!details || starting) return
    setStarting(true); setError('')
    try { await onStart(details.card, dialogueMode) }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '暂时无法开始。') }
    finally { if (alive.current) setStarting(false) }
  }
  const toggleBookmark = async () => {
    if (!user) { onAccount(); return }
    if (!details || saving) return
    setSaving(true); setError('')
    try { const result = await saveBookmark(id, !details.card.bookmarked); if (alive.current) setDetails((current) => current && { ...current, card: { ...current.card, bookmarked: result.bookmarked } }) }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '收藏暂未保存。') }
    finally { if (alive.current) setSaving(false) }
  }
  const copyLink = async () => {
    setShowLink(true)
    try { if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(cardUrl(id)); if (alive.current) setNotice('分享链接已复制。') } else setNotice('选中下方链接即可复制。') }
    catch { if (alive.current) setNotice('可以选中下方链接手动复制。') }
  }
  const withdraw = async () => {
    if (!details || withdrawing) return
    setWithdrawing(true); setError('')
    try { const result = await withdrawCard(id); if (alive.current) { setDetails((current) => current && { ...current, card: result.card }); setConfirmWithdraw(false); setShowLink(false); setNotice('已撤回公开，个人记录仍然保留。') } }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '暂时无法撤回。') }
    finally { if (alive.current) setWithdrawing(false) }
  }
  const sendReport = async () => {
    if (reporting) return
    setReporting(true); setError('')
    try { await reportCard(id, reason); if (alive.current) { setNotice('内容反馈已记录，可以在“我的反馈”查看处理进度。'); setReason('') } }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '反馈暂未保存。') }
    finally { if (alive.current) setReporting(false) }
  }
  const moreBranches = async () => {
    if (!details?.nextBranchCursor || loadingMore) return
    const at = version.current
    setLoadingMore(true); setError('')
    try {
      const page = await getBranches(id, details.nextBranchCursor)
      if (alive.current && at === version.current) setDetails((current) => current && { ...current, branches: [...current.branches, ...page.cards.filter((card) => !current.branches.some((old) => old.id === card.id))], nextBranchCursor: page.nextCursor })
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '接续成果暂时无法读取。') }
    finally { if (alive.current) setLoadingMore(false) }
  }
  if (loading && !details) return <main className="community-shell"><p role="status" className="community-loading">正在读取这次思考…</p></main>
  if (!details) return <main className="community-shell"><CommunityNav active="card" onNavigate={onNavigate} /><p className="inline-error" role="alert">{error || '这张思考卡已撤回或不存在。'}</p><div className="card-tools"><button className="secondary-action" onClick={onDiscover}>回到发现</button><button className="text-action" onClick={() => void load()}>重新读取</button></div></main>
  const { card, source, branches } = details
  const owner = user?.id === card.author.id, names = Object.keys(sharedFieldLabels) as SharedField[]
  return <main className="thought-detail-shell">
    <CommunityNav active="card" onNavigate={onNavigate} />
    <button className="text-action" onClick={onDiscover}>↶ 回到发现思考</button>
    <div className="thought-card-meta"><button className="author-link" onClick={() => onAuthor(card.author.id)}>{card.author.displayName}</button><time>{new Date(card.createdAt).toLocaleString('zh-CN')}</time>{card.revision > 1 && <span>更新于 {new Date(card.updatedAt).toLocaleString('zh-CN')}</span>}{card.status === 'withdrawn' && <span>已撤回公开 · 仅作者可查看</span>}</div>
    <h1>{card.question}</h1>
    <ThoughtPath key={`${card.id}:${version.current}:${card.status}:${card.revision}`} card={card} onOpen={onOpen} />
    <div className="thought-card-content">{names.filter((name) => card.fields[name]).map((name) => <section key={name}><span>{sharedFieldLabels[name]}</span><p>{card.fields[name]}</p></section>)}</div>
    <div className="card-start-area"><p>从同一个问题出发，先留下你自己的判断。新的思考默认保留在个人工作区。</p><label className="card-mode-label">这次怎样一起想<select aria-label="这次接续怎样思考" disabled={starting} value={dialogueMode} onChange={(event) => setDialogueMode(event.target.value as 'ai' | 'local')}><option value="ai">AI 共同思考</option><option value="local">本地提纲（不调用 AI）</option></select></label><button className="primary-action" disabled={starting} onClick={() => void start()}>{starting ? '正在生成第一问…' : '从这里开始我的思考'} ↗</button>{!user && <small>访客也可以先用本地流程思考，登录后再选择分享成果。</small>}</div>
    {card.status === 'public' && <div className="card-tools"><button className="secondary-action" disabled={saving} aria-pressed={card.bookmarked} onClick={() => void toggleBookmark()}><Bookmark size={15} fill={card.bookmarked ? 'currentColor' : 'none'} />{saving ? '正在保存…' : card.bookmarked ? '已收藏，留待再想' : '收藏，留待再想'}</button><button className="text-action" onClick={() => void copyLink()}>复制分享链接</button>{owner && <button className="text-action" onClick={() => setEditing(true)}>编辑公开内容</button>}</div>}
    {showLink && <input className="card-link-input" aria-label="思考卡分享链接" readOnly value={cardUrl(id)} onFocus={(event) => event.target.select()} />}
    {owner && card.status === 'public' && <div className="withdraw-area">{confirmWithdraw ? <><p>撤回后，发现页、收藏列表和公开链接将不再显示这张卡，你仍可在“我的分享”查看副本。</p><button className="secondary-action" disabled={withdrawing} onClick={() => void withdraw()}>{withdrawing ? '正在撤回…' : '确认撤回公开'}</button><button className="text-action" disabled={withdrawing} onClick={() => setConfirmWithdraw(false)}>先保留</button></> : <button className="text-action" onClick={() => setConfirmWithdraw(true)}>撤回这张卡的公开</button>}</div>}
    {notice && <p className="save-note" role="status">{notice}</p>}{error && <div><p className="inline-error" role="alert">{error}</p><button className="text-action" onClick={() => void load()}>刷新这张卡</button></div>}
    <section className="card-branches"><p className="eyebrow">不同的人，继续往前想</p><h2>从这里展开的思考{card.branchCount ? ` · ${card.branchCount}` : ''}</h2>{branches.length ? branches.map((branch) => <ThoughtCardRow key={branch.id} card={branch} signedIn={Boolean(user)} onOpen={onOpen} onAuthor={onAuthor} onAccount={onAccount} onBookmark={(updated) => setDetails((current) => current && { ...current, branches: current.branches.map((item) => item.id === updated.id ? updated : item) })} />) : <p className="branch-empty">还没有公开的接续成果。你可以先形成自己的判断，之后再决定是否分享。</p>}{details.nextBranchCursor && <button className="secondary-action" disabled={loadingMore} onClick={() => void moreBranches()}>{loadingMore ? '正在读取…' : '更多接续成果'}</button>}</section>
    {card.status === 'public' && <details className="card-report"><summary>反馈这张卡的内容</summary>{user ? <><label htmlFor="card-report-reason">需要关注的地方</label><textarea id="card-report-reason" rows={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请描述具体内容和原因。反馈仅自己与运营者可见。" /><div className="card-tools"><button className="secondary-action" disabled={reporting || reason.trim().length < 4} onClick={() => void sendReport()}>{reporting ? '正在记录…' : '提交内容反馈'}</button><button className="text-action" onClick={() => onNavigate('feedback')}>查看我的反馈</button></div></> : <button className="text-action" onClick={onAccount}>登录后提交反馈</button>}</details>}
    {editing && user && <ShareDialog card={card} source={source} authorName={user.displayName} onClose={() => setEditing(false)} onPublished={(updated) => { setDetails((current) => current && { ...current, card: updated }); setEditing(false); setNotice('公开内容已更新，个人原始记录仍然保留。') }} />}
  </main>
}
