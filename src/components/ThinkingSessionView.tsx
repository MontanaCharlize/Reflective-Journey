import { Check, CornerDownRight, Lightbulb, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { completePendingResponseSmart, generateFirstQuestionSmart, prepareUserResponse } from '../lib/ai'
import { cognitiveMoveLabel, getQuestionSupport, isReadyToSynthesize } from '../lib/engine'
import { recordSupport, reflectionDraft } from '../lib/reflection'
import { clearDraft, loadDraft, saveDraft, saveSession } from '../lib/storage'
import type { SessionDraft, ThinkingSession } from '../lib/types'
import { ProcessTrail } from './ProcessTrail'
import { IdleCheckIn } from './IdleCheckIn'
import { getWorkspaceOwner } from '../lib/workspace'
import { appendDictation } from '../lib/voice-input'
import { VoiceInput } from './VoiceInput'
import { AiSessionStatus } from './AiSessionStatus'

const guideLabel = { guide: '一个追问', evidence: '值得检查', counterexample: '换一个角度', synthesis: '整理一下' } as const

export function ThinkingSessionView({ initialSession, onChange, onComplete, onRestart, onPause, onBranch, onReturnToOrigin, onOpenCommunitySource, onAccount, onLab }: {
  initialSession: ThinkingSession
  onChange: (session: ThinkingSession) => void
  onComplete: (session: ThinkingSession) => void
  onRestart: () => void
  onPause: () => void
  onBranch: (question: string) => Promise<void>
  onReturnToOrigin?: () => void
  onOpenCommunitySource?: () => void
  onAccount?: () => void
  onLab?: () => void
}) {
  const [session, setSession] = useState(initialSession)
  const [draft, setDraft] = useState(() => loadDraft(initialSession.id))
  const [showFinish, setShowFinish] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [branching, setBranching] = useState(false)
  const [turnError, setTurnError] = useState('')
  const [draftError, setDraftError] = useState('')
  const [dictating, setDictating] = useState(false)
  const draftRef = useRef(draft)
  const request = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const ownerAtMount = useRef(getWorkspaceOwner())
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort() }
  }, [])

  const latest = session.trace.at(-1)
  const userTurns = useMemo(() => session.trace.filter((item) => item.kind === 'user').length, [session.trace])
  const needsFirstQuestion = session.trace.length === 1
  const busy = thinking || branching
  const finishZone = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (showFinish) finishZone.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    else if (userTurns > 0 && latest?.kind !== 'user') document.getElementById('trace-' + latest?.id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [latest?.id, showFinish, userTurns])

  const updateDraft = (next: SessionDraft) => {
    if (ownerAtMount.current !== getWorkspaceOwner()) return
    draftRef.current = next
    setDraft(next)
    try { saveDraft(session.id, next); setDraftError('') }
    catch (error) { setDraftError(error instanceof Error ? error.message : '草稿暂时无法保存。') }
  }
  const edit = (field: keyof SessionDraft, value: string) => updateDraft({ ...draftRef.current, [field]: value })
  const commit = (next: ThinkingSession) => {
    if (ownerAtMount.current !== getWorkspaceOwner()) throw new DOMException('账户已变化，这一轮已暂停。', 'AbortError')
    const saved = saveSession(next)
    setSession(saved)
    onChange(saved)
    return saved
  }

  const processTurn = async (pending: ThinkingSession) => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setThinking(true)
    setTurnError('')
    const options = {
      signal: controller.signal,
      onProgress: (checkpoint: ThinkingSession) => {
        if (mounted.current && !controller.signal.aborted) commit(checkpoint)
      },
    }
    try {
      const next = pending.pendingResponseId
        ? await completePendingResponseSmart(pending, options)
        : await generateFirstQuestionSmart(pending, options)
      if (mounted.current && !controller.signal.aborted) commit(next)
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setTurnError(error instanceof Error ? error.message : '这一轮还未完成，已保存的回答可以继续处理。')
    } finally {
      if (request.current === controller) request.current = null
      if (mounted.current) setThinking(false)
    }
  }

  const continueThinking = () => {
    if (!draft.response.trim() || busy || dictating) return
    try {
      // 先落盘用户原话，刷新、离开或取消请求均可恢复这一轮。
      const pending = commit(prepareUserResponse(session, draft.response))
      updateDraft({ ...draft, response: '' })
      void processTurn(pending)
    } catch (error) { setTurnError(error instanceof Error ? error.message : '回答尚未保存，请保留当前页面。') }
  }

  const help = (kind: 'hint' | 'rephrase') => {
    if (!latest?.move || busy) return
    try {
      const support = getQuestionSupport(latest.move, session)
      commit(recordSupport(session, latest.id, kind, support[kind]))
    } catch (error) { setTurnError(error instanceof Error ? error.message : '提示暂时无法保存。') }
  }

  const openFinish = () => {
    const suggestion = reflectionDraft(session)
    updateDraft({ ...draft, currentJudgment: draft.currentJudgment || suggestion.currentJudgment, openQuestion: draft.openQuestion || suggestion.openQuestion })
    setShowFinish(true)
    setTurnError('')
  }

  const branch = async (question: string) => {
    setBranching(true)
    try { await onBranch(question) }
    finally { if (mounted.current) setBranching(false) }
  }
  const reconnect = () => {
    if (busy) return
    const next = commit({ ...session, dialogueMode: 'ai' })
    void processTurn(next)
  }
  const useLocal = () => {
    if (busy) return
    const next = commit({ ...session, dialogueMode: 'local', aiRuntime: { mode: 'local', status: 'local' } })
    setTurnError('')
    if (next.pendingResponseId || next.trace.length === 1) void processTurn(next)
  }

  const finish = () => {
    if (draft.currentJudgment.trim().length < 2 || busy) return
    if (draft.expectedSignal.trim() && !draft.nextAction.trim()) { setTurnError('先写下准备做的小尝试，再留下想观察的信号。'); return }
    const { pendingResponseId: _pending, ...settled } = session
    const completed: ThinkingSession = {
      ...settled, status: 'completed',
      summary: {
        initialJudgment: reflectionDraft(session).initialJudgment,
        currentJudgment: draft.currentJudgment.trim(), changed: draft.changed.trim(),
        keyDiscovery: draft.keyDiscovery.trim(), openQuestion: draft.openQuestion.trim(),
        keyTurningPoint: draft.keyTurningPoint.trim(),
      },
      ...(draft.nextAction.trim() ? { verification: {
        action: draft.nextAction.trim(), expectedSignal: draft.expectedSignal.trim(),
        status: 'planned' as const, reviews: [],
      } } : {}),
    }
    try {
      const saved = commit(completed)
      try { clearDraft(saved.id) } catch { /* 已确认的成果仍完整保存在 session 中。 */ }
      onComplete(saved)
    } catch (error) { setTurnError(error instanceof Error ? error.message : '成果尚未保存，请保留当前页面。') }
  }

  return (
    <main className="session-shell">
      <section className="session-head">
        {session.communitySource && <p className="source-card-note">接续自 {session.communitySource.authorName} 的思考卡。这里先形成你自己的判断。{onOpenCommunitySource && <button className="text-action" onClick={onOpenCommunitySource}>查看来源 ↗</button>}</p>}
        {onReturnToOrigin && <button className="text-action origin-link" onClick={onReturnToOrigin}>↶ 返回原来的问题</button>}
        <div className="session-meta"><span>{userTurns} 次自己的回答</span><span>·</span><span>记录保存在此浏览器</span></div>
        <h1>{session.question}</h1>
        <p className="diagnosis-note">一句话、一个猜测，或暂时不知道，都可以成为下一步。</p>
      </section>
      <AiSessionStatus session={session} busy={busy} onRetry={reconnect} onLocal={useLocal} onAccount={onAccount} onLab={onLab} />
      <ProcessTrail session={session} />
      <section className="thought-stream" aria-label="思考轨迹">
        {session.trace.slice(1).map((item) => {
          const isUser = item.kind === 'user'
          const planner = session.plannerRecords.find((record) => record.id === item.plannerRecordId)
          const analysis = planner?.sourceResponseId ? session.analyses.find((entry) => entry.responseId === planner.sourceResponseId) : undefined
          const rephrase = session.supportRecords.find((record) => record.questionId === item.id && record.kind === 'rephrase')
          const hint = session.supportRecords.find((record) => record.questionId === item.id && record.kind === 'hint')
          const reflection = item.reflection || analysis?.observations[0]
          return (
            <article key={item.id} id={'trace-' + item.id} className={isUser ? 'trace user-trace' : 'trace guide-trace'}>
              <div className="trace-rail" aria-hidden="true"><span className={isUser ? 'trace-dot user-dot' : 'trace-dot guide-dot'} /></div>
              <div className="trace-body">
                {!isUser && reflection && <div className="turn-feedback"><span>{item.source === 'ai' ? '一起想一想' : '本地提纲整理'}</span><p>{reflection}</p></div>}
                <div className="trace-label">{isUser ? '你的思考' : item.source === 'ai' ? '接下来，可以从这里想' : guideLabel[item.kind as keyof typeof guideLabel] ?? '思考提示'}</div>
                {item.title && !isUser && <h2>{item.title}</h2>}
                <p>{rephrase?.content || item.content}</p>
                {hint && <aside className="support-note"><Lightbulb size={15} /><p>{hint.content}</p></aside>}
                {!isUser && planner && <details className="question-rationale"><summary>为什么现在问这个？</summary><div><span>{cognitiveMoveLabel[planner.chosenMove]}</span><p>{planner.whyNow}</p></div></details>}
              </div>
            </article>
          )
        })}
      </section>

      {!showFinish && <section className="response-zone">
        {session.pendingResponseId || needsFirstQuestion ? (
          <div className="pending-turn" aria-live="polite">
            <p>{session.pendingResponseId ? '你的回答已经保存。' : '你的问题已经保存。'}</p>
            <span>{thinking ? '正在整理这一轮，再生成一个追问……' : '可以继续处理，也可以先停在这里。'}</span>
            <div className="pending-actions">
              {thinking ? <button className="secondary-action" onClick={() => request.current?.abort()}>暂停处理</button>
                : <button className="primary-action" onClick={() => void processTurn(session)}>{needsFirstQuestion ? '生成第一问' : '继续这一轮'} <CornerDownRight size={15} /></button>}
            </div>
          </div>
        ) : <>
          <div className="support-actions">
            <button className="text-action" onClick={() => help('hint')} disabled={busy || session.supportRecords.some((record) => record.questionId === latest?.id && record.kind === 'hint')}><Lightbulb size={14} />给我一点提示</button>
            <button className="text-action" onClick={() => help('rephrase')} disabled={busy || session.supportRecords.some((record) => record.questionId === latest?.id && record.kind === 'rephrase')}>换个问法</button>
          </div>
          <label htmlFor="thinking-response">先留下一点自己的想法</label>
          <textarea id="thinking-response" value={draft.response} disabled={busy} onChange={(event) => edit('response', event.target.value)} placeholder="不用一次想清楚。先写一句也可以。" rows={4} />
          <VoiceInput label="语音输入回答" disabled={busy} onActiveChange={setDictating} onText={(text) => edit('response', appendDictation(draftRef.current.response, text))} />
          <IdleCheckIn key={latest?.id} questionId={latest?.id || ''} question={session.question} enabled={!busy && !showFinish && !session.pendingResponseId && !needsFirstQuestion} thought={draft.sideThought || ''}
            onThoughtChange={(text) => edit('sideThought', text)} onHint={() => help('hint')} onBranch={branch}
            onUseThought={(text) => { updateDraft({ ...draft, sideThought: '', response: draft.response ? `${draft.response}\n${text}` : text }); document.getElementById('thinking-response')?.focus() }} />
          <div className="response-actions">
            <button className="text-action" onClick={onRestart} disabled={busy}><RotateCcw size={14} />重新开始</button>
            <button className="primary-action" onClick={continueThinking} disabled={!draft.response.trim() || busy || dictating}><CornerDownRight size={16} />继续思考</button>
          </div>
        </>}
        <div className="session-exit-actions">
          <button className="text-action" onClick={onPause}>先停在这里</button>
          {isReadyToSynthesize(session) && <button className="secondary-action" onClick={openFinish} disabled={busy || dictating}>整理这次思考</button>}
        </div>
        {turnError && turnError !== session.aiRuntime.lastError && <p className="inline-error" role="alert">{turnError}</p>}
        {draftError && <p className="inline-error" role="alert">{draftError}</p>}
      </section>}

      {showFinish && <section className="finish-zone" ref={finishZone}>
        <p className="eyebrow">留下这一刻，想清楚的部分</p><h2>这次，我带走什么？</h2>
        <p className="finish-intro">当前判断的草稿来自你自己的表达，请确认或修改。结论不变、仍有疑问，都可以保存。</p>
        <label><span>此刻，我的判断是</span><textarea value={draft.currentJudgment} onChange={(event) => edit('currentJudgment', event.target.value)} rows={3} placeholder="也可以写：我暂时无法判断，还需要……" /></label>
        <label><span>这次发现了什么？（可选）</span><textarea value={draft.keyDiscovery} onChange={(event) => edit('keyDiscovery', event.target.value)} rows={2} placeholder="一个条件、一条依据，或一个以前没分清的区别。" /></label>
        <label><span>还有什么没想清楚？（可选）</span><textarea value={draft.openQuestion} onChange={(event) => edit('openQuestion', event.target.value)} rows={2} placeholder="把需要继续核对的地方留下来。" /></label>
        <details className="verification-draft"><summary>留下一个小尝试，下次再回看（可选）</summary><p>如果有一个小尝试值得做，可以留下来。也可以直接保存这次思考。</p>
          <label><span>我准备做的小尝试（可选）</span><textarea value={draft.nextAction} onChange={(event) => edit('nextAction', event.target.value)} rows={2} placeholder="下一次，我会先……" /></label>
          <label><span>我想观察的信号（可选）</span><textarea value={draft.expectedSignal} onChange={(event) => edit('expectedSignal', event.target.value)} rows={2} placeholder="如果出现……，我会重新考虑。" /></label>
        </details>
        <details className="extra-reflection"><summary>再留下一点变化或转折（可选）</summary>
          <label><span>和开始相比，有什么变化？</span><textarea value={draft.changed} onChange={(event) => edit('changed', event.target.value)} rows={2} /></label>
          <label><span>对你有帮助的一次追问</span><textarea value={draft.keyTurningPoint} onChange={(event) => edit('keyTurningPoint', event.target.value)} rows={2} /></label>
        </details>
        {(turnError || draftError) && <p className="inline-error" role="alert">{turnError || draftError}</p>}
        <div className="response-actions"><button className="text-action" onClick={() => setShowFinish(false)}>继续想一会儿</button><button className="primary-action" onClick={finish} disabled={draft.currentJudgment.trim().length < 2}><Check size={16} />确认并保存成果</button></div>
      </section>}
    </main>
  )
}
