import { ArrowUpRight, Trash2 } from 'lucide-react'
import type { ThinkingSession } from '../lib/types'

export function History({
  sessions,
  onOpen,
  onDelete,
  onNew,
  onOpenCard,
}: {
  sessions: ThinkingSession[]
  onOpen: (session: ThinkingSession) => void
  onDelete: (id: string) => void
  onNew: () => void
  onOpenCard?: (id: string) => void
}) {
  return (
    <main className="history-shell">
      <div className="history-head">
        <div>
          <p className="eyebrow">答案会过时，思考过程不会</p>
          <h1>我的思考</h1>
        </div>
        <button className="primary-action" onClick={onNew}>提出新问题 <ArrowUpRight size={16} /></button>
      </div>

      {sessions.length === 0 ? (
        <div className="empty-history">
          <p>这里还没有记录。</p>
          <span>你的回答、追问、确认的收获和后来的验证，会一起留在这里。</span>
        </div>
      ) : (
        <div className="history-list">
          {sessions.map((session) => {
            const userTurns = session.trace.filter((item) => item.kind === 'user').length
            return (
              <article className="history-row" key={session.id}>
                <div className="history-content"><button className="history-main" onClick={() => onOpen(session)}>
                  <span className="history-question">{session.question}</span>
                  <span className="history-meta">
                    {new Date(session.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{session.status === 'completed' ? '已整理' : '进行中'}
                    {' · '}{userTurns} 次回答
                    {' · '}过程已保存
                    {session.verification && <>{' · '}{session.verification.status === 'planned' ? '有尝试待回看' : '已记录验证结果'}</>}
                  </span>
                  {session.summary?.currentJudgment && <span className="history-summary">{session.summary.currentJudgment}</span>}
                </button>
                {onOpenCard && <div className="history-community-links">{session.communitySource && <button className="text-action" onClick={() => onOpenCard(session.communitySource!.cardId)}>回到来源问题 ↗</button>}{session.publishedCards?.[0] && <button className="text-action" onClick={() => onOpenCard(session.publishedCards![0].cardId)}>查看我的分享 ↗</button>}</div>}
                </div>
                <button className="delete-action" onClick={() => onDelete(session.id)} aria-label="删除记录"><Trash2 size={16} /></button>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
