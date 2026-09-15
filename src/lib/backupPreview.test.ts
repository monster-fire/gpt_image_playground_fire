import { describe, expect, it } from 'vitest'

import type { AgentConversation, AppSettings, StoredImage, StoredImageThumbnail, TaskParams, TaskRecord } from '../types'
import { previewBackupZipFiles } from './backupPreview'
import { buildExportZip } from './exportZip'

describe('backupPreview', () => {
  it('reads backup contents without writing and reports counts, conflicts, and missing image refs', async () => {
    const task: TaskRecord = {
      id: 'task-1',
      prompt: '提示词',
      params: {} as TaskParams,
      inputImageIds: ['img-1'],
      outputImages: ['missing-output'],
      status: 'done',
      error: null,
      createdAt: 1700000000000,
      finishedAt: 1700000000002,
      elapsed: 1,
    }
    const image: StoredImage = { id: 'img-1', dataUrl: 'data:image/png;base64,AAECAw==', source: 'generated' }
    const thumbnail: StoredImageThumbnail = { id: 'img-1', thumbnailDataUrl: 'data:image/webp;base64,BAUG', thumbnailVersion: 2 }
    const conversation: AgentConversation = {
      id: 'conversation-1',
      title: 'Agent',
      createdAt: 1700000000000,
      updatedAt: 1700000000002,
      rounds: [{
        id: 'round-1',
        index: 1,
        userMessageId: 'message-user-1',
        assistantMessageId: 'message-assistant-1',
        prompt: '继续',
        inputImageIds: ['agent-missing'],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 1700000000001,
        finishedAt: 1700000000002,
      }],
      messages: [],
    }
    const zip = await buildExportZip({
      options: { exportConfig: true, exportTasks: true, exportPreferences: true, exportPromptPresets: true },
      exportedAt: 1700000001000,
      settings: { profiles: [{ id: 'profile-a' }], enterSubmit: true } as unknown as AppSettings,
      tasks: [task],
      images: [image],
      thumbnailsByImageId: new Map([[thumbnail.id, thumbnail]]),
      favoriteCollections: [],
      defaultFavoriteCollectionId: null,
      agentConversations: [conversation],
      promptPresets: [{ id: 'preset-a', name: '预设', content: '内容' }],
    })

    const preview = await previewBackupZipFiles(
      { name: 'backup.zip', bytes: zip.bytes },
      {
        tasks: [{ ...task, prompt: '旧提示词' }],
        images: [image],
        promptPresets: [{ id: 'preset-a', name: '预设', content: '不同内容' }],
      },
    )

    expect(preview.counts).toMatchObject({
      files: 1,
      tasks: 1,
      agentConversations: 1,
      images: 1,
      thumbnails: 1,
      settings: 1,
      preferences: 1,
      promptPresets: 1,
    })
    expect(preview.images[0].dataUrl).toBe(image.dataUrl)
    expect(preview.thumbnails[0].thumbnailDataUrl).toBe(thumbnail.thumbnailDataUrl)
    expect(preview.conflicts.tasks).toEqual([{ id: 'task-1', status: 'different' }])
    expect(preview.conflicts.images).toEqual([{ id: 'img-1', status: 'same' }])
    expect(preview.conflicts.promptPresets).toEqual([{ id: 'preset-a', status: 'different' }])
    expect(preview.missingImageRefs).toEqual([
      { ownerType: 'task', ownerId: 'task-1', imageId: 'missing-output' },
      { ownerType: 'agentConversation', ownerId: 'conversation-1', imageId: 'agent-missing' },
    ])
  })

  it('uses current images when checking missing refs and compares preset name plus content', async () => {
    const task: TaskRecord = {
      id: 'task-1',
      prompt: '提示词',
      params: {} as TaskParams,
      inputImageIds: ['existing-local-image'],
      outputImages: [],
      status: 'done',
      error: null,
      createdAt: 1700000000000,
      finishedAt: 1700000000001,
      elapsed: 1,
    }
    const zip = await buildExportZip({
      options: { exportTasks: true, exportPromptPresets: true, exportImages: false, exportThumbnails: false },
      exportedAt: 1700000001000,
      settings: {} as AppSettings,
      tasks: [task],
      images: [],
      thumbnailsByImageId: new Map(),
      favoriteCollections: [],
      defaultFavoriteCollectionId: null,
      agentConversations: [],
      promptPresets: [{ id: 'preset-a', name: '新名称', content: '相同内容' }],
    })

    const preview = await previewBackupZipFiles(
      { name: 'backup.zip', bytes: zip.bytes },
      {
        images: [{ id: 'existing-local-image', dataUrl: 'data:image/png;base64,AAECAw==' }],
        promptPresets: [{ id: 'preset-a', name: '旧名称', content: '相同内容' }],
      },
    )

    expect(preview.missingImageRefs).toEqual([])
    expect(preview.conflicts.promptPresets).toEqual([{ id: 'preset-a', status: 'different' }])
  })

  it('rejects duplicate IDs with different contents in one backup', async () => {
    const first: TaskRecord = {
      id: 'task-1',
      prompt: '第一版',
      params: {} as TaskParams,
      inputImageIds: [],
      outputImages: [],
      status: 'done',
      error: null,
      createdAt: 1700000000000,
      finishedAt: 1700000000001,
      elapsed: 1,
    }
    const second = { ...first, prompt: '第二版' }
    const zip = await buildExportZip({
      options: { exportTasks: true },
      exportedAt: 1700000001000,
      settings: {} as AppSettings,
      tasks: [first, second],
      images: [],
      thumbnailsByImageId: new Map(),
      favoriteCollections: [],
      defaultFavoriteCollectionId: null,
      agentConversations: [],
    })

    await expect(previewBackupZipFiles({ name: 'backup.zip', bytes: zip.bytes })).rejects.toThrow('重复 任务 ID')
  })

  it('validates multipart backups before returning parsed data', async () => {
    const base = {
      exportedAt: 1700000001000,
      settings: {} as AppSettings,
      tasks: [],
      images: [],
      thumbnailsByImageId: new Map<string, StoredImageThumbnail>(),
      favoriteCollections: [],
      defaultFavoriteCollectionId: null,
      agentConversations: [],
    }
    const part1 = await buildExportZip({
      ...base,
      options: { exportTasks: true },
      includeManifestData: true,
      backupPart: { id: 'backup-a', index: 1, total: 2 },
    })
    const duplicatePart1 = await buildExportZip({
      ...base,
      options: { exportTasks: true },
      includeManifestData: false,
      backupPart: { id: 'backup-a', index: 1, total: 2 },
    })

    await expect(previewBackupZipFiles([
      { name: 'part1.zip', bytes: part1.bytes },
      { name: 'part1-copy.zip', bytes: duplicatePart1.bytes },
    ])).rejects.toThrow('重复分片')
    await expect(previewBackupZipFiles({ name: 'part1.zip', bytes: part1.bytes })).rejects.toThrow('分片备份不完整')
  })
})
