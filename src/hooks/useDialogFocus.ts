import { useEffect, type RefObject } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let nextDialogFocusId = 0
const dialogStack: Array<{ id: number; dialog: HTMLElement; previous: HTMLElement | null }> = []

function getTopDialog() {
  return dialogStack[dialogStack.length - 1]
}

function isHiddenBySelfOrAncestor(el: HTMLElement) {
  let current: HTMLElement | null = el
  while (current) {
    if (current.hidden) return true
    if (current.getAttribute('aria-hidden') === 'true') return true
    const style = window.getComputedStyle(current)
    if (style.display === 'none' || style.visibility === 'hidden') return true
    current = current.parentElement
  }
  return false
}

function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  if (el.hasAttribute('disabled')) return false
  return !isHiddenBySelfOrAncestor(el)
}

function getFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isFocusable)
}

export function useDialogFocus(active: boolean, dialogRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    if (!dialog) return
    const id = ++nextDialogFocusId
    dialogStack.push({ id, dialog, previous })

    const isTopDialog = () => getTopDialog()?.id === id

    const focusableElements = getFocusableElements(dialog)
    const focusTarget =
      focusableElements.find((el) => el.hasAttribute('data-autofocus')) ??
      focusableElements[0] ??
      dialog

    const focusTimer = window.setTimeout(() => {
      if (isTopDialog() && document.contains(focusTarget) && !isHiddenBySelfOrAncestor(focusTarget)) focusTarget.focus()
    }, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopDialog()) return
      if (event.key !== 'Tab') return
      const elements = getFocusableElements(dialog)
      if (elements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const onFocusIn = () => {
      if (!isTopDialog()) return
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement && dialog.contains(activeElement)) return
      const target = getFocusableElements(dialog)[0] ?? dialog
      target.focus()
    }

    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      const index = dialogStack.findIndex((item) => item.id === id)
      if (index >= 0) dialogStack.splice(index, 1)
      const fallback = getTopDialog()?.dialog.querySelector<HTMLElement>('[data-autofocus]') ??
        (getTopDialog()?.dialog ? getFocusableElements(getTopDialog()!.dialog)[0] : null) ??
        document.querySelector<HTMLElement>('main button:not([disabled]), main [href], button:not([disabled]), [href]')
      const restoreTarget = previous && document.contains(previous) && !isHiddenBySelfOrAncestor(previous)
        ? previous
        : fallback
      restoreTarget?.focus()
    }
  }, [active, dialogRef])
}
