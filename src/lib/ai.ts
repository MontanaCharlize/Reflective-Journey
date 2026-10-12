import {
  analyzeResponse,
  appendIntervention,
  appendNextInterventionLocal,
  appendUserTrace,
  applyAnalysis,
  createSessionBase,
  generateQuestionLocal,
  moveObjective,
  nowId,
  plannerWhy,
  selectNextMove,
} from './engine'
import type { AiEvent, CognitiveState, ResponseAnalysis, ThinkingSession, TraceItem } from './types'

const PROVIDER_KEY = 'reflective-journey/v0.4/preferred-provider'
const REQUEST_TIMEOUT = 25_000

export interface AiProviderInfo {
  id: string
  label: string
  model: string
  configured: boolean
}

export interface AiStatus {
  ok: boolean
  activeProvider: string | null
  providers: AiProviderInfo[]
  localFallback: boolean
}

const unique = <T,>(items: T[]) => [...new Set(items)]

function preferredProvider() {
  try { return localStorage.getItem(PROVIDER_KEY) || undefined } catch { return undefined }
}

export function setPreferredProvider(provider: string | null) {
  try {
    if (provider) localStorage.setItem(PROVIDER_KEY, provider)
    else localStorage.removeItem(PROVIDER_KEY)
  } catch { /* ignore */ }
}

export function getPreferredProvider() {
  return preferredProvider() ?? null
}

export interface TurnOptions {
  signal?: AbortSignal
  onProgress?: (session: ThinkingSession) => void
  origin?: ThinkingSession['origin']
}

