import { ArrowUpRight, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getAiStatus } from '../lib/ai'
import type { AiStatus } from '../lib/ai'
import { returnPrompt } from '../lib/reflection'
import type { ThinkingSession } from '../lib/types'
import { appendDictation } from '../lib/voice-input'
import { VoiceInput } from './VoiceInput'

export function Home({
  onStart,
  loading = false,
  error = '',
  sessions,
  onOpen,
  onLab,
}: {
  onStart: (question: string, mode: 'ai' | 'local') => void | Promise<void>
  loading?: boolean
  error?: string
  sessions: ThinkingSession[]
  onOpen: (session: ThinkingSession) => void
  onLab?: () => void
}) {
  const [question, setQuestion] = useState('')
  const [dictating, setDictating] = useState(false)
  const [mode, setMode] = useState<'ai' | 'local'>('ai')
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null)
  useEffect(() => { let alive = true; getAiStatus().then((status) => { if (alive) setAiStatus(status) }); return () => { alive = false } }, [])
  const ongoing = sessions.find((session) => session.status === 'active')
  const toReview = sessions.filter((session) => session.verification?.status === 'planned').slice(0, 2)

  const submit = () => {
    const value = question.trim()
    if (value.length < 4 || loading || dictating) return
    void onStart(value, mode)
  }

  return (
    <main className="home-shell">
      <section className="question-stage">
        <p className="eyebrow">从一个真实的问题开始</p>
        <h1>今天，你在想什么？</h1>
        <div className="thinking-mode"><label htmlFor="thinking-mode">这次怎样一起想</label><select id="thinking-mode" value={mode} disabled={loading || dictating} onChange={(event) => setMode(event.target.value as 'ai' | 'local')}><option value="ai">AI 共同思考</option><option value="local">本地提纲（不调用 AI）</option></select><span>{mode === 'local' ? '仅提供本地辅助，不会声称模型参与。' : !aiStatus ? '正在读取模型配置…' : aiStatus.access?.loginRequired ? '当前网站需登录后使用模型。' : aiStatus.providers.length ? `模型已配置：${aiStatus.providers.find((provider) => provider.id === aiStatus.activeProvider)?.label || aiStatus.activeProvider} · 回应时再核验实际连接。` : '当前没有可用模型，先检查连接。'}</span>{onLab && <button className="text-action" onClick={onLab}>模型连接</button>}</div>
        {(toReview[0] || ongoing) && <button className="return-shortcut" disabled={loading} onClick={() => onOpen(toReview[0] || ongoing!)}>{toReview[0] ? '回看上次的小尝试' : '接着上次的思考'} <ArrowUpRight size={15} /></button>}
        <div className="question-composer">
          <textarea
            aria-label="你的问题"
            autoFocus
            value={question}
            disabled={loading}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') submit()
            }}
            placeholder="写下一个问题、困惑，或者一件你还没有想明白的事……"
            rows={5}
          />
          <VoiceInput label="语音输入问题" disabled={loading} onActiveChange={setDictating} onText={(text) => setQuestion((current) => appendDictation(current, text))} />
          <div className="composer-footer">
            <span>{loading ? '问题已保存，正在生成第一问……' : ''}</span>
            <button className="primary-action" onClick={submit} disabled={question.trim().length < 4 || loading || dictating}>
              {loading
                ? <><LoaderCircle size={17} className="spin" />正在理解</>
                : <>开始思考<kbd className="kbd">⌘↵</kbd></>}
            </button>
          </div>
        </div>
        {error && <p className="inline-error">{error}</p>}
        {dictating && <p className="keyboard-hint">先停止语音，检查文字后再开始思考。</p>}
        <div className="entry-prompts" aria-label="找一个自己的问题">
          <span>可以从这里想起</span>
          {['我有一个选择拿不准', '我想弄清一个观点', '我想复盘一件事'].map((prompt) => <button className="text-action" key={prompt} disabled={loading || dictating} onClick={() => setQuestion(prompt + '：')}>{prompt}</button>)}
        </div>
        {(ongoing || toReview.length > 0) && <section className="return-section"><p className="eyebrow">之前的想法，还在这里</p>
          {ongoing && <button className="return-row" onClick={() => onOpen(ongoing)} disabled={loading}><span className="return-kicker">继续上次的思考</span><strong>{ongoing.question}</strong><span>{returnPrompt(ongoing)}</span><ArrowUpRight size={17} /></button>}
          {toReview.map((session) => <button className="return-row" key={session.id} onClick={() => onOpen(session)} disabled={loading}><span className="return-kicker">有一件事，值得回来看看</span><strong>{session.question}</strong><span>{returnPrompt(session)}</span><ArrowUpRight size={17} /></button>)}
        </section>}
      </section>
    </main>
  )
}
