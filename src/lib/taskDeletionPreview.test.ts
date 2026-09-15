import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { taskDeletionMessage, taskDeletionSignature } from './taskDeletionPreview'

const task: TaskRecord = { id: 'task-a', prompt: 'test', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: ['image-a'], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1 }

describe('task deletion preview', () => {
  it('counts shared output images once and describes browser deletion', () => {
    expect(taskDeletionMessage([task, { ...task, id: 'task-b' }])).toContain('2 个任务，涉及 1 张输出图片')
    expect(taskDeletionMessage([task])).toContain('服务器数据不受影响')
  })
  it('detects changes to deletion resources but ignores unrelated prompt edits', () => {
    const original = taskDeletionSignature([task])
    expect(taskDeletionSignature([{ ...task, outputImages: ['image-b'] }])).not.toBe(original)
    expect(taskDeletionSignature([{ ...task, inputImageIds: ['ref'] }])).not.toBe(original)
    expect(taskDeletionSignature([{ ...task, prompt: 'renamed' }])).toBe(original)
  })
})
