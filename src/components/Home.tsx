import { ArrowUpRight, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { returnPrompt } from '../lib/reflection'
import type { ThinkingSession } from '../lib/types'

export function Home({
  onStart,
  loading = false,
  error = '',
  sessions,
  onOpen,
}: {
  onStart: (question: string) => void | Promise<void>
  loading?: boolean
  error?: string
  sessions: ThinkingSession[]
  onOpen: (session: ThinkingSession) => void
}) {
  const [question, setQuestion] = useState('')
  const ongoing = sessions.find((session) => session.status === 'active')
  const toReview = sessions.filter((session) => session.verification?.status === 'planned').slice(0, 2)

  const submit = () => {
    const value = question.trim()
    if (value.length < 4 || loading) return
    void onStart(value)
  }

  return (
    <main className="home-shell">
      <section className="question-stage">
        <p className="eyebrow">从一个真实的问题开始</p>
        <h1>今天，你在想什么？</h1>
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
          <div className="composer-footer">
            <span>{loading ? '问题已保存，正在生成第一问……' : '先想清楚一点。随时可以停下来，之后再继续。'}</span>
            <button className="primary-action" onClick={submit} disabled={question.trim().length < 4 || loading}>
              {loading ? <LoaderCircle size={17} className="spin" /> : <ArrowUpRight size={17} />}
              {loading ? '正在理解' : '开始思考'}
            </button>
          </div>
        </div>
        {error && <p className="inline-error">{error}</p>}
        <p className="keyboard-hint">⌘ / Ctrl + Enter 也可以开始</p>
        <div className="entry-prompts" aria-label="找一个自己的问题">
          <span>可以从这里想起</span>
          {['我有一个选择拿不准', '我想弄清一个观点', '我想复盘一件事'].map((prompt) => <button className="text-action" key={prompt} disabled={loading} onClick={() => setQuestion(prompt + '：')}>{prompt}</button>)}
        </div>
        {(ongoing || toReview.length > 0) && <section className="return-section"><p className="eyebrow">之前的想法，还在这里</p>
          {ongoing && <button className="return-row" onClick={() => onOpen(ongoing)} disabled={loading}><span className="return-kicker">继续上次的思考</span><strong>{ongoing.question}</strong><span>{returnPrompt(ongoing)}</span><ArrowUpRight size={17} /></button>}
          {toReview.map((session) => <button className="return-row" key={session.id} onClick={() => onOpen(session)} disabled={loading}><span className="return-kicker">有一件事，值得回来看看</span><strong>{session.question}</strong><span>{returnPrompt(session)}</span><ArrowUpRight size={17} /></button>)}
        </section>}
      </section>
    </main>
  )
}
