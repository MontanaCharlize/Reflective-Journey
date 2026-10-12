import { configuredProviders, resolveProvider, callJsonModel } from './providers.mjs'

const allowedMoves = new Set([
  'clarify_focus','state_position','specify_mechanism','surface_assumption','generate_alternative',
  'seek_counterexample','request_source','request_evidence','test_boundary','define_criteria',
  'expose_tradeoff','isolate_blocker','predict_next_step','clarify_concept','distinguish_fact_value',
  'specific_example','identify_trigger','find_exception','formulate_test','synthesize',
])

const promptVersion = 'v0.5.2'
const arr = (value, max = 6) => Array.isArray(value) ? value.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()).slice(0, max) : []
const str = (value, max = 240) => typeof value === 'string' ? value.trim().slice(0, max) : ''

const normalizeComparable = (text) => str(text, 1000).toLowerCase().replace(/[\s。！？!?，,；;：:“”‘’'"（）()、…—-]/g, '')
function textSimilarity(a, b) {
  const make = (text) => {
    const normalized = normalizeComparable(text)
    if (normalized.length < 2) return normalized ? [normalized] : []
    return Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2))
  }
  const left = make(a), right = make(b)
  if (!left.length || !right.length) return 0
  const counts = new Map()
  for (const item of right) counts.set(item, (counts.get(item) || 0) + 1)
  let overlap = 0
  for (const item of left) {
    const count = counts.get(item) || 0
    if (count > 0) { overlap += 1; counts.set(item, count - 1) }
  }
  return (2 * overlap) / (left.length + right.length)
}

function evidenceCanComplete(move, excerpt) {
  const text = normalizeComparable(excerpt)
  if (!text) return false
  const explicitUncertainPosition = /^(?:我)?(?:暂时无法判断|还不能判断|没有形成判断|还没有形成判断)$/.test(text)
  if (explicitUncertainPosition && (move === 'state_position' || move === 'synthesize')) return true
  if (/不知道|不清楚|不懂|没想法|想不出来|想不到|想不出|想不起|记不清|记不起|说不清|分不清|没想好|没想明白|无法回答|没有找到|没找到|找不到|(?:我|这一步|这里)(?:还|完全)?不会(?:怎么)?(?:回答|解释|判断|说明|处理|做|算|证明|分析|描述|举|找|写)/.test(text)) return false
  return true
}

function isNearDuplicateQuestion(question, session) {
  const normalized = normalizeComparable(question)
  if (normalized.length < 5) return false
  const previous = (Array.isArray(session?.trace) ? session.trace : [])
    .filter((item) => item && item.kind !== 'user' && item.kind !== 'question' && typeof item.content === 'string')
    .slice(-6)
  return previous.some((item) => {
    const old = normalizeComparable(item.content)
    if (!old) return false
    if (normalized === old) return true
    if (Math.min(normalized.length, old.length) >= 10 && (normalized.includes(old) || old.includes(normalized))) return true
    return Math.min(normalized.length, old.length) >= 8 && textSimilarity(normalized, old) >= 0.9
  })
}

function traceForPrompt(session, maxItems = 14) {
  const items = Array.isArray(session?.trace) ? session.trace.slice(-maxItems) : []
  return items.map((item) => ({
    id: item.id,
    role: item.kind === 'user' || item.kind === 'question' ? 'user' : 'guide',
    kind: item.kind,
    move: item.move || null,
    content: str((Array.isArray(session?.supportRecords) ? session.supportRecords : []).find((record) => record.questionId === item.id && record.kind === 'rephrase')?.content || item.content, 800),
    hintUsed: str((Array.isArray(session?.supportRecords) ? session.supportRecords : []).find((record) => record.questionId === item.id && record.kind === 'hint')?.content, 300),
  }))
}

function stateForPrompt(session) {
  const s = session?.cognitiveState || {}
  return {
    currentPosition: str(s.currentPosition),
    focus: str(s.focus),
    keyClaims: arr(s.keyClaims),
    assumptions: arr(s.assumptions),
    uncertainties: arr(s.uncertainties),
    evidenceSignals: arr(s.evidenceSignals),
    alternatives: arr(s.alternatives),
    boundaries: arr(s.boundaries),
    goals: arr(s.goals),
    changedIdeas: arr(s.changedIdeas),
    completedMoves: arr(s.completedMoves, 30).filter((x) => allowedMoves.has(x)),
  }
}

