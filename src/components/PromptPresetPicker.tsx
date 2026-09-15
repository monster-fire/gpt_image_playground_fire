import { useEffect, useState, useSyncExternalStore } from 'react'
import { selectPromptPreset, useStore } from '../store'
import { getPromptPresetState, loadPromptPresets, subscribePromptPresets } from '../lib/promptPresets'
import PromptPresetManager from './PromptPresetManager'

export default function PromptPresetPicker() {
  const state = useSyncExternalStore(subscribePromptPresets, getPromptPresetState)
  const mode = useStore((s) => s.appMode)
  const selected = useStore((s) => s.appMode === 'gallery' ? s.galleryPromptPresetId : s.agentConversations.find((c) => c.id === s.activeAgentConversationId)?.promptPresetId ?? null)
  const [manage, setManage] = useState(false)
  const [seenRevisions, setSeenRevisions] = useState<Record<string, string>>({})
  const preset = state.presets.find((p) => p.id === selected)
  useEffect(() => {
    if (preset && seenRevisions[preset.id] === undefined) setSeenRevisions((seen) => ({ ...seen, [preset.id]: preset.revision }))
  }, [preset, seenRevisions])
  useEffect(() => {
    if (state.loaded && selected && !state.presets.some((p) => p.id === selected)) selectPromptPreset(null)
  }, [state.loaded, state.presets, selected, mode])
  return <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
    <select aria-label="提示词预设" title={state.presets.find((p) => p.id === selected)?.name ?? '不使用预设'} value={selected ?? ''}
      className="min-h-11 min-w-0 max-w-full flex-1 sm:flex-none sm:w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2"
      onChange={(event) => event.target.value === '__manage__' ? setManage(true) : selectPromptPreset(event.target.value || null)}>
      <option value="">不使用预设</option>
      {state.presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      <option value="__manage__">管理预设</option>
    </select>
    {preset && seenRevisions[preset.id] !== undefined && seenRevisions[preset.id] !== preset.revision && <span role="status">预设已更新</span>}
    {state.loading && <span role="status">正在同步预设…</span>}
    {state.error && <><span role="alert" className="text-red-600 break-words">{state.error}</span><button className="min-h-11 text-blue-600" onClick={() => void loadPromptPresets({ force: true }).catch(() => {})}>重试</button></>}
    <PromptPresetManager open={manage} initialPresetId={selected} onClose={() => setManage(false)} />
  </div>
}