async function api<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  if (signal?.aborted) throw new DOMException('已暂停这一轮', 'AbortError')
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const response = await fetch(path, {
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}`)
    return await response.json() as T
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}

export async function getAiStatus(): Promise<AiStatus> {
  try {
    return await api<AiStatus>('/api/ai/providers')
  } catch {
    return { ok: false, activeProvider: null, providers: [], localFallback: true }
  }
}

function mergeState(local: CognitiveState, ai: Partial<CognitiveState>, allowPositionOverride = false): CognitiveState {
  const mergedList = (a: string[], b?: string[]) => unique([...a, ...(Array.isArray(b) ? b : [])]).slice(-14)
  return {
    currentPosition: allowPositionOverride ? (ai.currentPosition?.trim() || local.currentPosition) : local.currentPosition,
    focus: ai.focus?.trim() || local.focus,
    keyClaims: mergedList(local.keyClaims, ai.keyClaims),
    assumptions: mergedList(local.assumptions, ai.assumptions),
    uncertainties: mergedList(local.uncertainties, ai.uncertainties),
    evidenceSignals: mergedList(local.evidenceSignals, ai.evidenceSignals),
    alternatives: mergedList(local.alternatives, ai.alternatives),
    boundaries: mergedList(local.boundaries, ai.boundaries),
    goals: mergedList(local.goals, ai.goals),
    changedIdeas: mergedList(local.changedIdeas, ai.changedIdeas),
    completedMoves: unique([...local.completedMoves, ...(Array.isArray(ai.completedMoves) ? ai.completedMoves : [])]),
  }
}

function sourceIds(session: ThinkingSession) {
  return session.trace.slice(-12).map((item) => item.id)
}

function addEvent(session: ThinkingSession, event: Omit<AiEvent, 'id' | 'createdAt' | 'turn'>): ThinkingSession {
  return {
    ...session,
    aiEvents: [
      ...session.aiEvents,
      {
        id: nowId('aie'),
        createdAt: Date.now(),
        turn: session.trace.filter((item) => item.kind === 'user').length,
        ...event,
      },
    ],
  }
}

function markRuntime(session: ThinkingSession, provider?: string, model?: string, lastError?: string): ThinkingSession {
  return {
    ...session,
    aiRuntime: {
      mode: provider ? 'hybrid' : 'local',
      provider: provider || session.aiRuntime.provider,
      model: model || session.aiRuntime.model,
      lastCheckedAt: Date.now(),
      lastError,
    },
  }
}

interface AnalyzeApiResponse {
  ok: boolean
  provider?: string
  model?: string
  latencyMs?: number
  promptVersion?: string
  message?: string
  analysis?: {
    excerpt?: string
    observations?: string[]
    detectedSignals?: string[]
    stateAfter?: Partial<CognitiveState>
    engagement?: 'engaged' | 'stuck'
    completedMoveEvidence?: ResponseAnalysis['completedMoveEvidence']
  }
}

interface QuestionApiResponse {
  ok: boolean
  provider?: string
  model?: string
  latencyMs?: number
  promptVersion?: string
  message?: string
  result?: { question?: string; contextAnchor?: string }
}

async function generateAiQuestion(session: ThinkingSession, trigger: 'initial' | 'user_response', options: TurnOptions = {}) {
  const move = selectNextMove(session)
  const provider = preferredProvider()
  const whyNow = plannerWhy(move, session)
  try {
    const response = await api<QuestionApiResponse>('/api/ai/question', {
      provider,
      session,
      move,
      objective: moveObjective[move],
      whyNow,
    }, options.signal)
    if (!response.ok || !response.result?.question) throw new Error(response.message || '模型没有生成有效问题')

    let next = appendIntervention(session, {
      move,
      content: response.result.question,
      trigger,
      source: 'ai',
      provider: response.provider,
      model: response.model,
      contextAnchor: response.result.contextAnchor,
    })
    next = markRuntime(next, response.provider, response.model)
    next = addEvent(next, {
      phase: 'question_generation',
      provider: response.provider || 'unknown',
      model: response.model || 'unknown',
      status: 'success',
      latencyMs: response.latencyMs,
      promptVersion: response.promptVersion || 'v0.5',
      sourceTraceIds: sourceIds(session),
      move,
      summary: `认知引擎锁定“${move}”，模型只负责把该动作改写成针对当前上下文的一问。`,
      structured: {
        contextAnchor: response.result.contextAnchor || '',
        question: response.result.question,
      },
    })
    return next
  } catch (error) {
    if (options.signal?.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    let next = appendNextInterventionLocal(session, trigger)
    next = markRuntime(next, undefined, undefined, message)
    next = addEvent(next, {
      phase: 'fallback',
      provider: provider || 'unconfigured',
      model: 'local-question-generator',
      status: 'fallback',
      promptVersion: 'local-v0.5',
      sourceTraceIds: sourceIds(session),
      move,
      summary: '真实模型不可用，本轮已自动退回本地认知引擎的问题模板，思考流程不中断。',
      error: message,
      structured: { fallbackQuestion: generateQuestionLocal(move, session) },
    })
    return next
  }
}

export async function createSessionSmart(question: string, options: TurnOptions = {}): Promise<ThinkingSession> {
  const base = { ...createSessionBase(question), ...(options.origin ? { origin: options.origin } : {}) }
  options.onProgress?.(base)
  return generateAiQuestion(base, 'initial', options)
}

export async function generateFirstQuestionSmart(session: ThinkingSession, options: TurnOptions = {}) {
  return generateAiQuestion(session, 'initial', options)
}

export function prepareUserResponse(session: ThinkingSession, content: string): ThinkingSession {
  if (session.pendingResponseId) throw new Error('上一条回答已保存，请先继续处理这一轮。')
  if (!content.trim()) throw new Error('先留下一句自己的想法。')
  const appended = appendUserTrace(session, content)
  return { ...appended.session, pendingResponseId: appended.userItem.id }
}

export async function completePendingResponseSmart(session: ThinkingSession, options: TurnOptions = {}): Promise<ThinkingSession> {
  const responseItem = session.trace.find((item) => item.id === session.pendingResponseId && item.kind === 'user')
  if (!responseItem) throw new Error('找不到这次待处理的回答。')
  const localAnalysis = analyzeResponse(session, responseItem)
  const provider = preferredProvider()
  let analyzed: ThinkingSession
  const existing = session.analyses.find((analysis) => analysis.responseId === responseItem.id)
  if (existing) {
    analyzed = session
  } else if (localAnalysis.engagement === 'stuck' || localAnalysis.detectedSignals.includes('declines_direction')) {
    // 卡住、跑题或明确拒绝当前方向时，本地规则足够确定；不让模型把这些导航信号误包装成认知进展。
    analyzed = applyAnalysis(session, localAnalysis)
  } else try {
    const response = await api<AnalyzeApiResponse>('/api/ai/analyze', {
      provider,
      session,
      responseId: responseItem.id,
    }, options.signal)
    if (!response.ok || !response.analysis?.stateAfter) throw new Error(response.message || 'AI 认知分析无效')

    const analysis: ResponseAnalysis = {
      responseId: responseItem.id,
      createdAt: Date.now(),
      excerpt: response.analysis.excerpt?.trim() || localAnalysis.excerpt,
      observations: unique([...(response.analysis.observations || []), ...localAnalysis.observations]).slice(0, 4),
      detectedSignals: unique([...(response.analysis.detectedSignals || []), ...localAnalysis.detectedSignals]),
      stateAfter: mergeState(
        localAnalysis.stateAfter,
        response.analysis.stateAfter,
        (response.analysis.completedMoveEvidence || []).some((item) => item.move === 'state_position' || item.move === 'synthesize'),
      ),
      source: 'ai',
      provider: response.provider,
      model: response.model,
      engagement: response.analysis.engagement || 'engaged',
      completedMoveEvidence: [...(localAnalysis.completedMoveEvidence || []), ...(response.analysis.completedMoveEvidence || [])],
    }
    if (analysis.engagement === 'stuck') analysis.stateAfter.completedMoves = [...session.cognitiveState.completedMoves]
    analyzed = applyAnalysis(session, analysis)
    analyzed = markRuntime(analyzed, response.provider, response.model)
    analyzed = addEvent(analyzed, {
      phase: 'response_analysis',
      provider: response.provider || 'unknown',
      model: response.model || 'unknown',
      status: 'success',
      latencyMs: response.latencyMs,
      promptVersion: response.promptVersion || 'v0.5',
      sourceTraceIds: [responseItem.id],
      summary: analysis.observations[0] || '模型完成了结构化认知状态更新。',
      structured: {
        excerpt: analysis.excerpt,
        detectedSignals: analysis.detectedSignals,
        stateAfter: analysis.stateAfter,
      },
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    const message = error instanceof Error ? error.message : String(error)
    analyzed = applyAnalysis(session, localAnalysis)
    analyzed = markRuntime(analyzed, undefined, undefined, message)
    analyzed = addEvent(analyzed, {
      phase: 'fallback',
      provider: provider || 'unconfigured',
      model: 'local-cognitive-analyzer',
      status: 'fallback',
      promptVersion: 'local-v0.5',
      sourceTraceIds: [responseItem.id],
      summary: '真实模型认知分析不可用，本轮使用本地结构化分析继续更新认知状态。',
      error: message,
      structured: {
        excerpt: localAnalysis.excerpt,
        detectedSignals: localAnalysis.detectedSignals,
        stateAfter: localAnalysis.stateAfter,
      },
    })
  }

  options.onProgress?.(analyzed)
  const next = await generateAiQuestion(analyzed, 'user_response', options)
  const { pendingResponseId: _pending, ...completed } = next
  return completed
}

export async function appendUserResponseSmart(session: ThinkingSession, content: string, options: TurnOptions = {}): Promise<ThinkingSession> {
  const pending = prepareUserResponse(session, content)
  options.onProgress?.(pending)
  return completePendingResponseSmart(pending, options)
}

export async function compareProviders(session: ThinkingSession) {
  const move = selectNextMove(session)
  const response = await api<{
    ok: boolean
    message?: string
    candidates?: Array<{ ok: boolean; provider: string; model?: string; latencyMs?: number; question?: string; contextAnchor?: string; error?: string }>
  }>('/api/ai/arena', {
    session,
    move,
    objective: moveObjective[move],
    whyNow: plannerWhy(move, session),
  })
  if (!response.ok) throw new Error(response.message || '模型竞技场不可用')
  return { move, candidates: response.candidates || [] }
}
