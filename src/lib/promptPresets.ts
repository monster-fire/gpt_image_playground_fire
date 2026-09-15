import { nasFetch } from './nasAuth'

export type PromptPreset = {
  id: string
  name: string
  content: string
  revision: string
  createdAt: number
  updatedAt: number
}

export type PromptPresetDraft = {
  id?: string
  name: string
  content: string
  baseRevision?: string
}

export type PromptPresetSnapshot = {
  id: string
  name: string
  revision: string
  content: string
}

export type PromptPresetState = {
  presets: PromptPreset[]
  revision: string
  loading: boolean
  error: string
  loaded: boolean
}

const listeners = new Set<() => void>()
let state: PromptPresetState = {
  presets: [],
  revision: '',
  loading: false,
  error: '',
  loaded: false,
}
let loadGeneration = 0
let loadPromise: Promise<PromptPresetState> | null = null
let channel: BroadcastChannel | null = null

function emit() {
  for (const listener of listeners) listener()
}

function setState(patch: Partial<PromptPresetState>) {
  state = { ...state, ...patch }
  emit()
}

function ensureChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel
  channel = new BroadcastChannel('prompt-presets')
  channel.onmessage = (event) => {
    if (event.data?.type === 'prompt-presets-updated') void loadPromptPresets({ force: true }).catch(() => {})
    if (event.data?.type === 'prompt-presets-clear') clearPromptPresets()
  }
  return channel
}

export function subscribePromptPresets(listener: () => void) {
  listeners.add(listener)
  ensureChannel()
  return () => { listeners.delete(listener) }
}

export function getPromptPresetState() {
  return state
}

function normalizePreset(value: unknown): PromptPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('预设响应无效')
  const item = value as Record<string, unknown>
  const preset = {
    id: typeof item.id === 'string' ? item.id : '',
    name: typeof item.name === 'string' ? item.name : '',
    content: typeof item.content === 'string' ? item.content : '',
    revision: typeof item.revision === 'string' ? item.revision : '',
    createdAt: typeof item.createdAt === 'number' ? item.createdAt : 0,
    updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : 0,
  }
  if (!preset.id || !preset.name.trim() || !preset.content.trim() || !preset.revision) throw new Error('预设响应无效')
  return preset
}

function normalizePayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('预设响应无效')
  const record = payload as Record<string, unknown>
  if (!Array.isArray(record.presets) || typeof record.revision !== 'string') throw new Error('预设响应无效')
  return {
    presets: record.presets.map(normalizePreset),
    revision: record.revision,
  }
}

async function readPromptPresetError(response: Response) {
  try {
    const payload = await response.json()
    const message = payload?.error?.message
    if (typeof message === 'string' && message) return message
  } catch {
    // 使用统一兜底文案。
  }
  if (response.status === 401) return '登录已过期，请重新登录'
  if (response.status === 409 || response.status === 412) return '提示词预设已被其他页面修改，请重新读取后再保存'
  if (response.status === 422) return '提示词预设内容无效，请检查名称和内容'
  return '提示词预设请求失败，请检查 NAS 连接'
}

export async function loadPromptPresets(opts: { force?: boolean } = {}) {
  if (loadPromise && !opts.force) return loadPromise
  const generation = ++loadGeneration
  setState({ loading: true, error: '' })
  loadPromise = nasFetch('/api/prompt-presets')
    .then(async (response) => {
      if (!response.ok) throw new Error(await readPromptPresetError(response))
      const payload = normalizePayload(await response.json())
      if (generation !== loadGeneration) {
        if (loadPromise) return loadPromise
        if (!state.loaded) throw new Error('登录状态已变化，请重新登录')
        return state
      }
      setState({ ...payload, loading: false, error: '', loaded: true })
      return state
    })
    .catch((error: Error) => {
      if (generation === loadGeneration) setState({ loading: false, error: error.message || '提示词预设读取失败', loaded: false })
      throw error
    })
    .finally(() => {
      if (generation === loadGeneration) loadPromise = null
    })
  return loadPromise
}

export function clearPromptPresets() {
  loadGeneration++
  loadPromise = null
  setState({ presets: [], revision: '', loading: false, error: '', loaded: false })
}

function createPresetId(name: string) {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'preset'
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${base}-${suffix}`
}

function normalizeDraft(draft: PromptPresetDraft) {
  const name = draft.name.trim()
  const content = draft.content.trim()
  if (!name) throw new Error('请输入预设名称')
  if (!content) throw new Error('请输入预设内容')
  return {
    id: draft.id?.trim() || createPresetId(name),
    name,
    content,
  }
}

export async function savePromptPreset(draft: PromptPresetDraft) {
  const item = normalizeDraft(draft)
  const exists = state.presets.some((preset) => preset.id === item.id)
  const presets = exists
    ? state.presets.map((preset) => preset.id === item.id ? { ...preset, ...item } : preset)
    : [...state.presets, item]
  return replacePromptPresets(presets, { baseRevision: draft.baseRevision })
}

export async function deletePromptPreset(id: string) {
  return replacePromptPresets(state.presets.filter((preset) => preset.id !== id))
}

export async function replacePromptPresets(presets: Array<Pick<PromptPreset, 'id' | 'name' | 'content'>>, opts: { baseRevision?: string } = {}) {
  const generation = loadGeneration
  if (!state.loaded || !state.revision) {
    await loadPromptPresets({ force: true })
    if (generation !== loadGeneration) throw new Error('登录状态已变化，请重新读取提示词预设')
  }
  const revision = opts.baseRevision || state.revision
  const response = await nasFetch('/api/prompt-presets', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'If-Match': revision,
    },
    body: JSON.stringify({ presets: presets.map((preset) => ({ id: preset.id, name: preset.name, content: preset.content })) }),
  })
  if (!response.ok) throw new Error(await readPromptPresetError(response))
  const payload = normalizePayload(await response.json())
  if (generation !== loadGeneration) throw new Error('登录状态已变化，请重新读取提示词预设')
  setState({ ...payload, loading: false, error: '', loaded: true })
  ensureChannel()?.postMessage({ type: 'prompt-presets-updated' })
  return state
}

export function setupPromptPresetAutoSync() {
  ensureChannel()
  if (typeof window === 'undefined') return () => {}
  const sync = () => {
    if (document.visibilityState === 'hidden') return
    void loadPromptPresets({ force: true }).catch(() => {})
  }
  const clearAndNotify = () => {
    clearPromptPresets()
    ensureChannel()?.postMessage({ type: 'prompt-presets-clear' })
  }
  window.addEventListener('focus', sync)
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('nas-session-expired', clearPromptPresets)
  window.addEventListener('nas-logout', clearAndNotify)
  return () => {
    window.removeEventListener('focus', sync)
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('nas-session-expired', clearPromptPresets)
    window.removeEventListener('nas-logout', clearAndNotify)
  }
}

export function getPromptPresetSnapshot(id: string | null | undefined): PromptPresetSnapshot | null {
  if (!id) return null
  const preset = state.presets.find((item) => item.id === id)
  return preset ? { id: preset.id, name: preset.name, revision: preset.revision, content: preset.content } : null
}

export function combinePresetPrompt(presetContent: string, prompt: string) {
  const preset = presetContent.trim()
  const userPrompt = prompt.trim()
  if (preset && userPrompt) return `${preset}\n\n本次用户要求：\n${userPrompt}`
  return preset || userPrompt
}
