import { useEffect, useId, useRef, useState } from 'react'
import { useStore } from '../store'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { Checkbox } from './Checkbox'
import { CopyIcon } from './icons'

function renderMessage(message: string) {
  return message.split(/(`[^`]+`|「[^」]+」|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={index} className="rounded bg-gray-100 px-1 py-0.5 text-[0.85em] text-gray-700 dark:bg-white/[0.06] dark:text-gray-200">
          {part.slice(1, -1)}
        </code>
      )
    }

    if (part.startsWith('「') && part.endsWith('」')) {
      return (
        <strong key={index} className="font-semibold text-gray-700 dark:text-gray-200">
          {part}
        </strong>
      )
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-gray-700 dark:text-gray-200">
          {part.slice(2, -2)}
        </strong>
      )
    }

    return part
  })
}

function getActionButtonClass(tone: 'primary' | 'secondary' | 'danger' | 'warning' = 'primary') {
  if (tone === 'secondary') {
    return 'border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-white/[0.08] dark:text-gray-400 dark:hover:bg-white/[0.06]'
  }
  if (tone === 'warning') return 'bg-orange-500 text-white hover:bg-orange-600'
  if (tone === 'danger') return 'bg-red-500 text-white hover:bg-red-600'
  return 'bg-blue-500 text-white hover:bg-blue-600'
}

function getActionErrorMessage(err: unknown) {
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return '操作失败，请重试'
}

export default function ConfirmDialog() {
  const confirmDialog = useStore((s) => s.confirmDialog)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const messageId = useId()
  const [canConfirm, setCanConfirm] = useState(true)
  const [checkboxChecked, setCheckboxChecked] = useState(false)
  const [requiredTextValue, setRequiredTextValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    const delay = confirmDialog?.minConfirmDelayMs ?? 0
    if (!confirmDialog || delay <= 0) {
      setCanConfirm(true)
      return
    }

    setCanConfirm(false)
    const timer = window.setTimeout(() => setCanConfirm(true), delay)
    return () => window.clearTimeout(timer)
  }, [confirmDialog])

  useEffect(() => {
    setCheckboxChecked(confirmDialog?.checkbox?.defaultChecked ?? false)
    setRequiredTextValue('')
    setIsSubmitting(false)
    setActionError('')
  }, [confirmDialog])

  const handleClose = () => {
    if (!canConfirm || isSubmitting) return
    setConfirmDialog(null)
  }

  const handleCancel = () => {
    confirmDialog?.cancelAction?.(checkboxChecked)
    handleClose()
  }

  const closeIfCurrent = (dialog: NonNullable<typeof confirmDialog>) => {
    if (useStore.getState().confirmDialog === dialog) setConfirmDialog(null)
  }

  useCloseOnEscape(Boolean(confirmDialog) && canConfirm, handleClose)
  useDialogFocus(Boolean(confirmDialog), dialogRef)
  usePreventBackgroundScroll(Boolean(confirmDialog))

  if (!confirmDialog) return null
  const isDestructive = confirmDialog.title.includes('删除') || confirmDialog.title.includes('清空')
  const confirmTone = confirmDialog.tone ?? (isDestructive ? 'danger' : undefined)
  const confirmClassName = getActionButtonClass(confirmTone === 'danger' || confirmTone === 'warning' ? confirmTone : 'primary')
  const confirmText = confirmDialog.confirmText ?? (isDestructive ? '确认删除' : '确认')
  const cancelText = confirmDialog.cancelText ?? '取消'
  const customButtons = confirmDialog.buttons?.filter((button) => button.label.trim()) ?? []
  const showCancel = confirmDialog.showCancel !== false
  const requiredTextMatched = !confirmDialog.requiredText || requiredTextValue === confirmDialog.requiredText
  const canSubmitAction = canConfirm && requiredTextMatched
  const shouldFocusRequiredText = Boolean(confirmDialog.requiredText)
  const shouldFocusConfirm = !shouldFocusRequiredText && !showCancel
  const shouldFocusCancel = !shouldFocusRequiredText && showCancel

  return (
    <div
      data-no-drag-select
      className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        className="relative bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] rounded-3xl shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] max-w-sm w-full p-6 z-10 ring-1 ring-black/5 dark:ring-white/10 animate-confirm-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="mb-2 flex items-center gap-2 text-base font-bold text-gray-800 dark:text-gray-100">
          {confirmDialog.icon === 'info' && (
            <svg className="h-5 w-5 shrink-0 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
          )}
          {confirmDialog.icon === 'copy' && (
            <CopyIcon className="h-5 w-5 shrink-0 text-blue-500" />
          )}
          {confirmDialog.title}
        </h3>
        <p id={messageId} className={`text-sm text-gray-500 dark:text-gray-400 ${confirmDialog.checkbox ? 'mb-4' : 'mb-6'} leading-relaxed whitespace-pre-line ${confirmDialog.messageAlign === 'center' ? 'text-center' : ''}`}>
          {renderMessage(confirmDialog.message)}
        </p>
        {confirmDialog.checkbox && (
          <Checkbox
            checked={checkboxChecked}
            onChange={setCheckboxChecked}
            label={confirmDialog.checkbox.label}
            tone={confirmDialog.checkbox.tone}
            disabled={confirmDialog.checkbox.disabled}
            className="mb-6"
          />
        )}
        {confirmDialog.requiredText && (
          <label className="mb-6 block text-sm text-gray-600 dark:text-gray-300">
            <span className="mb-2 block">
              请输入 <strong className="font-semibold text-gray-800 dark:text-gray-100">{confirmDialog.requiredText}</strong> 确认操作
            </span>
            <input
              type="text"
              value={requiredTextValue}
              onChange={(event) => {
                setRequiredTextValue(event.target.value)
                setActionError('')
              }}
              data-autofocus={shouldFocusRequiredText ? true : undefined}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none transition focus:border-red-400 focus:ring-2 focus:ring-red-100 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:border-red-400 dark:focus:ring-red-400/20"
              aria-label={`输入 ${confirmDialog.requiredText} 确认操作`}
            />
          </label>
        )}
        {actionError && (
          <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200">
            {actionError}
          </div>
        )}
        {customButtons.length > 0 ? (
          <div className="flex gap-2">
            {customButtons.map((button) => (
              <button
                key={button.label}
                onClick={() => {
                  if (!canSubmitAction || isSubmitting) return
                  const dialog = confirmDialog
                  setActionError('')
                  setIsSubmitting(true)
                  void (async () => {
                    const shouldClose = await button.action(checkboxChecked)
                    return shouldClose
                  })()
                    .then((shouldClose: void | boolean) => {
                      if (shouldClose !== false) closeIfCurrent(dialog)
                    })
                    .catch((err) => setActionError(getActionErrorMessage(err)))
                    .finally(() => setIsSubmitting(false))
                }}
                disabled={!canSubmitAction || isSubmitting}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${getActionButtonClass(button.tone)}`}
              >
                {button.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex gap-2">
            {showCancel && (
              <button
                onClick={handleCancel}
                disabled={isSubmitting}
                data-autofocus={shouldFocusCancel ? true : undefined}
                className="flex-1 py-2 rounded-xl border border-gray-200 dark:border-white/[0.08] text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06] transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {cancelText}
              </button>
            )}
            <button
              onClick={() => {
                if (!canSubmitAction || isSubmitting) return
                const dialog = confirmDialog
                setActionError('')
                if (!confirmDialog.awaitAction) {
                  try {
                    const shouldClose = confirmDialog.action?.(checkboxChecked)
                    if (shouldClose !== false) closeIfCurrent(dialog)
                  } catch (err) {
                    setActionError(getActionErrorMessage(err))
                  }
                  return
                }
                setIsSubmitting(true)
                void (async () => {
                  try {
                    const shouldClose = await confirmDialog.action?.(checkboxChecked)
                    if (shouldClose !== false) closeIfCurrent(dialog)
                  } catch (err) {
                    setActionError(getActionErrorMessage(err))
                  } finally {
                    setIsSubmitting(false)
                  }
                })()
              }}
              disabled={!canSubmitAction || isSubmitting}
              data-autofocus={shouldFocusConfirm ? true : undefined}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${confirmClassName}`}
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
