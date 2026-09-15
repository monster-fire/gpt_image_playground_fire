// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPromptPresets, loadPromptPresets } from '../lib/promptPresets'
import PromptPresetManager from './PromptPresetManager'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const storeMock = vi.hoisted(() => ({
  setConfirmDialog: vi.fn(),
  showToast: vi.fn(),
  useStore: vi.fn((selector: (s: { setConfirmDialog: typeof storeMock.setConfirmDialog, showToast: typeof storeMock.showToast }) => unknown) => selector({
    setConfirmDialog: storeMock.setConfirmDialog,
    showToast: storeMock.showToast,
  })),
}))

vi.mock('../store', () => ({
  useStore: storeMock.useStore,
}))

describe('PromptPresetManager', () => {
  let container: HTMLDivElement
  let root: Root
  let fetcher: ReturnType<typeof vi.fn>
  let onClose: () => void

  beforeEach(() => {
    clearPromptPresets()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose = vi.fn() as () => void
    fetcher = vi.fn().mockResolvedValue(Response.json({
      presets: [{ id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }],
      revision: 'r1',
    }))
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('BroadcastChannel', class {
      onmessage: ((event: MessageEvent) => void) | null = null
      postMessage = vi.fn()
      close = vi.fn()
    })
    storeMock.setConfirmDialog.mockClear()
    storeMock.showToast.mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    clearPromptPresets()
    vi.unstubAllGlobals()
  })

  async function render(open = true, initialPresetId?: string | null) {
    await act(async () => {
      root.render(<PromptPresetManager open={open} initialPresetId={initialPresetId} onClose={onClose} />)
    })
    await act(async () => {})
  }

  function inputText(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter?.call(el, value)
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  it('shows only name and content fields for editing', async () => {
    await render()

    expect(document.body.textContent).toContain('提示词预设')
    expect(document.body.querySelector('input[placeholder="例如：女性写真 · 丰腴曲线"]')).toBeTruthy()
    expect(document.body.querySelector('textarea[placeholder="输入可复用的角色、风格、画面要求..."]')).toBeTruthy()
    expect(document.body.textContent).not.toContain('公共画面需求')
    expect(document.body.textContent).not.toContain('Agent补充指令')
  })

  it('keeps the edited draft when server save fails', async () => {
    fetcher
      .mockResolvedValueOnce(Response.json({
        presets: [{ id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }],
        revision: 'r1',
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'conflict' } }), { status: 409, headers: { 'Content-Type': 'application/json' } }))

    await render()
    const input = document.body.querySelector('input[placeholder="例如：女性写真 · 丰腴曲线"]') as HTMLInputElement
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement

    await act(async () => {
      inputText(input, '新名称')
      inputText(textarea, '新的多行内容')
    })

    const saveButton = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === '保存')!
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(document.body.textContent).toContain('conflict')
    expect((document.body.querySelector('input[placeholder="例如：女性写真 · 丰腴曲线"]') as HTMLInputElement).value).toBe('新名称')
    expect((document.body.querySelector('textarea') as HTMLTextAreaElement).value).toBe('新的多行内容')
  })

  it('does not overwrite a dirty draft after background sync', async () => {
    fetcher
      .mockResolvedValueOnce(Response.json({
        presets: [{ id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }],
        revision: 'r1',
      }))
      .mockResolvedValueOnce(Response.json({
        presets: [{ id: 'p1', name: '写真', content: '其他标签更新', revision: 'pr2', createdAt: 1, updatedAt: 2 }],
        revision: 'r2',
      }))
      .mockResolvedValueOnce(Response.json({
        presets: [{ id: 'p1', name: '写真', content: '自己的草稿', revision: 'pr3', createdAt: 1, updatedAt: 3 }],
        revision: 'r3',
      }))

    await render()
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      inputText(textarea, '自己的草稿')
    })
    await act(async () => {
      await loadPromptPresets({ force: true })
    })

    expect((document.body.querySelector('textarea') as HTMLTextAreaElement).value).toBe('自己的草稿')

    expect(fetcher.mock.calls.some((call) => call[1]?.method === 'PUT')).toBe(false)
  })

  it('resets draft when closed and reopened with a different initial preset', async () => {
    fetcher.mockResolvedValue(Response.json({
      presets: [
        { id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 },
        { id: 'p2', name: '插画', content: '水彩', revision: 'pr2', createdAt: 1, updatedAt: 1 },
      ],
      revision: 'r1',
    }))

    await render(true, 'p1')
    await act(async () => {
      inputText(document.body.querySelector('textarea') as HTMLTextAreaElement, '未保存')
    })
    await render(false, 'p1')
    await render(true, 'p2')

    expect((document.body.querySelector('input[placeholder="例如：女性写真 · 丰腴曲线"]') as HTMLInputElement).value).toBe('插画')
    expect((document.body.querySelector('textarea') as HTMLTextAreaElement).value).toBe('水彩')
  })

  it('does not close while saving', async () => {
    let resolveSave!: (value: Response) => void
    fetcher
      .mockResolvedValueOnce(Response.json({
        presets: [{ id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }],
        revision: 'r1',
      }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => {
        resolveSave = resolve
      }))

    await render()
    await act(async () => {
      inputText(document.body.querySelector('textarea') as HTMLTextAreaElement, '保存中')
    })
    const saveButton = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent === '保存')!
    await act(async () => {
      saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(onClose).not.toHaveBeenCalled()

    await act(async () => {
      resolveSave(Response.json({
        presets: [{ id: 'p1', name: '写真', content: '保存中', revision: 'pr2', createdAt: 1, updatedAt: 2 }],
        revision: 'r2',
      }))
    })
  })
})
