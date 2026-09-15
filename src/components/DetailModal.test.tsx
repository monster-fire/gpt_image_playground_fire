// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import DetailModal from './DetailModal'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const storeMock = vi.hoisted(() => {
  const state = {
    tasks: [] as TaskRecord[],
    detailTaskId: null as string | null,
    setDetailTaskId: vi.fn(),
    setLightboxImageId: vi.fn(),
    setConfirmDialog: vi.fn(),
    showToast: vi.fn(),
    openFavoritePicker: vi.fn(),
    settings: { codexCli: false, zipDownloadRoutes: [] as string[] },
    dismissedCodexCliPrompts: [] as string[],
    streamPreviews: {} as Record<string, string>,
    streamPreviewSlots: {} as Record<string, Record<number, string>>,
  }
  return {
    state,
    useStore: Object.assign(
      vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
      { getState: vi.fn(() => state) },
    ),
  }
})

vi.mock('../store', () => ({
  useStore: storeMock.useStore,
  reuseConfig: vi.fn(),
  editOutputs: vi.fn(),
  removeTask: vi.fn(),
  showCodexCliPrompt: vi.fn(),
  getCodexCliPromptKey: vi.fn(() => 'profile'),
  retryTask: vi.fn(),
}))

vi.mock('../hooks/useCloseOnEscape', () => ({ useCloseOnEscape: vi.fn() }))
vi.mock('../hooks/useDialogFocus', () => ({ useDialogFocus: vi.fn() }))
vi.mock('../hooks/usePreventBackgroundScroll', () => ({ usePreventBackgroundScroll: vi.fn() }))
vi.mock('../hooks/useTooltip', () => ({
  useTooltip: () => ({ visible: false, handlers: {} }),
}))
vi.mock('../lib/imageCache', () => ({
  getCachedImage: vi.fn(() => undefined),
  ensureImageCached: vi.fn(async () => 'data:image/png;base64,a'),
}))
vi.mock('../lib/paramDisplay', () => ({
  ActualValueBadge: ({ value }: { value: string }) => <span>{value}</span>,
  DetailParamValue: () => <span>value</span>,
}))
vi.mock('../lib/canvasImage', () => ({ createMaskPreviewDataUrl: vi.fn() }))
vi.mock('../lib/clipboard', () => ({
  copyImageSourceToClipboard: vi.fn(),
  copyTextToClipboard: vi.fn(),
  getClipboardFailureMessage: vi.fn(() => 'copy failed'),
}))
vi.mock('../lib/downloadImages', () => ({
  downloadImageEntriesAsZip: vi.fn(),
  downloadImageIds: vi.fn(),
  getImageZipEntries: vi.fn(),
}))
vi.mock('../lib/taskPromptDisplay', () => ({ isAgentTaskPromptPending: vi.fn(() => false) }))
vi.mock('../lib/apiProfiles', () => ({ getApiProviderLabel: vi.fn(() => 'OpenAI') }))
vi.mock('../lib/taskRecovery', () => ({
  getRecoveringTaskDetail: vi.fn(() => ''),
  getRecoveringTaskLabel: vi.fn(() => ''),
  isRecoveringTask: vi.fn(() => false),
}))
vi.mock('../lib/imageApiShared', () => ({ sanitizeRawApiPayload: vi.fn((value: string) => value) }))

describe('DetailModal', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    storeMock.state.tasks = []
    storeMock.state.detailTaskId = null
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('opens after initially rendering without a selected task', async () => {
    act(() => root.render(<DetailModal />))
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    storeMock.state.tasks = [{
      id: 'task-a',
      prompt: 'test image',
      params: DEFAULT_PARAMS,
      inputImageIds: [],
      outputImages: ['image-a'],
      status: 'done',
      error: null,
      createdAt: Date.now(),
      finishedAt: Date.now(),
      elapsed: 100,
    }]
    storeMock.state.detailTaskId = 'task-a'

    await act(async () => {
      root.render(<DetailModal />)
      await Promise.resolve()
    })

    expect(container.querySelector('[role="dialog"]')).toBeTruthy()
    expect(container.querySelector('img[data-image-id="image-a"]')).toBeTruthy()
  })
})
