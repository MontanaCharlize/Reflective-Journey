import { useEffect, useState } from 'react'
import { Completed } from './components/Completed'
import { Header } from './components/Header'
import { History } from './components/History'
import { Home } from './components/Home'
import { ModelLab } from './components/ModelLab'
import { ThinkingSessionView } from './components/ThinkingSessionView'
import { QuickNotes } from './components/QuickNotes'
import { createSessionSmart } from './lib/ai'
import { deleteSession, loadSessions, saveSession } from './lib/storage'
import type { ThinkingSession } from './lib/types'

type View = 'home' | 'session' | 'history' | 'completed' | 'lab'

function App() {
  const [view, setView] = useState<View>('home')
  const [active, setActive] = useState<ThinkingSession | null>(null)
  const [sessions, setSessions] = useState<ThinkingSession[]>([])
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [storageError, setStorageError] = useState('')

  const refresh = () => {
    try { setSessions(loadSessions()); setStorageError('') }
    catch (error) { setStorageError(error instanceof Error ? error.message : '记录暂时无法读取。') }
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => { window.scrollTo(0, 0) }, [view, active?.id])

  const start = async (question: string, origin?: ThinkingSession, propagateError = false) => {
    if (starting) return
    setStarting(true)
    setStartError('')
    try {
      const session = saveSession(await createSessionSmart(question, {
        ...(origin ? { origin: { sessionId: origin.id, question: origin.question } } : {}),
        onProgress: (base) => { saveSession(base); refresh() },
      }))
      setActive(session)
      refresh()
      setView('session')
    } catch (error) {
      setStartError(error instanceof Error ? error.message : '启动思考失败，请重试。')
      if (propagateError) throw error
    } finally {
      setStarting(false)
    }
  }

  const navigate = (target: 'home' | 'session' | 'history' | 'lab') => {
    if (target === 'session' && !active) return
    setView(target)
  }

  const openSession = (session: ThinkingSession) => {
    setActive(session)
    setView(session.status === 'completed' ? 'completed' : 'session')
  }

  const remove = (id: string) => {
    try {
      deleteSession(id)
      if (active?.id === id) setActive(null)
      refresh()
    } catch (error) { setStorageError(error instanceof Error ? error.message : '删除未能保存。') }
  }

  const origin = sessions.find((session) => session.id === active?.origin?.sessionId)

  return (
    <div className="app-shell">
      <Header view={view === 'completed' ? 'session' : view} onNavigate={navigate} />
      {storageError && <p className="app-error" role="alert">{storageError}</p>}
      {view === 'home' && <Home onStart={start} loading={starting} error={startError} sessions={sessions} onOpen={openSession} />}
      {view === 'session' && active && (
        <ThinkingSessionView
          key={active.id}
          initialSession={active}
          onChange={(session) => { setActive(session); refresh() }}
          onComplete={(session) => { setActive(session); refresh(); setView('completed') }}
          onRestart={() => { void start(active.question) }}
          onPause={() => setView('home')}
          onBranch={(question) => start(question, active, true)}
          onReturnToOrigin={origin ? () => openSession(origin) : undefined}
        />
      )}
      {view === 'lab' && <ModelLab />}
      {view === 'history' && <History sessions={sessions} onOpen={openSession} onDelete={remove} onNew={() => setView('home')} />}
      {view === 'completed' && active && <Completed key={active.id} session={active} onChange={(session) => { setActive(session); refresh() }} onNew={() => setView('home')} onHistory={() => setView('history')} />}
      <QuickNotes />
    </div>
  )
}

export default App
