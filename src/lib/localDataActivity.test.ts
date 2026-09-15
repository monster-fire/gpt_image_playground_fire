// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertLocalDataAccess, assertNoRecentLocalDataWrite, hasRecentLocalDataWrite, registerLocalDataActivityChecker, resetLocalDataActivityForTests, runExclusiveLocalDataClear } from './localDataActivity'

type Listener = (event: MessageEvent) => void

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []
  listeners = new Set<Listener>()
  name: string

  constructor(name: string) {
    this.name = name
    MockBroadcastChannel.instances.push(this)
  }

  addEventListener(_type: string, listener: Listener) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: Listener) {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown) {
    for (const instance of MockBroadcastChannel.instances) {
      if (instance === this || instance.name !== this.name) continue
      for (const listener of instance.listeners) listener({ data } as MessageEvent)
    }
  }

  close() {
    this.listeners.clear()
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((item) => item !== this)
  }
}

describe('localDataActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockBroadcastChannel.instances = []
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    resetLocalDataActivityForTests()
  })

  afterEach(() => {
    resetLocalDataActivityForTests()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('blocks local data clearing while this tab reports active work', async () => {
    registerLocalDataActivityChecker(() => true)

    await expect(hasRecentLocalDataWrite()).resolves.toBe(true)
    await expect(assertNoRecentLocalDataWrite()).rejects.toThrow('其他页面正在写入本地数据')
  })

  it('blocks local data clearing when another tab reports active work', async () => {
    registerLocalDataActivityChecker(() => false)
    const other = new BroadcastChannel('gpt-image-playground-local-data-activity')
    other.addEventListener('message', (event) => {
      if (event.data?.type === 'query') other.postMessage({ type: 'active', id: event.data.id })
    })

    await expect(hasRecentLocalDataWrite()).resolves.toBe(true)

    other.close()
  })

  it('allows local data clearing when no tab reports active work', async () => {
    registerLocalDataActivityChecker(() => false)
    const result = hasRecentLocalDataWrite()
    await vi.advanceTimersByTimeAsync(301)
    await expect(result).resolves.toBe(false)

    const assertion = assertNoRecentLocalDataWrite()
    await vi.advanceTimersByTimeAsync(301)
    await expect(assertion).resolves.toBeUndefined()
  })

  it('reports active while this tab is clearing local data', async () => {
    registerLocalDataActivityChecker(() => false)
    let release!: () => void
    const clearing = runExclusiveLocalDataClear(() => new Promise<void>((resolve) => {
      release = resolve
    }))
    await vi.advanceTimersByTimeAsync(301)

    await expect(hasRecentLocalDataWrite()).resolves.toBe(true)
    release()
    await expect(clearing).resolves.toBeUndefined()
  })

  it('blocks access under another tab lock and requires refresh after another tab clears', () => {
    registerLocalDataActivityChecker(() => false)
    localStorage.setItem('gpt-image-playground-clear-lock', JSON.stringify({ owner: 'other', expiresAt: Date.now() + 1000 }))
    expect(() => assertLocalDataAccess()).toThrow('正在清空')
    localStorage.removeItem('gpt-image-playground-clear-lock')
    localStorage.setItem('gpt-image-playground-clear-epoch', 'new-generation')
    expect(() => assertLocalDataAccess()).toThrow('请刷新')
  })
})
