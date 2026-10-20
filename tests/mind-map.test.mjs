import test from 'node:test'
import assert from 'node:assert/strict'
import { loadTs } from './load-ts.mjs'
const engine = await loadTs('src/lib/engine.ts')
const { buildResultMindMap, layoutMindMap, resultMindMapSvg } = await loadTs('src/lib/mind-map.ts')
const fixture = () => ({ ...engine.createSessionBase('周末如何安排摄影活动？'), status: 'completed', summary: { currentJudgment: '只参加上午，下午休息。', changed: '' } })
const flatten = (node) => [node, ...node.children.flatMap(flatten)]

test('导图只接收已确认成果，不从原始对话、模型推测或私密笔记补结论', () => {
  const session = fixture()
  session.trace.push({ id: 'u-private', kind: 'user', content: 'PRIVATE_RAW_TRACE' })
  session.cognitiveState.assumptions = ['PRIVATE_MODEL_GUESS']
  session.notes = 'PRIVATE_QUICK_NOTE'
  const map = buildResultMindMap(session)
  assert.deepEqual(flatten(map).map((node) => node.id), ['question', 'current'])
  assert.equal(map.children[0].content, session.summary.currentJudgment)
  assert.doesNotMatch(JSON.stringify(map), /PRIVATE_/)
  assert.equal(buildResultMindMap({ ...session, status: 'active' }), null)
  assert.equal(buildResultMindMap({ ...session, summary: undefined }), null)
  assert.equal(buildResultMindMap({ ...session, summary: {} }), null)
})

test('未填写的变化、疑问和计划不生成节点，也不伪造已想清楚或已有收获', () => {
  const session = fixture()
  session.summary.openQuestion = '  '
  const nodes = flatten(buildResultMindMap(session))
  assert.deepEqual(nodes.map((node) => node.id), ['question', 'current'])
  assert.equal(session.summary.changed, '')
})

test('初始判断、当前判断及多次回看各自保留，修订不覆盖已保存成果', () => {
  const session = fixture()
  session.summary.initialJudgment = '原本打算参加全天。'
  session.verification = { action: '先核对活动时间。', expectedSignal: '上午是否有独立拍摄环节。', status: 'reviewed', reviews: [{ id: 'r1', createdAt: 1, outcome: '上午有独立环节。', revisedJudgment: '保持只参加上午的安排。' }, { id: 'r2', createdAt: 2, outcome: '试过之后下午休息更充分。' }] }
  const before = JSON.stringify(session), nodes = flatten(buildResultMindMap(session))
  for (const content of [session.summary.initialJudgment, session.summary.currentJudgment, session.verification.expectedSignal, ...session.verification.reviews.map((review) => review.outcome), session.verification.reviews[0].revisedJudgment]) assert.ok(nodes.some((node) => node.content === content))
  assert.equal(JSON.stringify(session), before)
})

test('长文本与深层回看的布局不重叠、不越界，折叠不影响完整原文导出', () => {
  const session = fixture()
  session.summary.keyDiscovery = '这是一段较长的确认文字。'.repeat(200) + '原文末尾标记'
  session.verification = { action: '核对时段。', status: 'reviewed', reviews: Array.from({ length: 4 }, (_, i) => ({ id: 'r' + i, outcome: '这次实际观察到的内容。', revisedJudgment: '本次重新整理的判断。' })) }
  const map = buildResultMindMap(session), layout = layoutMindMap(map)
  for (const node of layout.nodes) {
    assert.ok(node.x >= 0 && node.y >= 0 && node.x + node.width <= layout.width && node.y + node.height <= layout.height)
    for (const other of layout.nodes.filter((other) => other.id !== node.id && other.x === node.x)) assert.ok(node.y + node.height <= other.y || other.y + other.height <= node.y)
  }
  const compact = layoutMindMap(map, new Set(['action']))
  assert.ok(!compact.nodes.some((node) => node.id.startsWith('review-')))
  const svg = resultMindMapSvg(map)
  assert.ok(svg.includes('原文末尾标记'));assert.ok(svg.includes('第 4 次回看'))
  assert.ok(!svg.includes('…'))
})

test('SVG 导出将用户文字作为文本转义，不嵌入可执行标签或外部资源', () => {
  const session = fixture()
  session.summary.currentJudgment = '<script>alert("x")</script> & <image href="https://example.test/private"/>\u0000'
  const svg = resultMindMapSvg(buildResultMindMap(session))
  assert.ok(svg.includes('&lt;script&gt;'));assert.ok(svg.includes('&amp;'))
  assert.doesNotMatch(svg, /<script|<image|<foreignObject|\u0000/)
})
