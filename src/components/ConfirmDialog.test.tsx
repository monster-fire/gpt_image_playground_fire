// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConfirmDialog from './ConfirmDialog'

const storeMock = vi.hoisted(() => {
  type ConfirmDialogState = {
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    showCancel?: boolean
    buttons?: Array<{
      label: string
      tone?: 'primary' | 'secondary' | 'danger' | 'warning'
      action: (checkboxChecked?: boolean) => void | boolean | Promise<void | boolean>
    }>
    requiredText?: string
    awaitAction?: boolean
    action?: (checkboxChecked?: boolean) => void | boolean | Promise<void | boolean>
  } | null

  const state = {
    confirmDialog: null as ConfirmDialogState,
    setConfirmDialog: vi.fn((dialog: ConfirmDialogState) => {
      state.confirmDialog = dialog
    }),
  }

  const useStore = vi.fn((selector: (s: typeof state) => unknown) => selector(state)) as unknown as ((selector: (s: typeof state) => unknown) => unknown) & { getState: () => typeof state }
  useStore.getState = () => state

  return {
    state,
    useStore,
  }
})

vi.mock('../store', () => ({
  useStore: storeMock.useStore,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ConfirmDialog', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    storeMock.state.confirmDialog = null
    storeMock.state.setConfirmDialog.mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.style.overflow = ''
  })

  function render() {
    act(() => {
      root.render(<ConfirmDialog />)
    })
  }

  async function flushFocus() {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }

  function click(el: Element) {
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  async function changeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, value)
    await act(async () => {
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('uses dialog semantics, focuses the cancel button, and restores focus after close', async () => {
    const opener = document.createElement('button')
    opener.textContent = '打开'
    document.body.appendChild(opener)
    opener.focus()
    storeMock.state.confirmDialog = {
      title: '删除任务',
      message: '确定要删除这个任务吗？',
      action: vi.fn(),
    }

    render()
    await flushFocus()

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement | null
    expect(dialog).toBeTruthy()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog?.getAttribute('aria-describedby')).toBeTruthy()
    expect((document.activeElement as HTMLElement).textContent).toBe('取消')

    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(storeMock.state.setConfirmDialog).toHaveBeenCalledWith(null)

    render()
    await flushFocus()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('keeps tab focus inside the dialog', async () => {
    storeMock.state.confirmDialog = {
      title: '确认操作',
      message: '继续执行吗？',
      action: vi.fn(),
    }

    render()
    await flushFocus()

    const buttons = container.querySelectorAll('button')
    buttons[1]?.focus()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    })

    expect(document.activeElement).toBe(buttons[0])
  })

  it('waits for custom button actions before closing', async () => {
    const pending = deferred<void>()
    const action = vi.fn(() => pending.promise)
    storeMock.state.confirmDialog = {
      title: '选择处理方式',
      message: '请选择继续方式。',
      buttons: [{ label: '继续', action }],
    }

    render()
    await flushFocus()

    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '继续') as HTMLButtonElement
    click(button)

    expect(button.disabled).toBe(true)
    expect(storeMock.state.setConfirmDialog).not.toHaveBeenCalledWith(null)
    await act(async () => {})
    expect(action).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.resolve()
      await pending.promise
    })

    expect(storeMock.state.setConfirmDialog).toHaveBeenCalledWith(null)
  })

  it('keeps a custom button dialog open when the action returns false', async () => {
    const action = vi.fn(() => false)
    storeMock.state.confirmDialog = {
      title: '关闭设置',
      message: '配置保存失败后应停留。',
      buttons: [{ label: '保存', action }],
    }

    render()
    await flushFocus()

    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '保存') as HTMLButtonElement
    click(button)
    await act(async () => {})

    expect(action).toHaveBeenCalledTimes(1)
    expect(storeMock.state.setConfirmDialog).not.toHaveBeenCalledWith(null)
    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
  })

  it('shows an error and keeps a normal awaitAction dialog open when the action rejects', async () => {
    const action = vi.fn(async () => {
      throw new Error('删除失败，请重试')
    })
    storeMock.state.confirmDialog = {
      title: '删除任务',
      message: '删除后不可恢复。',
      awaitAction: true,
      action,
    }

    render()
    await flushFocus()

    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '确认删除') as HTMLButtonElement
    click(button)
    await act(async () => {})

    expect(action).toHaveBeenCalledTimes(1)
    expect(storeMock.state.setConfirmDialog).not.toHaveBeenCalledWith(null)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('删除失败，请重试')
    expect(button.disabled).toBe(false)
  })

  it('shows an error and keeps a custom button dialog open when the action rejects', async () => {
    const action = vi.fn(async () => {
      throw new Error('保存失败')
    })
    storeMock.state.confirmDialog = {
      title: '关闭设置',
      message: '保存后关闭。',
      buttons: [{ label: '保存', action }],
    }

    render()
    await flushFocus()

    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '保存') as HTMLButtonElement
    click(button)
    await act(async () => {})

    expect(action).toHaveBeenCalledTimes(1)
    expect(storeMock.state.setConfirmDialog).not.toHaveBeenCalledWith(null)
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('保存失败')
  })

  it('does not close a new dialog opened by the previous action', async () => {
    const nextDialog = {
      title: '下一步确认',
      message: '这是新的确认框。',
      action: vi.fn(),
    }
    const action = vi.fn(() => {
      storeMock.state.confirmDialog = nextDialog
    })
    storeMock.state.confirmDialog = {
      title: '遮罩确认',
      message: '继续处理遮罩。',
      awaitAction: true,
      action,
    }

    render()
    await flushFocus()

    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '确认') as HTMLButtonElement
    click(button)
    await act(async () => {})

    expect(action).toHaveBeenCalledTimes(1)
    expect(storeMock.state.setConfirmDialog).not.toHaveBeenCalledWith(null)
    expect(storeMock.state.confirmDialog).toBe(nextDialog)
  })

  it('requires matching text before confirming destructive actions', async () => {
    const action = vi.fn()
    storeMock.state.confirmDialog = {
      title: '清空本地数据',
      message: '该操作会删除本地历史。',
      requiredText: '清空',
      action,
    }

    render()
    await flushFocus()

    const input = container.querySelector('input') as HTMLInputElement
    const confirmButton = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === '确认删除') as HTMLButtonElement
    expect(document.activeElement).toBe(input)
    expect(confirmButton.disabled).toBe(true)

    await changeInput(input, '清')
    expect(confirmButton.disabled).toBe(true)

    await changeInput(input, '清空')
    expect(confirmButton.disabled).toBe(false)

    click(confirmButton)
    expect(action).toHaveBeenCalledTimes(1)
    expect(storeMock.state.setConfirmDialog).toHaveBeenCalledWith(null)
  })
})
