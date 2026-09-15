export interface ApiErrorContext {
  phase?: string
  requestBytes?: number
  elapsedMs?: number
  timeoutMs?: number
}

export interface ApiErrorDiagnostic {
  status: number
  statusText: string
  category: string
  summary: string
  action: string
  detail: string
  requestId?: string
  contentType?: string
  phase?: string
  requestBytes?: number
  elapsedMs?: number
  timeoutMs?: number
}

export class ApiRequestError extends Error {
  diagnostic: ApiErrorDiagnostic

  constructor(diagnostic: ApiErrorDiagnostic) {
    super(formatApiErrorMessage(diagnostic))
    this.name = 'ApiRequestError'
    this.diagnostic = diagnostic
  }
}

const REQUEST_ID_HEADERS = [
  'x-request-id',
  'request-id',
  'openai-request-id',
  'x-openai-request-id',
  'cf-ray',
  'x-amzn-requestid',
]

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function truncateText(value: string, maxLength = 600): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}…`
}

export function sanitizeApiErrorText(value: string): string {
  return truncateText(value
    .replace(/data:[^,;\s]+;base64,[A-Za-z0-9+/=_-]{80,}/gi, '[base64 图片已省略]')
    .replace(/\b[A-Za-z0-9+/]{160,}={0,2}\b/g, '[base64 内容已省略]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-***')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, 'Bearer ***')
    .replace(/(["']?(?:api[_-]?key|authorization|cookie|set-cookie|session[_-]?token|access[_-]?token|refresh[_-]?token)["']?\s*:\s*)["'][^"']*["']/gi, '$1"***"')
    .replace(/\b(api[_-]?key|authorization|cookie|set-cookie|session[_-]?token|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*[^,\n\r}]+/gi, '$1=***'))
}

function redactRawValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeApiErrorText(value)
  }
  if (Array.isArray(value)) return value.map(redactRawValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (/^(api[_-]?key|authorization|cookie|set-cookie|session[_-]?token|access[_-]?token|refresh[_-]?token)$/i.test(key)) {
      return [key, '***']
    }
    if (/^(b64_json|base64|data)$/i.test(key) && typeof item === 'string' && item.length > 80) {
      return [key, '[base64 内容已省略]']
    }
    return [key, redactRawValue(item)]
  }))
}

export function sanitizeRawApiPayload(value: string): string {
  try {
    return JSON.stringify(redactRawValue(JSON.parse(value)), null, 2)
  } catch {
    return sanitizeApiErrorText(value)
  }
}

function getRequestId(headers: Headers): string | undefined {
  for (const name of REQUEST_ID_HEADERS) {
    const value = headers.get(name)
    if (value) return sanitizeApiErrorText(value)
  }
  return undefined
}

function stripHtml(value: string): string {
  const scriptMatches = Array.from(value.matchAll(/<script\b[^>]*\bsrc=["']?([^"'>\s]+)["']?[^>]*>/gi))
    .map((match) => `script src="${match[1]}"`)
  const title = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  const text = value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  return [...scriptMatches, title, text].filter(Boolean).join(' ')
}

function extractJsonMessage(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const error = record.error
  if (error && typeof error === 'object') {
    const errorRecord = error as Record<string, unknown>
    if (typeof errorRecord.message === 'string') return errorRecord.message
    if (typeof errorRecord.detail === 'string') return errorRecord.detail
  }
  if (typeof record.detail === 'string') return record.detail
  if (Array.isArray(record.detail)) {
    return record.detail.map((item) => typeof item === 'string' ? item : JSON.stringify(item)).join('\n')
  }
  if (typeof record.error === 'string') return record.error
  if (typeof record.message === 'string') return record.message
  return JSON.stringify(value)
}

function classifyStatus(status: number, detail: string, isHtml: boolean): Pick<ApiErrorDiagnostic, 'category' | 'summary' | 'action'> {
  if (isHtml) return { category: 'html_guard', summary: '请求被网关或防护页拦截', action: '检查 CDN、防护规则或代理地址是否返回了 HTML 页面。' }
  if (status === 401 || status === 403) return { category: 'auth', summary: '供应商 API Key 认证失败', action: '检查当前配置使用的供应商 API Key、账号权限和模型权限。' }
  if (status === 404) return { category: 'not_found', summary: '接口地址或模型路径不存在', action: '检查 Base URL、接口模式和模型名称是否匹配当前供应商。' }
  if (status === 408) return { category: 'request_timeout', summary: '请求超时', action: '供应商返回请求超时，确认供应商是否仍在处理后再决定是否手动重试。' }
  if (status === 429) return { category: 'rate_limit', summary: '请求受限或额度不足', action: '等待限流恢复，或检查供应商账号额度、并发限制和计费状态。' }
  if (status === 504) return { category: 'gateway_timeout', summary: '网关超时', action: '这是代理、CDN 或上游网关超时，不等于客户端计时器触发；请检查代理超时配置和供应商状态。' }
  if (status === 502 || status === 503) return { category: 'upstream', summary: '上游服务失败', action: '这是网关或上游失败，不能直接判断为客户端计时器触发；请稍后手动重试或检查代理日志。' }
  if (status >= 500) return { category: 'server', summary: '服务端错误', action: '检查供应商状态和代理日志，避免对可能已受理的请求自动重试。' }
  if (/stream|event-stream|SSE/i.test(detail)) return { category: 'stream', summary: '流式响应错误', action: '尝试关闭流式传输，或检查供应商是否支持当前流式格式。' }
  if (status >= 400) return { category: 'bad_request', summary: '请求参数或服务端校验失败', action: '检查模型、尺寸、质量、图片数量和输入图片是否符合供应商限制。' }
  return { category: 'unknown', summary: '请求失败', action: '查看诊断详情并检查网络、代理和供应商返回内容。' }
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.clone().text()
  } catch {
    return ''
  }
}

export function formatApiErrorMessage(diagnostic: ApiErrorDiagnostic): string {
  const parts = [
    diagnostic.status > 0
      ? `${diagnostic.summary}：HTTP ${diagnostic.status}${diagnostic.statusText ? ` ${diagnostic.statusText}` : ''}`
      : diagnostic.summary,
  ]
  if (diagnostic.detail) parts.push(`详情：${diagnostic.detail}`)
  if (diagnostic.action) parts.push(`建议：${diagnostic.action}`)
  if (diagnostic.requestId) parts.push(`Request ID：${diagnostic.requestId}`)
  const metrics = [
    diagnostic.phase ? `阶段：${diagnostic.phase}` : '',
    typeof diagnostic.requestBytes === 'number' ? `请求大小：${formatBytes(diagnostic.requestBytes)}` : '',
    typeof diagnostic.elapsedMs === 'number' ? `耗时：${Math.round(diagnostic.elapsedMs)}ms` : '',
    typeof diagnostic.timeoutMs === 'number' ? `本地超时：${Math.round(diagnostic.timeoutMs)}ms` : '',
  ].filter(Boolean)
  if (metrics.length) parts.push(metrics.join('，'))
  return parts.join('\n')
}

export async function getApiError(response: Response, context: ApiErrorContext = {}): Promise<ApiRequestError> {
  const contentType = response.headers.get('Content-Type') || undefined
  const rawText = await readResponseText(response)
  const looksHtml = /html/i.test(contentType || '') || /^\s*</.test(rawText)
  const sourceText = looksHtml ? stripHtml(rawText) : rawText
  let detail = sourceText

  if (!looksHtml && rawText.trim()) {
    try {
      detail = extractJsonMessage(JSON.parse(rawText))
    } catch {
      detail = rawText
    }
  }

  const safeDetail = sanitizeApiErrorText(detail || response.statusText || `HTTP ${response.status}`)
  const classification = classifyStatus(response.status, safeDetail, looksHtml)

  return new ApiRequestError({
    status: response.status,
    statusText: response.statusText,
    category: classification.category,
    summary: classification.summary,
    action: classification.action,
    detail: safeDetail,
    requestId: getRequestId(response.headers),
    contentType,
    phase: context.phase,
    requestBytes: context.requestBytes,
    elapsedMs: context.elapsedMs,
    timeoutMs: context.timeoutMs,
  })
}

export function getNetworkApiError(err: unknown, context: ApiErrorContext = {}): ApiRequestError {
  const explicitTimeout = typeof context.timeoutMs === 'number'
  const detail = sanitizeApiErrorText(err instanceof Error ? err.message : String(err))
  return new ApiRequestError({
    status: 0,
    statusText: '',
    category: explicitTimeout ? 'client_timeout' : 'network',
    summary: explicitTimeout ? '客户端计时器触发超时' : '网络请求失败',
    action: explicitTimeout
      ? '本地计时器已中止请求；确认供应商是否可能仍在处理后，再决定是否手动重试。'
      : '检查网络、代理地址、DNS、TLS 或浏览器连接限制；不能仅凭网络错误判断为跨域问题。',
    detail: detail || (explicitTimeout ? 'AbortError' : 'Network error'),
    phase: context.phase,
    requestBytes: context.requestBytes,
    elapsedMs: context.elapsedMs,
    timeoutMs: context.timeoutMs,
  })
}
