import { analyzeResponse, appendIntervention, appendNextInterventionLocal, appendUserTrace, applyAnalysis, createSessionBase, moveObjective, nowId, plannerWhy, selectNextMove } from './engine'
import type { AiEvent, CognitiveMove, CognitiveState, ResponseAnalysis, ThinkingSession } from './types'
import { getWorkspaceOwner, workspaceKey } from './workspace'

const REQUEST_TIMEOUT = 60000
export interface AiProviderInfo { id: string; label: string; model: string; configured: boolean }
export interface AiStatus { ok: boolean; activeProvider: string | null; providers: AiProviderInfo[]; localFallback: boolean; planning?: string; access?: { canUseAi: boolean; loginRequired: boolean; localGuest: boolean } }
export interface TurnOptions { signal?: AbortSignal; onProgress?: (session: ThinkingSession) => void; origin?: ThinkingSession['origin']; communitySource?: ThinkingSession['communitySource']; dialogueMode?: 'ai' | 'local' }
export class AiServiceError extends Error {
  constructor(message: string, public code = 'AI_ERROR', public status = 0) { super(message); this.name = 'AiServiceError' }
}
function preferredProvider() { try { return localStorage.getItem(workspaceKey('preferred-provider')) || undefined } catch { return undefined } }
export function getPreferredProvider() { return preferredProvider() ?? null }
export function setPreferredProvider(provider: string | null) { try { if (provider) localStorage.setItem(workspaceKey('preferred-provider'), provider); else localStorage.removeItem(workspaceKey('preferred-provider')) } catch { /* 偏好写入失败不影响当前思考。 */ } }
async function api<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException('已暂停这一轮', 'AbortError')
  const controller = new AbortController(), abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetch(path, { method: payload ? 'POST' : 'GET', headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(getWorkspaceOwner() ? { 'X-RJ-User': getWorkspaceOwner()! } : {}) }, body: payload ? JSON.stringify(payload) : undefined, signal: controller.signal })
    const result = await response.json()
    if (signal?.aborted) throw new DOMException('已暂停这一轮', 'AbortError')
    if (!response.ok || result.ok === false) throw new AiServiceError(result.message || 'AI 暂时无法完成这一轮。', result.code || 'AI_ERROR', response.status)
    return result as T
  } catch (error) {
    if (signal?.aborted) throw new DOMException('已暂停这一轮', 'AbortError')
    if (error instanceof AiServiceError) throw error
    if (controller.signal.aborted) throw new AiServiceError('AI 这次回应超时，你的原话已保存，可以重试。', 'AI_TIMEOUT')
    throw new AiServiceError('暂时无法连接 AI 服务。你的原话已保存，请检查连接后重试。', 'AI_CONNECTION_FAILED')
  } finally { window.clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
export async function getAiStatus(): Promise<AiStatus> {
  try { return await api<AiStatus>('/api/ai/providers') }
  catch { return { ok: false, activeProvider: null, providers: [], localFallback: false } }
}
export const checkAiConnection = () => api<{ ok: boolean; provider: string; model: string; latencyMs: number }>('/api/ai/check', { provider: preferredProvider() })
function addEvent(session: ThinkingSession, event: Omit<AiEvent, 'id' | 'createdAt' | 'turn'>): ThinkingSession {
  return { ...session, aiEvents: [...session.aiEvents, { id: nowId('aie'), createdAt: Date.now(), turn: session.trace.filter((item) => item.kind === 'user').length, ...event }] }
}
interface TurnResult {
  ok: boolean; provider: string; model: string; latencyMs: number; promptVersion: string; attempts: number
  analysis: { excerpt: string; observations: string[]; detectedSignals: string[]; stateAfter: CognitiveState; engagement: 'engaged' | 'stuck'; completedMoveEvidence: ResponseAnalysis['completedMoveEvidence'] } | null
  decision: { move: CognitiveMove; title: string; objective: string; whyNow: string; contextAnchor: string; reflection: string; question: string }
  grounding: Record<string, unknown>; usage?: Record<string, number>
}
async function localTurn(session: ThinkingSession, options: TurnOptions): Promise<ThinkingSession> {
  let next: ThinkingSession = { ...session, dialogueMode: 'local' }
  const response = session.trace.find((item) => item.id === session.pendingResponseId && item.kind === 'user')
  if (response && !session.analyses.some((item) => item.responseId === response.id)) next = applyAnalysis(next, analyzeResponse(next, response))
  options.onProgress?.(next)
  if (options.signal?.aborted) throw new DOMException('已暂停这一轮', 'AbortError')
  next = appendNextInterventionLocal(next, response ? 'user_response' : 'initial')
  next = { ...next, aiRuntime: { mode: 'local', status: 'local', lastCheckedAt: Date.now() } }
  next = addEvent(next, { phase: 'fallback', provider: 'local', model: 'local-outline', status: 'fallback', promptVersion: 'local-v0.8', sourceTraceIds: response ? [response.id] : [], move: next.trace.at(-1)?.move, summary: '用户主动选择本地提纲；这一轮没有调用模型，也没有声称 AI 作出了判断。' })
  const { pendingResponseId: _pending, ...completed } = next
  return completed
}
async function aiTurn(session: ThinkingSession, options: TurnOptions): Promise<ThinkingSession> {
  if (options.signal?.aborted) throw new DOMException('已暂停这一轮', 'AbortError')
  if ((options.dialogueMode || session.dialogueMode) === 'local') return localTurn(session, options)
  const latest = [...session.trace].reverse().find((item) => item.kind === 'user')
  try {
    const result = await api<TurnResult>('/api/ai/turn', { provider: preferredProvider(), session }, options.signal)
    if (!result.decision?.question || !result.decision?.move || (latest && !result.analysis)) throw new AiServiceError('AI 回应缺少必要的理解或决策信息，请重试。', 'AI_INVALID_TURN')
    let next: ThinkingSession = { ...session, dialogueMode: 'ai' }
    if (latest && result.analysis) {
      const analysis: ResponseAnalysis = { ...result.analysis, responseId: latest.id, createdAt: Date.now(), source: 'ai', provider: result.provider, model: result.model }
      next = { ...next, analyses: next.analyses.filter((item) => item.responseId !== latest.id) }
      next = applyAnalysis(next, analysis)
    }
    next = appendIntervention(next, { move: result.decision.move, content: result.decision.question, title: result.decision.title, objective: result.decision.objective, whyNow: result.decision.whyNow, reflection: result.decision.reflection, contextAnchor: result.decision.contextAnchor, source: 'ai', decisionSource: 'ai', trigger: latest ? 'user_response' : 'initial', provider: result.provider, model: result.model })
    next = { ...next, aiRuntime: { mode: 'hybrid', status: 'ready', provider: result.provider, model: result.model, lastCheckedAt: Date.now() } }
    next = addEvent(next, { phase: 'dialogue_decision', provider: result.provider, model: result.model, status: 'success', latencyMs: result.latencyMs, promptVersion: result.promptVersion, sourceTraceIds: session.trace.slice(-18).map((item) => item.id), move: result.decision.move, summary: result.decision.whyNow, structured: { questionId: next.trace.at(-1)?.id, decision: result.decision, grounding: result.grounding, attempts: result.attempts, usage: result.usage } })
    const { pendingResponseId: _pending, ...completed } = next
    return completed
  } catch (error) {
    if (options.signal?.aborted) throw error
    const code = error instanceof AiServiceError ? error.code : 'AI_ERROR'
    const message = error instanceof Error ? error.message : 'AI 暂时无法参与这一轮。'
    const failed = addEvent({ ...session, dialogueMode: 'ai', aiRuntime: { ...session.aiRuntime, status: 'failed', lastError: message, lastErrorCode: code, lastCheckedAt: Date.now() } }, { phase: 'error', provider: preferredProvider() || session.aiRuntime.provider || 'server-default', model: session.aiRuntime.model || 'unconfirmed', status: 'error', promptVersion: 'dialogue-v0.8', sourceTraceIds: latest ? [latest.id] : [], summary: 'AI 未能完成本轮，已保留原话与待处理状态；没有追加本地模板。', error: message })
    options.onProgress?.(failed)
    throw error
  }
}
export async function createSessionSmart(question: string, options: TurnOptions = {}): Promise<ThinkingSession> {
  const base = { ...createSessionBase(question), dialogueMode: options.dialogueMode || 'ai' as const, ...(options.origin ? { origin: options.origin } : {}), ...(options.communitySource ? { communitySource: options.communitySource } : {}) }
  options.onProgress?.(base)
  return aiTurn(base, options)
}
export const generateFirstQuestionSmart = (session: ThinkingSession, options: TurnOptions = {}) => aiTurn(session, options)
export function prepareUserResponse(session: ThinkingSession, content: string): ThinkingSession {
  if (session.pendingResponseId) throw new Error('上一条回答已保存，请先继续处理这一轮。')
  if (!content.trim()) throw new Error('先留下一句自己的想法。')
  const result = appendUserTrace(session, content)
  return { ...result.session, pendingResponseId: result.userItem.id }
}
export async function completePendingResponseSmart(session: ThinkingSession, options: TurnOptions = {}) {
  if (!session.trace.some((item) => item.kind === 'user' && item.id === session.pendingResponseId)) throw new Error('找不到这次待处理的回答。')
  return aiTurn(session, options)
}
export async function appendUserResponseSmart(session: ThinkingSession, content: string, options: TurnOptions = {}) {
  const pending = prepareUserResponse(session, content)
  options.onProgress?.(pending)
  return completePendingResponseSmart(pending, options)
}
export async function compareProviders(session: ThinkingSession) {
  const move = selectNextMove(session)
  const result = await api<{ ok: boolean; message?: string; candidates?: Array<{ ok: boolean; provider: string; model?: string; latencyMs?: number; question?: string; contextAnchor?: string; error?: string }> }>('/api/ai/arena', { session, move, objective: moveObjective[move], whyNow: plannerWhy(move, session) })
  return { move, candidates: result.candidates || [] }
}
