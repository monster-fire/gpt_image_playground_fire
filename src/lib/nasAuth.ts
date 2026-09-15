import { readRuntimeEnv } from './runtimeEnv'

export type NasSession = { authenticated: true; expiresAt: number; csrfToken: string }
let session: NasSession | null = null
const controllers = new Set<AbortController>()

export function isNasAuthEnabled() {
  if (import.meta.env.MODE !== 'test') return true
  return readRuntimeEnv(import.meta.env.VITE_NAS_AUTH_ENABLED) === 'true'
}

export function setNasSession(value: NasSession | null) {
  session = value
}

export function hasNasSession() {
  return session !== null && Date.now() < session.expiresAt
}

export function expireNasSession() {
  session = null
  for (const controller of controllers) controller.abort()
  controllers.clear()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('nas-session-expired'))
}

export async function nasFetch(path: string, init: RequestInit = {}) {
  if (!path.startsWith('/api/')) throw new Error('NAS 请求路径无效')
  const headers = new Headers(init.headers)
  if (session && init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', session.csrfToken)
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' })
  if (response.status === 401 && response.headers.get('X-App-Auth-Error') === 'APP_SESSION_EXPIRED') expireNasSession()
  return response
}

export async function checkNasSession(): Promise<NasSession> {
  const response = await nasFetch('/api/auth/session')
  if (!response.ok) throw new Error(response.status === 401 ? '请登录后继续' : '无法连接 NAS，请重试')
  const value = await response.json() as NasSession
  if (value.authenticated !== true || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now() || typeof value.csrfToken !== 'string' || !value.csrfToken) throw new Error('NAS 会话响应无效')
  session = value
  return value
}

// 供应商凭据原样使用；只有同源 NAS 代理请求附带应用会话信息。
export async function providerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  if (!isNasAuthEnabled()) return fetch(url, init)
  if (!session || Date.now() >= session.expiresAt) {
    expireNasSession()
    throw new Error('应用登录已过期，请重新登录')
  }
  const target = new URL(url, window.location.href)
  const proxy = target.origin === window.location.origin && target.pathname.startsWith('/api-proxy/')
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (init.signal?.aborted) controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  controllers.add(controller)
  const headers = new Headers(init.headers)
  if (proxy) headers.set('X-CSRF-Token', session.csrfToken)
  else {
    headers.delete('X-CSRF-Token')
    headers.delete('Cookie')
  }
  const cleanup = () => {
    controllers.delete(controller)
    init.signal?.removeEventListener('abort', abort)
  }
  try {
    const response = await fetch(url, { ...init, headers, credentials: proxy ? 'same-origin' : 'omit', signal: controller.signal })
    if (proxy && response.status === 401 && response.headers.get('X-App-Auth-Error') === 'APP_SESSION_EXPIRED') expireNasSession()
    if (!response.body) { cleanup(); return response }
    const reader = response.body.getReader()
    // 正文读完后释放会话关联，同时保留流式响应的退出取消能力。
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const chunk = await reader.read()
          if (chunk.done) { cleanup(); stream.close() }
          else stream.enqueue(chunk.value)
        } catch (error) { cleanup(); stream.error(error) }
      },
      async cancel(reason) { controller.abort(); cleanup(); await reader.cancel(reason) },
    })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  } catch (error) {
    cleanup()
    throw error
  }
}
