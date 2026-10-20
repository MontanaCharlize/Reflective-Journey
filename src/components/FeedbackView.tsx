import { useState, useRef, useEffect } from 'react'
import { getReports, resolveReport } from '../lib/community'
import type { ContentReport } from '../lib/community-types'
import { usePagedList } from '../lib/use-paged-list'
import { CommunityNav } from './CommunityNav'
import type { CommunitySection } from './CommunityNav'

function ReportItem({ report, moderate, onOpen, onResolved }: { report: ContentReport; moderate: boolean; onOpen: (id: string) => void; onResolved: () => void }) {
  const [resolution, setResolution] = useState<'keep' | 'withdraw'>('keep'), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const submit = async () => {
    if (busy) return
    setBusy(true); setError('')
    try { await resolveReport(report.id, resolution, note, report.createdAt, report.cardRevision); if (alive.current) onResolved() }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '处理尚未保存。') }
    finally { if (alive.current) setBusy(false) }
  }
  return <article className="feedback-row"><div className="feedback-meta"><span>{report.resolution ? '已处理' : '等待查看'}</span><time>{new Date(report.createdAt).toLocaleString('zh-CN')}</time></div><h2>{report.question || '对应思考卡已撤回公开'}</h2><p className="feedback-reason">{report.reason}</p>
    {report.cardStatus === 'public' && <button className="text-action" onClick={() => onOpen(report.cardId)}>查看对应卡片 ↗</button>}
    {report.resolution && <div className="feedback-resolution"><span>{report.resolution === 'withdraw' ? '处理结果：停止公开' : '处理结果：保留内容'}</span><p>{report.note}</p></div>}
    {moderate && !report.resolution && <div className="moderation-form"><label htmlFor={'resolution-' + report.id}>处理方式</label><select id={'resolution-' + report.id} value={resolution} disabled={busy} onChange={(event) => setResolution(event.target.value as 'keep' | 'withdraw')}><option value="keep">保留内容，说明原因</option><option value="withdraw">停止公开，保留作者副本</option></select><label htmlFor={'review-' + report.id}>处理说明（提交反馈的人可见）</label><textarea id={'review-' + report.id} value={note} maxLength={500} disabled={busy} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="说明核查结果和处理依据，至少四个字。" /><p>{resolution === 'withdraw' ? '确认后卡片将不再出现在公开页面，作者保留自己的副本。' : '确认后反馈将标记为已处理，卡片保留当前状态。'}</p><button className="secondary-action" disabled={busy || note.trim().length < 4} onClick={() => void submit()}>{busy ? '正在保存…' : '确认处理这条反馈'}</button></div>}
    {error && <div><p className="inline-error" role="alert">{error}</p><button className="text-action" onClick={onResolved}>重新读取当前反馈</button></div>}
  </article>
}

export function FeedbackView({ moderate = false, signedIn, canModerate, onOpen, onAccount, onNavigate }: { moderate?: boolean; signedIn: boolean; canModerate: boolean; onOpen: (id: string) => void; onAccount: () => void; onNavigate: (view: CommunitySection) => void }) {
  const [status, setStatus] = useState('pending')
  const allowed = signedIn && (!moderate || canModerate)
  const list = usePagedList<ContentReport>([moderate, status].join(':'), async (cursor) => { const page = await getReports(cursor, moderate ? status : undefined); return { items: page.reports, nextCursor: page.nextCursor } }, allowed)
  return <main className="community-shell"><CommunityNav active={moderate ? 'moderation' : 'feedback'} onNavigate={onNavigate} /><p className="eyebrow">让思考留在一个值得信任的地方</p><h1 className="community-title">{moderate ? '社区内容处理' : '我的内容反馈'}</h1><p className="community-intro">{moderate ? '逐条查看内容与反馈，给出有依据的处理说明。权限由服务器配置。' : '只有你和社区运营者能看到这些反馈及处理说明。'}</p>
    {!allowed ? <div className="community-empty"><p>{signedIn ? '这个账户没有社区运营权限。' : '登录后可以查看内容反馈。'}</p>{!signedIn && <button className="primary-action" onClick={onAccount}>进入账户</button>}</div> : <>
      {moderate && <div className="community-filters">{[['pending', '待处理'], ['resolved', '已处理'], ['all', '全部反馈']].map(([value, title]) => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{title}</button>)}</div>}
      {list.error && <div><p className="inline-error" role="alert">{list.error}</p><button className="text-action" onClick={() => void list.refresh()}>重新读取</button></div>}
      {list.loading && !list.items.length && <p className="community-loading" role="status">正在读取反馈…</p>}
      {!list.loading && !list.error && !list.items.length && <p className="community-empty">{moderate ? '当前没有这样的反馈。' : '你还没有提交过内容反馈。可以从思考卡底部反馈具体问题。'}</p>}
      {list.items.map((report) => <ReportItem key={[report.id, report.resolution || 'pending', report.createdAt, report.cardRevision].join(':')} report={report} moderate={moderate} onOpen={onOpen} onResolved={() => void list.refresh()} />)}
      {list.cursor && <button className="secondary-action" disabled={list.loading} onClick={() => void list.more()}>更早的反馈</button>}
    </>}
  </main>
}
