import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearPromptPresets, combinePresetPrompt, getPromptPresetSnapshot, getPromptPresetState, loadPromptPresets, replacePromptPresets, savePromptPreset, subscribePromptPresets } from './promptPresets'

beforeEach(() => {
  clearPromptPresets()
  vi.stubGlobal('BroadcastChannel', class {
    onmessage: ((event: MessageEvent) => void) | null = null
    postMessage = vi.fn()
    close = vi.fn()
  })
})

afterEach(() => {
  clearPromptPresets()
  vi.unstubAllGlobals()
})

describe('prompt preset client', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('loads server presets into memory and exposes snapshots without local persistence', async () => {
    const preset = { id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }
    const fetcher = vi.fn().mockResolvedValue(Response.json({ presets: [preset], revision: 'r1' }))
    vi.stubGlobal('fetch', fetcher)

    await loadPromptPresets()

    expect(getPromptPresetState()).toMatchObject({ presets: [preset], revision: 'r1', loaded: true })
    expect(getPromptPresetSnapshot('p1')).toEqual({ id: 'p1', name: '写真', content: '自然光', revision: 'pr1' })
    expect(fetcher.mock.calls[0][0]).toBe('/api/prompt-presets')
    expect(fetcher.mock.calls[0][1].cache).toBe('no-store')
  })

  it('saves with If-Match and keeps the current in-memory list after conflict', async () => {
    const initial = { id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ presets: [initial], revision: 'r1' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'conflict' } }), { status: 409, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetcher)

    await loadPromptPresets()
    await expect(savePromptPreset({ id: 'p1', name: '写真', content: '午后自然光' })).rejects.toThrow('conflict')

    const init = fetcher.mock.calls[1][1]
    expect(init.method).toBe('PUT')
    expect(init.headers.get('If-Match')).toBe('r1')
    expect(JSON.parse(init.body).presets[0]).toEqual({ id: 'p1', name: '写真', content: '午后自然光' })
    expect(getPromptPresetState().presets[0].content).toBe('自然光')
  })

  it('waits for a newer forced synchronization before resolving an older one', async () => {
    const first = deferred<Response>()
    const second = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
    const older = loadPromptPresets({ force: true })
    const newer = loadPromptPresets({ force: true })
    let done = false
    void older.then(() => { done = true })
    first.resolve(Response.json({ presets: [], revision: 'old' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(done).toBe(false)
    second.resolve(Response.json({ presets: [], revision: 'new' }))
    expect((await older).revision).toBe('new')
    expect((await newer).revision).toBe('new')
  })

  it('rejects a load that completes after session memory was cleared', async () => {
    const response = deferred<Response>()
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(response.promise))
    const loading = loadPromptPresets()
    clearPromptPresets()
    response.resolve(Response.json({ presets: [], revision: 'old' }))
    await expect(loading).rejects.toThrow('登录状态')
    expect(getPromptPresetState().loaded).toBe(false)
  })

  it('does not revive memory when a save resolves after logout', async () => {
    const initial = { id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }
    const save = deferred<Response>()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ presets: [initial], revision: 'r1' }))
      .mockReturnValueOnce(save.promise)
    vi.stubGlobal('fetch', fetcher)

    await loadPromptPresets()
    const promise = savePromptPreset({ id: 'p1', name: '写真', content: '午后自然光', baseRevision: 'r1' })
    clearPromptPresets()
    save.resolve(Response.json({
      presets: [{ ...initial, content: '午后自然光', revision: 'pr2' }],
      revision: 'r2',
    }))

    await expect(promise).rejects.toThrow('登录状态')
    expect(getPromptPresetState()).toMatchObject({ presets: [], revision: '', loaded: false })
  })

  it('uses the supplied edit revision instead of the latest background revision', async () => {
    const initial = { id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ presets: [initial], revision: 'r1' }))
      .mockResolvedValueOnce(Response.json({ presets: [{ ...initial, content: '别人修改', revision: 'pr2' }], revision: 'r2' }))
      .mockResolvedValueOnce(Response.json({ presets: [{ ...initial, content: '自己修改', revision: 'pr3' }], revision: 'r3' }))
    vi.stubGlobal('fetch', fetcher)

    await loadPromptPresets()
    await loadPromptPresets({ force: true })
    await savePromptPreset({ id: 'p1', name: '写真', content: '自己修改', baseRevision: 'r1' })

    expect(fetcher.mock.calls[2][1].headers.get('If-Match')).toBe('r1')
  })


  it('notifies subscribers after replace and combines preset content with user input', async () => {
    const listener = vi.fn()
    subscribePromptPresets(listener)
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ presets: [], revision: 'r1' }))
      .mockResolvedValueOnce(Response.json({
        presets: [{ id: 'p1', name: '写真', content: '自然光', revision: 'pr1', createdAt: 1, updatedAt: 1 }],
        revision: 'r2',
      }))
    vi.stubGlobal('fetch', fetcher)

    await loadPromptPresets()
    await replacePromptPresets([{ id: 'p1', name: '写真', content: '自然光' }])

    expect(listener).toHaveBeenCalled()
    expect(combinePresetPrompt('自然光', '白色针织连衣裙')).toBe('自然光\n\n本次用户要求：\n白色针织连衣裙')
    expect(combinePresetPrompt('自然光', '')).toBe('自然光')
  })
})
