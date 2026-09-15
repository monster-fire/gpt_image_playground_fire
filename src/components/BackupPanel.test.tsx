// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BackupPanel from './BackupPanel'

const mocks = vi.hoisted(() => {
  const state = {
    tasks: [],
    agentConversations: [],
    settings: { profiles: [], customProviders: [] },
    setConfirmDialog: vi.fn(),
  }
  return {
    dbMock: {
      getLocalDataSummary: vi.fn(async () => ({
        tasks: { count: 2, logicalBytes: 100 },
        images: { count: 7, logicalBytes: 7000 },
        thumbnails: { count: 5, logicalBytes: 500 },
        agentConversations: { count: 3, logicalBytes: 300 },
        agentContextImages: { count: 4, logicalBytes: 4000 },
      })),
    },
    storeMock: {
      state,
      commitDataImport: vi.fn(async () => ['done']),
      exportData: vi.fn(async () => ({ messages: ['exported'] })),
      previewDataImport: vi.fn(async () => ({
        manifests: [],
        settings: [],
        preferences: [],
        promptPresets: [],
        tasks: [],
        agentConversations: [],
        images: [],
        thumbnails: [],
        counts: { files: 1, tasks: 1, agentConversations: 0, images: 0, thumbnails: 0, settings: 0, preferences: 0, promptPresets: 0 },
        conflicts: { tasks: [], agentConversations: [], images: [], thumbnails: [], settings: [], promptPresets: [] },
        missingImageRefs: [{ ownerType: 'task', ownerId: 'task-a', imageId: 'missing-image' }],
      })),
      useStore: Object.assign(vi.fn(() => state), { getState: () => state }),
    },
  }
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../lib/db', () => ({
  getLocalDataSummary: mocks.dbMock.getLocalDataSummary,
}))

vi.mock('../store', () => ({
  commitDataImport: mocks.storeMock.commitDataImport,
  exportData: mocks.storeMock.exportData,
  previewDataImport: mocks.storeMock.previewDataImport,
  useStore: mocks.storeMock.useStore,
}))

const dbMock = mocks.dbMock
const storeMock = mocks.storeMock

describe('BackupPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    storeMock.commitDataImport.mockClear()
    storeMock.exportData.mockClear()
    storeMock.previewDataImport.mockClear()
    storeMock.state.setConfirmDialog.mockClear()
  })

  async function render() {
    await act(async () => {
      root.render(<BackupPanel />)
    })
  }


  it('renders logical size estimate from local data summary', async () => {
    await render()

    expect(dbMock.getLocalDataSummary).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('任务 2 个、对话 3 个')
    expect(container.textContent).toContain('原图 7 张')
    expect(container.textContent).toContain('压缩前逻辑大小估算 7.2 KB')
  })

  it('passes missing confirmation to commit', async () => {
    await render()
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'backup.zip', arrayBuffer: async () => new ArrayBuffer(0) }] })
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]'))
    const checkbox = checkboxes[checkboxes.length - 1] as HTMLInputElement
    await act(async () => { checkbox.click() })
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.includes('导入') || item.textContent?.includes('瀵煎叆'))!
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(storeMock.commitDataImport).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ missingConfirmed: true }))
  })

  it('keeps export failure in results and prevents confirm close', async () => {
    storeMock.exportData.mockRejectedValueOnce(new Error('boom'))
    await render()
    const button = container.querySelector('button')!
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const dialog = storeMock.state.setConfirmDialog.mock.calls[0][0]

    let result: unknown
    await act(async () => {
      result = await dialog.action()
    })
    expect(result).toBe(false)
    expect(container.textContent).toContain('boom')
  })
});
