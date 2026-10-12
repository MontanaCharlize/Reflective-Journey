import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadTs, memoryStorage } from './load-ts.mjs'

const notes = await loadTs('src/lib/quick-notes.ts')
const idle = await loadTs('src/lib/idle-checkin.ts')
const viewport = { width: 1280, height: 800 }
beforeEach(() => {
  globalThis.localStorage = memoryStorage()
  globalThis.window = { innerWidth: 1280, innerHeight: 800, dispatchEvent: () => true }
})

test('随手记默认收起，打开、文字及窗口状态可完整恢复', () => {
  const initial = notes.loadQuickNote(viewport)
  assert.equal(initial.open, false)
  const written = { ...initial, open: true, text: '随手留下\n还没有整理的念头', updatedAt: 100, layout: { x: 32, y: 48, width: 400, height: 300 } }
  notes.saveQuickNote(written)
  assert.deepEqual(notes.loadQuickNote(viewport), written)
  notes.saveQuickNote({ ...written, open: false })
  assert.equal(notes.loadQuickNote(viewport).text, written.text)
})

test('桌面窗口缩到手机宽度时，笔记可读且拖动和尺寸保持在屏幕内', () => {
  const note = notes.defaultQuickNote(viewport)
  notes.saveQuickNote({ ...note, text: '重要的笔记', layout: { x: 1100, y: 700, width: 900, height: 600 } })
  const restored = notes.loadQuickNote({ width: 320, height: 480 })
  assert.equal(restored.text, '重要的笔记')
  assert.ok(restored.layout.x >= 8 && restored.layout.y >= 8)
  assert.ok(restored.layout.x + restored.layout.width <= 312)
  assert.ok(restored.layout.y + restored.layout.height <= 472)
})

test('坏 JSON 与无效几何数据不会让笔记窗口丢到屏幕外', () => {
  localStorage.setItem('reflective-journey/v0.5/quick-note', '{bad')
  assert.equal(notes.loadQuickNote(viewport).open, false)
  localStorage.setItem('reflective-journey/v0.5/quick-note', JSON.stringify({ text: '保留这行', open: true, layout: { x: -10000, y: 99999, width: null, height: -20 } }))
  const restored = notes.loadQuickNote(viewport)
  assert.equal(restored.text, '保留这行')
  assert.equal(restored.layout.x, 8)
  assert.ok(restored.layout.height >= 220)
  assert.ok(restored.layout.y + restored.layout.height <= 792)
})

test('岔开的念头追加到随手记，保留既有笔记与原会话', () => {
  const initial = { ...notes.defaultQuickNote(viewport), text: '原来的笔记' }
  notes.saveQuickNote(initial)
  localStorage.setItem('reflective-journey/v0.5/sessions', '原会话数据')
  notes.appendQuickNote('此刻的新念头', '最初的问题')
  const next = notes.loadQuickNote(viewport)
  assert.match(next.text, /原来的笔记\n\n【最初的问题】\n此刻的新念头/)
  assert.equal(next.open, true)
  assert.equal(localStorage.getItem('reflective-journey/v0.5/sessions'), '原会话数据')
})

test('笔记保存失败会明确报告，已保存的内容保持不变', () => {
  notes.saveQuickNote({ ...notes.defaultQuickNote(viewport), text: '已经保存的内容' })
  localStorage.setItem = () => { throw new Error('quota') }
  assert.throws(() => notes.saveQuickNote({ ...notes.defaultQuickNote(viewport), text: '新内容' }), /暂时无法保存/)
  assert.equal(notes.loadQuickNote(viewport).text, '已经保存的内容')
})

test('90 秒停顿才满足询问条件，输入和笔记编辑会重新计时', () => {
  const conditions = { enabled: true, visible: true, composing: false }
  let state = idle.createIdleCheckIn('q1', 0)
  assert.equal(idle.shouldOfferCheckIn(state, 89999, conditions), false)
  assert.equal(idle.shouldOfferCheckIn(state, 90000, conditions), true)
  state = idle.recordEditing(state, 80000)
  assert.equal(idle.shouldOfferCheckIn(state, 120000, conditions), false)
  assert.equal(idle.shouldOfferCheckIn(state, 170000, conditions), true)
})

test('页面隐藏、正在拼音输入或功能关闭时不询问', () => {
  const state = idle.createIdleCheckIn('q1', 0)
  assert.equal(idle.shouldOfferCheckIn(state, 300000, { enabled: true, visible: false, composing: false }), false)
  assert.equal(idle.shouldOfferCheckIn(state, 300000, { enabled: true, visible: true, composing: true }), false)
  assert.equal(idle.shouldOfferCheckIn(state, 300000, { enabled: false, visible: true, composing: false }), false)
})

test('询问一次后不因更多等待或编辑再次弹出，下一题可重新询问', () => {
  const conditions = { enabled: true, visible: true, composing: false }
  const offered = idle.recordEditing(idle.markCheckInOffered(idle.createIdleCheckIn('q1', 0)), 100000)
  assert.equal(idle.shouldOfferCheckIn(offered, 999999, conditions), false)
  assert.equal(idle.shouldOfferCheckIn(idle.createIdleCheckIn('q2', 0), 90000, conditions), true)
})

test('关闭设置及近期已询问的问题会跨刷新保留', () => {
  assert.equal(idle.loadCheckInEnabled(), true)
  idle.saveCheckInEnabled(false)
  assert.equal(idle.loadCheckInEnabled(), false)
  idle.rememberCheckIn('q1')
  idle.rememberCheckIn('q1')
  assert.equal(idle.hasOfferedCheckIn('q1'), true)
  assert.equal(idle.hasOfferedCheckIn('q2'), false)
  assert.equal(JSON.parse(localStorage.getItem('reflective-journey/v0.5/idle-checkin-offered')).length, 1)
})
