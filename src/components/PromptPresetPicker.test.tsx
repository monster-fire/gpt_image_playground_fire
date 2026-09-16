// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPromptPresets, loadPromptPresets } from '../lib/promptPresets'
import PromptPresetPicker from './PromptPresetPicker'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const store = vi.hoisted(() => ({
  state: {
    appMode: 'gallery',
    galleryPromptPresetId: null as string | null,
    activeAgentConversationId: 'conversation',
    agentConversations: [{ id: 'conversation', promptPresetId: null as string | null }],
  },
  select: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof store.state) => unknown) => selector(store.state),
  selectPromptPreset: store.select,
}))
vi.mock('./PromptPresetManager', () => ({
  default: ({ open, initialPresetId, onClose }: { open: boolean; initialPresetId: string | null; onClose: () => void }) => open ? <div data-testid="manager" data-selected={initialPresetId}><button onClick={onClose}>关闭管理</button></div> : null,
}))

describe('PromptPresetPicker', () => {
  let container: HTMLDivElement
  let root: Root
  let fetcher: ReturnType<typeof vi.fn>
  const presets = [
    { id: 'portrait', name: '自然光写真', content: '自然光', revision: 'p1', createdAt: 1, updatedAt: 1 },
    { id: 'watercolor', name: 'Watercolor 插画', content: '水彩', revision: 'p2', createdAt: 1, updatedAt: 1 },
  ]

  beforeEach(async () => {
    clearPromptPresets()
    store.state.appMode = 'gallery'
    store.state.galleryPromptPresetId = null
    store.state.agentConversations[0].promptPresetId = null
    store.select.mockReset().mockImplementation((id: string | null) => {
      if (store.state.appMode === 'gallery') store.state.galleryPromptPresetId = id
      else store.state.agentConversations[0].promptPresetId = id
    })
    fetcher = vi.fn().mockImplementation(async () => Response.json({ presets, revision: 'r1' }))
    vi.stubGlobal('fetch', fetcher)
    await loadPromptPresets()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    clearPromptPresets()
    vi.unstubAllGlobals()
  })

  async function render() {
    await act(async () => { root.render(<PromptPresetPicker />) })
  }

  async function click(selector: string) {
    await act(async () => { document.querySelector<HTMLButtonElement>(selector)!.click() })
    await render()
  }

  async function search(value: string) {
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="搜索预设"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('shows only a named icon before selection, without a standalone selector', async () => {
    await render()
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('button')?.textContent).toBe('')
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('提示词预设')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[aria-label="取消预设"]')).toBeNull()
  })

  it('searches names, selects a preset and clears it from the toolbar', async () => {
    await render()
    await click('[aria-label="提示词预设"]')
    await search(' WATERCOLOR ')
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    await click('[role="option"]')
    expect(store.select).toHaveBeenLastCalledWith('watercolor')
    expect(container.textContent).toContain('Watercolor 插画')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click('[aria-label="取消预设"]')
    expect(store.select).toHaveBeenLastCalledWith(null)
    expect(container.querySelector('button')?.textContent).toBe('')
  })

  it('supports keyboard navigation, Escape and outside dismissal', async () => {
    await render()
    const trigger = container.querySelector<HTMLButtonElement>('button')!
    act(() => trigger.focus())
    await click('[aria-label="提示词预设"]')
    const input = document.querySelector<HTMLInputElement>('[aria-label="搜索预设"]')!
    await act(async () => {
      input.focus()
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(document.activeElement).toBe(document.querySelector('[role="option"]'))
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement?.textContent).toBe('Watercolor 插画')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    await click('[aria-label="提示词预设"]')
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('opens management for the selected preset from the popup footer', async () => {
    store.state.galleryPromptPresetId = 'portrait'
    await render()
    await click('[aria-haspopup="dialog"]')
    const manage = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '管理预设')!
    await act(async () => manage.click())
    expect(document.querySelector('[data-testid="manager"]')?.getAttribute('data-selected')).toBe('portrait')
    expect(document.querySelector('[aria-label="选择提示词预设"]')).toBeNull()
  })

  it('uses the current Agent conversation without changing the gallery selection', async () => {
    store.state.galleryPromptPresetId = 'portrait'
    store.state.appMode = 'agent'
    store.state.agentConversations[0].promptPresetId = 'watercolor'
    await render()
    expect(container.textContent).toContain('Watercolor 插画')
    await click('[aria-label="取消预设"]')
    expect(store.state.agentConversations[0].promptPresetId).toBeNull()
    expect(store.state.galleryPromptPresetId).toBe('portrait')
    store.state.appMode = 'gallery'
    await render()
    expect(container.textContent).toContain('自然光写真')
  })

  it('shows no-results and empty-library states while retaining management access', async () => {
    await render()
    await click('[aria-label="提示词预设"]')
    await search('missing')
    expect(document.body.textContent).toContain('未找到预设')
    fetcher.mockImplementation(async () => Response.json({ presets: [], revision: 'r2' }))
    await act(async () => { await loadPromptPresets({ force: true }) })
    await search('')
    expect(document.body.textContent).toContain('暂无预设')
    expect(document.body.textContent).toContain('管理预设')
  })

  it('keeps selection on sync failure, offers retry and clears a deleted selection after successful sync', async () => {
    store.state.galleryPromptPresetId = 'portrait'
    await render()
    fetcher.mockRejectedValue(new Error('offline'))
    await act(async () => { await loadPromptPresets({ force: true }).catch(() => {}) })
    expect(store.select).not.toHaveBeenCalled()
    expect(container.textContent).toContain('预设同步失败')
    await click('[aria-haspopup="dialog"]')
    expect(document.querySelector('[role="alert"]')).toBeTruthy()
    fetcher.mockImplementation(async () => Response.json({ presets: [], revision: 'r2' }))
    const retry = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '重试')!
    await act(async () => { retry.click() })
    expect(store.select).toHaveBeenLastCalledWith(null)
  })

  it('marks a selected preset updated and acknowledges its latest revision on reselection', async () => {
    store.state.galleryPromptPresetId = 'portrait'
    await render()
    fetcher.mockImplementation(async () => Response.json({ presets: [{ ...presets[0], revision: 'p3' }], revision: 'r2' }))
    await act(async () => { await loadPromptPresets({ force: true }) })
    expect(container.textContent).toContain('预设已更新')
    await click('[aria-haspopup="dialog"]')
    await click('[role="option"]')
    expect(container.textContent).not.toContain('预设已更新')
  })
})
