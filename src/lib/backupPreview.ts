import type { AgentConversation, AppSettings, StoredImage, StoredImageThumbnail, TaskRecord } from '../types'
import { readExportZip, readExportZipFileAsDataUrl, readExportZipManifest, type ExportPromptPreset, type ExportZipManifest } from './exportZip'

export type BackupPreviewFile = {
  name: string
  bytes: Uint8Array
}

export type BackupPreviewCurrentData = {
  tasks?: TaskRecord[]
  agentConversations?: AgentConversation[]
  images?: StoredImage[]
  thumbnails?: StoredImageThumbnail[]
  promptPresets?: ExportPromptPreset[]
}

export type BackupPreviewItemConflict = {
  id: string
  status: 'same' | 'different'
}

export type BackupPreviewResult = {
  manifests: ExportZipManifest[]
  settings: Partial<AppSettings>[]
  preferences: Partial<AppSettings>[]
  promptPresets: ExportPromptPreset[]
  tasks: TaskRecord[]
  agentConversations: AgentConversation[]
  images: StoredImage[]
  thumbnails: StoredImageThumbnail[]
  counts: {
    files: number
    tasks: number
    agentConversations: number
    images: number
    thumbnails: number
    settings: number
    preferences: number
    promptPresets: number
  }
  conflicts: {
    tasks: BackupPreviewItemConflict[]
    agentConversations: BackupPreviewItemConflict[]
    images: BackupPreviewItemConflict[]
    thumbnails: BackupPreviewItemConflict[]
    settings: BackupPreviewItemConflict[]
    promptPresets: BackupPreviewItemConflict[]
  }
  missingImageRefs: Array<{ ownerType: 'task' | 'agentConversation'; ownerId: string; imageId: string }>
}

type SelectedPart = {
  file: BackupPreviewFile
  manifest: ExportZipManifest
}

export async function previewBackupZipFiles(input: BackupPreviewFile | BackupPreviewFile[], current: BackupPreviewCurrentData = {}): Promise<BackupPreviewResult> {
  const files = Array.isArray(input) ? input : [input]
  if (!files.length) throw new Error('没有选择备份文件。')

  const selected: SelectedPart[] = []
  for (const file of files) {
    const manifest = await readExportZipManifest(file.bytes, false) as ExportZipManifest
    if (manifest.version !== 3) throw new Error('备份版本不受支持。')
    selected.push({ file, manifest })
  }
  validateBackupParts(selected)

  const settings = selected.flatMap((part) => part.manifest.settings ? [part.manifest.settings] : [])
  const preferences = selected.flatMap((part) => part.manifest.preferences ? [part.manifest.preferences] : [])
  const promptPresets = selected.flatMap((part) => part.manifest.promptPresets ?? [])
  const tasks = selected.flatMap((part) => part.manifest.tasks ?? [])
  const agentConversations = selected.flatMap((part) => part.manifest.agentConversations ?? [])
  const images: StoredImage[] = []
  const thumbnails: StoredImageThumbnail[] = []

  for (const part of selected) {
    const hasFiles = Object.keys(part.manifest.imageFiles ?? {}).length > 0 || Object.keys(part.manifest.thumbnailFiles ?? {}).length > 0
    if (!hasFiles) continue
    const { manifest, files: zipFiles } = await readExportZip(part.file.bytes)
    for (const [id, info] of Object.entries(manifest.imageFiles ?? {})) {
      const dataUrl = readExportZipFileAsDataUrl(zipFiles, info.path)
      if (!dataUrl) continue
      images.push({
        id,
        dataUrl,
        createdAt: info.createdAt,
        source: info.source,
        width: info.width,
        height: info.height,
      })
    }
    for (const [id, info] of Object.entries(manifest.thumbnailFiles ?? {})) {
      const thumbnailDataUrl = readExportZipFileAsDataUrl(zipFiles, info.path)
      if (!thumbnailDataUrl) continue
      thumbnails.push({
        id,
        thumbnailDataUrl,
        width: info.width,
        height: info.height,
        thumbnailVersion: info.thumbnailVersion,
      })
    }
  }
  assertNoDuplicateConflicts('任务', tasks)
  assertNoDuplicateConflicts('Agent 对话', agentConversations)
  assertNoDuplicateConflicts('图片', images, (item) => item.dataUrl)
  assertNoDuplicateConflicts('缩略图', thumbnails, (item) => item.thumbnailDataUrl)
  assertNoDuplicateConflicts('提示词预设', promptPresets, (item) => ({ name: item.name, content: item.content }))

  return {
    manifests: selected.map((part) => part.manifest),
    settings,
    preferences,
    promptPresets,
    tasks,
    agentConversations,
    images,
    thumbnails,
    counts: {
      files: selected.length,
      tasks: tasks.length,
      agentConversations: agentConversations.length,
      images: images.length,
      thumbnails: thumbnails.length,
      settings: settings.length,
      preferences: preferences.length,
      promptPresets: promptPresets.length,
    },
    conflicts: {
      tasks: findConflicts(tasks, current.tasks ?? []),
      agentConversations: findConflicts(agentConversations, current.agentConversations ?? []),
      images: findConflicts(images, current.images ?? [], (item) => item.dataUrl),
      thumbnails: findConflicts(thumbnails, current.thumbnails ?? [], (item) => item.thumbnailDataUrl),
      settings: [],
      promptPresets: findConflicts(promptPresets, current.promptPresets ?? [], (item) => ({ name: item.name, content: item.content })),
    },
    missingImageRefs: findMissingImageRefs(tasks, agentConversations, new Set([...images.map((image) => image.id), ...(current.images ?? []).map((image) => image.id)])),
  }
}

