export const VOICE_ACTIVITY = 'reflective-journey:voice-activity'

interface SpeechResult { isFinal: boolean; [index: number]: { transcript: string } }
interface SpeechResultEvent { results: ArrayLike<SpeechResult> }
export interface BrowserRecognition {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: SpeechResultEvent) => void) | null
  start: () => void; stop: () => void; abort: () => void
}
export interface SpeechHost {
  isSecureContext?: boolean
  SpeechRecognition?: new () => BrowserRecognition
  webkitSpeechRecognition?: new () => BrowserRecognition
}
export interface VoiceState {
  status: 'idle' | 'starting' | 'listening' | 'stopping'
  interim: string
  message: string
  error: boolean
}
export const emptyVoiceState = (): VoiceState => ({ status: 'idle', interim: '', message: '', error: false })
export function voiceSupport(host: SpeechHost = globalThis as SpeechHost) {
  if (host.isSecureContext === false) return { supported: false, reason: '语音输入需要 HTTPS 或本机 localhost 地址。' }
  const supported = Boolean(host.SpeechRecognition || host.webkitSpeechRecognition)
  return { supported, reason: supported ? '' : '此浏览器暂不支持语音识别。可以换用支持语音识别的浏览器，或继续打字。' }
}

// 仅在边界都是西文时补空格，不改写原稿或识别出的语句。
export function appendDictation(existing: string, incoming: string) {
  const text = incoming.trim()
  if (!text) return existing
  if (!existing) return text
  const last = existing.at(-1) || ''
  const first = text[0]
  const gap = /[\p{L}\p{N}]/u.test(last) && /[\p{L}\p{N}]/u.test(first) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(last + first)
  return existing + (gap ? ' ' : '') + text
}

let active: VoiceInputController | null = null
export const isVoiceInputActive = () => active !== null

const errorMessage = (code: string) => ({
  'not-allowed': '麦克风权限未开启。请在浏览器的网站权限中允许麦克风，再点语音输入。',
  'service-not-allowed': '此浏览器的语音识别服务不可用，可以换用其他浏览器或继续打字。',
  'audio-capture': '没有找到可用的麦克风，请检查设备连接或是否被其他应用占用。',
  'network': '语音识别连接失败。请检查网络；浏览器的识别服务也可能暂时不可用。',
  'no-speech': '没有听清声音，可以靠近麦克风再试一次，或继续打字。',
  'language-not-supported': '当前识别服务不支持普通话，可以换用其他浏览器或继续打字。',
  'aborted': '语音已停止，已确认的文字仍在输入框里。',
} as Record<string, string>)[code] || '语音识别暂时失败，已确认的文字仍在输入框里，可以重试或继续打字。'

type Timer = ReturnType<typeof setTimeout>
interface VoiceOptions {
  host?: SpeechHost
  onState: (state: VoiceState) => void
  onText: (text: string) => void
  onActivity?: () => void
  schedule?: (callback: () => void, ms: number) => Timer
  unschedule?: (timer: Timer) => void
}

export class VoiceInputController {
  private state = emptyVoiceState()
  private recognition: BrowserRecognition | null = null
  private timers: Timer[] = []
  private finalIndexes = new Set<number>()
  private receivedText = false
  private readonly host: SpeechHost
  private readonly schedule: NonNullable<VoiceOptions['schedule']>
  private readonly unschedule: NonNullable<VoiceOptions['unschedule']>
  constructor(private readonly options: VoiceOptions) {
    this.host = options.host || globalThis as SpeechHost
    this.schedule = options.schedule || setTimeout
    this.unschedule = options.unschedule || clearTimeout
  }
  private emit(patch: Partial<VoiceState>) {
    this.state = { ...this.state, ...patch }
    this.options.onState({ ...this.state })
    this.options.onActivity?.()
  }
  private clearTimers() { for (const timer of this.timers) this.unschedule(timer); this.timers = [] }
  private detach(abort = true) {
    const recognition = this.recognition
    this.recognition = null
    this.clearTimers()
    if (active === this) active = null
    if (recognition) {
      recognition.onstart = null; recognition.onend = null; recognition.onerror = null; recognition.onresult = null
      if (abort) try { recognition.abort() } catch { /* 已结束的浏览器识别器可能拒绝再次中止。 */ }
    }
  }
  start() {
    if (this.state.status !== 'idle') return
    const support = voiceSupport(this.host)
    if (!support.supported) { this.emit({ message: support.reason, error: true }); return }
    if (active && active !== this) active.cancel('已切换到另一处语音输入，已确认的文字仍然保留。')
    const Constructor = this.host.SpeechRecognition || this.host.webkitSpeechRecognition!
    try {
      const recognition = new Constructor()
      this.recognition = recognition
      this.finalIndexes.clear(); this.receivedText = false
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      const current = () => this.recognition === recognition
      recognition.onstart = () => {
        if (!current()) return
        this.clearTimers()
        this.emit({ status: 'listening', message: '正在听，确认的文字会追加到输入框。', error: false })
        this.timers.push(this.schedule(() => this.stop(), 120000))
      }
      recognition.onresult = (event) => {
        if (!current()) return
        let text = '', interim = ''
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index]
          const transcript = result[0]?.transcript || ''
          if (!result.isFinal) interim = appendDictation(interim, transcript)
          else if (!this.finalIndexes.has(index)) {
            this.finalIndexes.add(index)
            text = appendDictation(text, transcript)
          }
        }
        if (text) { this.receivedText = true; this.options.onText(text) }
        this.emit({ interim })
      }
      recognition.onerror = ({ error }) => {
        if (!current()) return
        this.detach()
        this.emit({ status: 'idle', message: errorMessage(error), error: error !== 'aborted' })
      }
      recognition.onend = () => {
        if (!current()) return
        this.detach(false)
        this.emit({ status: 'idle', message: this.state.interim ? '最后一段尚未确认，可以检查后手动采用。' : this.receivedText ? '语音已结束，文字可修改后再提交。' : '没有识别到文字，可以再试一次或继续打字。' })
      }
      active = this
      this.emit({ status: 'starting', interim: '', message: '正在开启麦克风，请留意浏览器的权限提示。', error: false })
      this.timers.push(this.schedule(() => { this.detach(); this.emit({ status: 'idle', message: '麦克风未能启动，请检查权限后再试。', error: true }) }, 15000))
      recognition.start()
    } catch {
      this.detach()
      this.emit({ status: 'idle', message: '无法开启语音输入，请检查浏览器和麦克风权限后再试。', error: true })
    }
  }
  stop() {
    if (!this.recognition || this.state.status === 'stopping') return
    if (this.state.status === 'starting') { this.cancel(); return }
    const recognition = this.recognition
    this.clearTimers()
    this.emit({ status: 'stopping', message: '正在确认最后一段文字…' })
    this.timers.push(this.schedule(() => {
      this.detach()
      this.emit({ status: 'idle', message: this.state.interim ? '最后一段尚未确认，可以检查后手动采用。' : '语音已停止，已确认的文字仍在输入框里。' })
    }, 3000))
    try { recognition.stop() }
    catch { this.cancel() }
  }
  cancel(message = '语音已停止，已确认的文字仍在输入框里。') {
    const wasActive = this.recognition !== null
    this.detach()
    if (wasActive) this.emit({ status: 'idle', message, error: false })
  }
  acceptInterim() {
    if (this.state.status !== 'idle' || !this.state.interim.trim()) return
    this.options.onText(this.state.interim.trim())
    this.emit({ interim: '', message: '这段文字已放入输入框，请检查后再提交。', error: false })
  }
  dispose() { this.detach() }
}
