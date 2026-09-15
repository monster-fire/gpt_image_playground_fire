import * as db from '../src/lib/db'
import { createAgentContextImageLoader } from '../src/lib/agentContextImages'

function check(value: unknown, message: string) {
  if (!value) throw new Error(message)
}

export async function seedLegacyDatabase() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('gpt-image-playground', 3)
    request.onupgradeneeded = () => {
      for (const name of ['images', 'thumbnails', 'tasks', 'agentConversations']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' })
      }
      request.transaction!.objectStore('tasks').put({ id: 'legacy-task', prompt: 'preserve' })
    }
    request.onsuccess = () => { request.result.close(); resolve() }
    request.onerror = () => reject(request.error)
  })
}

export async function firstSend() {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 768
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(768, 768)
  let seed = 17
  for (let i = 0; i < pixels.data.length; i++) {
    seed = Math.imul(seed, 1664525) + 1013904223
    pixels.data[i] = i % 4 === 3 ? 255 : seed >>> 24
  }
  ctx.putImageData(pixels, 0, 0)
  const original = canvas.toDataURL('image/png')
  check(original.length > 512 * 1024, 'fixture must require compression')
  await db.putImage({ id: 'legacy-image', dataUrl: original, createdAt: 1 })
  check((await db.getAllTasks()).some((task) => task.id === 'legacy-task'), 'migration lost legacy task')
  const loader = createAgentContextImageLoader(async (id) => (await db.getImage(id))?.dataUrl)
  const first = await loader('legacy-image')
  check(first && first.length <= 512 * 1024, 'first send did not compress')
  check((await db.getAgentContextImage('legacy-image'))?.dataUrl === first, 'first send did not persist')
  return { originalBytes: original.length, contextBytes: first!.length, migration: true }
}

export async function afterReload() {
  let loads = 0
  const loader = createAgentContextImageLoader(async (id) => {
    loads++
    return (await db.getImage(id))?.dataUrl
  })
  const saved = await loader('legacy-image')
  check(saved && loads === 0, 'reload did not reuse persistent cache')
  const original = (await db.getImage('legacy-image'))!
  await db.putImage({ ...original, width: 768 })
  check((await db.getAgentContextImage(original.id))?.dataUrl === saved, 'metadata update invalidated cache')
  await db.putImage({ ...original, id: 'new-image' })
  await loader('new-image')
  await loader('legacy-image')
  check(loads === 1, 'mixed request recompressed cached image')
  await db.deleteImage('legacy-image')
  check(!await db.getImage('legacy-image') && !await db.getAgentContextImage('legacy-image'), 'delete left original or cache')
  check(!await loader('legacy-image'), 'loader retained deleted copy')
  check(!await db.putAgentContextImageIfSourceMatches({ id: 'legacy-image', dataUrl: saved!, version: 1 }, original.dataUrl), 'late write resurrected deleted cache')
  check(!await db.getAgentContextImage('legacy-image'), 'orphan cache after late write')
  const replacement = 'data:image/png;base64,replaced'
  await db.putImage({ ...original, id: 'new-image', dataUrl: replacement })
  check(!await db.getAgentContextImage('new-image'), 'replacement left stale cache')
  check(!await db.putAgentContextImageIfSourceMatches({ id: 'new-image', dataUrl: saved!, version: 1 }, original.dataUrl), 'late write accepted obsolete original')
  await db.putImage({ ...original, id: 'new-image' })
  await loader('new-image')
  await db.clearImages()
  check((await db.getAllImageIds()).length === 0, 'clear left originals')
  check(!await db.getAgentContextImage('new-image'), 'clear left compressed cache')
  check(!await db.putAgentContextImageIfSourceMatches({ id: 'new-image', dataUrl: saved!, version: 1 }, original.dataUrl), 'late write after clear created orphan')
  // 两种事务排队顺序都必须以原图和副本同时删除结束。
  for (const deleteFirst of [false, true]) {
    await db.putImage({ ...original, id: 'race' })
    const record = { id: 'race', dataUrl: saved!, version: 1 }
    await Promise.all(deleteFirst
      ? [db.deleteImage('race'), db.putAgentContextImageIfSourceMatches(record, original.dataUrl)]
      : [db.putAgentContextImageIfSourceMatches(record, original.dataUrl), db.deleteImage('race')])
    check(!await db.getImage('race') && !await db.getAgentContextImage('race'), 'delete/write race left orphan')
  }
  return { reloadReuse: true, incrementalCompression: true, deleteCascade: true, clearCascade: true, lateWriteRejected: true, replacementInvalidation: true, concurrentDeletion: true }
}

export async function measureIncrementalPreparation() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 768
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(768, 768)
  let seed = 39
  for (let i = 0; i < pixels.data.length; i++) {
    seed = Math.imul(seed, 1664525) + 1013904223
    pixels.data[i] = i % 4 === 3 ? 255 : seed >>> 24
  }
  ctx.putImageData(pixels, 0, 0)
  const original = canvas.toDataURL('image/png')
  const ids = Array.from({ length: 16 }, (_, index) => `benchmark-${index}`)
  for (const id of ids) await db.putImage({ id, dataUrl: original, createdAt: 1 })
  const results = []
  for (const [phase, count, expectedHits, expectedProcessed] of [
    ['cold', 14, 0, 14], ['warm', 14, 14, 0], ['incremental', 16, 14, 2],
  ] as const) {
    let progress = { checked: 0, cacheHits: 0, processed: 0 }
    const start = performance.now()
    const loader = createAgentContextImageLoader(async (id) => (await db.getImage(id))?.dataUrl, undefined, { total: count, onProgress: (value) => { progress = value } })
    for (const id of ids.slice(0, count)) await loader(id)
    check(progress.checked === count && progress.cacheHits === expectedHits && progress.processed === expectedProcessed, `${phase} image progress is incorrect`)
    results.push({ phase, milliseconds: Math.round(performance.now() - start), ...progress })
  }
  return results
}
