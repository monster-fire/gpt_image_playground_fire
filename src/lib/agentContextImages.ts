import { loadImage } from './canvasImage'
import { getAgentContextImage, putAgentContextImageIfSourceMatches } from './db'
import { throwIfAborted } from './serverSentEvents'

const MAX_CONTEXT_IMAGE_LENGTH = 512 * 1024
const MAX_CONTEXT_IMAGE_EDGE = 1536
// 调整压缩参数时递增，旧副本会在下次使用时被替换。
const CONTEXT_IMAGE_VERSION = 1

export async function compressAgentContextImage(dataUrl: string): Promise<string> {
  if (dataUrl.length <= MAX_CONTEXT_IMAGE_LENGTH) return dataUrl
  const image = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持压缩 Agent 上下文图片')
  const scale = Math.min(1, MAX_CONTEXT_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight))
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale * 0.8 ** attempt))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale * 0.8 ** attempt))
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const result = canvas.toDataURL('image/webp', Math.max(0.5, 0.8 - attempt * 0.06))
      if (!result.startsWith('data:image/')) throw new Error('Agent 上下文图片压缩失败')
      if (result.length <= MAX_CONTEXT_IMAGE_LENGTH) return result
    }
    throw new Error('Agent 上下文图片仍然过大，请减少参考图片后重试')
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

export function createAgentContextImageLoader(
  load: (id: string) => Promise<string | null | undefined>,
  signal?: AbortSignal,
) {
  // 内存只合并正在处理的请求；已完成的副本从 IndexedDB 读取，避免删除后仍命中内存。
  const cache = new Map<string, Promise<string | null | undefined>>()
  return async (id: string) => {
    throwIfAborted(signal)
    if (!cache.has(id)) {
      cache.set(id, (async () => {
        try {
          const stored = await getAgentContextImage(id)
          throwIfAborted(signal)
          if (stored?.version === CONTEXT_IMAGE_VERSION && typeof stored.dataUrl === 'string'
            && stored.dataUrl.startsWith('data:image/') && stored.dataUrl.length <= MAX_CONTEXT_IMAGE_LENGTH) {
            return stored.dataUrl
          }
        } catch (error) {
          throwIfAborted(signal)
          console.warn('读取 Agent 图片缓存失败，将重新压缩', error)
        }
        const dataUrl = await load(id)
        throwIfAborted(signal)
        if (!dataUrl) return dataUrl
        const compressed = await compressAgentContextImage(dataUrl)
        throwIfAborted(signal)
        try {
          const saved = await putAgentContextImageIfSourceMatches({ id, dataUrl: compressed, version: CONTEXT_IMAGE_VERSION }, dataUrl)
          if (!saved) return undefined
        } catch (error) {
          // 缓存空间不足不阻止本次发送，下次发送仍可重试缓存。
          console.warn('保存 Agent 图片缓存失败，本次使用已压缩图片', error)
        }
        return compressed
      })())
    }
    try {
      const result = await cache.get(id)
      throwIfAborted(signal)
      return result
    } finally {
      cache.delete(id)
    }
  }
}
