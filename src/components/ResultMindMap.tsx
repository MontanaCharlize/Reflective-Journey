import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Download, Focus, Minus, Plus } from 'lucide-react'
import { buildResultMindMap, downloadMindMapPng, downloadMindMapSvg, layoutMindMap } from '../lib/mind-map'
import type { ThinkingSession } from '../lib/types'

export function ResultMindMap({ session }: { session: ThinkingSession }) {
  const map = useMemo(() => buildResultMindMap(session), [session])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState('current')
  const [zoom, setZoom] = useState(1)
  const [camera, setCamera] = useState<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState({ width: 800, height: 520 })
  const [exporting, setExporting] = useState(false), [notice, setNotice] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; scale: number } | null>(null)
  const hintId = useId()
  useEffect(() => {
    const element = host.current
    if (!element) return
    const update = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    update()
    const observer = new ResizeObserver(update);observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const layout = useMemo(() => map ? layoutMindMap(map, collapsed) : null, [map, collapsed])
  if (!map || !layout) return <p className="save-note">确认并保存这次思考的判断后，就可以查看成果导图。</p>
  const fit = Math.min((size.width - 40) / layout.width, (size.height - 40) / layout.height, 1)
  const scale = Math.max(.025, fit * zoom)
  const center = camera || { x: layout.width / 2, y: layout.height / 2 }
  const viewWidth = size.width / scale, viewHeight = size.height / scale
  const active = layout.nodes.find((node) => node.id === selected)
  const reset = () => { setZoom(1);setCamera(null) }
  const toggle = (id: string) => {
    setCollapsed((current) => { const next = new Set(current);if (next.has(id)) next.delete(id);else next.add(id);return next })
    setCamera(null)
  }
  const choose = (id: string) => { setSelected(id);if (collapsed.has(id)) toggle(id) }
  const save = async (format: 'png' | 'svg') => {
    setNotice('');setExporting(true)
    try { if (format === 'svg') downloadMindMapSvg(map);else await downloadMindMapPng(map);setNotice('已导出完整导图，包含所有节点的原文。') }
    catch (error) { setNotice(error instanceof Error ? error.message : '导出失败，请重试。') }
    finally { setExporting(false) }
  }
  return <section className="result-mind-map" aria-label="思考成果导图">
    <div className="mind-map-heading"><div><h2>把这次思考展开看</h2><p>来自你已保存的成果与回看，未填写的内容不生成节点。</p></div><div className="mind-map-download"><button className="text-action" disabled={exporting} onClick={() => void save('png')}><Download size={14} />{exporting ? '正在导出…' : '导出图片'}</button><button className="text-action" disabled={exporting} onClick={() => void save('svg')}>SVG</button></div></div>
    <div className="mind-map-tools" role="group" aria-label="导图视图控制"><button aria-label="缩小导图" onClick={() => setZoom((value) => Math.max(.4, value / 1.3))}><Minus size={16} /></button><output aria-label="相对适应画布的缩放">{Math.round(zoom * 100)}%</output><button aria-label="放大导图" onClick={() => setZoom((value) => Math.min(8, value * 1.3))}><Plus size={16} /></button><button className="mind-map-fit" onClick={reset}><Focus size={15} />适应画布</button><button onClick={() => { setCollapsed(collapsed.size ? new Set() : new Set(layout.nodes.filter((node) => node.id !== map.id).map((node) => node.id)));reset() }}>{collapsed.size ? '展开全部' : '收起内容'}</button></div>
    <div className="mind-map-canvas" ref={host}>
      <svg role="group" tabIndex={0} aria-label="成果思维导图画布" aria-describedby={hintId} viewBox={`${center.x - viewWidth / 2} ${center.y - viewHeight / 2} ${viewWidth} ${viewHeight}`}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[event.key]
          if (delta) { event.preventDefault();setCamera({ x: center.x + delta[0] * 60 / scale, y: center.y + delta[1] * 60 / scale }) }
          if (event.key === 'Home') { event.preventDefault();reset() }
        }}
        onPointerDown={(event) => {
          if ((event.target as Element).closest('[data-mind-node]') || event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId);drag.current = { x: event.clientX, y: event.clientY, cx: center.x, cy: center.y, scale }
        }}
        onPointerMove={(event) => { const start = drag.current;if (start) setCamera({ x: start.cx - (event.clientX - start.x) / start.scale, y: start.cy - (event.clientY - start.y) / start.scale }) }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}>
        {layout.edges.map((edge) => <path key={edge.to} className="mind-map-edge" d={edge.path} />)}
        {layout.nodes.map((node) => <g key={node.id} data-mind-node={node.id} role="button" tabIndex={0} aria-label={`${node.label}：${node.content}`} aria-pressed={selected === node.id} className={'mind-map-node' + (node.id === map.id ? ' root' : node.emphasis ? ' emphasis' : '') + (selected === node.id ? ' selected' : '')} onClick={() => choose(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault();choose(node.id) } }}>
          <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={12} />
          <text className="mind-map-label" x={node.x + 18} y={node.y + 25}>{node.label}{node.collapsed ? '　＋' : ''}</text>
          <text className="mind-map-content" xmlSpace="preserve">{node.lines.map((line, i) => <tspan key={i} x={node.x + 18} y={node.y + 51 + i * 22}>{line}</tspan>)}</text>
        </g>)}
      </svg>
    </div>
    <p className="mind-map-hint" id={hintId}>拖动画布移动，点击节点查看原文。键盘可用方向键移动画布，Home 键复位。</p>
    {active && <div className="mind-map-original" aria-live="polite"><div><span>{active.source}</span>{active.id !== map.id && <button className="text-action" onClick={() => toggle(active.id)}>{active.collapsed ? '展开节点' : '收起节点'}</button>}</div><h3>{active.label}</h3><p>{active.content}</p></div>}
    {notice && <p className="save-note" role="status">{notice}</p>}
  </section>
}
