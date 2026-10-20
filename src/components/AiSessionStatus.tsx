import type { ThinkingSession } from '../lib/types'

export function AiSessionStatus({ session, busy, onRetry, onLocal, onAccount, onLab }: {
  session: ThinkingSession; busy: boolean; onRetry: () => void; onLocal: () => void; onAccount?: () => void; onLab?: () => void
}) {
  const runtime = session.aiRuntime
  const local = session.dialogueMode === 'local'
  const failed = runtime.status === 'failed' || Boolean(runtime.lastError)
  if (busy) return <aside className="ai-session-status" role="status">{local ? '正在整理本地提纲…' : 'AI 正在理解这段表达，并选择下一步…'}</aside>
  if (!local && runtime.status === 'ready') return <aside className="ai-session-status connected"><span className="ai-status-dot" />AI 参与理解与决策 · {runtime.provider} / {runtime.model}<small>理解有偏差时，可以直接纠正；你也可以改变讨论方向。</small></aside>
  if (local) return <aside className="ai-session-status"><strong>本地提纲 · 没有调用 AI</strong><p>这是你主动选择的辅助方式。可以随时让 AI 重新理解已有回答。</p><button className="text-action" onClick={onRetry}>让 AI 接着这段思考</button></aside>
  return <aside className={'ai-session-status' + (failed ? ' unavailable' : '')} role={failed ? 'alert' : 'status'}><strong>{failed ? 'AI 未能参与这一轮' : '这段记录仍沿用旧版决策方式'}</strong><p>{runtime.lastError || '已有原话仍然保留，可以让 AI 重新理解并选择下一步。'}</p><div className="ai-status-actions"><button className="secondary-action" onClick={onRetry}>重新接入 AI</button>{runtime.lastErrorCode === 'LOGIN_REQUIRED' && onAccount && <button className="text-action" onClick={onAccount}>登录后继续</button>}{onLab && <button className="text-action" onClick={onLab}>检查模型连接</button>}<button className="text-action" onClick={onLocal}>暂用本地提纲</button></div><small>不会把本地模板当作 AI 回应；本轮未处理完时，你的原话和草稿都会保留。</small></aside>
}
