// @vitest-environment jsdom
import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AgentProgressLabel from './AgentProgressLabel'
import { clearAgentProgress, setAgentProgress } from '../lib/agentProgress'

describe('AgentProgressLabel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_789_442_100_000)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    clearAgentProgress('conversation-a')
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    clearAgentProgress('conversation-a')
    vi.useRealTimers()
  })

  function render() {
    act(() => {
      root.render(<AgentProgressLabel conversationId="conversation-a" />)
    })
  }

  it('delays image preparation details and then shows checked and processed counts', async () => {
    setAgentProgress('conversation-a', '准备图片', {
      checked: 1,
      total: 3,
      processed: 0,
      cacheHits: 1,
      currentImageId: 'image-a',
    })
    render()

    expect(container.textContent).toBe('正在准备…')

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(container.textContent).toBe('准备图片 · 已检查 1/3 张，已处理 0 张')

    setAgentProgress('conversation-a', '准备图片', {
      checked: 2,
      total: 3,
      processed: 1,
      cacheHits: 1,
      currentImageId: 'image-b',
    })
    render()

    expect(container.textContent).toBe('准备图片 · 已检查 2/3 张，已处理 1 张')
  })

  it('shows later phases without preparation delay', () => {
    setAgentProgress('conversation-a', '等待响应')
    render()

    expect(container.textContent).toBe('等待响应…')
  })
})
