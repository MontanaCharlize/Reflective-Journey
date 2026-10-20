export type CognitiveType =
  | 'causal'
  | 'evidence'
  | 'decision'
  | 'problem'
  | 'concept'
  | 'perspective'
  | 'self'
  | 'exploratory'

export type CognitiveMove =
  | 'clarify_focus'
  | 'state_position'
  | 'specify_mechanism'
  | 'surface_assumption'
  | 'generate_alternative'
  | 'seek_counterexample'
  | 'request_source'
  | 'request_evidence'
  | 'test_boundary'
  | 'define_criteria'
  | 'expose_tradeoff'
  | 'isolate_blocker'
  | 'predict_next_step'
  | 'clarify_concept'
  | 'distinguish_fact_value'
  | 'specific_example'
  | 'identify_trigger'
  | 'find_exception'
  | 'formulate_test'
  | 'synthesize'

export type TraceKind =
  | 'question'
  | 'user'
  | 'guide'
  | 'evidence'
  | 'counterexample'
  | 'synthesis'

export type TraceSource = 'user' | 'local_engine' | 'ai'

export interface TraceItem {
  id: string
  kind: TraceKind
  title?: string
  content: string
  createdAt: number
  move?: CognitiveMove
  plannerRecordId?: string
  source?: TraceSource
  reflection?: string
}

export interface CognitiveState {
  /** 用户最近一次明确表达的判断/位置，不强行转成“正确答案”。 */
  currentPosition: string
  /** 当前对话中反复出现、最值得继续追踪的语句。 */
  focus: string
  /** 用户已经表达出的主要主张。 */
  keyClaims: string[]
  /** 系统识别到、值得后续检验的可能前提。这里只保存可审计的结构化摘要。 */
  assumptions: string[]
  /** 用户自己表达出的不确定、保留或模糊处。 */
  uncertainties: string[]
  /** 用户已经提到的数据、研究、来源、案例等证据线索。 */
  evidenceSignals: string[]
  /** 用户已经提出的其他解释/方案。 */
  alternatives: string[]
  /** 用户主动说出的条件、例外或边界。 */
  boundaries: string[]
  /** 决策类问题里用户已经说出的目标或底线。 */
  goals: string[]
  /** 过程中用户显式修正过的想法。 */
  changedIdeas: string[]
  /** 已经完成过的认知动作。 */
  completedMoves: CognitiveMove[]
}

export interface ResponseAnalysis {
  responseId: string
  createdAt: number
  excerpt: string
  observations: string[]
  detectedSignals: string[]
  stateAfter: CognitiveState
  source?: 'local' | 'ai'
  provider?: string
  model?: string
  engagement?: 'engaged' | 'stuck'
  completedMoveEvidence?: Array<{ move: CognitiveMove; excerpt: string }>
}

export interface PlannerRecord {
  id: string
  turn: number
  createdAt: number
  trigger: 'initial' | 'user_response'
  sourceResponseId?: string
  cognitiveType: CognitiveType
  chosenMove: CognitiveMove
  objective: string
  whyNow: string
  focusExcerpt: string
  observations: string[]
  questionId: string
  generationSource?: 'local' | 'ai'
  provider?: string
  model?: string
  contextAnchor?: string
  decisionSource?: 'local' | 'ai'
}

export interface ReflectionSummary {
  currentJudgment: string
  changed: string
  keyTurningPoint?: string
  initialJudgment?: string
  keyDiscovery?: string
  openQuestion?: string
}

export interface SupportRecord {
  id: string
  questionId: string
  kind: 'hint' | 'rephrase'
  content: string
  createdAt: number
}

export interface VerificationReview {
  id: string
  createdAt: number
  outcome: string
  revisedJudgment?: string
}

export interface VerificationPlan {
  action: string
  expectedSignal?: string
  status: 'planned' | 'reviewed'
  reviews: VerificationReview[]
}

export interface SessionDraft {
  response: string
  currentJudgment: string
  changed: string
  keyTurningPoint: string
  keyDiscovery: string
  openQuestion: string
  nextAction: string
  expectedSignal: string
  reviewOutcome: string
  revisedJudgment: string
  sideThought?: string
}

export type AiEventPhase =
  | 'dialogue_decision'
  | 'response_analysis'
  | 'question_generation'
  | 'fallback'
  | 'error'

export interface AiEvent {
  id: string
  createdAt: number
  turn: number
  phase: AiEventPhase
  provider: string
  model: string
  status: 'success' | 'fallback' | 'error'
  latencyMs?: number
  promptVersion: string
  sourceTraceIds: string[]
  move?: CognitiveMove
  /** 只保存可解释、可审计的结构化摘要，不保存模型隐藏思维链。 */
  summary: string
  structured?: Record<string, unknown>
  error?: string
}

export interface AiRuntimeSnapshot {
  mode: 'local' | 'hybrid'
  provider?: string
  model?: string
  lastCheckedAt?: number
  lastError?: string
  status?: 'ready' | 'failed' | 'local'
  lastErrorCode?: string
}

export interface ThinkingSession {
  schemaVersion: 5
  id: string
  question: string
  cognitiveType: CognitiveType
  diagnosisReason: string
  createdAt: number
  updatedAt: number
  status: 'active' | 'completed'
  trace: TraceItem[]
  cognitiveState: CognitiveState
  analyses: ResponseAnalysis[]
  plannerRecords: PlannerRecord[]
  aiEvents: AiEvent[]
  aiRuntime: AiRuntimeSnapshot
  interventionIndex: number
  summary?: ReflectionSummary
  supportRecords: SupportRecord[]
  pendingResponseId?: string
  verification?: VerificationPlan
  origin?: { sessionId: string; question: string }
  communitySource?: { cardId: string; question: string; authorName: string }
  publishedCards?: Array<{ cardId: string; createdAt: number }>
  dialogueMode?: 'ai' | 'local'
}
