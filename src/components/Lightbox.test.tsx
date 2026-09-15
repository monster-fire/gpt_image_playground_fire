// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Lightbox from './Lightbox'

const storeMock = vi.hoisted(() => {
  const state = {
    lightboxImageId: null as string | null,
    lightboxImageList: [] as string[],
    maskDraft: null,
    tasks: [] as unknown[],
    inputImages: [] as unknown[],
    setLightboxImageId: vi.fn((id: string | null, list?: string[]) => {
      state.lightboxImageId = id
      state.lightboxImageList = list ?? (id ? [id] : [])
    }),
    replaceInputImage: vi.fn(),
    setMaskEditorImageId: vi.fn(),
    showToast: vi.fn(),
  }

  return {
    state,
    useStore: Object.assign(
      vi.fn((selector: (s: typeof state) => unknown) => selector(state)),
      {
        getState: vi.fn(() => state),
        setState: vi.fn((patch: Partial<typeof state>) => Object.assign(state, patch)),
      },
    ),
  }
})

const imageCacheMock = vi.hoisted(() => ({
  getCachedImage: vi.fn(),
  ensureImageCached: vi.fn(),
  ensureImageThumbnailCached: vi.fn(),
}))

vi.mock('../store', () => ({
  createInputImageFromFile: vi.fn(),
  deleteImageIfUnreferenced: vi.fn(),
  useStore: storeMock.useStore,
}))

vi.mock('../lib/imageCache', () => imageCacheMock)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('Lightbox', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    storeMock.state.lightboxImageId = 'image-a'
    storeMock.state.lightboxImageList = ['image-a']
    storeMock.state.maskDraft = null
    storeMock.state.tasks = []
    storeMock.state.inputImages = []
    storeMock.state.setLightboxImageId.mockClear()
    storeMock.state.replaceInputImage.mockClear()
    storeMock.state.setMaskEditorImageId.mockClear()
    storeMock.state.showToast.mockClear()
    imageCacheMock.getCachedImage.mockReset().mockReturnValue(undefined)
    imageCacheMock.ensureImageCached.mockReset().mockResolvedValue('data:image/png;base64,a')
    imageCacheMock.ensureImageThumbnailCached.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.style.overflow = ''
    vi.useRealTimers()
  })

  function render() {
    act(() => {
      root.render(<Lightbox />)
    })
  }

  function click(el: Element) {
    act(() => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('opens the frame before a delayed original image resolves', async () => {
    const original = deferred<string | undefined>()
    imageCacheMock.ensureImageCached.mockReturnValue(original.promise)

    render()

    expect(container.querySelector('[data-lightbox-root]')).toBeTruthy()
    expect(container.textContent).toContain('正在读取图片')

    await act(async () => {
      original.resolve('data:image/png;base64,original')
      await original.promise
    })

    const img = container.querySelector('img[data-image-id="image-a"]') as HTMLImageElement | null
    expect(img?.src).toContain('data:image/png;base64,original')
  })

  it('uses a thumbnail while the original image is loading', async () => {
    const original = deferred<string | undefined>()
    imageCacheMock.ensureImageCached.mockReturnValue(original.promise)
    imageCacheMock.ensureImageThumbnailCached.mockResolvedValue({
      dataUrl: 'data:image/png;base64,thumb',
    })

    render()
    await act(async () => {})

    const img = container.querySelector('img[data-image-id="image-a"]') as HTMLImageElement | null
    expect(img?.src).toContain('data:image/png;base64,thumb')
    expect(container.textContent).toContain('正在加载原图')

    await act(async () => {
      original.resolve('data:image/png;base64,original')
      await original.promise
    })

    expect((container.querySelector('img[data-image-id="image-a"]') as HTMLImageElement).src).toContain('data:image/png;base64,original')
  })

  it('shows missing state and keeps navigation available when the image is absent', async () => {
    imageCacheMock.ensureImageCached.mockResolvedValue(undefined)
    storeMock.state.lightboxImageList = ['image-a', 'image-b']

    render()
    await act(async () => {})

    expect(container.textContent).toContain('图片不存在')
    expect(container.textContent).toContain('1 / 2')

    const buttons = container.querySelectorAll('button')
    click(buttons[1])
    expect(storeMock.state.setLightboxImageId).toHaveBeenCalledWith('image-b', ['image-a', 'image-b'])
  })

  it('shows a retry action when IndexedDB reading rejects', async () => {
    imageCacheMock.ensureImageCached
      .mockRejectedValueOnce(new Error('idb failed'))
      .mockResolvedValueOnce('data:image/png;base64,retried')

    render()
    await act(async () => {})

    expect(container.textContent).toContain('图片读取失败')
    const retryButtons = Array.from(container.querySelectorAll('button'))
    click(retryButtons[retryButtons.length - 1])
    await act(async () => {})

    expect(imageCacheMock.ensureImageCached).toHaveBeenCalledTimes(2)
    expect((container.querySelector('img[data-image-id="image-a"]') as HTMLImageElement).src).toContain('data:image/png;base64,retried')
  })

  it('does not flash back to the previous image after a fast switch', async () => {
    const first = deferred<string | undefined>()
    const second = deferred<string | undefined>()
    imageCacheMock.ensureImageCached
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    storeMock.state.lightboxImageList = ['image-a', 'image-b']

    render()
    act(() => {
      storeMock.state.lightboxImageId = 'image-b'
      root.render(<Lightbox />)
    })

    await act(async () => {
      first.resolve('data:image/png;base64,first')
      await first.promise
    })

    expect(container.querySelector('img[data-image-id]')).toBeNull()

    await act(async () => {
      second.resolve('data:image/png;base64,second')
      await second.promise
    })

    const img = container.querySelector('img[data-image-id="image-b"]') as HTMLImageElement | null
    expect(img?.src).toContain('data:image/png;base64,second')
    expect(container.querySelector('img[data-image-id="image-a"]')).toBeNull()
  })

  it('does not reopen after closing while a read is still pending', async () => {
    const original = deferred<string | undefined>()
    imageCacheMock.ensureImageCached.mockReturnValue(original.promise)

    render()
    click(container.querySelector('[data-lightbox-root]')!)

    act(() => {
      storeMock.state.lightboxImageId = null
      root.render(<Lightbox />)
    })

    await act(async () => {
      original.resolve('data:image/png;base64,late')
      await original.promise
    })

    expect(container.querySelector('[data-lightbox-root]')).toBeNull()
  })
})
