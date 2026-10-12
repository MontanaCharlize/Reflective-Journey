import { clip, isStuckResponse, nowId } from './engine'
import type { ThinkingSession } from './types'

/** 只从已保存的表达生成可编辑草稿；不把推断当作用户确认的收获。 */
export function reflectionDraft(session: ThinkingSession) {
  const first = session.trace.find((item) => item.kind === 'user' && (session.analyses.find((analysis) => analysis.responseId === item.id)?.engagement === 'engaged' || !isStuckResponse(item.content)))
  return {
    initialJudgment: first?.content || '',
    currentJudgment: session.cognitiveState.currentPosition || '',
    keyDiscovery: '',
    openQuestion: session.cognitiveState.uncertainties.at(-1) || '',
  }
}

export function recordSupport(session: ThinkingSession, questionId: string, kind: 'hint' | 'rephrase', content: string): ThinkingSession {
  if (session.supportRecords.some((record) => record.questionId === questionId && record.kind === kind)) return session
  return { ...session, supportRecords: [...session.supportRecords, { id: nowId('support'), questionId, kind, content, createdAt: Date.now() }] }
}

export function reviewVerification(session: ThinkingSession, outcome: string, revisedJudgment = ''): ThinkingSession {
  if (!session.verification || !outcome.trim()) throw new Error('请先写下这次实际观察到的结果。')
  return {
    ...session,
    verification: {
      ...session.verification,
      status: 'reviewed',
      reviews: [...session.verification.reviews, {
        id: nowId('review'), createdAt: Date.now(), outcome: outcome.trim(),
        ...(revisedJudgment.trim() ? { revisedJudgment: revisedJudgment.trim() } : {}),
      }],
    },
  }
}

export function returnPrompt(session: ThinkingSession) {
  return session.verification?.status === 'planned'
    ? `上次你想尝试“${clip(session.verification.action, 50).replace(/[。！？!?]+$/, '')}”。现在有一次经历值得回看吗？`
    : '之前的思考还在，可以从上次停下的地方继续。'
}
