// @vitest-environment jsdom
import React, { useRef, useState } from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useDialogFocus } from '../hooks/useDialogFocus'

function ParentChildDialog({ onParentClose, onChildClose }: { onParentClose: () => void; onChildClose: () => void }) {
  const [parentOpen, setParentOpen] = useState(false)
  const [childOpen, setChildOpen] = useState(false)
  const parentRef = useRef<HTMLDivElement>(null)
  const childRef = useRef<HTMLDivElement>(null)

  useCloseOnEscape(parentOpen && !childOpen, () => {
    setParentOpen(false)
    onParentClose()
  })
  useDialogFocus(parentOpen && !childOpen, parentRef)
  useCloseOnEscape(childOpen, () => {
    setChildOpen(false)
    onChildClose()
  })
  useDialogFocus(childOpen, childRef)

  return (
    <div>
      <button type="button" onClick={() => setParentOpen(true)}>打开父弹窗</button>
      {parentOpen && (
        <div ref={parentRef} role="dialog" aria-modal="true" aria-label="父弹窗" tabIndex={-1}>
          <button type="button" data-autofocus onClick={() => setChildOpen(true)}>打开子弹窗</button>
          <button type="button">父弹窗按钮</button>
        </div>
      )}
      {childOpen && (
        <div ref={childRef} role="dialog" aria-modal="true" aria-label="子弹窗" tabIndex={-1}>
          <button type="button" data-autofocus onClick={() => setChildOpen(false)}>关闭子弹窗</button>
          <button type="button">子弹窗按钮</button>
        </div>
      )}
    </div>
  )
}

describe('dialog focus integration', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  async function flushFocus() {
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }

  it('closes only the top nested dialog and restores focus in order', async () => {
    const onParentClose = vi.fn()
    const onChildClose = vi.fn()

    act(() => {
      root.render(<ParentChildDialog onParentClose={onParentClose} onChildClose={onChildClose} />)
    })
    const opener = container.querySelector('button') as HTMLButtonElement
    opener.focus()
    act(() => opener.click())
    await flushFocus()

    const parentButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '打开子弹窗') as HTMLButtonElement
    expect(document.activeElement).toBe(parentButton)

    act(() => parentButton.click())
    await flushFocus()
    const childButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '关闭子弹窗') as HTMLButtonElement
    expect(document.activeElement).toBe(childButton)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await flushFocus()

    expect(onChildClose).toHaveBeenCalledTimes(1)
    expect(onParentClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(parentButton)

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    })
    await flushFocus()

    expect(onParentClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(opener)
  })
})
