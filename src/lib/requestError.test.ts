import { describe, expect, it } from 'vitest'
import { getApiError } from './requestError'

describe('getApiError', () => {
  it('classifies supplier 401 as API key authentication failure', async () => {
    const err = await getApiError(new Response(JSON.stringify({
      error: { message: 'Incorrect API key provided: sk-test-secret' },
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_123' },
    }))

    expect(err.diagnostic).toMatchObject({
      status: 401,
      category: 'auth',
      summary: '供应商 API Key 认证失败',
      requestId: 'req_123',
    })
    expect(err.message).toContain('HTTP 401')
    expect(err.message).toContain('sk-***')
    expect(err.message).not.toContain('sk-test-secret')
  })

  it('classifies 429 as rate limit or quota failure with context metrics', async () => {
    const err = await getApiError(new Response(JSON.stringify({
      error: { message: 'rate limit exceeded' },
    }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    }), {
      phase: 'responses',
      requestBytes: 68_701_827,
      elapsedMs: 35412,
    })

    expect(err.diagnostic).toMatchObject({
      status: 429,
      category: 'rate_limit',
      phase: 'responses',
      requestBytes: 68_701_827,
      elapsedMs: 35412,
    })
    expect(err.message).toContain('请求大小：65.5 MiB')
    expect(err.message).toContain('耗时：35412ms')
  })

  it('classifies 502 as upstream failure instead of timeout', async () => {
    const err = await getApiError(new Response(JSON.stringify({
      error: { message: 'Upstream request failed' },
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(err.diagnostic.category).toBe('upstream')
    expect(err.diagnostic.summary).toBe('上游服务失败')
    expect(err.message).toContain('Upstream request failed')
    expect(err.message).not.toContain('超时')
  })

  it('summarizes HTML guard pages as safe plain text', async () => {
    const err = await getApiError(new Response('<script src="/_guard/html.js?js=p456"></script><html><title>Denied</title><body>blocked cookie=abc123</body></html>', {
      status: 456,
      headers: { 'Content-Type': 'text/html' },
    }))

    expect(err.diagnostic.category).toBe('html_guard')
    expect(err.diagnostic.detail).toContain('script src="/_guard/html.js?js=p456"')
    expect(err.diagnostic.detail).toContain('cookie=***')
    expect(err.diagnostic.detail).not.toContain('<script')
    expect(err.message).toContain('HTTP 456')
  })

  it('redacts cookies, bearer tokens and base64 payloads', async () => {
    const err = await getApiError(new Response(`authorization: Bearer secret-token-value
cookie=session=secret
image=data:image/png;base64,${'a'.repeat(200)}`, {
      status: 400,
      headers: { 'Content-Type': 'text/plain' },
    }))

    expect(err.message).toContain('authorization=***')
    expect(err.message).toContain('cookie=***')
    expect(err.message).toContain('[base64 图片已省略]')
    expect(err.message).not.toContain('secret-token-value')
    expect(err.message).not.toContain('session=secret')
    expect(err.message).not.toContain('a'.repeat(120))
  })

  it('redacts quoted JSON secrets and full cookie lists', async () => {
    const err = await getApiError(new Response(JSON.stringify({
      apiKey: 'sk-json-secret',
      Cookie: 'a=1; b=2; session_token=secret',
      nested: { authorization: 'Bearer nested-secret-token' },
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(err.message).toContain('"apiKey":"***"')
    expect(err.message).toContain('"Cookie":"***"')
    expect(err.message).toContain('"authorization":"***"')
    expect(err.message).not.toContain('sk-json-secret')
    expect(err.message).not.toContain('session_token=secret')
    expect(err.message).not.toContain('nested-secret-token')
  })

  it('adds actionable guidance without treating 502 as timeout', async () => {
    const err = await getApiError(new Response('Upstream request failed', { status: 502 }))

    expect(err.diagnostic.action).toContain('不能直接判断为客户端计时器触发')
    expect(err.message).toContain('建议：')
    expect(err.message).not.toContain('请求超时')
  })
})
