import { analyzeResponse, emptyState as engineEmptyState } from './engine'
import type { CognitiveState, SessionDraft, ThinkingSession, TraceItem } from './types'
import { getWorkspaceOwner, workspaceKey } from './workspace'

const V04_KEY = 'reflective-journey/v0.4/sessions'
const V03_KEY = 'reflective-journey/v0.3/sessions'
const V02_KEY = 'reflective-journey/v0.2/sessions'

interface LegacySessionV2 {
  id: string
  question: string
  cognitiveType: ThinkingSession['cognitiveType']
  createdAt: number
  updatedAt: number
  status: ThinkingSession['status']
  trace: TraceItem[]
  interventionIndex: number
  summary?: ThinkingSession['summary']
}

interface LegacySessionV3 extends Omit<ThinkingSession, 'schemaVersion' | 'aiEvents' | 'aiRuntime' | 'supportRecords'> {
  schemaVersion?: 3
}

interface LegacySessionV4 extends Omit<ThinkingSession, 'schemaVersion' | 'supportRecords'> {
  schemaVersion?: 4
}

function rebuildCompletion(session: ThinkingSession): ThinkingSession {
  let replay = { ...session, trace: [] as TraceItem[], cognitiveState: engineEmptyState() }
  for (const item of session.trace) {
    replay = { ...replay, trace: [...replay.trace, item] }
    if (item.kind === 'user') replay.cognitiveState = analyzeResponse(replay, item).stateAfter
  }
  return { ...session, cognitiveState: { ...session.cognitiveState, completedMoves: replay.cognitiveState.completedMoves } }
}

const emptyState = (): CognitiveState => ({
  currentPosition: '',
  focus: '',
  keyClaims: [],
  assumptions: [],
  uncertainties: [],
  evidenceSignals: [],
  alternatives: [],
  boundaries: [],
  goals: [],
  changedIdeas: [],
  completedMoves: [],
})

function migrateV2(session: LegacySessionV2): ThinkingSession {
  const userItems = session.trace.filter((item) => item.kind === 'user')
  const lastUser = userItems.at(-1)?.content ?? ''
  const base: ThinkingSession = {
    schemaVersion: 5,
    id: session.id,
    question: session.question,
    cognitiveType: session.cognitiveType,
    diagnosisReason: '这条记录从 V0.2 迁移而来；当时还没有保存结构化的认知分析、提问规划和真实模型调用记录。',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    status: session.status,
    trace: session.trace.map((item) => ({ ...item, source: item.kind === 'user' || item.kind === 'question' ? 'user' : 'local_engine' })),
    cognitiveState: {
      ...emptyState(),
      currentPosition: lastUser,
      focus: lastUser.slice(0, 46),
      keyClaims: userItems.map((item) => item.content.slice(0, 120)),
    },
    analyses: [],
    plannerRecords: [],
    aiEvents: [],
    aiRuntime: { mode: 'local' },
    interventionIndex: session.interventionIndex,
    supportRecords: [],
  }
  return rebuildCompletion(session.summary ? { ...base, summary: session.summary } : base)
}

function migrateV3(session: LegacySessionV3): ThinkingSession {
  const base: ThinkingSession = {
    ...session,
    schemaVersion: 5,
    trace: session.trace.map((item) => ({
      ...item,
      source: item.source ?? (item.kind === 'user' || item.kind === 'question' ? 'user' : 'local_engine'),
    })),
    aiEvents: [],
    aiRuntime: { mode: 'local' },
    supportRecords: [],
  }
  return rebuildCompletion(base)
}

function migrateV4(session: LegacySessionV4): ThinkingSession {
  return rebuildCompletion({ ...session, schemaVersion: 5, supportRecords: [] })
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function loadSessions(owner: string | null = getWorkspaceOwner()): ThinkingSession[] {
  const KEY = workspaceKey('sessions', owner)
  const current = read<ThinkingSession[]>(KEY)
  if (Array.isArray(current)) return [...current].sort((a, b) => b.updatedAt - a.updatedAt)
  if (owner) return []

  const v4 = read<LegacySessionV4[]>(V04_KEY)
  if (Array.isArray(v4)) {
    const migrated = v4.map(migrateV4)
    write(KEY, migrated)
    return migrated
  }

  const v3 = read<LegacySessionV3[]>(V03_KEY)
  if (Array.isArray(v3)) {
    const migrated = v3.map(migrateV3)
    write(KEY, migrated)
    return migrated
  }

  const v2 = read<LegacySessionV2[]>(V02_KEY)
  if (!Array.isArray(v2)) return []
  const migrated = v2.map(migrateV2)
  write(KEY, migrated)
  return migrated
}

export function getSession(id: string) {
  return loadSessions().find((item) => item.id === id)
}

export function saveSession(session: ThinkingSession, owner: string | null = getWorkspaceOwner()) {
  const all = loadSessions(owner)
  const next = { ...session, updatedAt: Date.now() }
  const index = all.findIndex((item) => item.id === next.id)
  if (index >= 0) all[index] = next
  else all.unshift(next)
  write(workspaceKey('sessions', owner), all)
  return next
}

export function deleteSession(id: string) {
  write(workspaceKey('sessions'), loadSessions().filter((item) => item.id !== id))
  clearDraft(id)
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { throw new Error('浏览器暂时无法保存记录。请保留当前页面，并尝试释放浏览器存储空间。') }
}

export function emptyDraft(): SessionDraft {
  return { response: '', currentJudgment: '', changed: '', keyTurningPoint: '', keyDiscovery: '', openQuestion: '', nextAction: '', expectedSignal: '', reviewOutcome: '', revisedJudgment: '', sideThought: '' }
}

export function loadDraft(id: string): SessionDraft {
  return { ...emptyDraft(), ...(read<Record<string, SessionDraft>>(workspaceKey('drafts'))?.[id] || {}) }
}

export function saveDraft(id: string, draft: SessionDraft) {
  const all = read<Record<string, SessionDraft>>(workspaceKey('drafts')) || {}
  write(workspaceKey('drafts'), { ...all, [id]: draft })
}

export function clearDraft(id: string) {
  const all = read<Record<string, SessionDraft>>(workspaceKey('drafts')) || {}
  delete all[id]
  write(workspaceKey('drafts'), all)
}

export function importGuestSessions(ids: string[]) {
  const owner = getWorkspaceOwner()
  if (!owner) throw new Error('请先登录，再选择带入的访客记录。')
  const own = loadSessions(owner)
  const existing = new Set(own.map((session) => session.id))
  const incoming = loadSessions(null).filter((session) => ids.includes(session.id) && !existing.has(session.id))
  const guestDrafts = read<Record<string, SessionDraft>>(workspaceKey('drafts', null)) || {}
  const drafts = read<Record<string, SessionDraft>>(workspaceKey('drafts', owner)) || {}
  for (const session of incoming) if (guestDrafts[session.id]) drafts[session.id] = guestDrafts[session.id]
  write(workspaceKey('drafts', owner), drafts)
  write(workspaceKey('sessions', owner), [...incoming, ...own])
  return incoming.length
}
