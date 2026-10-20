import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'

const { VoiceInputController, appendDictation, voiceSupport, isVoiceInputActive } = await loadTs('src/lib/voice-input.ts')
function fixture({ throws = false, prefixed = false } = {}) {
  const instances = [], states = [], texts = [], timers = new Map()
  let now = 0, nextId = 0
  class FakeRecognition {
    onstart = null; onend = null; onerror = null; onresult = null
    aborted = 0; stopped = 0; started = 0
    constructor() { instances.push(this) }
    start() { this.started++; if (throws) throw new Error('permission or platform error') }
    stop() { this.stopped++ }
    abort() { this.aborted++ }
  }
  const host = { isSecureContext: true, [prefixed ? 'webkitSpeechRecognition' : 'SpeechRecognition']: FakeRecognition }
  const input = new VoiceInputController({
    host, onState: (state) => states.push(state), onText: (text) => texts.push(text),
    schedule: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id },
    unschedule: (id) => timers.delete(id),
  })
  return {
    input, instances, states, texts, host,
    last: () => states.at(-1),
    tick(ms) {
      now += ms
      for (const [id, timer] of [...timers]) if (timers.has(id) && timer.at <= now) { timers.delete(id); timer.fn() }
    },
    start() { input.start(); const speech = instances.at(-1); speech.onstart?.(); return speech },
  }
}
const result = (transcript, isFinal) => ({ 0: { transcript }, isFinal })
const emit = (speech, ...results) => speech.onresult?.({ results })

test('语音按能力与安全来源检测，不会在检测时开启麦克风', () => {
  assert.equal(voiceSupport({}).supported, false)
  assert.match(voiceSupport({ isSecureContext: false, SpeechRecognition: class {} }).reason, /HTTPS/)
  const f = fixture({ prefixed: true })
  assert.equal(voiceSupport(f.host).supported, true)
  assert.equal(f.instances.length, 0)
  const speech = f.start()
  assert.equal(speech.lang, 'zh-CN')
  assert.equal(speech.interimResults, true)
  f.input.dispose()
})

test('口述追加保留原稿和换行，中英文边界合理连接', () => {
  assert.equal(appendDictation('我原来写的：', '  这是新想法  '), '我原来写的：这是新想法')
  assert.equal(appendDictation('一个问题\n', '继续想'), '一个问题\n继续想')
  assert.equal(appendDictation('I think', 'this matters.'), 'I think this matters.')
  assert.equal(appendDictation('Hello', ', world'), 'Hello, world')
  assert.equal(appendDictation('原稿', '  '), '原稿')
})

test('临时识别可以替换和缩短，只追加新增的最终结果且不会重复', () => {
  const f = fixture(), speech = f.start()
  emit(speech, result('我还没想', false))
  emit(speech, result('我还没想清楚', false))
  assert.deepEqual(f.texts, [])
  assert.equal(f.last().interim, '我还没想清楚')
  emit(speech, result('我还没想清楚。', true), result('另一种可能', false))
  emit(speech, result('我还没想清楚。', true), result('另一种', false))
  assert.deepEqual(f.texts, ['我还没想清楚。'])
  assert.equal(f.last().interim, '另一种')
  emit(speech, result('我还没想清楚。', true))
  assert.equal(f.last().interim, '')
  emit(speech, result('我还没想清楚。', true), result('另一种可能。', true))
  assert.deepEqual(f.texts, ['我还没想清楚。', '另一种可能。'])
  f.input.dispose()
})

test('刻意重复的一句话在不同结果位置仍然保留，不能按文字内容去重', () => {
  const f = fixture(), speech = f.start()
  emit(speech, result('再想想。', true))
  emit(speech, result('再想想。', true), result('再想想。', true))
  assert.deepEqual(f.texts, ['再想想。', '再想想。'])
  f.input.dispose()
})

test('停止后仍接收最后的确认结果，结束后迟到事件不能再次写入', () => {
  const f = fixture(), speech = f.start()
  emit(speech, result('前半段。', true), result('后半', false))
  f.input.stop()
  assert.equal(speech.stopped, 1)
  assert.equal(f.last().status, 'stopping')
  emit(speech, result('前半段。', true), result('后半段。', true))
  const late = speech.onresult
  speech.onend()
  late({ results: [result('迟到的文字', true)] })
  assert.deepEqual(f.texts, ['前半段。', '后半段。'])
  assert.equal(f.last().status, 'idle')
  assert.equal(isVoiceInputActive(), false)
})

test('权限拒绝或网络失败恢复为可重试状态，不覆盖此前识别结果', () => {
  const f = fixture(), speech = f.start()
  emit(speech, result('已经留下的文字。', true))
  speech.onerror({ error: 'not-allowed' })
  assert.match(f.last().message, /权限/)
  assert.equal(isVoiceInputActive(), false)
  const retry = f.start()
  retry.onerror({ error: 'network' })
  assert.match(f.last().message, /连接失败/)
  assert.deepEqual(f.texts, ['已经留下的文字。'])
  f.input.dispose()
})

test('开启异常或权限提示超时会释放识别状态，不一直占用麦克风入口', () => {
  const failed = fixture({ throws: true })
  failed.input.start()
  assert.equal(failed.last().status, 'idle')
  assert.equal(isVoiceInputActive(), false)
  const pending = fixture()
  pending.input.start(); pending.tick(15000)
  assert.equal(pending.last().status, 'idle')
  assert.equal(pending.instances[0].aborted, 1)
  failed.input.dispose(); pending.input.dispose()
})

test('同一时刻只有一处语音输入，切换到笔记时旧输入不再接收结果', () => {
  const first = fixture(), second = fixture()
  const oldSpeech = first.start(), late = oldSpeech.onresult
  second.start()
  late({ results: [result('不能放入原输入框', true)] })
  assert.equal(oldSpeech.aborted, 1)
  assert.deepEqual(first.texts, [])
  assert.equal(first.last().status, 'idle')
  assert.equal(second.last().status, 'listening')
  first.input.dispose(); second.input.dispose()
})

test('页面离开或组件销毁后，中止识别并忽略迟到回调', () => {
  const f = fixture(), speech = f.start(), late = speech.onresult, lateStart = speech.onstart
  f.input.dispose()
  lateStart(); late({ results: [result('已换账户的文字', true)] })
  assert.deepEqual(f.texts, [])
  assert.equal(speech.aborted, 1)
  assert.equal(isVoiceInputActive(), false)
})

test('识别器未确认的片段需要主动采用，采用一次不会重复插入', () => {
  const f = fixture(), speech = f.start()
  emit(speech, result('还没确认的片段', false))
  speech.onend()
  assert.deepEqual(f.texts, [])
  assert.equal(f.last().interim, '还没确认的片段')
  f.input.acceptInterim(); f.input.acceptInterim()
  assert.deepEqual(f.texts, ['还没确认的片段'])
  f.input.dispose()
})

test('最长两分钟后停止，浏览器不发结束事件时仍能释放并保留待确认片段', () => {
  const f = fixture(), speech = f.start()
  emit(speech, result('最后几个字', false))
  f.tick(120000)
  assert.equal(speech.stopped, 1)
  f.tick(3000)
  assert.equal(f.last().status, 'idle')
  assert.equal(isVoiceInputActive(), false)
  assert.equal(speech.aborted, 1)
  f.input.acceptInterim()
  assert.deepEqual(f.texts, ['最后几个字'])
  f.input.dispose()
})