function analysisSystem() {
  return `你是“反思之旅”的认知状态分析器。你的职责不是回答用户的问题，也不是替用户下结论，而是把用户刚刚明确表达的内容整理成可审计的结构化状态。

硬约束：
1. 只依据用户实际说过的话，不猜测人格、心理疾病、智力、动机或未表达的立场。
2. assumptions 只能记录“这个判断可能依赖的前提”，必须用谨慎措辞，不把推断写成事实。
3. 不提供答案，不生成下一问。
4. 不输出隐藏思维链、逐步推理、内部草稿。只输出简短、可解释的观察结果。
5. 必须输出一个 JSON 对象，不能输出 Markdown。
6. completedMoves 只能从给定动作列表中选择。
7. 问题被提出不代表动作已完成。只有用户本轮明确给出内容才可标记完成，并在 completedMoveEvidence 中逐项引用用户原话。无法引用就不标记。
8. 用户说“不知道”、答非所问或只给应答词时，engagement 为 stuck；保留既有判断，不编造进展。
9. observations 只写具体、克制的回映，不使用“很棒”“更深入”“实质进步”等未经用户确认的评价。结论没有改变也完全有效。
10. 用户明确撤回前面的理由、例子或判断时，写入 changedIdeas 并标记 retraction / position_revision；不要把已撤回内容继续当作未受质疑的依据。
11. 用户明确表示不想继续当前方向时，不把它当作认知动作完成；detectedSignals 可标记 declines_direction。
12. currentPosition 代表用户对原问题的当前判断。回答机制、例子、证据、代价或触发点时不要用这些局部回答覆盖 currentPosition；只有用户本轮明确给出或修改整体判断时才更新，并同时给出 state_position 或 synthesize 的 completedMoveEvidence。

JSON 结构：
{
  "excerpt": "最值得继续追踪的用户原话/短摘要",
  "observations": ["最多4条、可展示给用户的观察"],
  "detectedSignals": ["简短信号标签"],
  "currentPosition": "用户当前明确表达的判断",
  "focus": "当前最值得追踪的焦点",
  "keyClaims": ["用户明确说出的主张"],
  "assumptions": ["可能依赖、后续值得检查的前提"],
  "uncertainties": ["用户明确表达的不确定性"],
  "evidenceSignals": ["用户提到的证据/来源/案例"],
  "alternatives": ["用户自己提出的替代解释/方案"],
  "boundaries": ["用户自己说出的条件、例外、边界"],
  "goals": ["用户明确表达的目标、标准或底线"],
  "changedIdeas": ["用户明确表达的观点变化"],
  "engagement": "engaged 或 stuck",
  "completedMoveEvidence": [{"move": "动作名", "excerpt": "来自用户本轮回答的连续原话"}]
}`
}

function questionSystem() {
  return `你是“反思之旅”的问题生成器。认知引擎已经决定“下一步该让用户完成什么认知动作”，你不能改变这个动作。你的任务只是根据用户的真实上下文，把这个动作改写成一个高度针对性的追问。

硬约束：
1. 只生成“一次一个问题”，不要列问题清单。
2. 不直接回答用户原问题，不把结论塞进问题里，不说教。
3. 尽量引用或改写用户刚才说过的具体内容，让用户明显感到问题是从自己的思考里长出来的。
4. 不重复用户已经明确完成的思考动作。
5. 中文自然、克制，通常 25~90 个汉字；必要时可有一句很短的铺垫，但只保留一个问号层级。
6. 不输出隐藏思维链。只输出问题和一个短的 contextAnchor，说明这句追问锚定了用户哪段已表达内容。
7. 必须输出 JSON，不能输出 Markdown。
8. 如果最新回答显示用户卡住，保持当前动作，缩小问题或回到具体经历；不要机械重复上一问，也不要推动用户虚构观点变化。
9. 新问题不能与最近已经问过的问题近似重复；必须增加一个新的、与 nextAction 一致的思考增量。
10. originQuestion 如有值只是用户主动岔开前的背景。始终以当前 originalQuestion 为主，不强迫用户回到原方向。
11. 如果 changedIdeas 中记录了“撤回/修正”，不要继续把对应旧理由、旧例子或旧判断当成仍然成立的前提来追问；应以用户保留下来的当前判断和最新表达为准。

JSON 结构：
{
  "question": "最终要问用户的一个问题",
  "contextAnchor": "来自用户上下文的短锚点，不超过40字"
}`
}

