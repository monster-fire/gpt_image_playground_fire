import * as db from '../src/lib/db'
import { clearRebuildableCaches, getLocalStorageSummary } from '../src/lib/localStorageStats'

const imageId = 'delayed-image'

type DelayState = {
  waiting: number
  released: boolean
  thumbnailDone: boolean
  agentDone: boolean
}

const delayState: DelayState = {
  waiting: 0,
  released: false,
  thumbnailDone: false,
  agentDone: false,
}
const waiters: Array<() => void> = []

function check(value: unknown, message: string) {
  if (!value) throw new Error(message)
}

function createLargeDataUrl() {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 768
  const ctx = canvas.getContext('2d')!
  const pixels = ctx.createImageData(768, 768)
  let seed = 29
  for (let i = 0; i < pixels.data.length; i++) {
    seed = Math.imul(seed, 1664525) + 1013904223
    pixels.data[i] = i % 4 === 3 ? 255 : seed >>> 24
  }
  ctx.putImageData(pixels, 0, 0)
  const dataUrl = canvas.toDataURL('image/png')
  check(dataUrl.length > 512 * 1024, 'fixture must require compression')
  return dataUrl
}

async function countStore(name: string) {
  return new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('gpt-image-playground', 5)
    request.onsuccess = () => {
      const tx = request.result.transaction(name, 'readonly')
      const countReq = tx.objectStore(name).count()
      countReq.onsuccess = () => {
        request.result.close()
        resolve(countReq.result)
      }
      countReq.onerror = () => {
        request.result.close()
        reject(countReq.error)
      }
    }
    request.onerror = () => reject(request.error)
  })
}

export async function seedDatabase() {
  await indexedDB.deleteDatabase('gpt-image-playground')
  const original = createLargeDataUrl()
  await db.putImage({ id: imageId, dataUrl: original, createdAt: Date.now(), source: 'upload' })
  await db.putImageThumbnail({
    id: imageId,
    thumbnailDataUrl: 'data:image/webp;base64,oldthumb',
    width: 768,
    height: 768,
    thumbnailVersion: 2,
  })
  await db.putAgentContextImageIfSourceMatches({ id: imageId, dataUrl: 'data:image/webp;base64,oldagent', version: 1 }, original)
  const summary = await getLocalStorageSummary()
  check(summary.rebuildableCache.count === 2, 'seed did not create rebuildable records')
  return { originalBytes: original.length, rebuildableCount: summary.rebuildableCache.count }
}

export async function startDelayedWrites() {
  db.setRebuildableCacheWriteDelayForTests(() => new Promise<void>((resolve) => {
    delayState.waiting += 1
    if (delayState.released) {
      resolve()
      return
    }
    waiters.push(resolve)
  }))
  void db.rebuildImageThumbnailForTests(imageId).then(() => {
    delayState.thumbnailDone = true
  })
  const original = (await db.getImage(imageId))!.dataUrl
  void db.putAgentContextImageIfSourceMatches({ id: imageId, dataUrl: 'data:image/webp;base64,lateagent', version: 1 }, original, await db.getRebuildableCacheEpoch()).then(() => {
    delayState.agentDone = true
  })
  return delayState
}

export async function getDelayedStatus() {
  return delayState
}

export async function clearFromSecondTab() {
  const summary = await clearRebuildableCaches()
  check(summary.rebuildableCache.count === 0, 'cleanup did not clear rebuildable records')
  check(await db.getImage(imageId), 'cleanup deleted original image')
  return {
    images: await countStore('images'),
    thumbnails: await countStore('thumbnails'),
    agentContextImages: await countStore('agentContextImages'),
  }
}

export async function releaseDelayedWrites() {
  delayState.released = true
  while (waiters.length > 0) waiters.shift()?.()
  return delayState
}

export async function verifyNoLateWrites() {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (delayState.thumbnailDone && delayState.agentDone) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  check(delayState.thumbnailDone && delayState.agentDone, 'delayed writes did not finish')
  check(await db.getImage(imageId), 'original image was deleted')
  check(!await db.getStoredImageThumbnail(imageId), 'late thumbnail write refilled cleared cache')
  check(!await db.getAgentContextImage(imageId), 'late Agent context write refilled cleared cache')
  const summary = await getLocalStorageSummary()
  check(summary.data.images.count === 1, 'original image count changed')
  check(summary.rebuildableCache.count === 0, 'rebuildable cache was refilled')
  db.setRebuildableCacheWriteDelayForTests(null)
  return {
    images: summary.data.images.count,
    rebuildableCount: summary.rebuildableCache.count,
    thumbnailCount: summary.data.thumbnails.count,
    agentContextImageCount: summary.data.agentContextImages.count,
  }
}
