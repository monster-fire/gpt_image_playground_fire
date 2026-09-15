import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const canvasImage = vi.hoisted(() => ({
  loadImage: vi.fn(),
}))
const db = vi.hoisted(() => ({
  getAgentContextImage: vi.fn(),
  putAgentContextImageIfSourceMatches: vi.fn(),
}))

vi.mock('./canvasImage', () => canvasImage)
vi.mock('./db', () => db)

import { compressAgentContextImage, createAgentContextImageLoader } from './agentContextImages'

type CanvasCall = {
  width: number
  height: number
  type?: string
  quality?: number
}

function dataUrl(size: number) {
  return `data:image/png;base64,${'A'.repeat(size - 'data:image/png;base64,'.length)}`
}

function blobToDataUrlSize(size: number) {
  return Math.max(0, size - 'data:image/webp;base64,'.length)
}

describe('agentContextImages', () => {
  const canvasCalls: CanvasCall[] = []
  let blobSizes: number[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    db.getAgentContextImage.mockReset().mockResolvedValue(undefined)
    db.putAgentContextImageIfSourceMatches.mockReset().mockResolvedValue(true)
    canvasCalls.length = 0
    blobSizes = []
    canvasImage.loadImage.mockResolvedValue({
      naturalWidth: 3200,
      naturalHeight: 1800,
    })
    vi.stubGlobal('document', {
      createElement: vi.fn((tagName: string) => {
        if (tagName !== 'canvas') return {}
        const canvas = {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({
            drawImage: vi.fn(),
          })),
          toDataURL: vi.fn((type?: string, quality?: number) => {
            canvasCalls.push({ width: canvas.width, height: canvas.height, type, quality })
            const size = blobSizes.shift() ?? 128 * 1024
            return `data:image/webp;base64,${'A'.repeat(size)}`
          }),
        }
        return canvas
      }),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reuses persisted copies across loaders without loading originals', async () => {
    const compressed = 'data:image/webp;base64,cHJldmlldw=='
    db.getAgentContextImage.mockResolvedValue({ id: 'saved', dataUrl: compressed, version: 1 })
    const load = vi.fn()
    await expect(createAgentContextImageLoader(load)('saved')).resolves.toBe(compressed)
    await expect(createAgentContextImageLoader(load)('saved')).resolves.toBe(compressed)
    expect(load).not.toHaveBeenCalled()
    expect(canvasImage.loadImage).not.toHaveBeenCalled()
    expect(db.putAgentContextImageIfSourceMatches).not.toHaveBeenCalled()
  })

  it('rebuilds obsolete cache versions and saves them against the original', async () => {
    const original = dataUrl(900 * 1024)
    db.getAgentContextImage.mockResolvedValue({ id: 'old', dataUrl: 'data:image/webp;base64,old', version: 0 })
    const result = await createAgentContextImageLoader(async () => original)('old')
    expect(db.putAgentContextImageIfSourceMatches).toHaveBeenCalledWith({ id: 'old', dataUrl: result, version: 1 }, original)
    expect(canvasImage.loadImage).toHaveBeenCalledTimes(1)
  })

  it('does not retain deleted copies in the per-turn loader', async () => {
    db.getAgentContextImage.mockResolvedValueOnce({ id: 'deleted', dataUrl: 'data:image/webp;base64,copy', version: 1 })
    const load = vi.fn(async () => undefined)
    const loader = createAgentContextImageLoader(load)
    expect(await loader('deleted')).toBe('data:image/webp;base64,copy')
    expect(await loader('deleted')).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('drops a compressed result when its original was deleted or replaced during compression', async () => {
    db.putAgentContextImageIfSourceMatches.mockResolvedValue(false)
    await expect(createAgentContextImageLoader(async () => dataUrl(900 * 1024))('deleted')).resolves.toBeUndefined()
  })

  it('continues with a compressed copy if IndexedDB cannot store the cache', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.putAgentContextImageIfSourceMatches.mockRejectedValue(new Error('quota exceeded'))
    const result = await createAgentContextImageLoader(async () => dataUrl(900 * 1024))('full')
    expect(result).toMatch(/^data:image\/webp;/)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('returns small ASCII data URLs without loading or rewriting the original image', async () => {
    const original = dataUrl(512 * 1024)

    await expect(compressAgentContextImage(original)).resolves.toBe(original)

    expect(canvasImage.loadImage).not.toHaveBeenCalled()
    expect(canvasCalls).toEqual([])
  })

  it('scales large images to a 1536px long edge and exports webp context copies', async () => {
    blobSizes = [blobToDataUrlSize(220 * 1024)]
    const original = dataUrl(900 * 1024)

    const compressed = await compressAgentContextImage(original)

    expect(canvasImage.loadImage).toHaveBeenCalledWith(original)
    expect(compressed).toMatch(/^data:image\/webp;base64,/)
    expect(compressed.length).toBeLessThanOrEqual(512 * 1024)
    expect(canvasCalls).toHaveLength(1)
    expect(canvasCalls[0]).toMatchObject({
      width: 1536,
      height: 864,
      type: 'image/webp',
      quality: 0.8,
    })
  })

  it('continues reducing dimensions and quality until the context image fits', async () => {
    blobSizes = [
      blobToDataUrlSize(700 * 1024),
      blobToDataUrlSize(540 * 1024),
      blobToDataUrlSize(300 * 1024),
    ]

    const compressed = await compressAgentContextImage(dataUrl(900 * 1024))

    expect(compressed.length).toBeLessThanOrEqual(512 * 1024)
    expect(canvasCalls.length).toBeGreaterThan(1)
    expect(canvasCalls[0]).toMatchObject({ width: 1536, height: 864, quality: 0.8 })
    const lastCall = canvasCalls[canvasCalls.length - 1]
    expect(lastCall.width).toBeLessThan(1536)
    expect(lastCall.height).toBeLessThan(864)
    expect(lastCall.quality).toBeLessThan(0.8)
  })

  it('does not upscale large byte images whose natural dimensions are already below the cap', async () => {
    canvasImage.loadImage.mockResolvedValueOnce({
      naturalWidth: 800,
      naturalHeight: 600,
    })

    await compressAgentContextImage(dataUrl(900 * 1024))

    expect(canvasCalls[0]).toMatchObject({ width: 800, height: 600 })
  })

  it('caches compressed loader results by image id and preserves missing images', async () => {
    blobSizes = [blobToDataUrlSize(220 * 1024)]
    const load = vi.fn(async (id: string) => id === 'missing' ? undefined : dataUrl(900 * 1024))
    const loadContextImage = createAgentContextImageLoader(load)

    const [first, second, missing] = await Promise.all([
      loadContextImage('image-a'),
      loadContextImage('image-a'),
      loadContextImage('missing'),
    ])

    expect(first).toBe(second)
    expect(first).toMatch(/^data:image\/webp;base64,/)
    expect(missing).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenCalledWith('image-a')
    expect(load).toHaveBeenCalledWith('missing')
    expect(canvasImage.loadImage).toHaveBeenCalledTimes(1)
  })

  it('checks abort before loading and after source image loading', async () => {
    const before = new AbortController()
    before.abort()
    const neverLoad = vi.fn(async () => dataUrl(900 * 1024))

    await expect(createAgentContextImageLoader(neverLoad, before.signal)('image-a')).rejects.toThrow(/abort/i)
    expect(neverLoad).not.toHaveBeenCalled()

    const after = new AbortController()
    const load = vi.fn(async () => {
      after.abort()
      return dataUrl(900 * 1024)
    })

    await expect(createAgentContextImageLoader(load, after.signal)('image-b')).rejects.toThrow(/abort/i)
    expect(canvasImage.loadImage).not.toHaveBeenCalled()
  })

  it('propagates compression failures instead of returning the oversized original', async () => {
    canvasImage.loadImage.mockRejectedValueOnce(new Error('decode failed'))
    const original = dataUrl(900 * 1024)

    await expect(compressAgentContextImage(original)).rejects.toThrow('decode failed')
    canvasImage.loadImage.mockRejectedValueOnce(new Error('decode failed'))
    await expect(createAgentContextImageLoader(async () => original)('image-a')).rejects.toThrow('decode failed')
  })
})
