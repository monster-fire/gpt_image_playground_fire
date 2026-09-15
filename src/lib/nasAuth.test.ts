import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkNasSession, expireNasSession, isNasAuthEnabled, nasFetch, providerFetch, setNasSession } from './nasAuth'

const browser = Object.assign(new EventTarget(), { location: { href: 'http://nas:11130/', origin: 'http://nas:11130' } })
beforeEach(() => {
  vi.stubEnv('VITE_NAS_AUTH_ENABLED', 'true')
  vi.stubGlobal('window', browser)
  setNasSession({ authenticated: true, expiresAt: Date.now() + 60000, csrfToken: 'app-csrf' })
})
afterEach(() => { expireNasSession(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('NAS session and supplier separation', () => {
  it('enables NAS auth outside test mode even when the env flag is absent', () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_NAS_AUTH_ENABLED', '')
    expect(isNasAuthEnabled()).toBe(true)
  })
  it('allows disabling NAS auth only in test mode', () => {
    vi.stubEnv('MODE', 'test')
    vi.stubEnv('VITE_NAS_AUTH_ENABLED', 'false')
    expect(isNasAuthEnabled()).toBe(false)
    vi.stubEnv('VITE_NAS_AUTH_ENABLED', 'true')
    expect(isNasAuthEnabled()).toBe(true)
  })
  it('adds CSRF only to local NAS writes', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    await nasFetch('/api/api-config', { method: 'PUT' })
    expect(fetcher.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('app-csrf')
    expect(fetcher.mock.calls[0][1].credentials).toBe('same-origin')
    await expect(nasFetch('https://supplier.example/api/key')).rejects.toThrow('路径无效')
  })
  it('never forwards application cookies or CSRF directly to the supplier', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetcher)
    const response = await providerFetch('https://supplier.example/v1/responses', { headers: { Authorization: 'Bearer supplier-test', Cookie: 'private', 'X-CSRF-Token': 'private' } })
    await response.text()
    const init = fetcher.mock.calls[0][1]
    expect(init.credentials).toBe('omit')
    expect(init.headers.get('Authorization')).toBe('Bearer supplier-test')
    expect(init.headers.has('Cookie')).toBe(false)
    expect(init.headers.has('X-CSRF-Token')).toBe(false)
  })
  it('keeps supplier 401 separate from explicitly marked NAS expiration', async () => {
    const listener = vi.fn()
    browser.addEventListener('nas-session-expired', listener)
    const fetcher = vi.fn().mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 401 })))
      .mockImplementationOnce(() => Promise.resolve(new Response('{}', { status: 401, headers: { 'X-App-Auth-Error': 'APP_SESSION_EXPIRED' } })))
    vi.stubGlobal('fetch', fetcher)
    await (await providerFetch('/api-proxy/responses')).text()
    expect(listener).not.toHaveBeenCalled()
    await (await providerFetch('/api-proxy/responses')).text()
    expect(listener).toHaveBeenCalledTimes(1)
    browser.removeEventListener('nas-session-expired', listener)
  })
  it('rejects expired sessions before a request and aborts an active response on logout', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream()))
    vi.stubGlobal('fetch', fetcher)
    const response = await providerFetch('/api-proxy/responses')
    const signal = fetcher.mock.calls[0][1].signal
    expireNasSession()
    expect(signal.aborted).toBe(true)
    await response.body?.cancel()
    await expect(providerFetch('/api-proxy/responses')).rejects.toThrow('过期')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('checks the absolute expiry supplied by the NAS', async () => {
    const expiresAt = Date.now() + 168 * 3600000
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ authenticated: true, expiresAt, csrfToken: 'checked' })))
    expect((await checkNasSession()).expiresAt).toBe(expiresAt)
  })
})
