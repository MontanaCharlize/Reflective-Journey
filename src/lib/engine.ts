import type {
  CognitiveMove,
  CognitiveState,
  CognitiveType,
  PlannerRecord,
  ResponseAnalysis,
  ThinkingSession,
  TraceItem,
} from './types'

export const nowId = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

export const clip = (raw: string, max = 46) => {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, max)}…`
}

const unique = (items: string[]) => [...new Set(items.filter(Boolean))]
const addUnique = (base: string[], item?: string) => (item ? unique([...base, item]) : base)

export function emptyState(): CognitiveState {
  return {
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
  }
}

export function classifyQuestion(raw: string): CognitiveType {
  const q = raw.toLowerCase()
  // 第一人称的重复行为/情绪模式优先于题目里偶然出现的“选择”“新闻”等关键词。
  // 例如“我为什么选择逃避冲突”是在理解自己的模式，不是做一个待选决策。
  const strongSelf = /(?:我为什么|为什么我|我(?:总是|经常|每次|常常|一到|一.+就)|我的.+(?:焦虑|拖延|害怕|内耗|情绪|走神|逃避|犹豫)|我.+(?:焦虑|拖延|害怕|内耗|走神|逃避|犹豫))/.test(q)
  if (strongSelf) return 'self'
  if (/可信|真假|靠谱吗|新闻|消息|研究|证实|数据|谣言|来源|证据/.test(q)) return 'evidence'
  if (/要不要|该不该|值不值得|选哪个|买不买|去不去|是否要|要不要选|应该选|哪个更好|怎么选|如何选|选择.+(?:还是|或者)|做决定/.test(q)) return 'decision'
  if (/怎么做|如何做|怎么算|证明|报错|题目|这题|这道题|代码|求解|怎么解/.test(q)) return 'problem'
  if (/是什么|什么叫|什么意思|怎么理解|区别|本质|概念|定义/.test(q)) return 'concept'
  if (/会不会.*(?:让|导致|造成|影响)|是否.*(?:导致|造成|影响)|为什么|原因|导致|造成|怎么会|为何|影响/.test(q)) return 'causal'
  if (/怎么看|如何看|是否公平|对不对|争议|观点|立场|应该如何评价/.test(q)) return 'perspective'
  return 'exploratory'
}

export function diagnoseQuestion(raw: string): { cognitiveType: CognitiveType; reason: string } {
  const cognitiveType = classifyQuestion(raw)
  const reasons: Record<CognitiveType, string> = {
    causal: '这个问题主要在追问“为什么会发生”以及中间的因果机制。',
    evidence: '这个问题的关键不是先得出结论，而是判断证据、来源与可信度。',
    decision: '这个问题包含选择与取舍，需要先澄清目标、底线和机会成本。',
    problem: '这个问题需要推进求解过程，重点是暴露卡点并逐步验证方法。',
    concept: '这个问题主要在形成概念模型，需要用自己的话解释并检查边界。',
    perspective: '这个问题包含立场与评价，需要区分事实、价值和不同视角。',
    self: '这个问题指向个人经验与行为模式，需要从具体情境而不是自我标签开始。',
    exploratory: '这个问题目前较开放，先收窄焦点并形成一个可检验的初步判断更有帮助。',
  }
  return { cognitiveType, reason: reasons[cognitiveType] }
}

export const cognitiveTypeLabel: Record<CognitiveType, string> = {
  causal: '因果解释',
  evidence: '证据判断',
  decision: '决策权衡',
  problem: '问题求解',
  concept: '概念理解',
  perspective: '多视角判断',
  self: '自我反思',
  exploratory: '探索性思考',
}

export const cognitiveMoveLabel: Record<CognitiveMove, string> = {
  clarify_focus: '收窄问题',
  state_position: '形成当前判断',
  specify_mechanism: '说清机制',
  surface_assumption: '检查隐含前提',
  generate_alternative: '寻找替代解释',
  seek_counterexample: '寻找反例',
  request_source: '追到原始来源',
  request_evidence: '定义所需证据',
  test_boundary: '检查边界条件',
  define_criteria: '明确判断标准',
  expose_tradeoff: '暴露取舍',
  isolate_blocker: '定位卡点',
  predict_next_step: '先做预测',
  clarify_concept: '用自己的话定义',
  distinguish_fact_value: '区分事实与价值',
  specific_example: '回到具体事件',
  identify_trigger: '识别触发点',
  find_exception: '寻找例外',
  formulate_test: '设计小实验',
  synthesize: '整合当前判断',
}

export const moveObjective: Record<CognitiveMove, string> = {
  clarify_focus: '把过大的问题缩成一个现在可以思考的焦点。',
  state_position: '先让用户留下自己的当前判断，避免被外部答案抢先定锚。',
  specify_mechanism: '把“因为”从标签变成可以检验的中间机制。',
  surface_assumption: '找出结论依赖但尚未检查的前提。',
  generate_alternative: '打破单一解释，至少形成一个竞争性解释。',
  seek_counterexample: '主动寻找能让当前判断失效的例子。',
  request_source: '把转述追溯到可核验的原始来源。',
  request_evidence: '明确什么证据真的能够支持或推翻当前判断。',
  test_boundary: '找到判断成立与不成立的边界。',
  define_criteria: '先说明用什么标准评价一个选择。',
  expose_tradeoff: '让选择的机会成本和放弃项变得可见。',
  isolate_blocker: '把“不会”拆成真正卡住的一步。',
  predict_next_step: '在得到提示前先形成一个可检验的预测。',
  clarify_concept: '形成用户自己的概念模型，而不是先背定义。',
  distinguish_fact_value: '避免把事实判断和价值偏好混在一起。',
  specific_example: '从抽象自我评价回到可观察的真实情境。',
  identify_trigger: '寻找状态变化发生的具体触发点。',
  find_exception: '通过例外识别真正起作用的变量。',
  formulate_test: '把解释变成一个可以尝试和验证的小假设。',
  synthesize: '把已经经过挑战的内容重新组织成用户自己的当前判断。',
}

const playbooks: Record<CognitiveType, CognitiveMove[]> = {
  causal: ['state_position', 'specify_mechanism', 'generate_alternative', 'surface_assumption', 'request_evidence', 'test_boundary', 'synthesize'],
  evidence: ['state_position', 'request_source', 'surface_assumption', 'request_evidence', 'seek_counterexample', 'test_boundary', 'synthesize'],
  decision: ['state_position', 'define_criteria', 'expose_tradeoff', 'surface_assumption', 'request_evidence', 'test_boundary', 'synthesize'],
  problem: ['isolate_blocker', 'predict_next_step', 'surface_assumption', 'test_boundary', 'request_evidence', 'synthesize'],
  concept: ['state_position', 'clarify_concept', 'seek_counterexample', 'surface_assumption', 'test_boundary', 'synthesize'],
  perspective: ['state_position', 'surface_assumption', 'generate_alternative', 'distinguish_fact_value', 'request_evidence', 'test_boundary', 'synthesize'],
  self: ['specific_example', 'identify_trigger', 'find_exception', 'surface_assumption', 'formulate_test', 'synthesize'],
  exploratory: ['clarify_focus', 'state_position', 'surface_assumption', 'generate_alternative', 'request_evidence', 'test_boundary', 'synthesize'],
}

function extractReason(text: string) {
  const match = text.match(/因为([^。！？；\n]{2,48})/)
  return match?.[1]?.trim() ?? ''
}

function extractFocus(text: string) {
  const reason = extractReason(text)
  if (reason) return clip(reason)
  const parts = text
    .split(/[。！？；\n]/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
  const marked = parts.find((item) => /但是|不过|所以|一定|总是|应该|取决于|我觉得|我认为|关键|最/.test(item))
  return clip(marked ?? parts.at(-1) ?? text)
}

function hasSpecificScene(text: string) {
  return /最近|上次|昨天|今天|当时|那次|有一次|在.+的时候|场景|发生/.test(text)
}

function hasInabilitySignal(text: string) {
  return /不知道|不清楚|不懂|没想法|想不出来|想不到|想不出|想不起|记不清|记不起|说不清|分不清|没想好|没有想好|没想明白|无法判断|没有找到|没找到|找不到|好难|(?:我|这一步|这里)(?:还|完全)?不会(?:怎么)?(?:回答|解释|判断|说明|处理|做|算|证明|分析|描述|举|找|写)/.test(text)
}

function hasExplicitPosition(text: string) {
  const compact = text.replace(/\s+/g, '')
  return /(?:我(?:现在|目前|暂时|还是|仍|更)?(?:觉得|认为|倾向|猜|相信|怀疑|支持|反对|同意|不同意)|我的(?:理解|选择|判断|决定|倾向)是|我理解为|我(?:会|不会)选|我赞成|我反对|暂时无法判断|还不能判断|没有形成判断|还没有形成判断)/.test(compact)
    || /^(?:会|不会|要(?:使用|用)|不(?:使用|用)|相信|怀疑|支持|反对|同意|不同意|取决于|看情况|要看|不一定|未必|可能会|应该|不应该)/.test(compact)
}

function hasSubstantiveContrast(text: string) {
  return /(?:但|但是|不过|可是|然而)[，,\s]*(?:我)?(?:觉得|认为|倾向|猜|相信|怀疑|支持|反对|会|不会|可能|应该|更)/.test(text)
}

function normalizeComparable(text: string) {
  return text.toLowerCase().replace(/[\s。！？!?，,；;：:“”‘’'"（）()、…—-]/g, '')
}

function bigrams(text: string) {
  const normalized = normalizeComparable(text)
  if (normalized.length < 2) return normalized ? [normalized] : []
  return Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2))
}

export function textSimilarity(a: string, b: string) {
  const left = bigrams(a)
  const right = bigrams(b)
  if (!left.length || !right.length) return 0
  const remaining = new Map<string, number>()
  for (const item of right) remaining.set(item, (remaining.get(item) || 0) + 1)
  let overlap = 0
  for (const item of left) {
    const count = remaining.get(item) || 0
    if (count > 0) {
      overlap += 1
      remaining.set(item, count - 1)
    }
  }
  return (2 * overlap) / (left.length + right.length)
}

function isDecliningDirection(text: string) {
  return /(?:这个|这条|这个角度|这个方向|这部分).{0,8}(?:不想(?:聊|谈|讨论|继续)|不重要|没兴趣)|(?:我)?不想(?:聊|谈|讨论|继续)(?:这个|这条|这个角度|这个方向|这部分)|换个(?:角度|方向|问题|话题)|先不(?:聊|谈|讨论)这个/.test(text)
}

function isExplicitlyOffTopic(text: string) {
  return /我(?:好像|刚才|这句)?跑题了|这和(?:刚才的|这个)?问题没关系|先说点别的|这个不相关|偏题了/.test(text)
}

function hasRetractionSignal(text: string) {
  return /(?:前面|刚才|之前)(?:我)?(?:说|提到|举的|那个).{0,36}(?:不对|不准确|不成立|不能说明|不算|撤回|说早了)|(?:这个|那个|刚才的|前面的).{0,20}(?:例子|理由|依据|判断).{0,12}(?:不能说明|不成立|不准确|不算|要撤回)/.test(text)
}

function isShortDecisionChoice(text: string) {
  const compact = normalizeComparable(text)
  if (!compact || compact.length > 16) return false
  return /^(?:不?参加|不?去|不?买|不?选|选择?.+|选.+|去|不去|买|不买|参加|不参加|接受|拒绝|继续|放弃|留下|离开|做|不做|要|不要|a|b|第[一二两三四五六七八九1-9]个)$/.test(compact)
}

function repeatedUserResponse(session: ThinkingSession, responseItem: TraceItem) {
  const users = session.trace.filter((item) => item.kind === 'user' && item.id !== responseItem.id)
  const previous = users.at(-1)?.content
  if (!previous) return false
  const current = normalizeComparable(responseItem.content)
  const before = normalizeComparable(previous)
  if (current.length >= 4 && current === before) return true
  return current.length >= 8 && before.length >= 8 && textSimilarity(current, before) >= 0.92
}

export function isStuckResponse(text: string, promptedMove?: CognitiveMove) {
  const compact = text.replace(/[\s。！？!?，,.…]/g, '')
  if (promptedMove === 'state_position' && hasExplicitPosition(text)) return false
  if (hasSubstantiveContrast(text)) return false
  if (compact === '不会' && promptedMove === 'state_position') return false
  if (/^(?:我)?(?:也|还|暂时|真的|完全|有点)?(?:不知道|不清楚|不懂|不会|没想法|想不出来|说不清|记不清|好难|不确定|没有)(?:怎么(?:说|回答|想|做))?(?:啊|呢|了|呀|吧)?$/.test(compact)
    || /^(嗯|哦|好|好的|随便|还行|不知道怎么回答|我不知道怎么回答)$/.test(compact)) return true

  // 用户经常不会只说“我不知道”，而会把当前缺口一起说出来。
  // 这类表达不应仅因包含动作关键词（如“前提”“证据”“例外”）就被当作完成。
  if (hasInabilitySignal(text)) return true
  if ((promptedMove === 'specific_example' || promptedMove === 'seek_counterexample' || promptedMove === 'find_exception')
    && /^(?:我)?(?:没有|没)(?:这样的|这种|类似的)?(?:例子|经历|情况|印象)/.test(compact)) return true
  return false
}

function inferSatisfiedMoves(state: CognitiveState, latestText: string, promptedMove?: CognitiveMove, cognitiveType?: CognitiveType): CognitiveMove[] {
  if (isStuckResponse(latestText, promptedMove)) return []
  const satisfied: CognitiveMove[] = []
  const unable = hasInabilitySignal(latestText)
  if (hasExplicitPosition(latestText) || (promptedMove === 'state_position' && cognitiveType === 'decision' && isShortDecisionChoice(latestText))) satisfied.push('state_position')
  if (state.alternatives.length > 0) satisfied.push('generate_alternative')
  if (state.boundaries.length > 0) satisfied.push('test_boundary')
  if (state.goals.length > 0) satisfied.push('define_criteria')
  if (!unable && /通过.{1,48}(?:使得|导致|让)|因为.{1,48}所以|导致.{1,48}(?:进而|从而|于是)|先.{1,30}再.{1,30}/.test(latestText)) satisfied.push('specify_mechanism')
  if (!unable && /(?:我(?:会|准备|打算)?(?:去)?(?:查|找|看|核对).{0,20}(?:原文|论文|期刊|官方|报告|网址|链接|作者|机构)|(?:来源|原文|报告|论文).{0,8}(?:是|来自|在|：|:))/.test(latestText)) satisfied.push('request_source')
  if (!unable && /(?:例外是|反例是|并不是每次|也有.{1,20}没有|有一次.{1,30}(?:却|反而))/.test(latestText)) satisfied.push('find_exception')
  if (!unable && hasSpecificScene(latestText)) satisfied.push('specific_example')
  if (!unable && /指的是|我的理解是|也就是说|可以理解为|本质上是/.test(latestText)) satisfied.push('clarify_concept')
  if (!unable && /我卡在|不会的是|不明白的是|问题出在|报错在/.test(latestText)) satisfied.push('isolate_blocker')
  const completionSignals: Partial<Record<CognitiveMove, RegExp>> = {
    clarify_focus: /我(?:最想|现在想|先想|先弄清|关注)|重点是|具体想弄清/,
    surface_assumption: /前提(?:是|为)|我(?:假设|默认)|需要.{1,30}成立/,
    seek_counterexample: /反例(?:是|有)|相反的例子|有一次.{1,24}(?:却|反而)|并不是.{1,20}(?:都|总是)/,
    request_evidence: /(?:如果|看到|需要|通过).{0,24}(?:数据|证据|调查|实验|对照|比较|统计|记录)|我会(?:查|找|核对)/,
    expose_tradeoff: /代价(?:是|在于)|要放弃|会失去|牺牲|成本(?:是|在于)|机会成本/,
    predict_next_step: /下一步(?:我|要|应该)|我会先|我准备先|我猜(?:要|会)|应该先/,
    distinguish_fact_value: /事实(?:是|部分)|价值(?:是|判断|偏好)|这只是我的偏好|我认为.{0,16}应该/,
    identify_trigger: /一.{1,16}就|当.{1,24}时|触发(?:点|是)|从.{1,16}开始/,
    formulate_test: /我(?:准备|会|想)试|我会(?:观察|记录|比较|验证)|下次.{0,24}(?:先|试|记录|观察)/,
    synthesize: /我(?:现在|目前|还是)?(?:觉得|认为|倾向)|我的判断是|取决于|暂时无法判断|还不能判断/,
  }
  if (!unable && promptedMove && latestText.length >= 4 && completionSignals[promptedMove]?.test(latestText)) satisfied.push(promptedMove)
  return unique(satisfied) as CognitiveMove[]
}

export function analyzeResponse(session: ThinkingSession, responseItem: TraceItem): ResponseAnalysis {
  const text = responseItem.content.trim()
  const excerpt = extractFocus(text)
  const observations: string[] = []
  const signals: string[] = []
  const responseIndex = session.trace.findIndex((item) => item.id === responseItem.id)
  const promptedMove = session.trace.slice(0, responseIndex).reverse().find((item) => item.move)?.move
  if (isDecliningDirection(text)) {
    return {
      responseId: responseItem.id,
      createdAt: Date.now(),
      excerpt: text,
      observations: ['这条方向你暂时不想继续。可以换一个角度，而不必把当前问题硬想到底。'],
      detectedSignals: ['declines_direction'],
      stateAfter: { ...session.cognitiveState, completedMoves: [...session.cognitiveState.completedMoves] },
      source: 'local',
      engagement: 'engaged',
      completedMoveEvidence: [],
    }
  }
  if (isExplicitlyOffTopic(text) || repeatedUserResponse(session, responseItem)) {
    return {
      responseId: responseItem.id,
      createdAt: Date.now(),
      excerpt: text,
      observations: [isExplicitlyOffTopic(text) ? '这一轮暂时偏离了当前追问，可以回到刚才那一步，或换个更容易回答的说法。' : '这一轮基本重复了前面的表达，但还没有补上当前追问需要的新信息。'],
      detectedSignals: [isExplicitlyOffTopic(text) ? 'off_topic' : 'repeats_previous'],
      stateAfter: { ...session.cognitiveState, completedMoves: [...session.cognitiveState.completedMoves] },
      source: 'local',
      engagement: 'stuck',
      completedMoveEvidence: [],
    }
  }
  if (isStuckResponse(text, promptedMove)) {
    return {
      responseId: responseItem.id,
      createdAt: Date.now(),
      excerpt: text,
      observations: ['这一问暂时还不清楚，可以借助一点提示，或换个更容易回答的问法。'],
      detectedSignals: ['needs_support'],
      stateAfter: { ...session.cognitiveState, completedMoves: [...session.cognitiveState.completedMoves] },
      source: 'local',
      engagement: 'stuck',
      completedMoveEvidence: [],
    }
  }
  const updatesPosition = hasExplicitPosition(text) || (promptedMove === 'state_position' && session.cognitiveType === 'decision' && isShortDecisionChoice(text)) || (promptedMove === 'synthesize' && !hasInabilitySignal(text) && text.length >= 4)
  let state: CognitiveState = {
    ...session.cognitiveState,
    currentPosition: updatesPosition ? clip(text, 120) : session.cognitiveState.currentPosition,
    focus: excerpt,
    keyClaims: addUnique(session.cognitiveState.keyClaims, clip(text, 120)),
  }

  const reason = extractReason(text)
  if (reason) {
    signals.push('explicit_reason')
    observations.push(`你给出了一个明确理由：“${clip(reason, 34)}”。`)
    state = { ...state, assumptions: addUnique(state.assumptions, `当前判断依赖“${clip(reason, 34)}”确实能支持结论。`) }
  }

  if (/不确定|不太确定|不清楚是否|还不能判断|暂时无法判断|说不准|拿不准|需要(?:确认|核对|验证)/.test(text)) {
    signals.push('uncertainty')
    observations.push('你明确保留了一处还没有确定的地方。')
    state = { ...state, uncertainties: addUnique(state.uncertainties, excerpt) }
  } else if (/可能|也许|不一定|感觉|好像|大概|或许|我猜|未必/.test(text)) {
    signals.push('tentative')
    observations.push('你的表述保留了余地，没有把这一点说成确定事实。')
  }

  if (!hasInabilitySignal(text) && /数据|研究|论文|来源|报告|统计|实验|新闻|案例|例子|亲身|看到|调查|官方/.test(text)) {
    signals.push('evidence_mentioned')
    observations.push('你已经提到了证据或来源线索，下一步可以检查它是否真的支持结论。')
    state = { ...state, evidenceSignals: addUnique(state.evidenceSignals, excerpt) }
  }

  if (!hasInabilitySignal(text) && /也可能|另一种|或者|除此之外|另一方面|还可能|未必只是|不只/.test(text)) {
    signals.push('alternative')
    observations.push('你已经开始提出不止一种解释或可能性。')
    state = { ...state, alternatives: addUnique(state.alternatives, excerpt) }
  }

  if (!hasInabilitySignal(text) && /如果.{1,48}(?:就|会|那么)|除非.{2,}|取决于.{2,}|只有.{1,}才|在.{1,}情况下|前提是.{2,}|只要.{1,}/.test(text)) {
    signals.push('boundary')
    observations.push('你已经给当前判断加上了条件或边界。')
    state = { ...state, boundaries: addUnique(state.boundaries, excerpt) }
  }

  if (!hasInabilitySignal(text) && /我(?:更)?(?:看重|在乎|希望|想要)|我的(?:目标|底线)|不能接受|优先考虑/.test(text)) {
    signals.push('goal')
    observations.push('你表达了一个目标、优先级或底线。')
    state = { ...state, goals: addUnique(state.goals, excerpt) }
  }

  if (/(?<!不|不能|不应|不是|不必)一定|肯定|必然|都这样|总是|(?<!不|不能|不应|不是)完全|从来|所有人|任何情况下/.test(text)) {
    signals.push('absolute_claim')
    observations.push('你的表述里有比较强的绝对判断，后面值得专门检查它的边界。')
    state = { ...state, assumptions: addUnique(state.assumptions, `“${excerpt}”目前被表达成接近无例外的判断。`) }
  }

  if (/就像|类似|好比|相当于|跟.+一样/.test(text)) {
    signals.push('analogy')
    observations.push('你正在使用类比来支持判断，后面可以检查两个情境的关键机制是否真的相同。')
    state = { ...state, assumptions: addUnique(state.assumptions, `当前类比需要“${excerpt}”在关键机制上足够相似。`) }
  }

  if (/原来|之前|刚开始|一开始/.test(text) && /现在|后来|但是|不过|改|发现/.test(text)) {
    signals.push('explicit_change')
    observations.push('你比较了之前和现在的想法，可以在整理时确认哪一部分发生了变化。')
    state = { ...state, changedIdeas: addUnique(state.changedIdeas, clip(text, 120)) }
  }

  if (/不是.+而是|关键.+不是|我改成|我现在觉得|换句话说/.test(text)) {
    signals.push('reframe')
    observations.push(`你重新表述了当前的焦点：“${excerpt}”。`)
    state = { ...state, changedIdeas: addUnique(state.changedIdeas, clip(text, 120)) }
  }

  if (hasRetractionSignal(text)) {
    signals.push('retraction')
    observations.push('你撤回或削弱了前面的一条理由/例子；旧记录会保留，但后续不应再把它当成未被质疑的依据。')
    state = { ...state, changedIdeas: addUnique(state.changedIdeas, `撤回/修正：${clip(text, 100)}`) }
  }

  if (updatesPosition && session.cognitiveState.currentPosition && normalizeComparable(session.cognitiveState.currentPosition) !== normalizeComparable(text)) {
    signals.push('position_revision')
    state = { ...state, changedIdeas: addUnique(state.changedIdeas, `当前判断更新为：${clip(text, 100)}`) }
  }

  if (observations.length === 0) observations.push(`你补充了这一轮的具体表达：“${excerpt}”。`)

  const naturallySatisfied = inferSatisfiedMoves(state, text, promptedMove, session.cognitiveType)
  state = { ...state, completedMoves: unique([...state.completedMoves, ...naturallySatisfied]) as CognitiveMove[] }

  return {
    responseId: responseItem.id,
    createdAt: Date.now(),
    excerpt,
    observations: observations.slice(0, 4),
    detectedSignals: signals,
    stateAfter: state,
    source: 'local',
    engagement: 'engaged',
    completedMoveEvidence: naturallySatisfied.map((move) => ({ move, excerpt: text })),
  }
}

function shouldSkipMove(move: CognitiveMove, session: ThinkingSession, latestText: string) {
  const completed = new Set(session.cognitiveState.completedMoves)
  if (completed.has(move)) return true
  const satisfied = new Set(inferSatisfiedMoves(session.cognitiveState, latestText, undefined, session.cognitiveType))
  return satisfied.has(move)
}

export function selectNextMove(session: ThinkingSession): CognitiveMove {
  const latestAnalysis = session.analyses.at(-1)
  if (latestAnalysis?.detectedSignals.includes('declines_direction')) return 'clarify_focus'
  if (latestAnalysis?.engagement === 'stuck') {
    const previousMove = [...session.trace].reverse().find((item) => item.move)?.move
    if (previousMove) return previousMove
  }
  const latestUser = [...session.trace].reverse().find((item) => item.kind === 'user')?.content ?? ''
  const sequence = playbooks[session.cognitiveType]
  const candidate = sequence.find((move) => !shouldSkipMove(move, session, latestUser))
  if (candidate) return candidate
  return session.cognitiveState.completedMoves.includes('formulate_test') ? 'request_evidence' : 'formulate_test'
}

export function interventionKind(move: CognitiveMove): TraceItem['kind'] {
  if (move === 'seek_counterexample' || move === 'generate_alternative' || move === 'find_exception') return 'counterexample'
  if (move === 'request_source' || move === 'request_evidence' || move === 'test_boundary') return 'evidence'
  if (move === 'synthesize') return 'synthesis'
  return 'guide'
}

export function generateQuestionLocal(move: CognitiveMove, session: ThinkingSession) {
  const focus = session.cognitiveState.focus || clip(session.question, 42)
  const current = session.cognitiveState.currentPosition || ''
  const reason = extractReason(current)

  const templates: Record<CognitiveMove, () => string> = {
    clarify_focus: () => `在“${clip(session.question, 38)}”这个问题里，你现在最想先弄清哪一小部分？只选一个。`,
    state_position: () => {
      if (session.cognitiveType === 'evidence') return `对“${clip(session.question, 38)}”，你现在更偏向相信、怀疑，还是暂时无法判断？`
      if (session.cognitiveType === 'decision') return `对“${clip(session.question, 38)}”，你现在更倾向哪个选择？哪怕只是一个初步想法也可以。`
      return `先不找标准答案。对“${clip(session.question, 38)}”，你此刻最接近的判断是什么？哪怕只有一点把握也可以。`
    },
    specify_mechanism: () => `你刚才把“${reason || focus}”放在了关键位置。它具体通过哪一步，才会导致你原问题里的结果？只说中间最关键的一环。`,
    surface_assumption: () => `要让你关于“${focus}”的判断成立，哪个前提必须先是真的？`,
    generate_alternative: () => `先暂时把“${focus}”放到一边。还有没有另一种完全不同的解释，也能说明“${clip(session.question, 34)}”？`,
    seek_counterexample: () => `针对“${focus}”，能不能找一种表面条件相似、结果却相反的情况？`,
    request_source: () => `要检查“${focus}”，你最值得追查的一个原始来源是什么？`,
    request_evidence: () => `要检查“${focus}”，哪一种具体证据最可能改变你现在的判断？`,
    test_boundary: () => `你现在的说法是“${focus}”。它在什么情况下可能不成立？给这个判断划一条最重要的边界。`,
    define_criteria: () => `面对这个选择，你最想守住的一条标准是什么？`,
    expose_tradeoff: () => `如果按现在更倾向的方向走，你最可能要付出哪一个代价？`,
    isolate_blocker: () => `面对“${clip(session.question, 38)}”，真正让你停住的是哪一个最小步骤？`,
    predict_next_step: () => `围绕你刚才说的“${focus}”，先不要看提示。你猜下一步最可能要用到什么关系、条件或操作？猜错也没关系。`,
    clarify_concept: () => `你刚才的理解集中在“${focus}”。如果不能引用课本定义，你会怎样用自己的话把这个概念说给没学过的人听？`,
    distinguish_fact_value: () => `在“${focus}”这句话里，哪一部分是在描述事实，哪一部分其实是你认为“应该怎样”的价值选择？试着把两者分开。`,
    specific_example: () => `围绕“${clip(session.question, 34)}”，最近一次真实发生的事情是什么？`,
    identify_trigger: () => `在你描述的“${focus}”里，哪一个具体瞬间让状态开始变化？`,
    find_exception: () => `在接近“${focus}”的情境里，有没有一次结果不同的经历？`,
    formulate_test: () => `为了检查“${focus}”，你愿意做哪一个很小的尝试？`,
    synthesize: () => `经过刚才的思考，你现在对“${clip(session.question, 38)}”的判断是什么？结论保持不变也可以。`,
  }

  return templates[move]().replace(/“([^”]*)”/g, (_match, topic: string) => `“${topic.replace(/[？?]/g, '')}”`)
}

export function plannerWhy(move: CognitiveMove, session: ThinkingSession) {
  const latestAnalysis = session.analyses.at(-1)
  const focus = latestAnalysis?.excerpt || session.cognitiveState.focus || clip(session.question, 36)
  const observation = latestAnalysis?.observations[0]
  if (!latestAnalysis) return `这是第一次介入。先完成“${cognitiveMoveLabel[move]}”，能让后面的追问建立在你的真实想法上。`
  return observation
    ? `${observation} 因此下一步先做“${cognitiveMoveLabel[move]}”，而不是直接补充答案。`
    : `你刚才把焦点放在“${focus}”。下一步用“${cognitiveMoveLabel[move]}”继续推进。`
}

export function appendUserTrace(session: ThinkingSession, content: string) {
  const userItem: TraceItem = {
    id: nowId('u'),
    kind: 'user',
    content: content.trim(),
    createdAt: Date.now(),
    source: 'user',
  }
  const next: ThinkingSession = { ...session, trace: [...session.trace, userItem], updatedAt: Date.now() }
  return { session: next, userItem }
}

export function applyAnalysis(session: ThinkingSession, analysis: ResponseAnalysis): ThinkingSession {
  return {
    ...session,
    cognitiveState: analysis.stateAfter,
    analyses: [...session.analyses, analysis],
    updatedAt: Date.now(),
  }
}

export function appendIntervention(
  session: ThinkingSession,
  options: {
    move: CognitiveMove
    content: string
    trigger?: PlannerRecord['trigger']
    source?: 'local' | 'ai'
    provider?: string
    model?: string
    contextAnchor?: string
    title?: string
    objective?: string
    whyNow?: string
    reflection?: string
    decisionSource?: 'local' | 'ai'
  },
): ThinkingSession {
  const { move } = options
  const questionId = nowId('g')
  const recordId = nowId('plan')
  const latestAnalysis = session.analyses.at(-1)
  const item: TraceItem = {
    id: questionId,
    kind: interventionKind(move),
    title: options.title || cognitiveMoveLabel[move],
    content: options.content,
    createdAt: Date.now(),
    move,
    plannerRecordId: recordId,
    source: options.source === 'ai' ? 'ai' : 'local_engine',
    ...(options.reflection ? { reflection: options.reflection } : {}),
  }

  const recordBase: PlannerRecord = {
    id: recordId,
    turn: session.plannerRecords.length + 1,
    createdAt: Date.now(),
    trigger: options.trigger ?? 'user_response',
    cognitiveType: session.cognitiveType,
    chosenMove: move,
    objective: options.objective || moveObjective[move],
    whyNow: options.whyNow || plannerWhy(move, session),
    focusExcerpt: options.contextAnchor || latestAnalysis?.excerpt || session.cognitiveState.focus || clip(session.question, 46),
    observations: latestAnalysis?.observations ?? [session.diagnosisReason],
    questionId,
    generationSource: options.source ?? 'local',
    contextAnchor: options.contextAnchor,
    decisionSource: options.decisionSource || 'local',
  }
  const withProvider = options.provider ? { ...recordBase, provider: options.provider } : recordBase
  const withModel = options.model ? { ...withProvider, model: options.model } : withProvider
  const record: PlannerRecord = latestAnalysis
    ? { ...withModel, sourceResponseId: latestAnalysis.responseId }
    : withModel

  return {
    ...session,
    trace: [...session.trace, item],
    plannerRecords: [...session.plannerRecords, record],
    interventionIndex: session.interventionIndex + 1,
    updatedAt: Date.now(),
  }
}

export function appendNextInterventionLocal(
  session: ThinkingSession,
  trigger: PlannerRecord['trigger'] = 'user_response',
): ThinkingSession {
  let move = selectNextMove(session)
  let content = session.analyses.at(-1)?.engagement === 'stuck' ? getQuestionSupport(move, session).rephrase : generateQuestionLocal(move, session)
  const recent = session.trace.filter((item) => item.kind !== 'user' && item.kind !== 'question').slice(-8)
  if (recent.some((item) => textSimilarity(item.content, content) >= 0.86)) {
    const options: CognitiveMove[] = ['specific_example', 'define_criteria', 'test_boundary', 'formulate_test', 'clarify_focus']
    const alternate = options.find((candidate) => !recent.some((item) => item.move === candidate))
    const canClarifyChoice = move === 'state_position' && !session.cognitiveState.currentPosition && recent.filter((item) => item.move === 'state_position').length < 2
    if (canClarifyChoice) content = '先不解释理由：这个选择里，你愿意先试哪一个方向？'
    else if (alternate) { move = alternate; content = generateQuestionLocal(move, session) }
    else content = `先停下重复追问。围绕“${clip(session.question, 28)}”，你想保留的一个关键词是什么？也可以先整理这次思考。`
  }
  return appendIntervention(session, {
    move,
    content,
    trigger,
    source: 'local',
  })
}

export function createSessionBase(question: string): ThinkingSession {
  const t = Date.now()
  const { cognitiveType, reason } = diagnoseQuestion(question)
  return {
    schemaVersion: 5,
    id: nowId('journey'),
    question: question.trim(),
    cognitiveType,
    diagnosisReason: reason,
    createdAt: t,
    updatedAt: t,
    status: 'active',
    trace: [{ id: nowId('q'), kind: 'question', content: question.trim(), createdAt: t, source: 'user' }],
    cognitiveState: emptyState(),
    analyses: [],
    plannerRecords: [],
    aiEvents: [],
    aiRuntime: { mode: 'local' },
    interventionIndex: 0,
    supportRecords: [],
  }
}

export function createSession(question: string): ThinkingSession {
  return appendNextInterventionLocal(createSessionBase(question), 'initial')
}

export function appendUserResponse(session: ThinkingSession, content: string): ThinkingSession {
  const appended = appendUserTrace(session, content)
  const analysis = analyzeResponse(appended.session, appended.userItem)
  return appendNextInterventionLocal(applyAnalysis(appended.session, analysis), 'user_response')
}

export function isReadyToSynthesize(session: ThinkingSession) {
  return session.trace.some((item) => item.kind === 'user')
}

export function getQuestionSupport(move: CognitiveMove, session: ThinkingSession) {
  const focus = clip(session.cognitiveState.focus || session.question, 30)
  const prompts: Record<CognitiveMove, [string, string]> = {
    clarify_focus: ['试着补一句：“这件事里，我最想弄清的是……”', `关于“${focus}”，你最想先弄清哪一点？`],
    state_position: ['可以从“我目前倾向……”“我暂时无法判断……”开始，只写一句。', `关于“${clip(session.question, 30)}”，你现在的第一反应是什么？`],
    specify_mechanism: ['把它写成“发生 A → 带来 B”，只填中间的一步。', `你提到的“${focus}”，接下来会引起哪一个具体变化？`],
    surface_assumption: ['试着补一句：“我的说法成立，需要先满足……”', '你这个想法需要什么条件，才站得住？'],
    generate_alternative: ['暂时保留原来的解释，试着写“也可能是因为……”', '除了刚才的解释，还可能有哪一种原因？'],
    seek_counterexample: ['想一个相似但结果不同的经历；暂时想不到也可以直接说。', '有没有一个例子，与你现在的说法不同？'],
    request_source: ['从你确实见过的文章、记录或数据开始；还没有找到来源也可以说明。', '你想先去哪里核对这件事？'],
    request_evidence: ['试着补一句：“如果我看到……，我会重新考虑。”', '看到什么，你会愿意重新考虑现在的想法？'],
    test_boundary: ['把“总是如此”缩小为“在……情况下如此”。', '哪一种情况下，你的说法可能不成立？'],
    define_criteria: ['只选你真正看重的一点，比如时间、兴趣或一条底线。', '这个选择里，你最在乎什么？'],
    expose_tradeoff: ['可以从“得到这个，我可能要放弃……”开始。', '走这条路，你可能要放弃什么？'],
    isolate_blocker: ['只写不会的那一步，已经会的部分暂时不用解释。', '你具体卡在哪一步？'],
    predict_next_step: ['先猜一个操作，再用结果检查；不需要先保证猜对。', '你愿意先尝试哪一步？'],
    clarify_concept: ['用“它像……，但与……不同”组织自己的理解。', `你会怎样用一句话解释“${focus}”？`],
    distinguish_fact_value: ['“发生了什么”是描述；“我觉得应该怎样”是偏好或评价。', '你刚才的说法里，哪一部分表达了自己的偏好？'],
    specific_example: ['想最近一次，补一句“当时，我正在……，然后……”', '最近一次具体发生了什么？'],
    identify_trigger: ['把过程放慢，找状态变化前紧挨着发生的一件事。', '变化开始前，发生了哪一件事？'],
    find_exception: ['回想一次结果不同的经历；如果没有印象，可以先记录这一点。', '有没有一次相似的情境，结果却不同？'],
    formulate_test: ['把尝试缩小到下一次就能做的一步，比如记录、比较或核对。', '下一次，你愿意做哪一个小尝试？'],
    synthesize: ['可以写“我现在仍然认为……，但我会保留……”。', '用一句话，你现在会怎么说这件事？'],
  }
  const [hint, rephrase] = prompts[move]
  return { hint, rephrase: rephrase.replace(/“([^”]*)”/g, (_match, topic: string) => `“${topic.replace(/[？?]/g, '')}”`) }
}

export const allCognitiveMoves = Object.keys(cognitiveMoveLabel) as CognitiveMove[]
