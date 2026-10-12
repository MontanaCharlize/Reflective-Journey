import { useEffect, useRef, useState } from 'react'
import { createIdleCheckIn, hasOfferedCheckIn, loadCheckInEnabled, markCheckInOffered, recordEditing, rememberCheckIn, saveCheckInEnabled, shouldOfferCheckIn } from '../lib/idle-checkin'
import { appendQuickNote } from '../lib/quick-notes'

export function IdleCheckIn({ questionId, question, enabled, thought, onThoughtChange, onUseThought, onHint, onBranch }: {
  questionId: string
  question: string
  enabled: boolean
  thought: string
  onThoughtChange: (text: string) => void
  onUseThought: (text: string) => void
  onHint: () => void
  onBranch: (text: string) => Promise<void>
}) {
  const [preferred, setPreferred] = useState(loadCheckInEnabled)
  const [show, setShow] = useState(false)
  const [sideOpen, setSideOpen] = useState(false)
  const [branching, setBranching] = useState(false)
  const [error, setError] = useState('')
  const clock = useRef({ ...createIdleCheckIn(questionId, Date.now()), offered: hasOfferedCheckIn(questionId) })
  const composing = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (clock.current.questionId !== questionId) {
      clock.current = { ...createIdleCheckIn(questionId, Date.now()), offered: hasOfferedCheckIn(questionId) }
      setShow(false)
      setSideOpen(false)
    }
    if (!enabled || !preferred || sideOpen) { setShow(false); return }
    clock.current = recordEditing(clock.current, Date.now())
    const activity = (event: Event) => {
      clock.current = recordEditing(clock.current, Date.now())
      // 点选询问中的按钮时保留控件，避免在 click 之前卸载它。
      if (!(event.target instanceof Element && event.target.closest('[data-idle-checkin]'))) setShow(false)
    }
    const visibility = () => { composing.current = false; clock.current = recordEditing(clock.current, Date.now()); setShow(false) }
    const beginComposition = (event: Event) => { composing.current = true; activity(event) }
    const endComposition = (event: Event) => { composing.current = false; activity(event) }
    const check = () => {
      if (shouldOfferCheckIn(clock.current, Date.now(), { enabled: true, visible: document.visibilityState === 'visible', composing: composing.current })) {
        clock.current = markCheckInOffered(clock.current)
        try { rememberCheckIn(questionId) } catch (failure) { setError(failure instanceof Error ? failure.message : '询问记录暂未保存。') }
        setShow(true)
      }
    }
    const timer = window.setInterval(check, 1000)
    for (const type of ['input', 'keydown', 'pointerdown', 'focusin']) document.addEventListener(type, activity, true)
    document.addEventListener('compositionstart', beginComposition, true)
    document.addEventListener('compositionend', endComposition, true)
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', visibility)
    return () => {
      window.clearInterval(timer)
      for (const type of ['input', 'keydown', 'pointerdown', 'focusin']) document.removeEventListener(type, activity, true)
      document.removeEventListener('compositionstart', beginComposition, true)
      document.removeEventListener('compositionend', endComposition, true)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('focus', visibility)
    }
  }, [questionId, enabled, preferred, sideOpen])

  const dismiss = () => { clock.current = markCheckInOffered(clock.current); setShow(false); setSideOpen(false); setError('') }
  const toggle = (value: boolean) => {
    setPreferred(value)
    try { saveCheckInEnabled(value); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '设置暂未保存。') }
  }
  const saveNote = () => {
    try {
      appendQuickNote(thought, question)
      onThoughtChange('')
      dismiss()
    } catch (failure) { setError(failure instanceof Error ? failure.message : '这个想法暂未保存。') }
  }
  const branch = async () => {
    if (thought.trim().length < 4 || branching) return
    setBranching(true)
    setError('')
    try { await onBranch(thought.trim()) }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : '暂时无法打开新的思考方向，想法仍在草稿里。') }
    finally { if (mounted.current) setBranching(false) }
  }

  return <div className="idle-checkin" data-idle-checkin>
    <label className="idle-setting"><input type="checkbox" checked={preferred} onChange={(event) => toggle(event.target.checked)} /><span>停顿时，温和地问问我</span></label>
    {!sideOpen && <button className="text-action idle-resume" onClick={() => setSideOpen(true)}>{thought.trim() ? '接着记刚才的想法' : '先记一个岔开的念头'}</button>}
    {show && !sideOpen && <section className="idle-prompt" aria-label="停顿询问" aria-live="polite">
      <p>这一刻，你的思绪到了哪里？</p>
      <small>没有时间限制。可以继续想，也可以先留下一点此刻的念头。</small>
      <div className="idle-options">
        <button className="text-action" onClick={dismiss}>我还在想，先别打扰</button>
        <button className="text-action" onClick={() => { onHint(); dismiss() }}>卡住了，给点提示</button>
        <button className="text-action" onClick={() => { setSideOpen(true); setShow(false) }}>有了别的想法</button>
      </div>
    </section>}
    {sideOpen && <section className="idle-side-thought" aria-label="此刻的想法">
      <label htmlFor="side-thought">此刻，什么吸引了你的注意？</label>
      <textarea id="side-thought" rows={3} value={thought} disabled={branching} onChange={(event) => onThoughtChange(event.target.value)} placeholder="想到哪就先写到哪，不用急着回到原问题。" />
      <div className="idle-options">
        <button className="secondary-action" disabled={!thought.trim() || branching} onClick={() => { onUseThought(thought.trim()); dismiss() }}>放进回答，接着想</button>
        <button className="text-action" disabled={!thought.trim() || branching} onClick={saveNote}>先放进随手记</button>
        <button className="text-action" disabled={thought.trim().length < 4 || branching} onClick={() => void branch()}>{branching ? '正在打开新方向…' : '沿着这个想法继续'}</button>
        <button className="text-action" disabled={branching} onClick={dismiss}>先回到原问题</button>
      </div>
      <small>新方向会另存一次思考，原问题和草稿仍然保留。</small>
    </section>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>
}
