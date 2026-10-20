import { useEffect, useRef, useState } from 'react'
import { Completed } from './components/Completed'
import { Header } from './components/Header'
import { History } from './components/History'
import { Home } from './components/Home'
import { ModelLab } from './components/ModelLab'
import { ThinkingSessionView } from './components/ThinkingSessionView'
import { QuickNotes } from './components/QuickNotes'
import { AccountView } from './components/AccountView'
import { CommunityView } from './components/CommunityView'
import { ThoughtCardView } from './components/ThoughtCardView'
import { ShareDialog } from './components/ShareDialog'
import { AuthorView } from './components/AuthorView'
import { NotificationsView } from './components/NotificationsView'
import { FeedbackView } from './components/FeedbackView'
import { createSessionSmart } from './lib/ai'
import { getAccount } from './lib/community'
import type { AccountUser, AiLimits, ThoughtCard } from './lib/community-types'
import { readRoute, routeHash } from './lib/navigation'
import type { AppView } from './lib/navigation'
import { deleteSession, loadSessions, saveSession } from './lib/storage'
import { getWorkspaceOwner, setWorkspaceOwner } from './lib/workspace'
import type { ThinkingSession } from './lib/types'
import { rememberPublishedCard } from './lib/community-links'

interface StartOptions {
  dialogueMode?: 'ai' | 'local'
  origin?: ThinkingSession
  communitySource?: ThinkingSession['communitySource']
  propagateError?: boolean
}

