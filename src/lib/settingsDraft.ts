import type { ApiProfile, AppSettings } from '../types'
import { normalizeSettings } from './apiProfiles'
import { localOnlySettings, nasSettingsSnapshot } from './nasConfig'

let apiSessionDraft: { settings: AppSettings; existingProfileIds: string[] } | null = null

export function apiDraftSnapshot(settings: AppSettings) {
  const { activeProfileId: _active, ...fields } = nasSettingsSnapshot(settings)
  return JSON.stringify(fields)
}

export function mergeApiDraft(draft: AppSettings, current: AppSettings) {
  return normalizeSettings({
    ...current,
    ...nasSettingsSnapshot(draft),
    activeProfileId: draft.profiles.some((profile) => profile.id === current.activeProfileId)
      ? current.activeProfileId
      : draft.profiles[0]?.id ?? '',
  })
}

export function mergePreferenceDraft(draft: AppSettings, current: AppSettings) {
  return normalizeSettings({ ...current, ...localOnlySettings(draft), ...nasSettingsSnapshot(current) })
}

function sanitizeProfileBaseUrl(baseUrl: string) {
  if (!baseUrl.trim()) return baseUrl
  try {
    const url = new URL(baseUrl)
    url.username = ''
    url.password = ''
    return url.toString()
  } catch {
    return baseUrl
  }
}

function sanitizeApiProfileDraft(profile: ApiProfile): ApiProfile {
  return {
    ...profile,
    apiKey: '',
    baseUrl: sanitizeProfileBaseUrl(profile.baseUrl),
    providerDrafts: undefined,
  }
}

export function sanitizeApiSessionDraft(draft: AppSettings, current: AppSettings) {
  return {
    settings: normalizeSettings({
      ...current,
      ...nasSettingsSnapshot(draft),
      apiKey: '',
      customProviders: [],
      profiles: draft.profiles.map(sanitizeApiProfileDraft),
      activeProfileId: draft.profiles.some((profile) => profile.id === draft.activeProfileId)
        ? draft.activeProfileId
        : draft.profiles[0]?.id ?? '',
    }),
    existingProfileIds: current.profiles.map((profile) => profile.id),
  }
}

export function saveApiSessionDraft(draft: AppSettings, current: AppSettings) {
  apiSessionDraft = sanitizeApiSessionDraft(draft, current)
}

export function consumeApiSessionDraft(current: AppSettings) {
  if (!apiSessionDraft) return null
  const snapshot = apiSessionDraft
  apiSessionDraft = null
  const currentProfilesById = new Map(current.profiles.map((profile) => [profile.id, profile]))
  const existingProfileIds = new Set(snapshot.existingProfileIds)
  const profiles = snapshot.settings.profiles.flatMap((profile) => {
    const currentProfile = currentProfilesById.get(profile.id)
    if (currentProfile) return [{ ...currentProfile, ...sanitizeApiProfileDraft(profile), apiKey: currentProfile.apiKey }]
    if (!existingProfileIds.has(profile.id)) return [sanitizeApiProfileDraft(profile)]
    return []
  })
  const activeProfileId = profiles.some((profile) => profile.id === snapshot.settings.activeProfileId)
    ? snapshot.settings.activeProfileId
    : current.activeProfileId
  return normalizeSettings({
    ...current,
    ...nasSettingsSnapshot(snapshot.settings),
    customProviders: current.customProviders,
    profiles: profiles.length ? profiles : current.profiles,
    activeProfileId,
  })
}

export function clearApiSessionDraft() {
  apiSessionDraft = null
}

export function validateApiDraft(settings: AppSettings): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const profile of settings.profiles) {
    if (!profile.name.trim()) errors[`${profile.id}:name`] = '请输入配置名称'
    if (profile.baseUrl.trim()) {
      try {
        const url = new URL(profile.baseUrl.trim())
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error()
      } catch { errors[`${profile.id}:baseUrl`] = '请输入完整的 http:// 或 https:// 地址，凭据请填写在密钥字段' }
    }
    if (!Number.isFinite(profile.timeout) || profile.timeout <= 0) errors[`${profile.id}:timeout`] = '超时必须大于 0'
  }
  return errors
}
