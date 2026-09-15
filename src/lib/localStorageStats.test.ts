// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  REBUILDABLE_CACHE_CLEARED_EVENT: 'gpt-image-cache-cleared',
  clearRebuildableImageStores: vi.fn(),
  getLocalDataSummary: vi.fn(),
}))
const imageCache = vi.hoisted(() => ({
  clearRebuildableImageCaches: vi.fn(),
}))

vi.mock('./db', () => db)
vi.mock('./imageCache', () => imageCache)

import { clearRebuildableCaches, getBrowserStorageEstimate, getLocalStorageSummary } from './localStorageStats'

const summary = {
  tasks: { count: 2, logicalBytes: 100 },
  images: { count: 3, logicalBytes: 30_000 },
  thumbnails: { count: 2, logicalBytes: 2_000 },
  agentConversations: { count: 1, logicalBytes: 400 },
  agentContextImages: { count: 4, logicalBytes: 8_000 },
}

describe('localStorageStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(Date, 'now').mockReturnValue(1_789_442_100_000)
    db.getLocalDataSummary.mockResolvedValue(summary)
    db.clearRebuildableImageStores.mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn(async () => ({ usage: 50_000, quota: 10_000_000 })),
      },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('summarizes local records, rebuildable cache, and browser estimate', async () => {
    await expect(getLocalStorageSummary()).resolves.toEqual({
      checkedAt: 1_789_442_100_000,
      data: summary,
      rebuildableCache: {
        count: 6,
        logicalBytes: 10_000,
      },
      siteEstimate: {
        usage: 50_000,
        quota: 10_000_000,
      },
    })
  })

  it('returns null when browser storage estimate is unavailable or rejected', async () => {
    vi.stubGlobal('navigator', {})
    await expect(getBrowserStorageEstimate()).resolves.toBeNull()

    vi.stubGlobal('navigator', {
      storage: {
        estimate: vi.fn(async () => { throw new Error('denied') }),
      },
    })
    await expect(getBrowserStorageEstimate()).resolves.toBeNull()
  })

  it('clears only rebuildable persistent stores and memory caches before refreshing summary', async () => {
    const onCleared = vi.fn()
    window.addEventListener('gpt-image-cache-cleared', onCleared)

    await clearRebuildableCaches()

    expect(db.clearRebuildableImageStores).toHaveBeenCalledOnce()
    expect(imageCache.clearRebuildableImageCaches).toHaveBeenCalledOnce()
    expect(db.getLocalDataSummary).toHaveBeenCalledOnce()
    expect(onCleared).toHaveBeenCalledOnce()
    window.removeEventListener('gpt-image-cache-cleared', onCleared)
  })
})
