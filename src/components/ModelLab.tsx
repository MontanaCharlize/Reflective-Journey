import { Check, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getAiStatus, getPreferredProvider, setPreferredProvider, type AiStatus } from '../lib/ai'

export function ModelLab() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [selected, setSelected] = useState<string | null>(getPreferredProvider())
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    setStatus(await getAiStatus())
    setLoading(false)
  }

  useEffect(() => { void refresh() }, [])

  const choose = (id: string | null) => {
    setPreferredProvider(id)
    setSelected(id)
  }

  return (
    <main className="lab-shell">
      <section className="lab-head">
        <p className="eyebrow">V0.5 · AI Provider</p>
        <h1>模型实验室</h1>
        <p>认知引擎决定“下一步做什么”，模型只负责结构化理解上下文和把这个动作问得更针对。</p>
      </section>

      <section className="lab-section">
        <div className="lab-section-head">
          <div>
            <h2>当前可用模型</h2>
            <p>API Key 只存在本机服务端的 <code>.env.local</code>，不会写进浏览器或导出的思考记录。</p>
          </div>
          <button className="quiet-button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            刷新
          </button>
        </div>

        {!status?.providers.length && !loading && (
          <div className="lab-empty">
            <p>还没有检测到已配置的真实模型。</p>
            <span>复制 <code>.env.example</code> 为 <code>.env.local</code>，填入 API Key 后重启 <code>npm run dev</code>。</span>
          </div>
        )}

        <div className="provider-list">
          {status?.providers.map((provider) => {
            const active = (selected || status.activeProvider) === provider.id
            return (
              <button key={provider.id} className={active ? 'provider-row active' : 'provider-row'} onClick={() => choose(provider.id)}>
                <div>
                  <strong>{provider.label}</strong>
                  <span>{provider.model}</span>
                </div>
                {active && <Check size={17} />}
              </button>
            )
          })}
        </div>
        {selected && (
          <button className="text-action" onClick={() => choose(null)}>跟随服务端 AI_PROVIDER 默认值</button>
        )}
      </section>

      <section className="lab-section lab-doc">
        <h2>为什么不是让模型直接决定下一问？</h2>
        <p>
          每轮先由模型把用户刚刚表达的内容整理成结构化认知状态；随后本地 Cognitive Engine 按认知路径选择唯一的 next_action；最后模型只根据这个动作和上下文生成一个问题。
        </p>
        <pre>{`用户回答\n  ↓\n结构化认知分析（AI）\n  ↓\nCognitive Engine 锁定 next_action\n  ↓\n针对性问题生成（AI）\n  ↓\n完整记录 + 自动回退`}</pre>
      </section>

      <section className="lab-section lab-doc">
        <h2>模型竞技场</h2>
        <p>如果同时配置了两个以上 Provider，可在终端运行 <code>npm run arena</code>。它会给所有已配置模型同一份上下文和同一个认知动作，输出各自的下一问，方便人工按“针对性、不泄露答案、不重复、认知推进量”等标准比较。</p>
      </section>
    </main>
  )
}
