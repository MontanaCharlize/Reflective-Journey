import { Bell, Compass, History, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import type { AccountUser } from '../lib/community-types'

type View = 'home' | 'history' | 'discover' | 'account' | 'lab' | 'notifications'

type Theme = 'light' | 'dark'

function initialTheme(): Theme {
  const stored = document.documentElement.dataset.theme
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function Header({ view, onNavigate, user, unread = 0 }: { view: string; onNavigate: (view: View) => void; user: AccountUser | null; unread?: number }) {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('rj-theme', next) } catch { /* 隐私模式下忽略 */ }
  }
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNavigate('home')} aria-label="返回首页">
        <span className="brand-seal" aria-hidden="true">思</span>
        <span>反思之旅</span>
      </button>
      <div className="header-actions">
        <nav className="header-actions" aria-label="主导航">
          <button className="quiet-button" aria-label="发现" title="发现" aria-current={view === 'discover' ? 'page' : undefined} onClick={() => onNavigate('discover')}><Compass className="mobile-nav-icon" size={16} aria-hidden="true" /><span className="desktop-nav-label">发现</span></button>
          <button className="quiet-button" aria-label="我的思考" title="我的思考" aria-current={view === 'history' ? 'page' : undefined} onClick={() => onNavigate('history')}><History className="mobile-nav-icon" size={16} aria-hidden="true" /><span className="desktop-nav-label">我的思考</span></button>
          <button className="quiet-button" aria-current={view === 'account' ? 'page' : undefined} onClick={() => onNavigate('account')}><span className="account-label">{user?.displayName || '账户'}</span></button>
        </nav>
        {user && <button className="icon-button notification-bell" aria-label={'接续提醒' + (unread ? `，${unread} 条未读` : '')} onClick={() => onNavigate('notifications')}><Bell size={16} />{unread > 0 && <span>{unread > 99 ? '99+' : unread}</span>}</button>}
        <button className="icon-button" onClick={toggleTheme} aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </header>
  )
}
