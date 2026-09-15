import { afterEach, expect, it, vi } from 'vitest'
import { storeImageWithSize } from './db'

afterEach(() => vi.unstubAllGlobals())

it('reports IndexedDB write failure as local storage without exposing image data', async () => {
  vi.stubGlobal('indexedDB', { open: () => { throw new DOMException('storage unavailable', 'QuotaExceededError') } })
  try {
    await storeImageWithSize('data:image/png;base64,aW1hZ2U=', 'generated')
    throw new Error('Expected storage failure')
  } catch (error) {
    expect(error).toMatchObject({ diagnostic: { category: 'local_storage', phase: '生成结果保存' } })
    expect((error as Error).message).toContain('QuotaExceededError')
    expect((error as Error).message).not.toContain('aW1hZ2U=')
  }
})
