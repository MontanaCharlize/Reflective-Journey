import { LoaderCircle, Mic, Square } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { emptyVoiceState, VOICE_ACTIVITY, VoiceInputController, voiceSupport } from '../lib/voice-input'
import { getWorkspaceOwner } from '../lib/workspace'

export function VoiceInput({ onText, onActiveChange, disabled = false, label = '语音输入', compact = false }: {
  onText: (text: string) => void; onActiveChange?: (active: boolean) => void; disabled?: boolean; label?: string; compact?: boolean
}) {
  const [state, setState] = useState(emptyVoiceState)
  const support = voiceSupport()
  const id = useId()
  const owner = getWorkspaceOwner()
  const onTextRef = useRef(onText)
  const activeChangeRef = useRef(onActiveChange)
  const disabledRef = useRef(disabled)
  const controller = useRef<VoiceInputController | null>(null)
  onTextRef.current = onText
  activeChangeRef.current = onActiveChange
  disabledRef.current = disabled

  useEffect(() => {
    let alive = true
    const activity = () => document.dispatchEvent(new Event(VOICE_ACTIVITY))
    const input = new VoiceInputController({
      onState: (next) => { if (alive && owner === getWorkspaceOwner()) { setState(next); activeChangeRef.current?.(next.status !== 'idle') } },
      onText: (text) => { if (alive && !disabledRef.current && owner === getWorkspaceOwner()) onTextRef.current(text) },
      onActivity: activity,
    })
    controller.current = input
    setState(emptyVoiceState())
    const visibility = () => { if (document.visibilityState !== 'visible') input.cancel('页面已离开，语音已停止；已确认的文字仍然保留。') }
    const pagehide = () => input.cancel()
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') input.stop() }
    document.addEventListener('visibilitychange', visibility)
    document.addEventListener('keydown', escape)
    window.addEventListener('pagehide', pagehide)
    return () => {
      alive = false; input.dispose(); activeChangeRef.current?.(false); activity()
      if (controller.current === input) controller.current = null
      document.removeEventListener('visibilitychange', visibility)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('pagehide', pagehide)
    }
  }, [owner])

  useEffect(() => { if (disabled) controller.current?.cancel() }, [disabled])
  const active = state.status !== 'idle'
  const waiting = state.status === 'starting' || state.status === 'stopping'
  return <div className={'voice-input' + (compact ? ' voice-input-compact' : '')}>
    <div className="voice-input-toolbar">
      <button type="button" className={'voice-input-button' + (active ? ' is-listening' : '')} disabled={disabled || state.status === 'stopping'} aria-label={active ? '停止' + label : label} aria-pressed={active} aria-describedby={id} onClick={() => active ? controller.current?.stop() : controller.current?.start()}>
        {waiting ? <LoaderCircle size={15} className="spin" /> : active ? <Square size={13} fill="currentColor" /> : <Mic size={15} />}
        {state.status === 'starting' ? '正在开启…' : state.status === 'stopping' ? '正在结束…' : active ? '停止语音' : '语音输入'}
      </button>
      <span className="voice-input-hint">普通话 · 文字可修改</span>
      <details className="voice-input-info"><summary>语音说明</summary><p>由浏览器识别声音，可能发送到浏览器的语音服务进行处理。本应用不保存录音。识别文字先放入草稿，由你决定何时提交。单次最多两分钟，可再次点击继续。</p></details>
    </div>
    <p id={id} className={'voice-input-message' + (state.error ? ' voice-input-error' : '')} role={state.error ? 'alert' : 'status'}>{state.message || (support.supported ? '浏览器识别可能联网处理，文字不会自动提交。' : support.reason)}</p>
    {(active || state.interim) && <div className="voice-input-preview"><span>{active ? '正在识别' : '待确认的片段'}</span><p>{state.interim || (state.status === 'listening' ? '可以开始说话了…' : state.message)}</p>{!active && state.interim && <button type="button" className="text-action" disabled={disabled} onClick={() => controller.current?.acceptInterim()}>采用这段文字</button>}</div>}
  </div>
}
