import { cognitiveMoveLabel, cognitiveTypeLabel } from './engine'
import type { ThinkingSession } from './types'

function time(value: number) {
  return new Date(value).toLocaleString('zh-CN')
}

export function sessionToMarkdown(session: ThinkingSession) {
  const lines: string[] = [
    `# ${session.question}`,
    '',
    `- 创建时间：${time(session.createdAt)}`,
    `- 认知类型：${cognitiveTypeLabel[session.cognitiveType]}`,
    `- 诊断说明：${session.diagnosisReason}`,
    `- 运行模式：${session.dialogueMode === 'ai' && session.aiRuntime.status === 'ready' ? `AI 参与理解与决策（${session.aiRuntime.provider ?? ''} / ${session.aiRuntime.model ?? ''}）` : session.aiRuntime.mode === 'hybrid' ? '含真实模型调用记录，当前状态请查看运行日志' : '本地提纲'}`,
    '',
    '## 完整思考与回答',
    '',
  ]

  if (session.origin) lines.splice(6, 0, `- 从另一个问题岔开：${session.origin.question}`, `- 原思考记录：${session.origin.sessionId}`)
  if (session.communitySource) lines.splice(6, 0, `- 接续自思考卡：${session.communitySource.cardId}`, `- 来源作者：${session.communitySource.authorName}`, `- 来源问题：${session.communitySource.question}`)

  session.trace.forEach((item, index) => {
    if (item.kind === 'question') {
      lines.push(`### ${index + 1}. 原始问题`, '', item.content, '')
      return
    }
    if (item.kind === 'user') {
      lines.push(`### ${index + 1}. 我的思考`, '', item.content, '')
      return
    }
    const source = item.source === 'ai' ? '真实模型动态生成' : '本地认知引擎'
    lines.push(`### ${index + 1}. 系统介入 · ${item.move ? cognitiveMoveLabel[item.move] : item.title ?? '思考提示'}`, '', `> 来源：${source}`, '', item.content, '')
  })

  if (session.supportRecords.length > 0) {
    lines.push('## 使用过的提示与换个问法', '')
    session.supportRecords.forEach((record) => {
      const question = session.trace.find((item) => item.id === record.questionId)
      lines.push(`### ${record.kind === 'hint' ? '一点提示' : '换个问法'}`, '', `- 对应问题：${question?.content || record.questionId}`, '', record.content, '')
    })
  }

  lines.push('## 认知引擎过程记录', '')
  if (session.plannerRecords.length === 0) {
    lines.push('该记录来自旧版本，没有保存结构化规划过程。', '')
  } else {
    session.plannerRecords.forEach((record) => {
      const analysis = record.sourceResponseId
        ? session.analyses.find((item) => item.responseId === record.sourceResponseId)
        : undefined
      lines.push(
        `### 第 ${record.turn} 次介入 · ${cognitiveMoveLabel[record.chosenMove]}`,
        '',
        `- 观察焦点：${record.focusExcerpt}`,
        `- 认知目标：${record.objective}`,
        `- 为什么此刻这样问：${record.whyNow}`,
        `- 认知分析来源：${analysis?.source === 'ai' ? `真实模型 ${analysis.provider ?? ''} / ${analysis.model ?? ''}` : analysis ? '本地结构化分析' : '首次介入'}`,
        `- 问题生成来源：${record.generationSource === 'ai' ? `真实模型 ${record.provider ?? ''} / ${record.model ?? ''}` : '本地问题生成器'}`,
        `- 决策来源：${record.decisionSource === 'ai' ? 'AI 根据对话选择下一步' : '本地规则'}`,
      )
      if (record.contextAnchor) lines.push(`- 上下文锚点：${record.contextAnchor}`)
      if (record.observations.length > 0) {
        lines.push('- 本轮结构化观察：')
        record.observations.forEach((observation) => lines.push(`  - ${observation}`))
      }
      lines.push('')
    })
  }

  if (session.aiEvents.length > 0) {
    lines.push('## 真实模型调用与回退记录', '')
    session.aiEvents.forEach((event, index) => {
      lines.push(
        `### ${index + 1}. ${event.phase}`,
        '',
        `- 时间：${time(event.createdAt)}`,
        `- Provider / Model：${event.provider} / ${event.model}`,
        `- 状态：${event.status}`,
        `- Prompt 版本：${event.promptVersion}`,
        event.latencyMs != null ? `- 耗时：${event.latencyMs} ms` : '- 耗时：未记录',
        `- 摘要：${event.summary}`,
      )
      if (event.error) lines.push(`- 错误/回退原因：${event.error}`)
      lines.push('')
    })
  }

  if (session.summary) {
    lines.push('## 最终整理', '', `### 此刻的判断`, '', session.summary.currentJudgment, '')
    if (session.summary.initialJudgment) lines.push('### 开始时的想法', '', session.summary.initialJudgment, '')
    if (session.summary.keyDiscovery) lines.push('### 用户确认的收获', '', session.summary.keyDiscovery, '')
    if (session.summary.openQuestion) lines.push('### 还值得弄清的问题', '', session.summary.openQuestion, '')
    if (session.summary.changed) lines.push('### 和开始相比发生的变化', '', session.summary.changed, '')
    if (session.summary.keyTurningPoint) lines.push('### 最关键的转折点', '', session.summary.keyTurningPoint, '')
  }

  if (session.verification) {
    lines.push('## 现实验证与回看', '', `- 准备尝试：${session.verification.action}`, `- 状态：${session.verification.status === 'planned' ? '待回看' : '已记录结果'}`, '')
    if (session.verification.expectedSignal) lines.push(`- 想观察的信号：${session.verification.expectedSignal}`, '')
    session.verification.reviews.forEach((review) => {
      lines.push(`### ${time(review.createdAt)} · 实际观察`, '', review.outcome, '')
      if (review.revisedJudgment) lines.push('### 回看后的判断', '', review.revisedJudgment, '')
    })
  }

  lines.push('---', '', '说明：全过程记录的是用户真实输入、结构化认知状态、认知引擎的策略选择、模型结构化输出与调用状态。系统不会请求、导出或保存模型的隐藏思维链。')
  return lines.join('\n')
}

export function downloadSessionMarkdown(session: ThinkingSession) {
  const blob = new Blob([sessionToMarkdown(session)], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `反思之旅_${session.question.slice(0, 24).replace(/[\\/:*?"<>|]/g, '_')}.md`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadSessionJson(session: ThinkingSession) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `反思之旅_${session.id}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}
