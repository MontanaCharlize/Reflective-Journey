import { ArrowRight, Check, Download } from 'lucide-react'
import { downloadSessionJson, downloadSessionMarkdown } from '../lib/export'
import type { ThinkingSession } from '../lib/types'
import { ProcessTrail } from './ProcessTrail'
import { SavedTrace } from './SavedTrace'
import { VerificationReview } from './VerificationReview'

export function Completed({ session, onChange, onNew, onHistory }: { session: ThinkingSession; onChange: (session: ThinkingSession) => void; onNew: () => void; onHistory: () => void }) {
  return (
    <main className="completed-shell completed-wide">
      <div className="completed-mark"><Check size={18} /></div>
      <p className="eyebrow">这次思考已经完整保存</p>
      <h1>{session.question}</h1>

      {session.summary?.initialJudgment && <section className="completed-change"><span>开始时，我这样想</span><p>{session.summary.initialJudgment}</p></section>}

      <section className="completed-judgment">
        <span>你现在的判断</span>
        <p>{session.summary?.currentJudgment}</p>
      </section>

      {session.summary?.keyDiscovery && <section className="completed-change"><span>我确认的一点收获</span><p>{session.summary.keyDiscovery}</p></section>}
      {session.summary?.openQuestion && <section className="completed-change"><span>还值得继续弄清的地方</span><p>{session.summary.openQuestion}</p></section>}

      {session.summary?.changed && (
        <section className="completed-change">
          <span>和开始相比发生的变化</span>
          <p>{session.summary.changed}</p>
        </section>
      )}

      {session.summary?.keyTurningPoint && (
        <section className="completed-change">
          <span>你标记的关键转折点</span>
          <p>{session.summary.keyTurningPoint}</p>
        </section>
      )}

      <div className="archive-actions">
        <button className="secondary-action" onClick={() => downloadSessionMarkdown(session)}>
          <Download size={15} />
          导出全过程 · Markdown
        </button>
        <button className="text-action export-json" onClick={() => downloadSessionJson(session)}>
          导出原始 JSON
        </button>
      </div>

      <VerificationReview session={session} onChange={onChange} />

      <SavedTrace session={session} />
      <ProcessTrail session={session} />

      <p className="completed-note">
        这里保存的是你真实说过的话、系统识别到的认知状态、每一次提问策略，以及你最后如何重新组织了自己的判断。
      </p>
      <div className="completed-actions">
        <button className="secondary-action" onClick={onHistory}>查看我的思考</button>
        <button className="primary-action" onClick={onNew}>提出另一个问题 <ArrowRight size={16} /></button>
      </div>
    </main>
  )
}
