import type { ApiProfile, AppSettings, TaskParams, TaskRecord } from '../types'
import { getActiveApiProfile, normalizeSettings } from './apiProfiles'
import { normalizeParamsForSettings } from './paramCompatibility'

export const TASK_STOPPED_MESSAGE = '已停止生成。'

export function isRecoveringTask(task: Pick<TaskRecord, 'status' | 'falRecoverable' | 'customRecoverable'>) {
  return task.status === 'error' && Boolean(task.falRecoverable || task.customRecoverable)
}

export function getRecoveringTaskLabel(task: Pick<TaskRecord, 'falRecoverable' | 'customRecoverable'>) {
  if (task.customRecoverable) return '自定义任务恢复中'
  return '恢复中'
}

export function getRecoveringTaskDetail(task: Pick<TaskRecord, 'falRecoverable' | 'customRecoverable'>) {
  if (task.customRecoverable) return '正在查询自定义异步任务结果'
  return '正在查询远端任务结果'
}

export function getTaskApiProfile(settings: AppSettings, task: Pick<TaskRecord, 'apiProfileId'>): ApiProfile | null {
  const normalized = normalizeSettings(settings)
  if (!task.apiProfileId) return null
  return normalized.profiles.find((profile) => profile.id === task.apiProfileId) ?? null
}

export function createSettingsForApiProfile(settings: AppSettings, profile: ApiProfile): AppSettings {
  const normalized = normalizeSettings(settings)
  return normalizeSettings({
    ...normalized,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    profiles: normalized.profiles.map((item) => item.id === profile.id ? profile : item),
    activeProfileId: profile.id,
  })
}

export function getRetryApiProfile(settings: AppSettings, task: TaskRecord): ApiProfile | null {
  return getTaskApiProfile(settings, task)
}

export function getTaskApiProfileName(task: Pick<TaskRecord, 'apiProfileName' | 'apiModel'>) {
  return task.apiProfileName || task.apiModel || '未知配置'
}

export function getRetryParams(settings: AppSettings, profile: ApiProfile, task: TaskRecord): TaskParams {
  const requestSettings = createSettingsForApiProfile(settings, profile)
  const failedCount = task.outputErrors?.length ?? 0
  const params = failedCount > 0
    ? { ...task.params, n: failedCount }
    : task.params
  return normalizeParamsForSettings(params, requestSettings, { hasInputImages: task.inputImageIds.length > 0 })
}

export function getCurrentApiProfileName(settings: AppSettings) {
  return getActiveApiProfile(settings).name
}
