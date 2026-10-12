const base = process.env.RJ_DEV_URL || 'http://localhost:5173'

const sample = {
  schemaVersion: 5,
  id: 'arena-demo',
  question: 'AI 会不会让大学生越来越不会思考？',
  cognitiveType: 'causal',
  diagnosisReason: '这个问题主要在追问 AI 使用和思考能力变化之间的因果机制。',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: 'active',
  trace: [
    { id: 'q1', kind: 'question', content: 'AI 会不会让大学生越来越不会思考？', createdAt: Date.now(), source: 'user' },
    { id: 'g1', kind: 'guide', content: '先不找标准答案。你此刻最接近的判断是什么？', createdAt: Date.now(), move: 'state_position', source: 'local_engine' },
    { id: 'u1', kind: 'user', content: '我觉得会，因为很多学生做作业遇到不会的，第一反应就是直接问 AI。', createdAt: Date.now(), source: 'user' },
  ],
  cognitiveState: {
    currentPosition: '我觉得会，因为很多学生做作业遇到不会的，第一反应就是直接问 AI。',
    focus: '第一反应就是直接问 AI',
    keyClaims: ['AI 会让大学生更不会思考'],
    assumptions: ['直接问 AI 会减少必要的自主思考过程'],
    uncertainties: [],
    evidenceSignals: [],
    alternatives: [],
    boundaries: [],
    goals: [],
    changedIdeas: [],
    completedMoves: ['state_position'],
  },
  analyses: [],
  plannerRecords: [],
  aiEvents: [],
  aiRuntime: { mode: 'local' },
  interventionIndex: 1,
  supportRecords: [],
}

try {
  const res = await fetch(`${base}/api/ai/arena`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session: sample,
      move: 'specify_mechanism',
      objective: '把“因为”从标签变成可以检验的中间机制。',
      whyNow: '用户已经明确表达了立场和一个理由，下一步需要说清理由如何导致能力下降。',
    }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.message || '竞技场请求失败')
  console.log('\n反思之旅 · V0.5 模型竞技场')
  console.log('认知动作：specify_mechanism\n')
  for (const candidate of data.candidates || []) {
    console.log(`--- ${candidate.provider}${candidate.model ? ` / ${candidate.model}` : ''} ---`)
    if (candidate.ok) {
      console.log(candidate.question)
      console.log(`锚点：${candidate.contextAnchor || '—'} · ${candidate.latencyMs ?? '?'} ms\n`)
    } else {
      console.log(`失败：${candidate.error}\n`)
    }
  }
  console.log('建议人工比较：上下文针对性 / 认知动作正确性 / 不泄露答案 / 不重复 / 单一认知负荷 / 认知推进量。\n')
} catch (error) {
  console.error('模型竞技场无法运行。请先在另一个终端执行 npm run dev，并确认 .env.local 至少配置一个 Provider。')
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