function normalizeAnalysis(data, session, latestText) {
  const previous = stateForPrompt(session)
  const merge = (oldArr, nextArr, max = 12) => [...new Set([...oldArr, ...arr(nextArr, max)])].slice(-max)
  const completedMoveEvidence = (Array.isArray(data?.completedMoveEvidence) ? data.completedMoveEvidence : [])
    .map((item) => ({ move: str(item?.move, 40), excerpt: str(item?.excerpt, 240) }))
    .filter((item) => allowedMoves.has(item.move) && item.excerpt.length >= 2 && latestText.includes(item.excerpt) && evidenceCanComplete(item.move, item.excerpt))
    .slice(0, 8)
  const engagement = data?.engagement === 'stuck' ? 'stuck' : 'engaged'
  const acceptedEvidence = engagement === 'stuck' ? [] : completedMoveEvidence
  const canUpdatePosition = acceptedEvidence.some((item) => item.move === 'state_position' || item.move === 'synthesize')
  return {
    engagement,
    completedMoveEvidence: acceptedEvidence,
    excerpt: str(data?.excerpt || data?.focus || previous.focus, 120),
    observations: arr(data?.observations, 4),
    detectedSignals: arr(data?.detectedSignals, 8),
    stateAfter: {
      currentPosition: canUpdatePosition ? str(data?.currentPosition || previous.currentPosition, 240) : previous.currentPosition,
      focus: str(data?.focus || data?.excerpt || previous.focus, 160),
      keyClaims: merge(previous.keyClaims, data?.keyClaims),
      assumptions: merge(previous.assumptions, data?.assumptions),
      uncertainties: merge(previous.uncertainties, data?.uncertainties),
      evidenceSignals: merge(previous.evidenceSignals, data?.evidenceSignals),
      alternatives: merge(previous.alternatives, data?.alternatives),
      boundaries: merge(previous.boundaries, data?.boundaries),
      goals: merge(previous.goals, data?.goals),
      changedIdeas: merge(previous.changedIdeas, data?.changedIdeas),
      completedMoves: [...new Set([...previous.completedMoves, ...acceptedEvidence.map((item) => item.move)])],
    },
  }
}

function normalizeQuestion(data, session) {
  const question = str(data?.question, 300)
  if (question.length < 4) throw new Error('模型没有生成有效追问')
  if ((question.match(/[？?]/g) || []).length > 1 || /\n\s*(?:[-*]|\d+[.、])/.test(question)) throw new Error('模型生成了多个问题，本轮将使用更聚焦的本地追问')
  if (isNearDuplicateQuestion(question, session)) throw new Error('模型追问与最近问题过于重复，本轮将使用本地追问')
  return {
    question,
    contextAnchor: str(data?.contextAnchor, 80),
  }
}

async function analyze(env, body, signal) {
  const provider = resolveProvider(env, body.provider)
  if (!provider) return { ok: false, code: 'NO_PROVIDER', message: '未配置可用 AI Provider。' }
  const session = body.session
  const responseId = body.responseId
  const latest = (session?.trace || []).find((item) => item.id === responseId) || [...(session?.trace || [])].reverse().find((item) => item.kind === 'user')
  if (!latest) return { ok: false, code: 'BAD_REQUEST', message: '找不到需要分析的用户回答。' }

  const user = JSON.stringify({
    originalQuestion: str(session.question, 600),
    originQuestion: str(session.origin?.question, 600),
    cognitiveType: session.cognitiveType,
    diagnosisReason: str(session.diagnosisReason, 300),
    allowedMoves: [...allowedMoves],
    previousState: stateForPrompt(session),
    recentTrace: traceForPrompt(session),
    latestUserResponse: { id: latest.id, content: str(latest.content, 1800) },
  })

  const result = await callJsonModel(provider, {
    system: analysisSystem(),
    user: `请分析以下上下文并输出 JSON：\n${user}`,
    maxTokens: 1500,
    temperature: 0.1,
    signal,
  })
  return {
    ok: true,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    promptVersion,
    analysis: normalizeAnalysis(result.data, session, latest.content),
  }
}

