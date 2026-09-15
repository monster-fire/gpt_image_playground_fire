import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { getRecoveringTaskDetail, getRecoveringTaskLabel, getRetryParams, isRecoveringTask } from './taskRecovery'
import type { TaskRecord } from '../types'

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'error',
    error: '失败',
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

describe('task recovery helpers', () => {
  it('detects fal and custom recovery states', () => {
    expect(isRecoveringTask(task({ falRecoverable: true }))).toBe(true)
    expect(isRecoveringTask(task({ customRecoverable: true }))).toBe(true)
    expect(isRecoveringTask(task({ status: 'done', falRecoverable: true }))).toBe(false)
  })

  it('labels custom recovery separately', () => {
    expect(getRecoveringTaskLabel(task({ falRecoverable: true }))).toBe('恢复中')
    expect(getRecoveringTaskLabel(task({ customRecoverable: true }))).toBe('自定义任务恢复中')
    expect(getRecoveringTaskDetail(task({ customRecoverable: true }))).toBe('正在查询自定义异步任务结果')
  })

  it('keeps only failed output count when retrying partial failures', () => {
    const profile = createDefaultOpenAIProfile({ id: 'profile-a', apiKey: 'key-a' })
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
    const params = getRetryParams(settings, profile, task({
      params: { ...DEFAULT_PARAMS, n: 4 },
      outputImages: ['image-a', 'image-b'],
      outputErrors: [
        { requestIndex: 2, error: 'failed-a' },
        { requestIndex: 3, error: 'failed-b' },
      ],
    }))

    expect(params.n).toBe(2)
  })
})
