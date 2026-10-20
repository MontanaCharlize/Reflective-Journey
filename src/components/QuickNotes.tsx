import { Download, GripHorizontal, Maximize2, Minimize2, StickyNote, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { fitNoteLayout, loadQuickNote, NOTES_CHANGED, NOTES_OPEN, noteViewport, saveQuickNote } from '../lib/quick-notes'
import type { NoteLayout, QuickNote } from '../lib/quick-notes'
import { workspaceKey } from '../lib/workspace'
import { appendDictation } from '../lib/voice-input'
import { VoiceInput } from './VoiceInput'

interface Interaction { kind: 'move' | 'resize'; pointerId: number; startX: number; startY: number; layout: NoteLayout; target: HTMLElement }

export function QuickNotes() {
  const [note, setNote] = useState(() => loadQuickNote(noteViewport()))
  const [error, setError] = useState('')
  const [maximized, setMaximized] = useState(false)
  const current = useRef(note)
  const interaction = useRef<Interaction | null>(null)
  const previousLayout = useRef<NoteLayout | null>(null)
  const editor = useRef<HTMLTextAreaElement | null>(null)

  const update = (next: QuickNote, persist = true) => {
    current.current = next
    setNote(next)
    if (!persist) return
    try { saveQuickNote(next); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : '笔记暂未保存。') }
  }

  useEffect(() => {
    const refresh = () => {
      const next = loadQuickNote(noteViewport())
      current.current = next
      setNote(next)
      setError('')
    }
    const open = () => { update({ ...current.current, open: true }); editor.current?.focus() }
    const fit = () => update({ ...current.current, layout: fitNoteLayout(current.current.layout, noteViewport()) })
    const fromOtherTab = (event: StorageEvent) => {
      if (event.key === workspaceKey('quick-note')) refresh()
    }
    window.addEventListener(NOTES_CHANGED, refresh)
    window.addEventListener(NOTES_OPEN, open)
    window.addEventListener('storage', fromOtherTab)
    window.addEventListener('resize', fit)
    window.visualViewport?.addEventListener('resize', fit)
    return () => {
      window.removeEventListener(NOTES_CHANGED, refresh)
      window.removeEventListener(NOTES_OPEN, open)
      window.removeEventListener('storage', fromOtherTab)
      window.removeEventListener('resize', fit)
      window.visualViewport?.removeEventListener('resize', fit)
    }
  }, [])

  useEffect(() => {
    if (!note.open) return
    const frame = window.requestAnimationFrame(() => editor.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [note.open])

  const begin = (event: PointerEvent<HTMLElement>, kind: Interaction['kind']) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    interaction.current = { kind, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, layout: current.current.layout, target: event.currentTarget }
    setMaximized(false)
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const drag = interaction.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    const layout = drag.kind === 'move'
      ? { ...drag.layout, x: drag.layout.x + dx, y: drag.layout.y + dy }
      : { ...drag.layout, width: drag.layout.width + dx, height: drag.layout.height + dy }
    update({ ...current.current, layout: fitNoteLayout(layout, noteViewport()) }, false)
  }
  const end = (event: PointerEvent<HTMLElement>) => {
    const drag = interaction.current
    if (!drag || event.pointerId !== drag.pointerId) return
    interaction.current = null
    if (drag.target.hasPointerCapture(drag.pointerId)) drag.target.releasePointerCapture(drag.pointerId)
    update(current.current)
  }
  const keyboard = (event: KeyboardEvent<HTMLElement>, kind: Interaction['kind']) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const step = event.shiftKey ? 48 : 16
    const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0
    const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0
    const layout = current.current.layout
    update({ ...current.current, layout: fitNoteLayout(kind === 'move' ? { ...layout, x: layout.x + dx, y: layout.y + dy } : { ...layout, width: layout.width + dx, height: layout.height + dy }, noteViewport()) })
    setMaximized(false)
  }
  const toggleSize = () => {
    if (maximized && previousLayout.current) update({ ...current.current, layout: fitNoteLayout(previousLayout.current, noteViewport()) })
    else {
      previousLayout.current = current.current.layout
      const viewport = noteViewport()
      update({ ...current.current, layout: fitNoteLayout({ x: 8, y: 8, width: viewport.width - 16, height: viewport.height - 16 }, viewport) })
    }
    setMaximized(!maximized)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([current.current.text], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = '反思之旅_随手记.txt'
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  return <>
    {!note.open && <button className="quick-note-launcher" onClick={() => update({ ...current.current, open: true })}><StickyNote size={17} />随手记{note.text && <span aria-label="已有笔记">·</span>}</button>}
    {note.open && <aside className="quick-note" aria-label="随手记" style={{ left: note.layout.x, top: note.layout.y, width: note.layout.width, height: note.layout.height }} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className="quick-note-header">
        <button className="quick-note-grip" aria-label="拖动随手记，可用方向键移动" onPointerDown={(event) => begin(event, 'move')} onKeyDown={(event) => keyboard(event, 'move')}><GripHorizontal size={16} /><span>随手记</span></button>
        <button className="quick-note-icon" aria-label={maximized ? '恢复随手记大小' : '展开随手记'} onClick={toggleSize}>{maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button className="quick-note-icon" aria-label="收起随手记" onClick={() => update({ ...current.current, open: false })}><X size={16} /></button>
      </div>
      <textarea ref={editor} aria-label="随手记内容" value={note.text} placeholder="一个念头、几个关键词，先随手留下来……" onChange={(event) => update({ ...current.current, text: event.target.value, updatedAt: Date.now() })} />
      <VoiceInput compact label="语音输入随手记" onText={(text) => update({ ...current.current, text: appendDictation(current.current.text, text), updatedAt: Date.now() })} />
      <div className="quick-note-footer"><span role="status">{error ? '暂未保存' : '已保存在此浏览器'}</span><button className="text-action" disabled={!note.text} onClick={download}><Download size={13} />导出</button></div>
      {error && <p className="quick-note-error" role="alert">{error}</p>}
      <button className="quick-note-resize" aria-label="调整随手记大小，可用方向键缩放" onPointerDown={(event) => begin(event, 'resize')} onKeyDown={(event) => keyboard(event, 'resize')} />
    </aside>}
  </>
}
