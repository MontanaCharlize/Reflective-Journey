import { workspaceKey } from './workspace'

export interface NoteLayout { x: number; y: number; width: number; height: number }
export interface NoteViewport { width: number; height: number }
export interface QuickNote { text: string; open: boolean; layout: NoteLayout; updatedAt: number }

export const NOTES_CHANGED = 'reflective-journey:notes-changed'
export const NOTES_OPEN = 'reflective-journey:notes-open'
const finite = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function fitNoteLayout(layout: NoteLayout, viewport: NoteViewport): NoteLayout {
  const maxWidth = Math.max(1, viewport.width - 16)
  const maxHeight = Math.max(1, viewport.height - 16)
  const width = Math.min(maxWidth, Math.max(Math.min(240, maxWidth), finite(layout.width, 340)))
  const height = Math.min(maxHeight, Math.max(Math.min(220, maxHeight), finite(layout.height, 360)))
  return {
    width, height,
    x: Math.max(8, Math.min(finite(layout.x, 8), Math.max(8, viewport.width - width - 8))),
    y: Math.max(8, Math.min(finite(layout.y, 8), Math.max(8, viewport.height - height - 8))),
  }
}

export function defaultQuickNote(viewport: NoteViewport): QuickNote {
  const layout = fitNoteLayout({ x: viewport.width - 364, y: viewport.height - 440, width: 340, height: 360 }, viewport)
  return { text: '', open: false, layout, updatedAt: 0 }
}

export function noteViewport(): NoteViewport {
  return { width: window.visualViewport?.width || window.innerWidth, height: window.visualViewport?.height || window.innerHeight }
}

export function loadQuickNote(viewport: NoteViewport): QuickNote {
  const fallback = defaultQuickNote(viewport)
  try {
    const raw = JSON.parse(localStorage.getItem(workspaceKey('quick-note')) || 'null')
    if (!raw || typeof raw !== 'object') return fallback
    return {
      text: typeof raw.text === 'string' ? raw.text : '',
      open: raw.open === true,
      updatedAt: finite(raw.updatedAt, 0),
      layout: fitNoteLayout({ ...fallback.layout, ...(raw.layout && typeof raw.layout === 'object' ? raw.layout : {}) }, viewport),
    }
  } catch { return fallback }
}

export function saveQuickNote(note: QuickNote) {
  try { localStorage.setItem(workspaceKey('quick-note'), JSON.stringify(note)) }
  catch { throw new Error('随手记暂时无法保存，请保留当前页面或先导出笔记。') }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(NOTES_CHANGED))
}

export function openQuickNote() {
  window.dispatchEvent(new Event(NOTES_OPEN))
}

export function appendQuickNote(text: string, context = '') {
  if (!text.trim()) return
  const note = loadQuickNote(noteViewport())
  const addition = [context ? `【${context}】` : '', text.trim()].filter(Boolean).join('\n')
  saveQuickNote({ ...note, open: true, text: note.text ? `${note.text}\n\n${addition}` : addition, updatedAt: Date.now() })
}