function App() {
  const initial = readRoute(window.location.hash)
  const [view, setView] = useState<AppView>(initial.view)
  const [cardId, setCardId] = useState<string | null>(initial.cardId)
  const [active, setActive] = useState<ThinkingSession | null>(null)
  const [sessions, setSessions] = useState<ThinkingSession[]>([])
  const [user, setUser] = useState<AccountUser | null>(null)
  const [limits, setLimits] = useState<AiLimits | null>(null)
  const [ready, setReady] = useState(false)
  const [requiresInvite, setRequiresInvite] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [storageError, setStorageError] = useState('')
  const [serviceError, setServiceError] = useState('')
  const [sharing, setSharing] = useState(false)
  const [unread, setUnread] = useState(0)
  const activeRef = useRef(active)
  const userRef = useRef(user)
  const readyRef = useRef(ready)
  const epoch = useRef(0)
  const startRequest = useRef<AbortController | null>(null)
  activeRef.current = active
  userRef.current = user
  readyRef.current = ready

  const refresh = () => {
    try { setSessions(loadSessions()); setStorageError('') }
    catch (error) { setStorageError(error instanceof Error ? error.message : '记录暂时无法读取。') }
  }
  const go = (target: AppView, selectedCard?: string) => {
    if (target !== 'session' && startRequest.current) {
      startRequest.current.abort(); startRequest.current = null; setStarting(false)
    }
    setView(target)
    if (selectedCard) setCardId(selectedCard)
    const hash = routeHash(target, selectedCard || cardId)
    if (window.location.hash !== hash) window.location.hash = hash
  }
  const applyAccount = (nextUser: AccountUser | null, nextLimits: AiLimits | null, returnHome = true) => {
    epoch.current++
    startRequest.current?.abort()
    startRequest.current = null
    setStarting(false)
    setSharing(false)
    activeRef.current = null
    setActive(null)
    userRef.current = nextUser
    setWorkspaceOwner(nextUser?.id || null)
    setUser(nextUser)
    setUnread(0)
    setLimits(nextLimits)
    refresh()
    if (returnHome) go('home')
  }

  useEffect(() => {
    let alive = true
    getAccount().then((result) => {
      if (!alive) return
      applyAccount(result.user, result.limits, false)
      setUnread(result.unreadNotifications || 0)
      setRequiresInvite(Boolean(result.registrationRequiresInvite))
      setReady(true)
    }).catch(() => {
      if (!alive) return
      applyAccount(null, null, false)
      setServiceError('账户服务暂时不可用，可以先保留本机思考，稍后再登录或分享。')
      setReady(true)
    })
    return () => { alive = false; startRequest.current?.abort() }
  }, [])

  useEffect(() => {
    let alive = true
    const check = async () => {
      if (!readyRef.current || document.visibilityState !== 'visible') return
      const at = epoch.current
      try {
        const result = await getAccount()
        if (!alive || at !== epoch.current) return
        setRequiresInvite(Boolean(result.registrationRequiresInvite))
        if ((result.user?.id || null) !== (userRef.current?.id || null) || getWorkspaceOwner() !== (result.user?.id || null)) applyAccount(result.user, result.limits)
        else { setLimits(result.limits); setUser(result.user); setServiceError('') }
        setUnread(result.unreadNotifications || 0)
      } catch { /* 网络中断时保留当前本机工作区。服务端仍校验每次写操作。 */ }
    }
    if (view === 'account') void check()
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { alive = false; window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [view, ready])

  useEffect(() => {
    if (!user?.id) return
    let alive = true
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const at = epoch.current
      getAccount().then((result) => {
        if (!alive || at !== epoch.current) return
        if (result.user?.id !== userRef.current?.id) applyAccount(result.user, result.limits)
        else { setUser(result.user); setLimits(result.limits) }
        setUnread(result.unreadNotifications || 0)
      }).catch(() => { /* 暂时离线时保留当前页面。 */ })
    }, 45000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [user?.id])

  useEffect(() => {
    const changed = () => {
      const route = readRoute(window.location.hash)
      if ((route.view === 'session' || route.view === 'completed') && !activeRef.current) setView('home')
      else setView(route.view)
      setCardId(route.cardId)
      setSharing(false)
    }
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])

  useEffect(() => { window.scrollTo(0, 0) }, [view, active?.id, cardId])

  const start = async (question: string, options: StartOptions = {}) => {
    if (starting || !ready) return
    setStarting(true); setStartError('')
    const controller = new AbortController()
    const owner = getWorkspaceOwner()
    startRequest.current = controller
    let checkpoint: ThinkingSession | null = null
    try {
      const next = await createSessionSmart(question, {
        signal: controller.signal,
        dialogueMode: options.dialogueMode || 'ai',
        ...(options.origin ? { origin: { sessionId: options.origin.id, question: options.origin.question } } : {}),
        ...(options.communitySource ? { communitySource: options.communitySource } : {}),
        onProgress: (base) => {
          if (controller.signal.aborted || getWorkspaceOwner() !== owner) return
          checkpoint = saveSession(base); refresh()
        },
      })
      if (controller.signal.aborted || getWorkspaceOwner() !== owner) return
      const session = saveSession(next)
      activeRef.current = session
      setActive(session)
      refresh()
      go('session')
    } catch (error) {
      if (controller.signal.aborted) return
      setStartError(error instanceof Error ? error.message : '启动思考失败，请重试。')
      if (checkpoint && getWorkspaceOwner() === owner) { activeRef.current = checkpoint; setActive(checkpoint); refresh(); go('session') }
      if (options.propagateError) throw error
    } finally {
      if (startRequest.current === controller) { startRequest.current = null; setStarting(false) }
    }
  }
  const openSession = (session: ThinkingSession) => {
    activeRef.current = session
    setActive(session)
    go(session.status === 'completed' ? 'completed' : 'session')
  }
  const remove = (id: string) => {
    try {
      deleteSession(id)
      if (active?.id === id) { activeRef.current = null; setActive(null) }
      refresh()
    } catch (error) { setStorageError(error instanceof Error ? error.message : '删除未能保存。') }
  }
  const fromCard = (card: ThoughtCard, dialogueMode: 'ai' | 'local') => start(card.question, {
    dialogueMode,
    communitySource: { cardId: card.id, question: card.question, authorName: card.author.displayName },
    propagateError: true,
  })
  const origin = sessions.find((session) => session.id === active?.origin?.sessionId)
  const navigate = (target: AppView) => go(target)
  const openAuthor = (id: string) => go('author', id)
  const published = (card: ThoughtCard) => {
    const current = activeRef.current
    if (current) {
      try {
        const updated = saveSession(rememberPublishedCard(current, card))
        activeRef.current = updated;setActive(updated);refresh()
      } catch { setStorageError('卡片已经发布，但本机暂时无法保存回看链接，可以从“我的分享”打开。') }
    }
    setSharing(false);go('card', card.id)
  }

  return (
    <div className="app-shell">
      <Header view={view} onNavigate={navigate} user={user} unread={unread} />
      {storageError && <p className="app-error" role="alert">{storageError}</p>}
      {serviceError && <p className="app-error" role="status">{serviceError}</p>}
      {!ready ? <main className="account-shell"><p role="status">正在打开你的工作区…</p></main> : <>
        {view === 'home' && <><Home key={'home:' + (user?.id || 'guest')} onStart={(question, mode) => start(question, { dialogueMode: mode })} onLab={() => go('lab')} loading={starting} error={startError} sessions={sessions} onOpen={openSession} /><div className="workspace-note">{user ? <>当前工作区：{user.displayName}</> : <>个人记录先保存在此浏览器，<button className="text-action" onClick={() => go('account')}>登录后管理与分享</button></>}</div></>}
        {view === 'session' && active && <ThinkingSessionView
          key={'thinking:' + (user?.id || 'guest') + ':' + active.id}
          initialSession={active}
          onChange={(session) => { activeRef.current = session; setActive(session); refresh() }}
          onComplete={(session) => { activeRef.current = session; setActive(session); refresh(); go('completed') }}
          onRestart={() => { void start(active.question, { communitySource: active.communitySource, dialogueMode: active.dialogueMode }) }}
          onPause={() => go('home')}
          onBranch={(question) => start(question, { origin: active, communitySource: active.communitySource, propagateError: true, dialogueMode: active.dialogueMode })}
          onAccount={() => go('account')}
          onLab={() => go('lab')}
          onReturnToOrigin={origin ? () => openSession(origin) : undefined}
          onOpenCommunitySource={active.communitySource ? () => go('card', active.communitySource!.cardId) : undefined}
        />}
        {(view === 'session' || view === 'completed') && !active && <Home key={'home:' + (user?.id || 'guest')} onStart={(question, mode) => start(question, { dialogueMode: mode })} onLab={() => go('lab')} loading={starting} error={startError} sessions={sessions} onOpen={openSession} />}
        {view === 'lab' && <ModelLab />}
        {view === 'history' && <History sessions={sessions} onOpen={openSession} onDelete={remove} onNew={() => go('home')} onOpenCard={(id) => go('card', id)} />}
        {view === 'completed' && active && <Completed key={'completed:' + (user?.id || 'guest') + ':' + active.id} session={active} onChange={(session) => { activeRef.current = session; setActive(session); refresh() }} onNew={() => go('home')} onHistory={() => go('history')} onShare={() => user ? setSharing(true) : go('account')} onOpenCard={(id) => go('card', id)} />}
        {view === 'account' && <AccountView key={'account:' + (user?.id || 'guest')} user={user} limits={limits} requiresInvite={requiresInvite} onSignedIn={(next, quota, count) => { setServiceError(''); applyAccount(next, quota, false); setUnread(count); go('account') }} onSignedOut={() => applyAccount(null, null)} onImported={refresh} onShares={() => go('shares')} onLab={() => go('lab')} onProfileSaved={(next) => { userRef.current = next; setUser(next) }} onPublic={() => user && openAuthor(user.id)} onBookmarks={() => go('bookmarks')} onNotifications={() => go('notifications')} onFeedback={() => go('feedback')} onModeration={() => go('moderation')} />}
        {(view === 'discover' || view === 'shares' || view === 'bookmarks') && <CommunityView key={'community:' + view + ':' + (user?.id || 'guest')} mode={view} signedIn={Boolean(user)} onOpen={(id) => go('card', id)} onAuthor={openAuthor} onNew={() => go('home')} onAccount={() => go('account')} onNavigate={navigate} />}
        {view === 'card' && cardId && <ThoughtCardView key={'card:' + cardId + ':' + (user?.id || 'guest')} id={cardId} user={user} onOpen={(id) => go('card', id)} onAuthor={openAuthor} onStart={fromCard} onDiscover={() => go('discover')} onAccount={() => go('account')} onNavigate={navigate} />}
        {view === 'author' && cardId && <AuthorView key={'author:' + cardId + ':' + (user?.id || 'guest')} id={cardId} viewerId={user?.id || null} onOpen={(id) => go('card', id)} onAuthor={openAuthor} onAccount={() => go('account')} onNavigate={navigate} />}
        {view === 'notifications' && <NotificationsView key={'notifications:' + (user?.id || 'guest')} signedIn={Boolean(user)} onOpen={(id) => go('card', id)} onAccount={() => go('account')} onUnread={setUnread} onNavigate={navigate} />}
        {(view === 'feedback' || view === 'moderation') && <FeedbackView key={'feedback:' + view + ':' + (user?.id || 'guest')} moderate={view === 'moderation'} signedIn={Boolean(user)} canModerate={Boolean(user?.canModerate)} onOpen={(id) => go('card', id)} onAccount={() => go('account')} onNavigate={navigate} />}
        {sharing && active && user && <ShareDialog key={'share:' + user.id + ':' + active.id} session={active} authorName={user.displayName} onClose={() => setSharing(false)} onPublished={published} />}
        <QuickNotes key={'notes:' + (user?.id || 'guest')} />
      </>}
    </div>
  )
}

export default App