async function question(env, body, signal) {
  const provider = resolveProvider(env, body.provider)
  if (!provider) return { ok: false, code: 'NO_PROVIDER', message: '未配置可用 AI Provider。' }
  const session = body.session
  const move = body.move
  if (!allowedMoves.has(move)) return { ok: false, code: 'BAD_MOVE', message: '认知动作无效。' }

  const user = JSON.stringify({
    originalQuestion: str(session.question, 600),
    originQuestion: str(session.origin?.question, 600),
    cognitiveType: session.cognitiveType,
    cognitiveState: stateForPrompt(session),
    recentTrace: traceForPrompt(session),
    nextAction: move,
    objective: str(body.objective, 300),
    whyNow: str(body.whyNow, 500),
    needsSupport: session.analyses?.at(-1)?.engagement === 'stuck',
  })

  const result = await callJsonModel(provider, {
    system: questionSystem(),
    user: `认知引擎已经锁定 nextAction=${move}。请只负责生成针对性追问，并输出 JSON：\n${user}`,
    maxTokens: 700,
    temperature: 0.35,
    signal,
  })
  return {
    ok: true,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    promptVersion,
    result: normalizeQuestion(result.data, session),
  }
}

async function arena(env, body, signal) {
  const providers = configuredProviders(env)
  if (providers.length === 0) return { ok: false, code: 'NO_PROVIDER', message: '没有配置任何模型。' }
  const session = body.session
  const move = body.move
  if (!allowedMoves.has(move)) return { ok: false, code: 'BAD_MOVE', message: '认知动作无效。' }

  const settled = await Promise.allSettled(providers.map(async (provider) => {
    const user = JSON.stringify({
      originalQuestion: str(session.question, 600),
      cognitiveType: session.cognitiveType,
      cognitiveState: stateForPrompt(session),
      recentTrace: traceForPrompt(session),
      nextAction: move,
      objective: str(body.objective, 300),
      whyNow: str(body.whyNow, 500),
    })
    const result = await callJsonModel(provider, {
      system: questionSystem(),
      user: `认知引擎已经锁定 nextAction=${move}。请只负责生成针对性追问，并输出 JSON：\n${user}`,
      maxTokens: 700,
      temperature: 0.35,
      signal,
    })
    return { provider: result.provider, model: result.model, latencyMs: result.latencyMs, ...normalizeQuestion(result.data, session) }
  }))

  return {
    ok: true,
    candidates: settled.map((item, index) => item.status === 'fulfilled'
      ? { ok: true, ...item.value }
      : { ok: false, provider: providers[index]?.id || 'unknown', error: item.reason?.message || String(item.reason) }),
  }
}

export function createAiHandler(env) {
  return async function handle(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/ai/providers') {
      const providers = configuredProviders(env)
      const active = resolveProvider(env)
      return sendJson(res, 200, {
        ok: true,
        activeProvider: active?.id || null,
        providers: providers.map((p) => ({ id: p.id, label: p.label, model: p.model, configured: true })),
        localFallback: true,
      })
    }

    if (req.method !== 'POST' || !['/api/ai/analyze', '/api/ai/question', '/api/ai/arena'].includes(pathname)) return false
    const controller = new AbortController()
    const abort = () => { if (!res.writableEnded) controller.abort() }
    res.once('close', abort)
    try {
      const body = await readBody(req)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { ok: false, code: 'BAD_REQUEST', message: '请求需要一个 JSON 对象。' })
      if (pathname === '/api/ai/analyze') return sendJson(res, 200, await analyze(env, body, controller.signal))
      if (pathname === '/api/ai/question') return sendJson(res, 200, await question(env, body, controller.signal))
      if (pathname === '/api/ai/arena') return sendJson(res, 200, await arena(env, body, controller.signal))
    } catch (error) {
      if (controller.signal.aborted || res.destroyed) return true
      const badRequest = error?.message === '请求 JSON 无效'
      return sendJson(res, badRequest ? 400 : 200, {
        ok: false,
        code: badRequest ? 'BAD_REQUEST' : 'AI_ERROR',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      res.off('close', abort)
    }
    return false
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 2_000_000) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
      catch { reject(new Error('请求 JSON 无效')) }
    })
    req.on('error', reject)
  })
}

export function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
  return true
}
