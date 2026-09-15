import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { deletePromptPreset, getPromptPresetState, loadPromptPresets, savePromptPreset, subscribePromptPresets, type PromptPreset } from '../lib/promptPresets'
import { useStore } from '../store'
import { CloseIcon, CopyIcon, EditIcon, PlusIcon, RefreshIcon, TrashIcon } from './icons'
import { TooltipButton } from './TooltipButton'

type PromptPresetManagerProps = {
  open: boolean
  initialPresetId?: string | null
  onClose: () => void
}

type Draft = {
  id: string | null
  name: string
  content: string
  dirty: boolean
  baseRevision: string
}

const emptyDraft: Draft = { id: null, name: '', content: '', dirty: false, baseRevision: '' }

function draftFromPreset(preset: PromptPreset, libraryRevision: string): Draft {
  return { id: preset.id, name: preset.name, content: preset.content, dirty: false, baseRevision: libraryRevision }
}

export default function PromptPresetManager({ open, initialPresetId, onClose }: PromptPresetManagerProps) {
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const [presetState, setPresetState] = useState(getPromptPresetState())
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const modalRef = useRef<HTMLDivElement>(null)
  const openedRef = useRef(false)

  useCloseOnEscape(open && !saving, () => requestClose())
  useDialogFocus(open, modalRef)
  usePreventBackgroundScroll(open, modalRef)

  useEffect(() => subscribePromptPresets(() => {
    try {
      setPresetState(getPromptPresetState())
    } catch (err) {
      console.error('同步提示词预设状态失败', err)
    }
  }), [])

  useEffect(() => {
    if (!open) return
    void loadPromptPresets().catch(() => {})
  }, [open])

  useEffect(() => {
    if (!open) {
      openedRef.current = false
      return
    }
    if (openedRef.current) return
    openedRef.current = true
    setError('')
    const preset = presetState.presets.find((item) => item.id === initialPresetId) ?? presetState.presets[0]
    setDraft(preset ? draftFromPreset(preset, presetState.revision) : { ...emptyDraft, baseRevision: presetState.revision })
  }, [initialPresetId, open, presetState.presets, presetState.revision])

  const selectedPreset = presetState.presets.find((preset) => preset.id === draft.id) ?? null
  const canSave = draft.name.trim() && draft.content.trim() && !saving

  if (!open) return null

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch, dirty: true }))
    setError('')
  }

  function requestClose() {
    if (saving) return
    if (!draft.dirty) {
      onClose()
      return
    }
    setConfirmDialog({
      title: '放弃未保存的预设修改',
      message: '当前预设编辑内容还没有保存，确定要关闭吗？',
      confirmText: '放弃修改',
      action: () => {
        setDraft(selectedPreset ? draftFromPreset(selectedPreset, presetState.revision) : { ...emptyDraft, baseRevision: presetState.revision })
        onClose()
      },
    })
  }

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    setError('')
    try {
      const result = await savePromptPreset({ id: draft.id ?? undefined, name: draft.name, content: draft.content, baseRevision: draft.baseRevision })
      const saved = result.presets.find((preset) => preset.name === draft.name.trim() && preset.content === draft.content.trim()) ?? result.presets[0]
      if (saved) setDraft(draftFromPreset(saved, result.revision))
      showToast('提示词预设已保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : '提示词预设保存失败')
    } finally {
      setSaving(false)
    }
  }

  function handleCopy(preset: PromptPreset) {
    setDraft({
      id: null,
      name: `${preset.name} 副本`,
      content: preset.content,
      dirty: true,
      baseRevision: presetState.revision,
    })
    setError('')
  }

  function handleDelete(preset: PromptPreset) {
    setConfirmDialog({
      title: '删除提示词预设',
      message: `确定要删除「${preset.name}」吗？删除后所有设备后续都会看不到这个预设，历史记录中的发送快照不会被删除。`,
      confirmText: '确认删除',
      tone: 'danger',
      awaitAction: true,
      action: async () => {
        try {
          await deletePromptPreset(preset.id)
          if (draft.id === preset.id) setDraft({ ...emptyDraft, baseRevision: getPromptPresetState().revision })
          showToast('提示词预设已删除')
        } catch (err) {
          setError(err instanceof Error ? err.message : '提示词预设删除失败')
          return false
        }
      },
    })
  }

  return createPortal(
    <div className="fixed inset-0 z-[105] flex items-center justify-center p-4 sm:p-6" onClick={requestClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-overlay-in" />
      <div ref={modalRef} role="dialog" aria-modal="true" tabIndex={-1} className="relative z-10 flex max-h-[88vh] w-full max-w-[820px] overflow-hidden rounded-3xl border border-white/50 bg-white/95 shadow-[0_8px_40px_rgb(0,0,0,0.12)] ring-1 ring-black/5 backdrop-blur-xl animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] dark:ring-white/10" onClick={(event) => event.stopPropagation()}>
        <div className="flex w-72 shrink-0 flex-col border-r border-gray-100 bg-gray-50/80 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4 dark:border-white/[0.06]">
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">提示词预设</h2>
            <TooltipButton tooltip="刷新" onClick={() => void loadPromptPresets({ force: true }).catch(() => {})} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200">
              <RefreshIcon className="h-4 w-4" />
            </TooltipButton>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar py-2">
            {presetState.loading && <div className="px-4 py-3 text-sm text-gray-400">正在读取预设...</div>}
            {!presetState.loading && presetState.presets.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">暂无预设</div>}
            {presetState.presets.map((preset) => (
              <div
                key={preset.id}
                role="button"
                tabIndex={0}
                onClick={() => setDraft(draftFromPreset(preset, presetState.revision))}
                aria-current={draft.id === preset.id ? 'true' : undefined}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  setDraft(draftFromPreset(preset, presetState.revision))
                }}
                className={`group flex w-full items-center gap-2 px-4 py-3 text-left transition ${draft.id === preset.id ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200' : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/[0.05]'}`}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-medium" title={preset.name}>{preset.name}</span>
                <TooltipButton tooltip="复制" onClick={(event) => { event.stopPropagation(); handleCopy(preset) }} className="rounded-md p-1 text-gray-400 opacity-0 hover:bg-white hover:text-gray-700 group-hover:opacity-100 dark:hover:bg-white/[0.08] dark:hover:text-white">
                  <CopyIcon className="h-3.5 w-3.5" />
                </TooltipButton>
                <TooltipButton tooltip="删除" onClick={(event) => { event.stopPropagation(); handleDelete(preset) }} className="rounded-md p-1 text-gray-400 opacity-0 hover:bg-white hover:text-red-500 group-hover:opacity-100 dark:hover:bg-white/[0.08] dark:hover:text-red-300">
                  <TrashIcon className="h-3.5 w-3.5" />
                </TooltipButton>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 p-4 dark:border-white/[0.06]">
            <button type="button" onClick={() => { setDraft({ ...emptyDraft, baseRevision: presetState.revision }); setError('') }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-200 px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-300 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/20">
              <PlusIcon className="h-4 w-4" />
              新建预设
            </button>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4 dark:border-white/[0.06]">
            <div className="flex min-w-0 items-center gap-2">
              <EditIcon className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="truncate text-base font-semibold text-gray-800 dark:text-gray-100">{draft.id ? '编辑预设' : '新建预设'}</span>
            </div>
            <TooltipButton tooltip="关闭" onClick={requestClose} className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.08] dark:hover:text-gray-200">
              <CloseIcon className="h-5 w-5" />
            </TooltipButton>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
            <label className="mb-4 block">
              <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200">名称</span>
              <input
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
                className="w-full rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2.5 text-sm text-gray-800 outline-none transition focus:border-blue-400 focus:ring-1 focus:ring-blue-300/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:border-blue-400"
                placeholder="例如：女性写真 · 丰腴曲线"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200">预设内容</span>
              <textarea
                value={draft.content}
                onChange={(event) => updateDraft({ content: event.target.value })}
                className="min-h-[340px] w-full resize-y rounded-xl border border-gray-200/70 bg-white/70 px-3 py-2.5 text-sm leading-relaxed text-gray-800 outline-none transition focus:border-blue-400 focus:ring-1 focus:ring-blue-300/40 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-100 dark:focus:border-blue-400"
                placeholder="输入可复用的角色、风格、画面要求..."
              />
            </label>
            {(error || presetState.error) && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">{error || presetState.error}</div>}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-100 px-6 py-4 dark:border-white/[0.06]">
            <button type="button" onClick={requestClose} className="rounded-xl px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.08]">取消</button>
            <button type="button" disabled={!canSave} onClick={handleSave} className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
