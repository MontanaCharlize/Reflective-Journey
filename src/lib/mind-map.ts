import type { ThinkingSession } from './types'

export interface MindMapNode {
  id: string
  label: string
  content: string
  source: string
  side?: -1 | 1
  emphasis?: boolean
  children: MindMapNode[]
}
export interface PositionedMindNode extends MindMapNode { x: number; y: number; width: number; height: number; lines: string[]; collapsed: boolean }
export interface MindMapLayout { nodes: PositionedMindNode[]; edges: Array<{ from: string; to: string; path: string }>; width: number; height: number }

/** Only confirmed results enter the map. Never derive conclusions from raw chat, notes or model analysis. */
export function buildResultMindMap(session: ThinkingSession): MindMapNode | null {
  if (session.status !== 'completed' || !session.summary?.currentJudgment?.trim()) return null
  const children: MindMapNode[] = []
  const add = (id: string, label: string, content: string | undefined, side: -1 | 1, source: string, emphasis = false) => {
    if (!content?.trim()) return
    children.push({ id, label, content: content.trim(), source, side, emphasis, children: [] })
  }
  const summary = session.summary
  add('initial', '开始时的想法', summary.initialJudgment, -1, '已保存成果 · 初始想法')
  add('changed', '想法的变化', summary.changed, -1, '已保存成果 · 变化')
  add('turning', '关键转折', summary.keyTurningPoint, -1, '已保存成果 · 转折')
  add('current', '现在的判断', summary.currentJudgment, 1, '已保存成果 · 当前判断', true)
  add('discovery', '确认的发现', summary.keyDiscovery, 1, '已保存成果 · 收获')
  add('open', '还没想清楚', summary.openQuestion, 1, '已保存成果 · 待弄清的问题')
  const plan = session.verification
  if (plan?.action.trim()) {
    const next: MindMapNode = { id: 'action', label: '下一步尝试', content: plan.action.trim(), source: '已保存的验证计划', side: 1, children: [] }
    if (plan.expectedSignal?.trim()) next.children.push({ id: 'signal', label: '想观察什么', content: plan.expectedSignal.trim(), source: '验证计划 · 预期信号', children: [] })
    plan.reviews.forEach((review, i) => {
      if (!review.outcome.trim()) return
      const node: MindMapNode = { id: `review-${i}`, label: `第 ${i + 1} 次回看`, content: review.outcome.trim(), source: '已保存的实际观察', children: [] }
      if (review.revisedJudgment?.trim()) node.children.push({ id: `revision-${i}`, label: '回看后的判断', content: review.revisedJudgment.trim(), source: '回看记录 · 修订判断', children: [] })
      next.children.push(node)
    })
    children.push(next)
  }
  return { id: 'question', label: '这次思考的问题', content: session.question, source: '原问题', emphasis: true, children }
}

export function wrapMindMapText(value: string, maxWidth = 224, maxLines = Infinity): string[] {
  const lines: string[] = []
  for (const paragraph of value.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '', width = 0
    for (const char of Array.from(paragraph)) {
      const size = /[\u0000-\u007f]/.test(char) ? 7.9 : 15
      if (line && width + size > maxWidth) { lines.push(line); line = ''; width = 0 }
      line += char; width += size
    }
    lines.push(line)
  }
  if (lines.length <= maxLines) return lines
  return [...lines.slice(0, maxLines - 1), lines[maxLines - 1].slice(0, -1) + '…']
}

