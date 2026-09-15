import { describe, expect, it } from 'vitest'
import { getApiError, getApiErrorMessage, maybeAppendStreamingHint } from './imageApiShared'

describe('imageApiShared error helpers', () => {
  it('keeps getApiErrorMessage compatible as a string wrapper', async () => {
    const message = await getApiErrorMessage(new Response(JSON.stringify({
      error: { message: 'invalid key' },
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(typeof message).toBe('string')
    expect(message).toContain('供应商 API Key 认证失败')
    expect(message).toContain('HTTP 401')
    expect(message).toContain('invalid key')
  })

  it('exports structured diagnostics for callers that need them', async () => {
    const err = await getApiError(new Response('Upstream request failed', { status: 502 }))

    expect(err.diagnostic).toMatchObject({
      status: 502,
      category: 'upstream',
      detail: 'Upstream request failed',
    })
  })

  it('preserves old streaming hint behavior for eligible 400 errors', () => {
    const message = maybeAppendStreamingHint('invalid character', 400, true)

    expect(message).toContain('invalid character')
    expect(message).toContain('流式')
  })

  it('does not append streaming hints to upstream errors', () => {
    const message = maybeAppendStreamingHint('Upstream request failed', 502, true)

    expect(message).toBe('Upstream request failed')
  })
})
