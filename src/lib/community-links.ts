import type { ThinkingSession } from './types'

export function rememberPublishedCard(session: ThinkingSession, card: { id: string; createdAt: number }): ThinkingSession {
  const existing = Array.isArray(session.publishedCards) ? session.publishedCards : []
  return { ...session, publishedCards: [{ cardId: card.id, createdAt: card.createdAt }, ...existing.filter((item) => item.cardId !== card.id)].slice(0, 20) }
}
