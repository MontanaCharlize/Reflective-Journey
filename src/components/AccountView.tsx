import { useState } from 'react'
import type { FormEvent } from 'react'
import { loginAccount, logoutAccount, registerAccount } from '../lib/community'
import type { AccountUser, AiLimits } from '../lib/community-types'
import { importGuestSessions, loadSessions } from '../lib/storage'
import { ProfileSettings } from './ProfileSettings'

export function AccountView({ user, limits, requiresInvite, onSignedIn, onSignedOut, onImported, onShares, onLab, onProfileSaved, onPublic, onBookmarks, onNotifications, onFeedback, onModeration }: {
  user: AccountUser | null; limits: AiLimits | null
  requiresInvite: boolean
  onSignedIn: (user: AccountUser, limits: AiLimits, unread: number) => void
  onSignedOut: () => void; onImported: () => void; onShares: () => void
  onLab?: () => void
  onProfileSaved: (user: AccountUser) => void; onPublic: () => void; onBookmarks: () => void; onNotifications: () => void; onFeedback: () => void; onModeration: () => void
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = mode === 'register' ? await registerAccount({ username, displayName, password, ...(requiresInvite ? { inviteCode } : {}) }) : await loginAccount({ username, password })
      setPassword(''); onSignedIn(result.user, result.limits, result.unreadNotifications || 0)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法登录。') }
    finally { setBusy(false) }
  }
  const logout = async () => {
    setBusy(true); setError('')
    try { await logoutAccount(); onSignedOut() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法退出。') }
    finally { setBusy(false) }
  }
  const bringIn = () => {
    try { const n = importGuestSessions(selected); setNotice(`已带入 ${n} 条思考，访客原记录保留。`); setSelected([]); onImported() }
    catch (failure) { setError(failure instanceof Error ? failure.message : '记录尚未带入。') }
  }
  let guest: ReturnType<typeof loadSessions> = []
  let readError = ''
  try {
    const own = user ? new Set(loadSessions().map((session) => session.id)) : new Set<string>()
    guest = user ? loadSessions(null).filter((session) => !own.has(session.id)) : []
  } catch (failure) { readError = failure instanceof Error ? failure.message : '访客记录暂时无法读取。' }
  return <main className="account-shell">
    <div className="account-head">
      <p className="eyebrow">保留自己的思考，也可以选择分享</p>
      <h1>{user ? user.displayName : '进入我的账户'}</h1>
      {user
        ? <p className="account-intro">账号：{user.username}。个人思考按账户保存在此浏览器，公开思考卡在服务端保存。</p>
        : <p className="account-intro">登录后可使用已配置的模型，并选择公开自己的思考成果。访客也能先用本地流程思考。</p>}
    </div>
    {user ? <>
      {limits && <p className="account-quota" style={{ textAlign: 'center' }}>今日模型调用剩余 {limits.remaining} / {limits.dailyLimit} 次 · {new Date(limits.resetsAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 重置</p>}
      <div className="account-actions" style={{ justifyContent: 'center' }}><button className="primary-action" onClick={onShares}>查看我的分享</button><button className="text-action" disabled={busy} onClick={() => void logout()}>退出登录</button></div>
      <nav className="account-community-links" aria-label="我的社区"><button onClick={onBookmarks}>我的收藏</button><button onClick={onNotifications}>接续提醒</button><button onClick={onFeedback}>我的反馈</button>{user.canModerate && <button onClick={onModeration}>社区内容处理</button>}</nav>
      <ProfileSettings user={user} onSaved={onProfileSaved} onPublic={onPublic} />
      {guest.length > 0 && <section className="guest-import"><h2>此浏览器还有访客记录</h2><p>选择想带入当前账户的思考及回答草稿。随手记单独保留，访客原记录也会保留。</p>
        <div className="guest-import-list">{guest.map((session) => <label key={session.id}><input type="checkbox" checked={selected.includes(session.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, session.id] : selected.filter((id) => id !== session.id))} /><span>{session.question}</span></label>)}</div>
        <button className="secondary-action" disabled={!selected.length} onClick={bringIn}>带入选中的 {selected.length} 条记录</button>
      </section>}
    </> : <>
      <div className="account-card">
        <div className="account-tabs"><button aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError('') }}>登录</button><button aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError('') }}>创建账户</button></div>
      <form onSubmit={(event) => void submit(event)} className="account-form">
        <label htmlFor="account-name">账号</label><input id="account-name" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} placeholder="字母、数字、下划线或短横线" />
        {mode === 'register' && <><label htmlFor="display-name">展示名称</label><input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={30} placeholder="分享时，别人会看到这个名称" /></>}
        {mode === 'register' && requiresInvite && <><label htmlFor="invite-code">邀请码</label><input id="invite-code" value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} required autoComplete="off" /></>}
        <label htmlFor="account-password">密码</label><input id="account-password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={mode === 'register' ? 12 : 1} maxLength={128} placeholder={mode === 'register' ? '至少 12 个字符' : '填写你的密码'} />
        <button className="primary-action" disabled={busy} type="submit">{busy ? '正在处理…' : mode === 'register' ? '创建并进入账户' : '登录账户'}</button>
      </form>
      </div>
      <p className="workspace-note" style={{ marginTop: 28 }}>暂不登录？访客也能直接使用本地流程思考。</p>
    </>}
    {(error || readError) && <p className="inline-error" role="alert">{error || readError}</p>}{notice && <p className="save-note" role="status">{notice}</p>}
    {onLab && <p className="account-quota" style={{ marginTop: 48, textAlign: 'center' }}><button className="text-action" onClick={onLab}>模型与接口</button></p>}
  </main>
}
