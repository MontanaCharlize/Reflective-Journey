import { ArrowLeft, FlaskConical, History } from 'lucide-react'

type View = 'home' | 'session' | 'history' | 'lab'

export function Header({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  return (
    <header className="site-header">
      <button className="brand" onClick={() => onNavigate('home')} aria-label="返回首页">
        <span className="brand-mark" aria-hidden="true">↗</span>
        <span>反思之旅</span>
      </button>
      <div className="header-actions">
        {view !== 'home' && (
          <button className="quiet-button" onClick={() => onNavigate('home')}>
            <ArrowLeft size={16} />
            返回提问
          </button>
        )}
        <button className="quiet-button" onClick={() => onNavigate('history')}>
          <History size={16} />
          我的思考
        </button>
        <button className="quiet-button developer-only" onClick={() => onNavigate('lab')}>
          <FlaskConical size={16} />
          模型
        </button>
      </div>
    </header>
  )
}
