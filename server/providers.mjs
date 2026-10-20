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
      thinkingMode: env.DEEPSEEK_THINKING_MODE === 'enabled' ? 'enabled' : 'disabled',
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
  if (provider.id === 'deepseek') {
    body.thinking = { type: provider.thinkingMode || 'disabled' }
    if (provider.thinkingMode === 'enabled') { body.reasoning_effort = 'low'; body.max_tokens = Math.max(maxTokens, 6000) }
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, provider.thinkingMode === 'enabled' ? 45000 : 25000)
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
      const unsafeMessage = payload?.error?.message || payload?.message || raw.slice(0, 500) || `HTTP ${response.status}`
      const message = provider.apiKey ? String(unsafeMessage).replaceAll(provider.apiKey, '[已隐藏]') : String(unsafeMessage)
      const error = new Error(`${provider.label} API 调用失败：${message}`)
      error.code = response.status === 401 || response.status === 403 ? 'AI_PROVIDER_AUTH' : response.status === 429 ? 'AI_PROVIDER_RATE_LIMIT' : 'AI_PROVIDER_ERROR'
      throw error
    }

    const choice = payload?.choices?.[0]
    if (choice?.finish_reason === 'length') { const error = new Error('模型输出达到长度上限，本轮未展示不完整的回应。请重试或检查思考模式与输出额度。'); error.code = 'MODEL_OUTPUT_TRUNCATED'; throw error }
    const message = choice?.message
    // 只读取用户可见的 content，不读取或保存 reasoning_content。
    let content = message?.content
    if (Array.isArray(content)) content = content.map((part) => part?.text || part?.content || '').join('')
    const parsed = extractJsonCandidate(content)
    return {
      data: parsed,
      latencyMs: Date.now() - started,
      provider: provider.id,
      model: provider.model,
      usage: payload?.usage ? { inputTokens: payload.usage.prompt_tokens, outputTokens: payload.usage.completion_tokens, totalTokens: payload.usage.total_tokens } : undefined,
    }
  } catch (error) {
    if (signal?.aborted) throw error
    if (error.cause?.code === 'EACCES' || error.cause?.code === 'EPERM') { const denied = new Error('启动 AI 服务的环境禁止访问外网，请从正常终端启动服务或检查运行环境的网络权限。'); denied.code = 'AI_NETWORK_BLOCKED'; throw denied }
    if (controller.signal.aborted) { const timeout = new Error('模型回应超时，请稍后重试；本轮没有自动改用模板。'); timeout.code = 'AI_TIMEOUT'; throw timeout }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
