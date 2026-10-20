export type CommunitySection = 'discover' | 'bookmarks' | 'shares' | 'notifications' | 'feedback'
export function CommunityNav({ active, onNavigate }: { active: string; onNavigate: (view: CommunitySection) => void }) {
  const entries: [CommunitySection, string][] = [['discover', '发现思考'], ['bookmarks', '我的收藏'], ['shares', '我的分享'], ['notifications', '接续提醒'], ['feedback', '我的反馈']]
  return <nav className="community-nav" aria-label="社区导航">{entries.map(([view, title]) => <button key={view} type="button" aria-current={view === active ? 'page' : undefined} onClick={() => onNavigate(view)}>{title}</button>)}</nav>
}
