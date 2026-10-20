import { cognitiveMoveLabel, cognitiveTypeLabel } from '../lib/engine'
import type { ThinkingSession } from '../lib/types'

export function ProcessTrail({ session, defaultOpen = false }: { session: ThinkingSession; defaultOpen?: boolean }) {
  return (
    <details className="process-trail" open={defaultOpen || undefined}>
      <summary>
        <span>认知路径</span>
        <small>{session.plannerRecords.length} 次策略选择 · {session.aiEvents.length} 条运行记录 · 全过程已保存</small>
      </summary>

      <div className="process-content">
        <section className="process-diagnosis">
          <div className="process-kicker">问题识别</div>
          <h3>{cognitiveTypeLabel[session.cognitiveType]}</h3>
          <p>{session.diagnosisReason}</p>
          <p className="process-runtime">
            当前运行：{session.aiRuntime.status === 'failed' ? 'AI 本轮未完成' : session.aiRuntime.status === 'ready' && session.aiRuntime.provider
              ? `${session.aiRuntime.provider}${session.aiRuntime.model ? ` · ${session.aiRuntime.model}` : ''}`
              : session.dialogueMode === 'local' ? '本地提纲' : '旧版记录，尚未验证新版 AI 参与'}
            {session.aiRuntime.lastError ? (session.dialogueMode === 'ai' ? ' · 本轮 AI 未完成，原话已保留' : ' · 旧记录曾使用本地回退') : ''}
          </p>
        </section>

        {session.plannerRecords.length === 0 ? (
          <p className="legacy-process-note">这条记录来自旧版本，当时还没有保存结构化的认知分析与提问规划。</p>
        ) : (
          <ol className="process-list">
            {session.plannerRecords.map((record) => {
              const analysis = record.sourceResponseId
                ? session.analyses.find((item) => item.responseId === record.sourceResponseId)
                : undefined
              const questionEvent = session.aiEvents.find((event) => event.phase === 'dialogue_decision' ? event.structured?.questionId === record.questionId : event.phase === 'question_generation' && event.move === record.chosenMove && event.turn === record.turn - 1)
              return (
                <li key={record.id}>
                  <div className="process-turn">第 {record.turn} 次介入</div>
                  <h4>{cognitiveMoveLabel[record.chosenMove]}</h4>
                  {analysis && analysis.observations.length > 0 && (
                    <div className="process-observations">
                      {analysis.observations.map((observation) => <p key={observation}>{observation}</p>)}
                    </div>
                  )}
                  <dl>
                    <div><dt>这一步由谁选择</dt><dd>{record.decisionSource === 'ai' ? 'AI 根据对话理解自主选择，本地只做约束检查' : '本地规则（旧版记录或主动选择的本地提纲）'}</dd></div>
                    <div>
                      <dt>当时聚焦</dt>
                      <dd>{record.focusExcerpt}</dd>
                    </div>
                    <div>
                      <dt>这一问要完成什么</dt>
                      <dd>{record.objective}</dd>
                    </div>
                    <div>
                      <dt>为什么此刻这样问</dt>
                      <dd>{record.whyNow}</dd>
                    </div>
                    <div>
                      <dt>认知分析</dt>
                      <dd>{analysis?.source === 'ai' ? `真实模型结构化分析 · ${analysis.provider ?? ''}${analysis.model ? ` / ${analysis.model}` : ''}` : analysis ? '本地结构化分析' : '首次介入，无上一轮回答'}</dd>
                    </div>
                    <div>
                      <dt>问题生成</dt>
                      <dd>{record.generationSource === 'ai' ? `真实模型动态生成 · ${record.provider ?? ''}${record.model ? ` / ${record.model}` : ''}` : '本地认知模板备用'}</dd>
                    </div>
                    {record.contextAnchor && (
                      <div>
                        <dt>上下文锚点</dt>
                        <dd>{record.contextAnchor}</dd>
                      </div>
                    )}
                    {questionEvent?.latencyMs != null && (
                      <div>
                        <dt>生成耗时</dt>
                        <dd>{questionEvent.latencyMs} ms</dd>
                      </div>
                    )}
                  </dl>
                </li>
              )
            })}
          </ol>
        )}

        {session.aiEvents.length > 0 && (
          <details className="ai-event-log">
            <summary>模型调用与运行记录</summary>
            <ol>
              {session.aiEvents.map((event) => (
                <li key={event.id}>
                  <div className="ai-event-meta">
                    <span>{event.phase === 'dialogue_decision' ? 'AI 理解、决策与回应' : event.phase === 'response_analysis' ? '认知分析' : event.phase === 'question_generation' ? '问题生成' : event.status === 'fallback' ? (session.dialogueMode === 'local' ? '本地提纲' : '旧版回退') : '调用异常'}</span>
                    <span>{event.provider} · {event.model}</span>
                    {event.latencyMs != null && <span>{event.latencyMs} ms</span>}
                  </div>
                  <p>{event.summary}</p>
                  {event.error && <p className="ai-event-error">{event.error}</p>}
                </li>
              ))}
            </ol>
            <p className="ai-log-note">这里只保存可审计的结构化输出、策略选择和调用状态；不展示或保存模型的隐藏推理。</p>
          </details>
        )}
      </div>
    </details>
  )
}
