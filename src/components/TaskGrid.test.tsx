// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskRecord } from '../types'
import TaskGrid from './TaskGrid'

const storeMock = vi.hoisted(() => {
  const state = {
    tasks: [] as TaskRecord[],
    searchQuery: '',
    filterStatus: 'all' as 'all' | 'running' | 'done' | 'error',
    filterFavorite: false,
    activeFavoriteCollectionId: null as string | null,
    defaultFavoriteCollectionId: 'default',
    selectedTaskIds: [] as string[],
    setSearchQuery: vi.fn((value: string) => { state.searchQuery = value }),
    setFilterStatus: vi.fn((value: 'all' | 'running' | 'done' | 'error') => { state.filterStatus = value }),
    setFilterFavorite: vi.fn((value: boolean) => { state.filterFavorite = value }),
    setActiveFavoriteCollectionId: vi.fn((value: string | null) => { state.activeFavoriteCollectionId = value }),
    setDetailTaskId: vi.fn(),
    setConfirmDialog: vi.fn(),
    setSelectedTaskIds: vi.fn(),
    clearSelection: vi.fn(() => { state.selectedTaskIds = [] }),
  }

  return {
    state,
    useStore: Object.assign(
      vi.fn((selector: (s: typeof state) => unknown) => selector(state)),
      {
        getState: vi.fn(() => state),
      },
    ),
  }
})

vi.mock('../store', () => ({
  useStore: storeMock.useStore,
  reuseConfig: vi.fn(),
  editOutputs: vi.fn(),
  removeTask: vi.fn(),
  taskMatchesFilterStatus: (task: TaskRecord, filterStatus: 'all' | 'running' | 'done' | 'error') => {
    if (filterStatus === 'all') return true
    return task.status === filterStatus
  },
  taskMatchesSearchQuery: (task: TaskRecord, query: string) => !query || task.prompt.toLowerCase().includes(query),
}))

vi.mock('./TaskCard', () => ({
  default: ({ task }: { task: TaskRecord }) => <div data-testid="task-card">{task.prompt}</div>,
}))

function task(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: overrides.id ?? 'task-1',
    prompt: overrides.prompt ?? '白色连衣裙',
    createdAt: overrides.createdAt ?? 1,
    status: overrides.status ?? 'done',
    params: { prompt: overrides.prompt ?? '白色连衣裙', n: 1, size: 'auto', quality: 'auto', output_format: 'png' },
    inputImages: [],
    outputImages: [],
    isFavorite: false,
    ...overrides,
  } as TaskRecord
}

describe('TaskGrid empty states', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    storeMock.state.tasks = []
    storeMock.state.searchQuery = ''
    storeMock.state.filterStatus = 'all'
    storeMock.state.filterFavorite = false
    storeMock.state.activeFavoriteCollectionId = null
    storeMock.state.selectedTaskIds = []
    for (const key of ['setSearchQuery', 'setFilterStatus', 'setFilterFavorite', 'setActiveFavoriteCollectionId', 'setDetailTaskId', 'setConfirmDialog', 'setSelectedTaskIds', 'clearSelection'] as const) {
      storeMock.state[key].mockClear()
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render() {
    act(() => {
      root.render(<TaskGrid />)
    })
  }

  function clickButton(text: string) {
    const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === text)
    expect(button).toBeTruthy()
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('shows the first-use empty state only when there is no history', () => {
    render()

    expect(container.textContent).toContain('输入提示词开始生成图片')
    expect(container.querySelector('button')).toBeNull()
  })

  it('clears search and status while keeping the current favorite scope', () => {
    storeMock.state.tasks = [task({ id: 'done', prompt: '海边', status: 'done', isFavorite: true })]
    storeMock.state.searchQuery = '不存在'
    storeMock.state.filterStatus = 'error'
    storeMock.state.filterFavorite = true
    storeMock.state.activeFavoriteCollectionId = 'default'

    render()

    expect(container.textContent).toContain('没有找到匹配的任务')
    clickButton('清除筛选')

    expect(storeMock.state.setSearchQuery).toHaveBeenCalledWith('')
    expect(storeMock.state.setFilterStatus).toHaveBeenCalledWith('all')
    expect(storeMock.state.setFilterFavorite).not.toHaveBeenCalled()
    expect(storeMock.state.setActiveFavoriteCollectionId).not.toHaveBeenCalled()
    expect(storeMock.state.clearSelection).toHaveBeenCalled()
  })

  it('returns from an empty favorite collection to all images', () => {
    storeMock.state.tasks = [task({ id: 'done', status: 'done', isFavorite: false })]
    storeMock.state.filterFavorite = true
    storeMock.state.activeFavoriteCollectionId = 'default'

    render()

    expect(container.textContent).toContain('这个收藏夹还没有图片')
    clickButton('返回全部图片')

    expect(storeMock.state.setSearchQuery).toHaveBeenCalledWith('')
    expect(storeMock.state.setFilterStatus).toHaveBeenCalledWith('all')
    expect(storeMock.state.setFilterFavorite).toHaveBeenCalledWith(false)
    expect(storeMock.state.setActiveFavoriteCollectionId).toHaveBeenCalledWith(null)
    expect(storeMock.state.clearSelection).toHaveBeenCalled()
  })
})
