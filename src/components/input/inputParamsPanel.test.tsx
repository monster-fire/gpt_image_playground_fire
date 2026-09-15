// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type ApiProfile, type TaskParams } from '../../types'
import InputParamsPanel from './inputParamsPanel'

vi.mock('../Select', () => ({
  default: ({ value, options, disabled, className }: { value: string; options: Array<{ label: string; value: string }>; disabled?: boolean; className?: string }) => (
    <select value={value} disabled={disabled} className={className} onChange={() => {}}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))

vi.mock('../Checkbox', () => ({
  Checkbox: ({ checked, label, disabled }: { checked: boolean; label?: React.ReactNode; disabled?: boolean }) => (
    <label>
      <input type="checkbox" checked={checked} disabled={disabled} readOnly />
      {label}
    </label>
  ),
}))

vi.mock('./buttonTooltip', () => ({
  default: ({ visible, text }: { visible: boolean; text: React.ReactNode }) => visible ? <div>{text}</div> : null,
}))

const hint = {
  visible: false,
  show: vi.fn(),
  hide: vi.fn(),
  clearTimer: vi.fn(),
  startTouch: vi.fn(),
}

const activeProfile: ApiProfile = {
  id: 'profile',
  name: 'Profile',
  provider: 'openai',
  baseUrl: '',
  apiKey: 'key',
  model: 'gpt-image-1',
  timeout: 120000,
  apiMode: 'images',
  codexCli: false,
  apiProxy: false,
  transparentBackgroundMethod: 'api',
}

describe('InputParamsPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderPanel(params: TaskParams, patch: Partial<React.ComponentProps<typeof InputParamsPanel>> = {}) {
    act(() => {
      root.render(
        <InputParamsPanel
          cols="grid-cols-6"
          params={params}
          setParams={vi.fn()}
          activeProfile={activeProfile}
          isFalProvider={false}
          isFalTextToImage={false}
          displaySize={params.size}
          qualityOptions={[
            { label: 'auto', value: 'auto' },
            { label: 'low', value: 'low' },
            { label: 'medium', value: 'medium' },
            { label: 'high', value: 'high' },
          ]}
          selectClass="select-base"
          transparentOutputAvailable={true}
          showTransparentOutputControl={params.output_format !== 'jpeg'}
          transparentOutputEnabled={params.transparent_output}
          transparentOutputHint={hint}
          onTransparentOutputMenuOpenChange={vi.fn()}
          compressionHint={hint}
          compressionDisabled={params.output_format === 'png'}
          outputCompressionInput={params.output_compression == null ? '' : String(params.output_compression)}
          setOutputCompressionInput={vi.fn()}
          commitOutputCompression={vi.fn()}
          moderationHint={hint}
          moderationDisabled={false}
          agentAutoImageCount={false}
          outputImageLimit={10}
          nInput={String(params.n)}
          setNInputFocused={vi.fn()}
          commitN={vi.fn()}
          handleNInputChange={vi.fn()}
          handleNLimitIncreaseAttempt={vi.fn()}
          showAgentNHint={vi.fn()}
          hideNLimitHint={vi.fn()}
          startAgentNHintTouch={vi.fn()}
          clearAgentNHintTouchTimer={vi.fn()}
          nLimitHint={hint}
          nLimitHintText="数量提示"
          streamConcurrentByN={false}
          streamConcurrentHint={hint}
          sizeHint={hint}
          qualityHint={hint}
          onOpenSizePicker={vi.fn()}
          {...patch}
        />,
      )
    })
  }

  it('shows size and gallery count before advanced controls on compact gallery layout', () => {
    renderPanel({
      ...DEFAULT_PARAMS,
      size: '1024x1024',
      n: 3,
      quality: 'high',
      transparent_output: true,
    }, { compact: true, appMode: 'gallery' })

    const details = container.querySelector('details')
    expect(details?.textContent).toContain('已修改 3')
    expect(container.textContent).toContain('尺寸')
    expect(container.textContent).toContain('数量')
    expect(details?.textContent).toContain('质量')
    expect(details?.textContent).toContain('透明背景')
    expect(container.textContent).toContain('高')
    expect(container.textContent).toContain('开启')
    expect(container.querySelector('input[type="number"]')).toBeTruthy()
  })

  it('hides count from the compact common area in Agent mode', () => {
    renderPanel({
      ...DEFAULT_PARAMS,
      n: 4,
      quality: 'medium',
    }, { compact: true, appMode: 'agent', agentAutoImageCount: true, nInput: 'auto' })

    const commonArea = container.querySelector('.grid')
    expect(commonArea?.textContent).toContain('尺寸')
    expect(commonArea?.textContent).not.toContain('数量')
    expect(container.querySelector('details')?.textContent).toContain('已修改 1')
  })

  it('keeps the full parameter grid when compact is disabled', () => {
    renderPanel(DEFAULT_PARAMS)

    expect(container.querySelector('details')).toBeNull()
    expect(container.textContent).toContain('尺寸')
    expect(container.textContent).toContain('质量')
    expect(container.textContent).toContain('格式')
    expect(container.textContent).toContain('审核')
    expect(container.textContent).toContain('数量')
  })
})
