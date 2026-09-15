import type { AppSettings } from '../types'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { nasFetch } from './nasAuth'

const LOCAL_PREFERENCES = ['clearInputAfterSubmit', 'persistInputOnRestart', 'reuseTaskApiProfileTemporarily', 'alwaysShowRetryButton', 'allowPromptRewrite', 'taskCompletionNotification', 'enterSubmit', 'zipDownloadRoutes', 'agentScrollToBottomAfterSubmit', 'agentMaxToolRounds', 'agentWebSearch', 'agentMathFormattingPrompt'] as const
const API_FIELDS = ['profiles', 'customProviders', 'providerOrder', 'activeProfileId', 'agentApiConfigMode', 'agentTextProfileId', 'agentImageProfileId'] as const
let revision = ''
let source: Record<string, unknown> = {}
let pending: Promise<void> = Promise.resolve()
let failure: Error | null = null
let generation = 0
let status = ''
let loadedSnapshot = ''
let queuedWrites = 0
let legacySettings: Partial<AppSettings> | null = null

export function captureLegacySettings(value: unknown) {
  if (legacySettings || !value || typeof value !== 'object') return
  const record = value as Partial<AppSettings>
  if (record.apiKey || (Array.isArray(record.profiles) && record.profiles.some((profile) => profile?.apiKey)) || (Array.isArray(record.customProviders) && record.customProviders.length)) legacySettings = record
}

export const getLegacyNasSettings = () => legacySettings
export function clearLegacyNasSettings() { legacySettings = null }

export function mergeLegacyNasSettings(settings: AppSettings) {
  const legacy = normalizeSettings(legacySettings)
  const profileIds = new Set(settings.profiles.map((profile) => profile.id))
  const providerIds = new Set(settings.customProviders.map((provider) => provider.id))
  return normalizeSettings({
    ...settings,
    profiles: [...settings.profiles, ...legacy.profiles.filter((profile) => !profileIds.has(profile.id))],
    customProviders: [...settings.customProviders, ...legacy.customProviders.filter((provider) => !providerIds.has(provider.id))],
  })
}

export function persistedNasSettings(settings: AppSettings): AppSettings {
  // 只暂留升级前已有的唯一副本，新的 NAS 密钥不会进入本地持久化。
  return legacySettings ? { ...localOnlySettings(settings), ...legacySettings } as AppSettings : localOnlySettings(settings)
}
const listeners = new Set<() => void>()

export const getNasConfigStatus = () => status
export const subscribeNasConfig = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
function setStatus(value: string) { status = value; for (const listener of listeners) listener() }

export function clearNasConfig() {
  generation++
  revision = ''
  source = {}
  failure = null
  pending = Promise.resolve()
  loadedSnapshot = ''
  queuedWrites = 0
  setStatus('')
}

export function localOnlySettings(value: Partial<AppSettings>): AppSettings {
  if (!value || typeof value !== 'object') value = {}
  const local = Object.fromEntries(LOCAL_PREFERENCES.filter((key) => value[key] !== undefined).map((key) => [key, value[key]]))
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...local, apiKey: '', profiles: [], customProviders: [] })
}

export function nasSettingsSnapshot(settings: AppSettings) {
  return Object.fromEntries(API_FIELDS.map((key) => [key, settings[key]]))
}

export async function loadNasSettings(settings: AppSettings): Promise<AppSettings> {
  const current = generation
  await pending.catch(() => {})
  const response = await nasFetch('/api/api-config')
  if (!response.ok) throw new Error('无法读取 NAS 配置，请检查配置文件并重试')
  const payload = await response.json()
  if (current !== generation) throw new Error('登录状态已变化，请重新登录')
  if (!payload.config || typeof payload.config !== 'object' || typeof payload.revision !== 'string') throw new Error('NAS 配置响应无效')
  source = payload.config
  revision = payload.revision
  failure = null
  pending = Promise.resolve()
  const loaded = normalizeSettings({ ...localOnlySettings(settings), ...source })
  loadedSnapshot = JSON.stringify(nasSettingsSnapshot(loaded))
  setStatus('已保存到 NAS')
  return loaded
}

export function saveNasSettings(settings: AppSettings) {
  const snapshot = nasSettingsSnapshot(settings)
  if (!queuedWrites && !failure && JSON.stringify(snapshot) === loadedSnapshot) return pending
  const current = generation
  queuedWrites++
  setStatus('正在保存到 NAS…')
  pending = pending.catch(() => {}).then(async () => {
    if (current !== generation) throw new Error('登录状态已变化，请重新读取配置')
    const config = { ...source, ...snapshot }
    // 旧单配置字段也由 NAS 当前 profile 统一覆盖，避免旧 Key 留在文件中。
    for (const key of ['apiKey', 'baseUrl', 'model', 'apiMode', 'timeout', 'codexCli', 'apiProxy'] as const) {
      if (key in config) config[key] = settings[key]
    }
    const response = await nasFetch('/api/api-config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': revision }, body: JSON.stringify({ config }) })
    if (!response.ok) throw new Error(response.status === 409 || response.status === 412 ? 'NAS 配置已被其他页面修改，请重新读取后再保存' : 'NAS 配置保存失败，请检查连接后重试')
    const payload = await response.json()
    if (current !== generation) return
    source = payload.config
    revision = payload.revision
    loadedSnapshot = JSON.stringify(snapshot)
    failure = null
  }).catch((error: Error) => {
    if (current === generation) { failure = error; setStatus(error.message) }
    throw error
  }).finally(() => {
    if (current !== generation) return
    queuedWrites--
    if (!failure) setStatus(queuedWrites ? '正在保存到 NAS…' : '已保存到 NAS')
  })
  return pending
}

export async function waitForNasConfig() {
  await pending
  if (failure) throw failure
}
