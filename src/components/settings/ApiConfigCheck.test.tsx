// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile } from '../../lib/apiProfiles'
import ApiConfigCheck from './ApiConfigCheck'

const nasAuthMock = vi.hoisted(() => ({
  providerFetch: vi.fn(),
}))

vi.mock('../../lib/nasAuth', () => nasAuthMock)
vi.mock('../../lib/devProxy', async () => {
  const actual = await vi.importActual<typeof import('../../lib/devProxy')>('../../lib/devProxy')
  return {
    ...actual,
    readClientDevProxyConfig: vi.fn(() => null),
    shouldUseApiProxy: vi.fn(() => false),
  }
})

describe('ApiConfigCheck', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    nasAuthMock.providerFetch.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(status: number, body: unknown = { data: [] }, headers?: HeadersInit) {
    nasAuthMock.providerFetch.mockResolvedValue(new Response(
      typeof body === 'string' ? body : JSON.stringify(body),
      { status, headers: headers ?? { 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' } },
    ))
    act(() => {
      root.render(<ApiConfigCheck profile={createDefaultOpenAIProfile({ apiKey: 'sk-test', baseUrl: 'https://api.example.com/v1' })} />)
    })
  }

  async function clickCheck() {
    const button = container.querySelector('button') as HTMLButtonElement
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('treats missing model-list endpoints as unverified instead of failed generation capability', async () => {
    render(404, { error: 'not found' })
    await clickCheck()

    expect(container.textContent).toContain('模型列表接口不可用')
    expect(container.textContent).toContain('图片模型能力未验证')
  })

  it('reports HTML or non-JSON responses as unreadable model-list checks', async () => {
    render(200, '<script src="/_guard/html.js?js=p456"></script>', { 'Content-Type': 'text/html' })
    await clickCheck()

    expect(container.textContent).toContain('未能读取模型列表')
    expect(container.textContent).toContain('鉴权及模型能力未验证')
  })

  it('reports supplier auth failures without implying app logout', async () => {
    render(401, { error: { message: 'bad key' } })
    await clickCheck()

    expect(container.textContent).toContain('HTTP 401')
    expect(container.textContent).toContain('供应商凭据')
  })

  it('clears connection result when switching profiles', async () => {
    render(200, { data: [] })
    await clickCheck()

    expect(container.textContent).toContain('模型列表可读取')

    act(() => {
      root.render(<ApiConfigCheck profile={createDefaultOpenAIProfile({ id: 'next-profile', apiKey: 'sk-next', baseUrl: 'https://api.next.example/v1' })} />)
    })

    expect(container.textContent).not.toContain('模型列表可读取')
  })

  it('aborts and ignores a late connection result after switching profiles', async () => {
    let resolveFetch: ((response: Response) => void) | null = null
    const abortSpy = vi.fn()
    nasAuthMock.providerFetch.mockImplementation((_url: string, init: RequestInit) => {
      init.signal?.addEventListener('abort', abortSpy)
      return new Promise((resolve) => {
        resolveFetch = resolve
      })
    })
    act(() => {
      root.render(<ApiConfigCheck profile={createDefaultOpenAIProfile({ id: 'old-profile', apiKey: 'sk-old', baseUrl: 'https://api.old.example/v1' })} />)
    })

    await act(async () => {
      ;(container.querySelector('button') as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('正在检查连接')

    act(() => {
      root.render(<ApiConfigCheck profile={createDefaultOpenAIProfile({ id: 'new-profile', apiKey: 'sk-new', baseUrl: 'https://api.new.example/v1' })} />)
    })
    await act(async () => {
      resolveFetch?.(new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      await Promise.resolve()
    })

    expect(abortSpy).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('模型列表可读取')
    expect(container.textContent).not.toContain('正在检查连接')
  })
})
