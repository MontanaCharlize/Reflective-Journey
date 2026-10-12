export const IDLE_CHECKIN_DELAY = 90_000
const ENABLED_KEY = 'reflective-journey/v0.5/idle-checkin-enabled'
const OFFERED_KEY = 'reflective-journey/v0.5/idle-checkin-offered'

export interface IdleCheckInState { questionId: string; lastActivityAt: number; offered: boolean }
export function createIdleCheckIn(questionId: string, now: number): IdleCheckInState {
  return { questionId, lastActivityAt: now, offered: false }
}
export function recordEditing(state: IdleCheckInState, now: number): IdleCheckInState {
  return { ...state, lastActivityAt: now }
}
export function shouldOfferCheckIn(state: IdleCheckInState, now: number, conditions: { enabled: boolean; visible: boolean; composing: boolean }) {
  return conditions.enabled && conditions.visible && !conditions.composing && !state.offered && now - state.lastActivityAt >= IDLE_CHECKIN_DELAY
}
export function markCheckInOffered(state: IdleCheckInState): IdleCheckInState {
  return { ...state, offered: true }
}
export function loadCheckInEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) !== 'false' } catch { return true }
}
export function saveCheckInEnabled(enabled: boolean) {
  try { localStorage.setItem(ENABLED_KEY, String(enabled)) }
  catch { throw new Error('停顿询问的设置暂未保存，本次选择仍然有效。') }
}

function recentOffers(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFERED_KEY) || '[]')
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(-200) : []
  } catch { return [] }
}
export function hasOfferedCheckIn(questionId: string) {
  return recentOffers().includes(questionId)
}
export function rememberCheckIn(questionId: string) {
  const ids = [...new Set([...recentOffers(), questionId])].slice(-200)
  try { localStorage.setItem(OFFERED_KEY, JSON.stringify(ids)) }
  catch { throw new Error('停顿询问记录暂未保存，本次停留仍不会重复询问。') }
}