function validateBackupParts(selected: SelectedPart[]) {
  const multipart = selected.some((part) => part.manifest.backupPart != null)
  if (!multipart) return
  if (selected.some((part) => !part.manifest.backupPart)) throw new Error('不能混合选择分片备份和普通备份。')
  const first = selected[0].manifest.backupPart!
  const indexes = new Set(selected.map((part) => part.manifest.backupPart!.index))
  const validSet = selected.every((part) => {
    const backupPart = part.manifest.backupPart!
    return backupPart.id === first.id && backupPart.total === first.total && backupPart.index >= 1 && backupPart.index <= first.total
  })
  if (!validSet || indexes.size !== selected.length) throw new Error('所选分片不属于同一批备份或包含重复分片。')
  if (selected.length !== first.total || indexes.size !== first.total) {
    throw new Error(`分片备份不完整，请一次选择同一备份的全部 ${first.total} 个 ZIP。`)
  }
  selected.sort((a, b) => a.manifest.backupPart!.index - b.manifest.backupPart!.index)
}

function findConflicts<T extends { id: string }>(incoming: T[], current: T[], getContent: (item: T) => unknown = (item) => item): BackupPreviewItemConflict[] {
  const currentById = new Map(current.map((item) => [item.id, item]))
  return incoming
    .filter((item) => currentById.has(item.id))
    .map((item) => ({
      id: item.id,
      status: stableStringify(getContent(item)) === stableStringify(getContent(currentById.get(item.id)!)) ? 'same' : 'different',
    }))
}

function assertNoDuplicateConflicts<T extends { id: string }>(label: string, items: T[], getContent: (item: T) => unknown = (item) => item) {
  const seen = new Map<string, string>()
  for (const item of items) {
    const text = stableStringify(getContent(item))
    const previous = seen.get(item.id)
    if (previous && previous !== text) throw new Error(`备份中存在重复 ${label} ID 且内容不同：${item.id}`)
    seen.set(item.id, text)
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function findMissingImageRefs(tasks: TaskRecord[], agentConversations: AgentConversation[], imageIds: Set<string>) {
  const refs: BackupPreviewResult['missingImageRefs'] = []
  for (const task of tasks) {
    for (const imageId of getTaskImageRefs(task)) {
      if (!imageIds.has(imageId)) refs.push({ ownerType: 'task', ownerId: task.id, imageId })
    }
  }
  for (const conversation of agentConversations) {
    for (const round of conversation.rounds) {
      for (const imageId of round.inputImageIds ?? []) {
        if (!imageIds.has(imageId)) refs.push({ ownerType: 'agentConversation', ownerId: conversation.id, imageId })
      }
    }
  }
  return refs
}

function getTaskImageRefs(task: TaskRecord) {
  return [
    ...(task.inputImageIds ?? []),
    ...(task.outputImages ?? []),
    ...(task.transparentOriginalImages ?? []),
    ...(task.streamPartialImageIds ?? []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.maskTargetImageId ? [task.maskTargetImageId] : []),
  ].filter(Boolean)
}
