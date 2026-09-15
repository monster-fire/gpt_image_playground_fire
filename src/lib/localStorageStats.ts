import { REBUILDABLE_CACHE_CLEARED_EVENT, clearRebuildableImageStores, getLocalDataSummary, type LocalDataSummary } from './db'
import { clearRebuildableImageCaches } from './imageCache'

export interface BrowserStorageEstimate {
  usage?: number
  quota?: number
}

export interface LocalStorageSummary {
  checkedAt: number
  data: LocalDataSummary
  rebuildableCache: {
    count: number
    logicalBytes: number
  }
  siteEstimate: BrowserStorageEstimate | null
}

export async function getBrowserStorageEstimate(): Promise<BrowserStorageEstimate | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const estimate = await navigator.storage.estimate()
    return {
      usage: estimate.usage,
      quota: estimate.quota,
    }
  } catch {
    return null
  }
}

export async function getLocalStorageSummary(): Promise<LocalStorageSummary> {
  const [data, siteEstimate] = await Promise.all([
    getLocalDataSummary(),
    getBrowserStorageEstimate(),
  ])
  return {
    checkedAt: Date.now(),
    data,
    rebuildableCache: {
      count: data.thumbnails.count + data.agentContextImages.count,
      logicalBytes: data.thumbnails.logicalBytes + data.agentContextImages.logicalBytes,
    },
    siteEstimate,
  }
}

export async function clearRebuildableCaches(): Promise<LocalStorageSummary> {
  await clearRebuildableImageStores()
  clearRebuildableImageCaches()
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REBUILDABLE_CACHE_CLEARED_EVENT))
  return getLocalStorageSummary()
}
