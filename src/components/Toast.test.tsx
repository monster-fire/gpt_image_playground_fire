// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from './Toast'

const storeMock = vi.hoisted(() => {
  const state = {
    toast: null as { message: string; type: 'info' | 'success' | 'error' } | null,
  }

  return {
    state,
    useStore: vi.fn((selector: (s: typeof state) => unknown) => selector(state)),
  }
})

vi.mock('../store', () => ({
  useStore: storeMock.useStore,
}))

describe('Toast', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    storeMock.state.toast = null
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render() {
    act(() => {
      root.render(<Toast />)
    })
  }

  it('announces non-error messages politely', () => {
    storeMock.state.toast = { message: '任务已提交', type: 'success' }

    render()

    const status = container.querySelector('[role="status"]')
    expect(status?.getAttribute('aria-live')).toBe('polite')
    expect(status?.getAttribute('aria-atomic')).toBe('true')
    expect(status?.textContent).toContain('任务已提交')
  })

  it('announces errors assertively', () => {
    storeMock.state.toast = { message: '请求失败', type: 'error' }

    render()

    const alert = container.querySelector('[role="alert"]')
    expect(alert?.getAttribute('aria-live')).toBe('assertive')
    expect(alert?.textContent).toContain('请求失败')
  })
})
