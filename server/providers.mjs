const trimSlash = (value) => value.replace(/\/+$/, '')

export function providerCatalog(env) {
  return {
    deepseek: {
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: trimSlash(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'),
      apiKey: env.DEEPSEEK_API_KEY || '',
      model: env.DEEPSEEK_MODEL || 'deepseek-flash',
      jsonMode: true,
    },
    openai: {
      id: 'openai',
      label: 'OpenAI',
      baseUrl: trimSlash(env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
      apiKey: env.OPENAI_API_KEY || '',
      model: env.OPENAI_MODEL || 'gpt-5.6-luna',
      jsonMode: true,
    },
    glm: {
      id: 'glm',
      label: 'GLM / 智谱',
      baseUrl: trimSlash(env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4'),
      apiKey: env.GLM_API_KEY || '',
      model: env.GLM_MODEL || '',
      jsonMode: String(env.GLM_JSON_MODE || '').toLowerCase() === 'true',
    },
    custom: {
      id: 'custom',
      label: 'Custom OpenAI-compatible',
      baseUrl: trimSlash(env.CUSTOM_AI_BASE_URL || ''),
      apiKey: env.CUSTOM_AI_API_KEY || '',
      model: env.CUSTOM_AI_MODEL || '',
      jsonMode: String(env.CUSTOM_AI_JSON_MODE || '').toLowerCase() !== 'false',
    },
  }
}

export function configuredProviders(env) {
  const catalog = providerCatalog(env)
  return Object.values(catalog).filter((p) => p.apiKey && p.baseUrl && p.model)
}

export function resolveProvider(env, requestedId) {
  const catalog = providerCatalog(env)
  const preferred = requestedId || env.AI_PROVIDER || 'deepseek'
  const direct = catalog[preferred]
  if (direct?.apiKey && direct.baseUrl && direct.model) return direct
  return configuredProviders(env)[0] || null
}

function extractJsonCandidate(text) {
  const cleaned = String(text || '').trim()
  if (!cleaned) throw new Error('模型返回了空内容')
  try {
    return JSON.parse(cleaned)
  } catch {
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    if (fenced) {
      try { return JSON.parse(fenced.trim()) } catch { /* continue */ }
    }
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1))
    throw new Error('模型没有返回可解析的 JSON')
  }
}

export async function callJsonModel(provider, { system, user, maxTokens = 1200, temperature = 0.2, signal }) {
  const started = Date.now()
  const url = `${provider.baseUrl}/chat/completions`
  const body = {
    model: provider.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: false,
    temperature,
    max_tokens: maxTokens,
  }
  if (provider.jsonMode) body.response_format = { type: 'json_object' }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 20_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const raw = await response.text()
    let payload
    try { payload = JSON.parse(raw) } catch { payload = null }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || raw.slice(0, 500) || `HTTP ${response.status}`
      throw new Error(`${provider.label} API 调用失败：${message}`)
    }

    const message = payload?.choices?.[0]?.message
    // 只读取用户可见的 content，不读取或保存 reasoning_content。
    let content = message?.content
    if (Array.isArray(content)) content = content.map((part) => part?.text || part?.content || '').join('')
    const parsed = extractJsonCandidate(content)
    return {
      data: parsed,
      latencyMs: Date.now() - started,
      provider: provider.id,
      model: provider.model,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
