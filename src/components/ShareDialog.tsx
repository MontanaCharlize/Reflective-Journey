import { useEffect, useRef, useState } from 'react'
import { editCard, publishCard } from '../lib/community'
import { sharedFieldLabels } from '../lib/community-types'
import type { CardSource, SharedField, ThoughtCard } from '../lib/community-types'
import { nowId } from '../lib/engine'
import { getWorkspaceOwner } from '../lib/workspace'
import type { ThinkingSession } from '../lib/types'

export function ShareDialog({ session, card, source, authorName, onClose, onPublished }: { session?: ThinkingSession; card?: ThoughtCard; source?: CardSource | null; authorName: string; onClose: () => void; onPublished: (card: ThoughtCard) => void }) {
  const [question, setQuestion] = useState(card?.question || session?.question || '')
  const [values, setValues] = useState<Record<SharedField, string>>({
    initialJudgment: card?.fields.initialJudgment || session?.summary?.initialJudgment || '', currentJudgment: card?.fields.currentJudgment || session?.summary?.currentJudgment || '', keyDiscovery: card?.fields.keyDiscovery || session?.summary?.keyDiscovery || '',
    openQuestion: card?.fields.openQuestion || session?.summary?.openQuestion || '', changed: card?.fields.changed || session?.summary?.changed || '', nextAction: card?.fields.nextAction || session?.verification?.action || '', expectedSignal: card?.fields.expectedSignal || session?.verification?.expectedSignal || '',
  })
  const [selected, setSelected] = useState<SharedField[]>(card ? Object.keys(card.fields) as SharedField[] : [])
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(nowId('share'))
  const owner = useRef(getWorkspaceOwner())
  const mounted = useRef(true)
  const names = Object.keys(sharedFieldLabels) as SharedField[]
  useEffect(() => {
    mounted.current = true
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { mounted.current = false; document.body.style.overflow = old }
  }, [])
  const change = () => { setConfirmed(false); setError('') }
  const submit = async () => {
    if (!confirmed || busy) return
    if (!owner.current || owner.current !== getWorkspaceOwner()) { setError('账户已经变化，请重新打开预览。'); return }
    setBusy(true); setError('')
    const fields = Object.fromEntries(selected.filter((name) => values[name].trim()).map((name) => [name, values[name].trim()])) as Partial<Record<SharedField, string>>
    try {
      const result = card ? await editCard(card.id, { question, fields, revision: card.revision }) : await publishCard({ question, fields, clientKey: key.current, ...(session?.communitySource ? { sourceCardId: session.communitySource.cardId } : {}) })
      if (mounted.current && getWorkspaceOwner() === owner.current) onPublished(result.card)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '暂时无法发布，预览内容仍在。') }
    finally { if (mounted.current) setBusy(false) }
  }
  const hasContent = selected.some((name) => values[name].trim())
  return <div className="share-backdrop"><section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" onKeyDown={(event) => {
    if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() }
    if (event.key !== 'Tab') return
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),input:not([disabled])')]
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus() }
  }}>
    <div className="share-head"><div><p className="eyebrow">由你决定，公开哪一部分</p><h2 id="share-title">{card ? '编辑公开的思考卡' : '预览我的思考卡'}</h2></div><button className="text-action" disabled={busy} onClick={onClose}>关闭预览</button></div>
    <p className="share-intro">{card ? '修改的是公开副本，个人记录和他人的接续成果保持各自内容。取消勾选的字段会从公开卡片移除。' : '逐项选择并修改成果。完整对话、随手记和系统分析仍留在个人工作区。'}</p>
    <label htmlFor="shared-question" className="form-label">公开的问题</label><textarea autoFocus id="shared-question" value={question} maxLength={600} rows={2} disabled={busy} onChange={(event) => { setQuestion(event.target.value); change() }} />
    <div className="share-fields">{names.map((name) => <div className="share-field" key={name}>
      <label className="share-select"><input type="checkbox" disabled={busy} checked={selected.includes(name)} onChange={(event) => { setSelected(event.target.checked ? [...selected, name] : selected.filter((value) => value !== name)); change() }} /><span>{sharedFieldLabels[name]}</span></label>
      {selected.includes(name) && <textarea aria-label={'公开内容：' + sharedFieldLabels[name]} value={values[name]} maxLength={2400} rows={3} disabled={busy} onChange={(event) => { setValues({ ...values, [name]: event.target.value }); change() }} />}
    </div>)}</div>
    <section className="share-preview" aria-label="即将公开的内容"><p className="eyebrow">即将公开的内容</p><h3>{question || '填写一个问题'}</h3><p className="share-public-meta">作者：{authorName}</p>{session?.communitySource && <p className="share-public-meta">接续自 {session.communitySource.authorName} 的公开思考卡：{session.communitySource.question}</p>}{card && source && <p className="share-public-meta">{source.status === 'public' ? `接续自 ${source.author?.displayName} 的思考卡：${source.question}` : '原来源已撤回或无法公开访问。'}</p>}{names.filter((name) => selected.includes(name) && values[name].trim()).map((name) => <div key={name}><span>{sharedFieldLabels[name]}</span><p>{values[name]}</p></div>)}{!hasContent && <p className="share-empty">选择至少一项成果，它才会出现在这里。</p>}</section>
    <label className="share-confirm"><input type="checkbox" disabled={busy || !hasContent || !question.trim()} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我确认公开预览中的这些内容</span></label>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="share-footer"><button className="text-action" disabled={busy} onClick={onClose}>{card ? '放弃本次修改' : '继续保持私密'}</button><button className="primary-action" disabled={busy || !confirmed || !hasContent || !question.trim()} onClick={() => void submit()}>{busy ? '正在保存…' : card ? '确认更新公开内容' : '发布这张思考卡'}</button></div>
  </section></div>
}
