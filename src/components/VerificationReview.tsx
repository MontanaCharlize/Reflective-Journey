import { useState } from 'react'
import { reviewVerification } from '../lib/reflection'
import { loadDraft, saveDraft, saveSession } from '../lib/storage'
import type { ThinkingSession } from '../lib/types'

export function VerificationReview({ session, onChange }: { session: ThinkingSession; onChange: (session: ThinkingSession) => void }) {
  const [draft, setDraft] = useState(() => loadDraft(session.id))
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const plan = session.verification
  if (!plan) return null
  const edit = (field: 'reviewOutcome' | 'revisedJudgment', value: string) => {
    const next = { ...draft, [field]: value }
    setDraft(next)
    setSaved(false)
    try { saveDraft(session.id, next); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '草稿未能保存。') }
  }
  const submit = () => {
    try {
      const next = saveSession(reviewVerification(session, draft.reviewOutcome, draft.revisedJudgment))
      onChange(next)
      const cleared = { ...draft, reviewOutcome: '', revisedJudgment: '' }
      setDraft(cleared)
      setEditing(false)
      setSaved(true)
      setError('')
      try { saveDraft(session.id, cleared) } catch { /* 验证结果已经保存。 */ }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '结果暂时无法保存。') }
  }
  return <section className="verification-review">
    <p className="eyebrow">{plan.status === 'planned' ? '留给下一次真实经历' : '想法与现实，再对照一次'}</p>
    <h2>我准备验证的一件事</h2><p className="verification-action">{plan.action}</p>
    {plan.expectedSignal && <p className="verification-signal"><span>想观察的信号</span>{plan.expectedSignal}</p>}
    {plan.reviews.map((review) => <article className="review-entry" key={review.id}><time>{new Date(review.createdAt).toLocaleDateString('zh-CN')}</time><h3>这次实际发生了什么</h3><p>{review.outcome}</p>{review.revisedJudgment && <><h3>现在，我会这样判断</h3><p>{review.revisedJudgment}</p></>}</article>)}
    {!editing ? <button className="secondary-action" onClick={() => { setEditing(true); setSaved(false) }}>{plan.reviews.length ? '再记录一次观察' : '有结果了，回来看看'}</button> : <div className="review-form">
      <label><span>实际观察到的结果</span><textarea value={draft.reviewOutcome} onChange={(event) => edit('reviewOutcome', event.target.value)} rows={3} placeholder="支持、推翻或暂时看不出结果，都可以如实记录。" /></label>
      <label><span>现在的判断（可选）</span><textarea value={draft.revisedJudgment} onChange={(event) => edit('revisedJudgment', event.target.value)} rows={2} placeholder="这次经历让你如何看待原来的想法？" /></label>
      <div className="response-actions"><button className="text-action" onClick={() => setEditing(false)}>下次再写</button><button className="primary-action" disabled={!draft.reviewOutcome.trim()} onClick={submit}>保存这次回看</button></div>
    </div>}
    {saved && <p className="save-note" role="status">这次回看已保存，可以随时再来补充。</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </section>
}
