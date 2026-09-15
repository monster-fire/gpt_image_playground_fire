// @vitest-environment jsdom

import React, { useRef, useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDialogFocus } from './useDialogFocus'

function Dialog({ open, label, children }: { open: boolean; label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(open, ref)
  if (!open) return null
  return (
    <div ref={ref} role="dialog" aria-label={label} tabIndex={-1}>
      {children}
    </div>
  )
}

function NestedDialogs() {
  const [parentOpen, setParentOpen] = useState(false)
  const [childOpen, setChildOpen] = useState(false)
  return (
    <main>
      <button type="button" onClick={() => setParentOpen(true)}>页面按钮</button>
      <Dialog open={parentOpen} label="父弹窗">
        <button type="button" data-autofocus onClick={() => setChildOpen(true)}>打开子弹窗</button>
        <button type="button">父级第二按钮</button>
      </Dialog>
      <Dialog open={childOpen} label="子弹窗">
        <button type="button" data-autofocus onClick={() => setChildOpen(false)}>关闭子弹窗</button>
        <button type="button">子级第二按钮</button>
      </Dialog>
    </main>
  )
}

describe('useDialogFocus', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  async function flushFocus() {
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
  }

  it('lets only the top dialog trap Tab focus', async () => {
    act(() => root.render(<NestedDialogs />))
    const pageButton = container.querySelector('main > button') as HTMLButtonElement
    act(() => pageButton.click())
    await flushFocus()
    const openChild = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '打开子弹窗') as HTMLButtonElement
    act(() => openChild.click())
    await flushFocus()

    const childButtons = Array.from(container.querySelectorAll('[aria-label="子弹窗"] button')) as HTMLButtonElement[]
    childButtons[1].focus()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    })

    expect(document.activeElement).toBe(childButtons[0])
  })

  it('skips autofocus targets hidden by an ancestor', async () => {
    function HiddenAutofocus() {
      const ref = useRef<HTMLDivElement>(null)
      useDialogFocus(true, ref)
      return (
        <div ref={ref} role="dialog" tabIndex={-1}>
          <div hidden>
            <button type="button" data-autofocus>隐藏按钮</button>
          </div>
          <button type="button">可见按钮</button>
        </div>
      )
    }

    act(() => root.render(<HiddenAutofocus />))
    await flushFocus()

    expect((document.activeElement as HTMLElement).textContent).toBe('可见按钮')
  })

  it('does not focus after unmounting before the initial timer fires', async () => {
    function App({ open }: { open: boolean }) {
      return (
        <main>
          <button type="button">页面按钮</button>
          <Dialog open={open} label="弹窗">
            <button type="button" data-autofocus>弹窗按钮</button>
          </Dialog>
        </main>
      )
    }

    act(() => root.render(<App open />))
    act(() => root.render(<App open={false} />))
    await flushFocus()

    expect((document.activeElement as HTMLElement).textContent).not.toBe('弹窗按钮')
  })

  it('falls back to a page button when the opener was removed', async () => {
    function App() {
      const [open, setOpen] = useState(false)
      const [showOpener, setShowOpener] = useState(true)
      return (
        <main>
          <button type="button">备用按钮</button>
          {showOpener && <button type="button" onClick={() => { setOpen(true); setShowOpener(false) }}>打开</button>}
          <Dialog open={open} label="弹窗">
            <button type="button" data-autofocus onClick={() => setOpen(false)}>关闭</button>
          </Dialog>
        </main>
      )
    }

    act(() => root.render(<App />))
    const opener = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '打开') as HTMLButtonElement
    opener.focus()
    act(() => opener.click())
    await flushFocus()
    const close = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '关闭') as HTMLButtonElement
    act(() => close.click())
    await flushFocus()

    expect((document.activeElement as HTMLElement).textContent).toBe('备用按钮')
  })

  it('pulls focus back from the page into the top dialog', async () => {
    act(() => root.render(<NestedDialogs />))
    const pageButton = container.querySelector('main > button') as HTMLButtonElement
    act(() => pageButton.click())
    await flushFocus()

    pageButton.focus()
    act(() => {
      pageButton.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    })

    expect((document.activeElement as HTMLElement).textContent).toBe('打开子弹窗')
  })
})
