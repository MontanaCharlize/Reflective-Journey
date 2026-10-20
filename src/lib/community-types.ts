export interface AccountUser { id: string; username: string; displayName: string; canModerate?: boolean }
export interface AiLimits { dailyLimit: number; used: number; remaining: number; resetsAt: number }
export const sharedFieldLabels = {
  initialJudgment: '开始时，我这样想', currentJudgment: '现在的判断', keyDiscovery: '我发现了什么',
  openQuestion: '还没有想清楚的地方', changed: '这次发生的变化', nextAction: '准备验证的小尝试', expectedSignal: '想观察的信号',
} as const
export type SharedField = keyof typeof sharedFieldLabels
export interface ThoughtCard {
  id: string
  question: string
  fields: Partial<Record<SharedField, string>>
  author: { id: string; displayName: string }
  sourceCardId: string | null
  status: 'public' | 'withdrawn'
  createdAt: number
  withdrawnAt: number | null
  revision: number
  updatedAt: number
  bookmarked: boolean
  branchCount: number
}
export interface CardSource { id: string; status: 'public' | 'unavailable'; question?: string; author?: ThoughtCard['author'] }
export interface CardDetails {
  card: ThoughtCard
  source: CardSource | null
  ancestors: CardSource[]
  branches: ThoughtCard[]
  nextBranchCursor: string | null
}
export interface CardPage { cards: ThoughtCard[]; nextCursor: string | null }
export interface AncestorPage { ancestors: CardSource[]; nextCursor: string | null; stopped: 'unavailable' | 'cycle' | 'limit' | null }
export interface AuthorProfile { id: string; displayName: string; bio: string; shares: number; branches: number }
export interface CommunityNotification { id: string; cardId: string; sourceCardId: string; question: string; sourceQuestion: string; actor: ThoughtCard['author']; createdAt: number; readAt: number | null }
export interface ContentReport { id: string; cardId: string; cardRevision: number; reason: string; createdAt: number; question: string | null; cardStatus: 'public' | 'withdrawn'; author?: string; resolution: 'keep' | 'withdraw' | null; note: string; reviewedAt: number | null }
