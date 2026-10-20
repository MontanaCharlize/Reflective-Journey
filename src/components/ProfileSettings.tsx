import { useEffect, useRef, useState } from 'react'
import { getAuthor, updateProfile } from '../lib/community'
import type { AccountUser } from '../lib/community-types'

export function ProfileSettings({ user, onSaved, onPublic }: { user: AccountUser; onSaved: (user: AccountUser) => void; onPublic: () => void }) {
  const [name, setName] = useState(user.displayName), [bio, setBio] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const alive = useRef(true)
  const [loaded, setLoaded] = useState(false), [attempt, setAttempt] = useState(0)
  useEffect(() => {
    alive.current = true; setLoading(true); setLoaded(false); setError('')
    getAuthor(user.id).then(({ profile }) => { if (alive.current) { setName(profile.displayName); setBio(profile.bio); setLoaded(true) } }).catch((failure) => { if (alive.current) setError(failure instanceof Error ? failure.message : '资料暂时无法读取。') }).finally(() => { if (alive.current) setLoading(false) })
    return () => { alive.current = false }
  }, [user.id, attempt])
  const save = async () => {
    if (busy || loading || !loaded) return
    setBusy(true); setError(''); setNotice('')
    try { const result = await updateProfile(name, bio); if (alive.current) { onSaved(result.user); setNotice('公开资料已保存。') } }
    catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : '资料尚未保存。') }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className="profile-settings"><div className="section-heading"><h2>我的公开资料</h2><button className="text-action" onClick={onPublic}>查看公开主页 ↗</button></div><p>别人只会看到展示名称、简介和你主动公开的思考卡。</p>
    <label htmlFor="profile-name">展示名称</label><input id="profile-name" value={name} maxLength={30} disabled={loading || busy} onChange={(event) => setName(event.target.value)} />
    <label htmlFor="profile-bio">个人简介（可选）</label><textarea id="profile-bio" value={bio} maxLength={240} rows={3} disabled={loading || busy} onChange={(event) => setBio(event.target.value)} placeholder="也可以留白。写下你愿意让别人了解的部分。" />
    <button className="secondary-action" disabled={loading || busy || !loaded || !name.trim()} onClick={() => void save()}>{loading ? '正在读取…' : busy ? '正在保存…' : '保存公开资料'}</button>{error && <><p className="inline-error" role="alert">{error}</p>{!loaded && <button className="text-action" onClick={() => setAttempt((value) => value + 1)}>重新读取公开资料</button>}</>}{notice && <p className="save-note" role="status">{notice}</p>}
  </section>
}
