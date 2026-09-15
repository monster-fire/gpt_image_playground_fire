// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentChatImageThumb from './AgentChatImageThumb'

const storeMock = vi.hoisted(() => {
  const state = {
    setLightboxImageId: vi.fn(),
  }
  return {
    useStore: vi.fn((selector: (s: typeof state) => unknown) => selector(state)),
    state,
  }
})

const imageCacheMock = vi.hoisted(() => ({
  ensureImageCached: vi.fn(),
  ensureImageThumbnailCached: vi.fn(),
  subscribeImageThumbnail: vi.fn(),
}))

const canvasMock = vi.hoisted(() => ({
  createMaskPreviewDataUrl: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: storeMock.useStore,
}))

vi.mock('../lib/imageCache', () => imageCacheMock)
vi.mock('../lib/canvasImage', () => canvasMock)

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []
  callback: IntersectionObserverCallback
  observe = vi.fn()
  disconnect = vi.fn()

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  intersect() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

describe('AgentChatImageThumb', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    MockIntersectionObserver.instances = []
    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver
    storeMock.state.setLightboxImageId.mockClear()
    imageCacheMock.ensureImageCached.mockReset().mockResolvedValue('data:image/png;base64,original')
    imageCacheMock.ensureImageThumbnailCached.mockReset().mockResolvedValue({
      dataUrl: 'data:image/png;base64,thumb',
    })
    imageCacheMock.subscribeImageThumbnail.mockReset().mockReturnValue(vi.fn())
    canvasMock.createMaskPreviewDataUrl.mockReset().mockResolvedValue('data:image/png;base64,mask-preview')
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (globalThis as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver
  })

  function render(maskImageId?: string | null) {
    act(() => {
      root.render(
        <AgentChatImageThumb
          imageId="image-a"
          imageIndex={0}
          imageIds={['image-a', 'image-b']}
          maskImageId={maskImageId}
        />,
      )
    })
  }

  it('waits until the thumb is near the viewport before loading a thumbnail', async () => {
    render()

    expect(imageCacheMock.ensureImageThumbnailCached).not.toHaveBeenCalled()

    await act(async () => {
      MockIntersectionObserver.instances[0].intersect()
    })

    expect(imageCacheMock.ensureImageThumbnailCached).toHaveBeenCalledWith('image-a')
    const img = container.querySelector('img') as HTMLImageElement | null
    expect(img?.src).toContain('data:image/png;base64,thumb')
    expect(imageCacheMock.ensureImageCached).not.toHaveBeenCalled()
  })

  it('opens the lightbox with the whole round image list', () => {
    render()

    act(() => {
      container.querySelector('div')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(storeMock.state.setLightboxImageId).toHaveBeenCalledWith('image-a', ['image-a', 'image-b'])
  })

  it('opens the lightbox from keyboard activation', () => {
    render()

    const thumb = container.querySelector('[role="button"]') as HTMLElement
    act(() => {
      thumb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(storeMock.state.setLightboxImageId).toHaveBeenCalledWith('image-a', ['image-a', 'image-b'])
  })

  it('keeps rendering when thumbnail loading rejects', async () => {
    imageCacheMock.ensureImageThumbnailCached.mockRejectedValue(new Error('thumbnail failed'))

    render()
    await act(async () => {
      MockIntersectionObserver.instances[0].intersect()
    })

    expect(container.querySelector('[role="button"]')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('clears the rendered thumbnail after rebuildable cache cleanup', async () => {
    render()

    await act(async () => {
      MockIntersectionObserver.instances[0].intersect()
    })
    expect(container.querySelector('img')).toBeTruthy()

    imageCacheMock.ensureImageThumbnailCached.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,rebuilt-thumb',
    })
    act(() => {
      window.dispatchEvent(new Event('gpt-image-cache-cleared'))
    })

    expect(container.querySelector('img')).toBeNull()
    await act(async () => {
      await Promise.resolve()
    })
    expect(imageCacheMock.ensureImageThumbnailCached).toHaveBeenCalledTimes(2)
    expect((container.querySelector('img') as HTMLImageElement).src).toContain('data:image/png;base64,rebuilt-thumb')
  })

  it('uses original images only for visible mask previews', async () => {
    render('mask-a')

    expect(imageCacheMock.ensureImageCached).not.toHaveBeenCalled()

    await act(async () => {
      MockIntersectionObserver.instances[0].intersect()
    })

    expect(imageCacheMock.ensureImageCached).toHaveBeenCalledWith('image-a')
    expect(imageCacheMock.ensureImageCached).toHaveBeenCalledWith('mask-a')
    expect(canvasMock.createMaskPreviewDataUrl).toHaveBeenCalled()
    expect((container.querySelector('img') as HTMLImageElement).src).toContain('data:image/png;base64,mask-preview')
  })

  it('ignores late mask preview results after switching images', async () => {
    let resolveOldPreview: (url: string) => void = () => {}
    canvasMock.createMaskPreviewDataUrl
      .mockReturnValueOnce(new Promise((resolve) => { resolveOldPreview = resolve }))
      .mockResolvedValueOnce('data:image/png;base64,new-mask-preview')

    render('mask-a')
    await act(async () => {
      MockIntersectionObserver.instances[0].intersect()
    })

    await act(async () => {
      root.render(
        <AgentChatImageThumb
          imageId="image-b"
          imageIndex={1}
          imageIds={['image-a', 'image-b']}
          maskImageId="mask-b"
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect((container.querySelector('img') as HTMLImageElement).src).toContain('data:image/png;base64,new-mask-preview')

    await act(async () => {
      resolveOldPreview('data:image/png;base64,old-mask-preview')
    })

    expect((container.querySelector('img') as HTMLImageElement).src).toContain('data:image/png;base64,new-mask-preview')
  })
})
