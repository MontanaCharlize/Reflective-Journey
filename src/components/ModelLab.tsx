import { Check, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { checkAiConnection, getAiStatus, getPreferredProvider, setPreferredProvider } from '../lib/ai'
import type { AiStatus } from '../lib/ai'

export function ModelLab() {
  const [status, setStatus] = useState<AiStatus | null>(null), [selected, setSelected] = useState<string | null>(getPreferredProvider())
  const [loading, setLoading] = useState(true), [checking, setChecking] = useState(false), [notice, setNotice] = useState(''), [error, setError] = useState('')
  const refresh = async () => { setLoading(true); setStatus(await getAiStatus()); setLoading(false) }
  useEffect(() => { void refresh() }, [])
  const choose = (id: string | null) => { setPreferredProvider(id); setSelected(id); setNotice(''); setError('') }
  const check = async () => {
    setChecking(true); setError(''); setNotice('')
    try { const result = await checkAiConnection(); setNotice(`真实连接已验证：${result.provider} / ${result.model}，${result.latencyMs} ms。`) }
    catch (failure) { setError(failure instanceof Error ? failure.message : '模型连接失败。') }
    finally { setChecking(false) }
  }
  return <main className="lab-shell"><section className="lab-head"><p className="eyebrow">AI 参与理解与决策</p><h1>模型连接</h1><p>AI 理解用户实际表达，选择这一轮最值得推进的目标，再给出回应和下一问。本地只校验证据、重复和访问边界，不再把对话锁在固定清单里。</p></section>
    <section className="lab-section"><div className="lab-section-head"><div><h2>服务端模型配置</h2><p>配置存在不代表实际连接成功。可以用下方按钮发送一条不含个人思考的合成请求验证连接。密钥只在服务端使用。</p></div><button className="quiet-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />刷新</button></div>
      {!status?.providers.length && !loading && <div className="lab-empty"><p>没有检测到可用模型配置。</p><span>请检查服务端 .env.local 的 API Key 与模型名称，更新后重启服务。</span></div>}
      <div className="provider-list">{status?.providers.map((provider) => <button key={provider.id} className={(selected || status.activeProvider) === provider.id ? 'provider-row active' : 'provider-row'} onClick={() => choose(provider.id)}><div><strong>{provider.label}</strong><span>{provider.model} · 已配置，连接需验证</span></div>{(selected || status.activeProvider) === provider.id && <Check size={17} />}</button>)}</div>
      {selected && <button className="text-action" onClick={() => choose(null)}>跟随服务端默认模型</button>}
      {status?.access?.loginRequired && <p className="inline-error">当前网站要求登录后使用模型，请先进入账户。</p>}
      {status?.access?.localGuest && <p className="save-note">当前为本机访问，已配置的模型可在访客工作区使用；仍受调用限额约束。</p>}
      <button className="secondary-action" disabled={checking || !status?.providers.length || status.access?.loginRequired} onClick={() => void check()}>{checking ? '正在验证真实连接…' : '验证真实模型连接'}</button>
      {notice && <p className="save-note" role="status">{notice}</p>}{error && <p className="inline-error" role="alert">{error}</p>}
    </section>
    <section className="lab-section lab-doc"><h2>每一轮由谁决定？</h2><p>用户的原话、已经明确的判断和最近的问题共同交给 AI。AI 需要给出这轮的具体目标、选择依据、真实引用和有增量的回应。本地拒绝虚构引用与重复问题；不合格时让模型修正，仍失败则清楚显示未完成，保留原话供重试。</p><pre>{`用户表达\n  ↓\nAI 理解上下文 + 选择下一步 + 作出回应\n  ↓\n证据与重复检查\n  ↓\n用户决定继续、纠正、换方向或整理成果`}</pre></section>
  </main>
}