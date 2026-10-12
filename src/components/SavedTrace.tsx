import { cognitiveMoveLabel } from '../lib/engine'
import type { ThinkingSession } from '../lib/types'

export function SavedTrace({ session }: { session: ThinkingSession }) {
  return (
    <section className="saved-trace">
      <div className="saved-trace-head">
        <p className="eyebrow">从问题到当前判断</p>
        <h2>完整思考轨迹</h2>
        <p>你的每次回答、系统每次介入，以及介入背后的认知动作和生成来源都保留在这里。</p>
      </div>
      <ol>
        {session.trace.map((item, index) => {
          const isQuestion = item.kind === 'question'
          const isUser = item.kind === 'user'
          return (
            <li key={item.id} className={isUser ? 'saved-step saved-user' : 'saved-step'}>
              <div className="saved-index">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <div className="saved-kind">
                  {isQuestion
                    ? '原始问题'
                    : isUser
                      ? '我的回答'
                      : item.move
                        ? `系统介入 · ${cognitiveMoveLabel[item.move]} · ${item.source === 'ai' ? '动态生成' : '本地备用'}`
                        : '系统介入'}
                </div>
                {item.title && !isQuestion && !isUser && <h3>{item.title}</h3>}
                <p>{item.content}</p>
                {session.supportRecords.filter((record) => record.questionId === item.id).map((record) => <aside className="support-note" key={record.id}><p>{record.kind === 'hint' ? '使用的提示：' : '后来换个问法：'}{record.content}</p></aside>)}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