export function layoutMindMap(root: MindMapNode, collapsed = new Set<string>(), fullText = false): MindMapLayout {
  const nodes: PositionedMindNode[] = [], edges: MindMapLayout['edges'] = []
  const sizes = new Map<string, { height: number; treeHeight: number; lines: string[] }>()
  const childrenOf = (node: MindMapNode) => collapsed.has(node.id) ? [] : node.children
  const measure = (node: MindMapNode): number => {
    const lines = collapsed.has(node.id) ? [] : wrapMindMapText(node.content, 224, fullText ? Infinity : 7)
    const height = Math.max(58, 52 + lines.length * 22)
    const kids = childrenOf(node)
    const total = kids.reduce((sum, item) => sum + measure(item), 0) + Math.max(0, kids.length - 1) * 26
    sizes.set(node.id, { height, treeHeight: Math.max(height, total), lines })
    return Math.max(height, total)
  }
  root.children.forEach(measure)
  const left = root.children.filter((node) => node.side === -1), right = root.children.filter((node) => node.side !== -1)
  const sideHeight = (items: MindMapNode[]) => items.reduce((sum, item) => sum + sizes.get(item.id)!.treeHeight, 0) + Math.max(0, items.length - 1) * 26
  const rootLines = wrapMindMapText(root.content, 224, fullText ? Infinity : 7), rootHeight = 52 + rootLines.length * 22
  const height = Math.max(rootHeight, sideHeight(left), sideHeight(right)) + 96
  nodes.push({ ...root, x: 0, y: (height - rootHeight) / 2, width: 260, height: rootHeight, lines: rootLines, collapsed: false })
  const place = (node: MindMapNode, x: number, top: number, side: -1 | 1, parent: string) => {
    const size = sizes.get(node.id)!
    nodes.push({ ...node, x, y: top + (size.treeHeight - size.height) / 2, width: 260, height: size.height, lines: size.lines, collapsed: collapsed.has(node.id) })
    edges.push({ from: parent, to: node.id, path: '' })
    const kids = childrenOf(node), kidsHeight = sideHeight(kids)
    let childTop = top + (size.treeHeight - kidsHeight) / 2
    kids.forEach((child) => { place(child, x + side * 340, childTop, side, node.id); childTop += sizes.get(child.id)!.treeHeight + 26 })
  }
  for (const [items, side] of [[left, -1], [right, 1]] as const) {
    let top = (height - sideHeight(items)) / 2
    items.forEach((node) => { place(node, side * 340, top, side, root.id); top += sizes.get(node.id)!.treeHeight + 26 })
  }
  const minX = Math.min(...nodes.map((node) => node.x)) - 48
  nodes.forEach((node) => { node.x -= minX })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  edges.forEach((edge) => {
    const from = byId.get(edge.from)!, to = byId.get(edge.to)!, forward = to.x > from.x
    const x1 = forward ? from.x + from.width : from.x, x2 = forward ? to.x : to.x + to.width
    const y1 = from.y + from.height / 2, y2 = to.y + to.height / 2, mid = (x1 + x2) / 2
    edge.path = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
  })
  return { nodes, edges, width: Math.max(...nodes.map((node) => node.x + node.width)) + 48, height }
}

const xml = (text: string) => text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '\ufffd').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]!))
export function resultMindMapSvg(root: MindMapNode): string {
  // Export always expands every node and uses the full text, independently of the on-screen view.
  const layout = layoutMindMap(root, new Set(), true)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}"><title>${xml(root.content)} · 思考成果导图</title><desc>仅由已保存成果和验证回看生成，节点保持原文。</desc><rect width="100%" height="100%" fill="#f7f6f2"/><g font-family="Microsoft YaHei, PingFang SC, sans-serif">${layout.edges.map((edge) => `<path d="${edge.path}" fill="none" stroke="#b5beb3" stroke-width="2"/>`).join('')}${layout.nodes.map((node) => {
    const center = node.id === root.id, fill = center ? '#2c3e35' : node.emphasis ? '#eaeee9' : '#ffffff', color = center ? '#ffffff' : '#242824'
    return `<g><title>${xml(node.label + '\n' + node.content)}</title><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" fill="${fill}" stroke="${center ? '#2c3e35' : '#d8ddd5'}"/><text x="${node.x + 18}" y="${node.y + 25}" font-size="12" fill="${center ? '#dbe6db' : '#627060'}">${xml(node.label)}</text><text xml:space="preserve" fill="${color}" font-size="15">${node.lines.map((line, i) => `<tspan x="${node.x + 18}" y="${node.y + 51 + i * 22}">${xml(line)}</tspan>`).join('')}</text></g>`
  }).join('')}</g></svg>`
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = name; link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const fileName = (root: MindMapNode) => '思考导图_' + root.content.slice(0, 28).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
export function downloadMindMapSvg(root: MindMapNode) { download(new Blob([resultMindMapSvg(root)], { type: 'image/svg+xml;charset=utf-8' }), fileName(root) + '.svg') }
export async function downloadMindMapPng(root: MindMapNode) {
  const layout = layoutMindMap(root, new Set(), true)
  const scale = Math.min(2, 6000 / layout.width, 6000 / layout.height, Math.sqrt(16000000 / (layout.width * layout.height)))
  if (scale < .35) throw new Error('内容较长，请导出 SVG 保留清晰的完整文字。')
  await document.fonts.ready
  const url = URL.createObjectURL(new Blob([resultMindMapSvg(root)], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('图片生成失败，可以改用 SVG 导出。')); img.src = url })
    const canvas = document.createElement('canvas');canvas.width = Math.ceil(layout.width * scale);canvas.height = Math.ceil(layout.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('浏览器暂不支持图片导出，可以使用 SVG。')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('图片生成失败，可以改用 SVG 导出。')
    download(blob, fileName(root) + '.png')
  } finally { URL.revokeObjectURL(url) }
}
