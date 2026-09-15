import { describe, expect, it } from 'vitest'
import config from './vite.config'

async function resolveConfig(mode: string, env: Record<string, string | undefined> = {}) {
  const prev = {
    VITE_NAS_AUTH_ENABLED: process.env.VITE_NAS_AUTH_ENABLED,
    VITE_DEFAULT_API_URL: process.env.VITE_DEFAULT_API_URL,
    NAS_DEV_SERVER_URL: process.env.NAS_DEV_SERVER_URL,
  }
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    const cfg = typeof config === 'function'
      ? await config({ command: 'serve', mode, isSsrBuild: false, isPreview: false })
      : config
    return { cfg, defaultApiUrl: process.env.VITE_DEFAULT_API_URL }
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe('vite NAS auth defaults', () => {
  it('keeps production and development on the NAS server path even when legacy static config env is present', async () => {
    const result = await resolveConfig('production', {
      VITE_NAS_AUTH_ENABLED: 'false',
      VITE_DEFAULT_API_URL: 'https://static-secret.example/v1?apiKey=secret',
      NAS_DEV_SERVER_URL: 'http://127.0.0.1:3131',
    })
    expect(result.defaultApiUrl).toBe('')
    expect(result.cfg.server?.proxy?.['/api/']).toMatchObject({ target: 'http://127.0.0.1:3131' })
    expect(result.cfg.server?.proxy?.['/api-proxy/']).toMatchObject({ target: 'http://127.0.0.1:3131' })
  })

  it('limits static fallback to explicit test mode override', async () => {
    delete process.env.VITE_DEFAULT_API_URL
    const result = await resolveConfig('test', {
      VITE_NAS_AUTH_ENABLED: 'false',
      VITE_DEFAULT_API_URL: 'https://static.example/v1',
    })
    expect(result.defaultApiUrl).toBe('https://static.example/v1')
    expect(result.cfg.server?.proxy?.['/api-proxy/']).toBeUndefined()
  })
})
