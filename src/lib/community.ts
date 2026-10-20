import type { AccountUser, AiLimits, AncestorPage, AuthorProfile, CardDetails, CardPage, CommunityNotification, ContentReport, SharedField, ThoughtCard } from './community-types'
import { getWorkspaceOwner } from './workspace'

export class CommunityError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message) }
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15000)
  const owner = getWorkspaceOwner()
  try {
    const response = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(owner ? { 'X-RJ-User': owner } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: controller.signal })
    const result = await response.json()
    if (!response.ok || result.ok === false) throw new CommunityError(result.message || '服务暂时无法完成操作。', response.status, result.code || 'REQUEST_FAILED')
    return result as T
  } catch (failure) {
    if (failure instanceof CommunityError) throw failure
    const timedOut = failure instanceof Error && failure.name === 'AbortError'
    throw new CommunityError(timedOut ? '这次读取超时了，请稍后重新读取。已保存的内容仍然保留。' : '暂时无法连接社区服务，请检查网络后重试。', 0, timedOut ? 'REQUEST_TIMEOUT' : 'CONNECTION_FAILED')
  } finally { window.clearTimeout(timer) }
}
export const getAccount = () => request<{ user: AccountUser | null; limits: AiLimits | null; registrationRequiresInvite?: boolean; unreadNotifications?: number }>('/api/account/me')
export const registerAccount = (body: { username: string; displayName: string; password: string; inviteCode?: string }) => request<{ user: AccountUser; limits: AiLimits; unreadNotifications: number }>('/api/account/register', body)
export const loginAccount = (body: { username: string; password: string }) => request<{ user: AccountUser; limits: AiLimits; unreadNotifications: number }>('/api/account/login', body)
export const logoutAccount = () => request('/api/account/logout', {})
export const getFeed = (query = '', cursor = '', kind = 'all') => request<CardPage>(`/api/community/cards?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}&kind=${encodeURIComponent(kind)}`)
export const getCard = (id: string) => request<CardDetails>(`/api/community/cards/${encodeURIComponent(id)}`)
export const getMyCards = (query = '', cursor = '', status = 'all') => request<CardPage>(`/api/community/mine?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}&status=${encodeURIComponent(status)}`)
export const getBookmarks = (query = '', cursor = '') => request<CardPage>(`/api/community/bookmarks?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(cursor)}`)
export const saveBookmark = (id: string, saved: boolean) => request<{ bookmarked: boolean }>(`/api/community/cards/${encodeURIComponent(id)}/bookmark`, { saved })
export const getAuthor = (id: string) => request<{ profile: AuthorProfile }>(`/api/community/authors/${encodeURIComponent(id)}`)
export const getAuthorCards = (id: string, cursor = '') => request<CardPage>(`/api/community/authors/${encodeURIComponent(id)}/cards?cursor=${encodeURIComponent(cursor)}`)
export const getBranches = (id: string, cursor = '') => request<CardPage>(`/api/community/cards/${encodeURIComponent(id)}/branches?cursor=${encodeURIComponent(cursor)}`)
export const getAncestorPath = (id: string, cursor = '') => request<AncestorPage>(`/api/community/cards/${encodeURIComponent(id)}/path?cursor=${encodeURIComponent(cursor)}`)
export const updateProfile = (displayName: string, bio: string) => request<{ user: AccountUser; profile: AuthorProfile }>('/api/account/profile', { displayName, bio })
export const editCard = (id: string, body: { question: string; fields: Partial<Record<SharedField, string>>; revision: number }) => request<{ card: ThoughtCard }>(`/api/community/cards/${encodeURIComponent(id)}/edit`, body)
export const getNotifications = (cursor = '') => request<{ notifications: CommunityNotification[]; unread: number; nextCursor: string | null }>(`/api/community/notifications?cursor=${encodeURIComponent(cursor)}`)
export const readNotifications = (ids: string[] | 'all') => request<{ unread: number }>('/api/community/notifications/read', ids === 'all' ? { all: true } : { ids })
export const getReports = (cursor = '', status?: string) => request<{ reports: ContentReport[]; nextCursor: string | null }>(status ? `/api/community/moderation/reports?status=${encodeURIComponent(status)}&cursor=${encodeURIComponent(cursor)}` : `/api/community/my-feedback?cursor=${encodeURIComponent(cursor)}`)
export const resolveReport = (id: string, resolution: 'keep' | 'withdraw', note: string, expectedAt: number, expectedRevision: number) => request(`/api/community/moderation/reports/${encodeURIComponent(id)}/resolve`, { resolution, note, expectedAt, expectedRevision })
export const publishCard = (body: { question: string; fields: Partial<Record<SharedField, string>>; sourceCardId?: string; clientKey: string }) => request<{ card: ThoughtCard }>('/api/community/cards', body)
export const withdrawCard = (id: string) => request<{ card: ThoughtCard }>(`/api/community/cards/${encodeURIComponent(id)}/withdraw`, {})
export const reportCard = (id: string, reason: string) => request(`/api/community/cards/${encodeURIComponent(id)}/report`, { reason })
export const cardUrl = (id: string) => `${window.location.origin}/#/community/${encodeURIComponent(id)}`
