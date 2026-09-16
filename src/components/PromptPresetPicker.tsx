import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { useTooltip } from '../hooks/useTooltip'
import { selectPromptPreset, useStore } from '../store'
import { getPromptPresetState, loadPromptPresets, subscribePromptPresets } from '../lib/promptPresets'
import { CloseIcon, CollectionManageIcon, SettingsIcon } from './icons'
import { TooltipButton } from './TooltipButton'
import ViewportTooltip from './ViewportTooltip'
import PromptPresetManager from './PromptPresetManager'

export default function PromptPresetPicker() {
  const state = useSyncExternalStore(subscribePromptPresets, getPromptPresetState)
  const mode = useStore((s) => s.appMode)
  const selected = useStore((s) => s.appMode === 'gallery' ? s.galleryPromptPresetId : s.agentConversations.find((c) => c.id === s.activeAgentConversationId)?.promptPresetId ?? null)
  const [manage, setManage] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const tooltip = useTooltip()
  const [seenRevisions, setSeenRevisions] = useState<Record<string, string>>({})
  const preset = state.presets.find((p) => p.id === selected)
  const updated = preset && seenRevisions[preset.id] !== undefined && seenRevisions[preset.id] !== preset.revision
  const filtered = state.presets.filter((p) => p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  useCloseOnEscape(open, () => setOpen(false))
  useDialogFocus(open, menuRef)
  useEffect(() => {
    if (preset && seenRevisions[preset.id] === undefined) setSeenRevisions((seen) => ({ ...seen, [preset.id]: preset.revision }))
  }, [preset, seenRevisions])
  useEffect(() => {
    if (state.loaded && selected && !state.presets.some((p) => p.id === selected)) selectPromptPreset(null)
  }, [state.loaded, state.presets, selected, mode])
  useEffect(() => { setOpen(false) }, [mode])
  useEffect(() => { tooltip.dismiss() }, [selected, tooltip.dismiss])
  useEffect(() => {
    if (!open) return
    setQuery('')
    void loadPromptPresets().catch(() => {})
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useLayoutEffect(() => {
    if (!open) return
    // 菜单跟随工具栏锚点，避开窄屏边缘和软键盘，不改变输入区布局。
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const viewport = window.visualViewport
      const left = viewport?.offsetLeft ?? 0
      const top = viewport?.offsetTop ?? 0
      const width = viewport?.width ?? window.innerWidth
      const menuWidth = Math.min(320, width - 24)
      const maxHeight = Math.max(0, Math.min(360, rect.top - top - 20))
      setPosition({
        left: Math.min(Math.max(left + 12, rect.left), left + width - menuWidth - 12),
        top: rect.top - 8,
        width: menuWidth,
        maxHeight,
      })
    }
    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    window.visualViewport?.addEventListener('resize', reposition)
    window.visualViewport?.addEventListener('scroll', reposition)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
      window.visualViewport?.removeEventListener('resize', reposition)
      window.visualViewport?.removeEventListener('scroll', reposition)
    }
  }, [open, selected])

  return <div data-preset-picker className={`relative flex min-w-0 max-w-[10rem] shrink items-center rounded-lg text-xs ${preset ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'text-gray-500 dark:text-gray-300'}`}>
    <span className="relative flex min-w-0" {...tooltip.handlers}>
      <button ref={triggerRef} type="button" aria-label={preset ? `提示词预设：${preset.name}` : '提示词预设'} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => { tooltip.dismiss(); setOpen((value) => !value) }}
        className={`relative flex h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-400 dark:hover:bg-white/[0.08] sm:h-10 ${preset ? '' : 'w-11 shrink-0 sm:w-10'}`}>
        <CollectionManageIcon className="h-5 w-5 shrink-0" />
        {preset && <span className="min-w-0 truncate">{preset.name}</span>}
        {(state.error || updated) && <span className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ${state.error ? 'bg-red-500' : 'bg-amber-500'}`}><span className="sr-only">{state.error ? '预设同步失败' : '预设已更新'}</span></span>}
      </button>
      <ViewportTooltip visible={!open && tooltip.visible} className="max-w-72 break-words">{preset?.name ?? '提示词预设'}{state.error ? '（同步失败）' : updated ? '（已更新）' : ''}</ViewportTooltip>
    </span>
    {preset && <TooltipButton tooltip="取消预设" wrapperClassName="relative inline-flex shrink-0" className="flex h-11 w-8 items-center justify-center rounded-lg text-blue-500 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:hover:bg-blue-500/20 sm:h-10" onClick={() => { selectPromptPreset(null); setOpen(false); triggerRef.current?.focus() }}><CloseIcon className="h-3.5 w-3.5" /></TooltipButton>}
    {open && createPortal(<div ref={menuRef} id={menuId} role="dialog" aria-modal="true" aria-label="选择提示词预设" style={{ ...position, transform: 'translateY(-100%)' }}
      className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.nativeEvent.isComposing) return
        const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
        const index = options.indexOf(document.activeElement as HTMLButtonElement)
        if (index < 0 && !(event.target instanceof HTMLInputElement && event.key === 'ArrowDown')) return
        if (!options.length) return
        event.preventDefault()
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length
        options[next].focus()
      }}>
      <div className="shrink-0 border-b border-gray-100 p-2 dark:border-gray-800">
        <input data-autofocus aria-label="搜索预设" placeholder="搜索预设" value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 w-full rounded-md border border-gray-200 bg-transparent px-3 text-sm outline-none focus:ring-2 focus:ring-blue-400 dark:border-gray-700" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
        {state.loading && <p role="status" className="px-3 py-2 text-xs text-gray-500">正在同步预设…</p>}
        {state.error && <div role="alert" className="px-3 py-2 text-xs text-red-600 dark:text-red-400"><p className="break-words">{state.error}</p><button type="button" className="min-h-11 text-blue-600 dark:text-blue-400" onClick={() => void loadPromptPresets({ force: true }).catch(() => {})}>重试</button></div>}
        {updated && <p role="status" className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400">预设已更新</p>}
        <div role="listbox" aria-label="提示词预设列表">
          {filtered.map((p) => <button key={p.id} type="button" role="option" aria-selected={p.id === selected}
            onClick={() => { selectPromptPreset(p.id); setSeenRevisions((seen) => ({ ...seen, [p.id]: p.revision })); setOpen(false) }}
            className={`flex min-h-11 w-full items-center rounded-md px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400 ${p.id === selected ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.06]'}`}><span className="min-w-0 break-words [overflow-wrap:anywhere]">{p.name}</span></button>)}
        </div>
        {!filtered.length && !state.loading && !state.error && <p role="status" className="px-3 py-4 text-center text-xs text-gray-500">{query.trim() ? '未找到预设' : '暂无预设'}</p>}
      </div>
      <div className="shrink-0 border-t border-gray-100 p-1 dark:border-gray-800"><button type="button" className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-gray-600 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:text-gray-300 dark:hover:bg-white/[0.06]" onClick={() => { setOpen(false); setManage(true) }}><SettingsIcon className="h-4 w-4" />管理预设</button></div>
    </div>, document.body)}
    <PromptPresetManager open={manage} initialPresetId={selected} onClose={() => setManage(false)} />
  </div>
}
