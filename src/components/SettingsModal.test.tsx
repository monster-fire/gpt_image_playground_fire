// @vitest-environment jsdom
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, createDefaultOpenAIProfile, normalizeSettings } from '../lib/apiProfiles'
import type { AppSettings } from '../types'
import SettingsModal from './SettingsModal'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const storeMock = vi.hoisted(() => {
  const settings = {
    showSettings: true,
    settingsTabRequest: 'api',
    settings: {} as AppSettings,
    tasks: [],
    agentConversations: [],
    reusedTaskApiProfileId: null as string | null,
    setShowSettings: vi.fn((show: boolean) => { settings.showSettings = show }),
    setSettings: vi.fn((patch: Partial<AppSettings>) => { settings.settings = normalizeSettings({ ...settings.settings, ...patch }) }),
    dismissPresetProfile: vi.fn(),
    dismissPresetProvider: vi.fn(),
    restorePresetProvider: vi.fn(),
    setReusedTaskApiProfile: vi.fn(),
    setConfirmDialog: vi.fn(),
    showToast: vi.fn(),
  }
  return {
    state: settings,
    useStore: Object.assign(
      vi.fn((selector: (s: typeof settings) => unknown) => selector(settings)),
      { getState: vi.fn(() => settings) },
    ),
    exportData: vi.fn(),
    importData: vi.fn(),
    clearData: vi.fn(),
    submitApiTest: vi.fn(),
  }
})

const nasConfigMock = vi.hoisted(() => ({
  loadNasSettings: vi.fn(),
  saveNasSettings: vi.fn(),
}))

vi.mock('../store', () => ({
  useStore: storeMock.useStore,
  exportData: storeMock.exportData,
  importData: storeMock.importData,
  clearData: storeMock.clearData,
  submitApiTest: storeMock.submitApiTest,
}))

vi.mock('../lib/nasAuth', () => ({
  isNasAuthEnabled: vi.fn(() => true),
}))

vi.mock('../lib/nasConfig', async () => {
  const actual = await vi.importActual<typeof import('../lib/nasConfig')>('../lib/nasConfig')
  return {
    ...actual,
    loadNasSettings: nasConfigMock.loadNasSettings,
    saveNasSettings: nasConfigMock.saveNasSettings,
  }
})

vi.mock('./Select', () => ({
  default: ({ value, onChange, options, disabled, className }: { value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; disabled?: boolean; className?: string }) => (
    <select value={value} disabled={disabled} className={className} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}))

vi.mock('./MarkdownRenderer', () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))

vi.mock('./NasConfigStatus', () => ({
  default: ({ onRetrySave, onReload }: { onRetrySave: () => Promise<boolean>; onReload: () => Promise<boolean> }) => (
    <div data-testid="nas-config-status">
      <button type="button" onClick={() => void onRetrySave()}>NAS 重试保存</button>
      <button type="button" onClick={() => void onReload()}>NAS 重新读取</button>
    </div>
  ),
}))

vi.mock('./settings/GeneralSettingsTab', () => ({
  default: () => <div data-testid="general-settings" />,
}))

vi.mock('./settings/AgentSettingsTab', () => ({
  default: () => <div data-testid="agent-settings" />,
}))

vi.mock('./settings/CustomProviderModal', () => ({
  default: () => <div data-testid="custom-provider-modal" />,
}))

vi.mock('./settings/ProfileImportUrlModal', () => ({
  default: () => <div data-testid="profile-import-url-modal" />,
}))

vi.mock('./settings/ZipDownloadRouteModal', () => ({
  ZIP_DOWNLOAD_ROUTE_OPTIONS: [],
  default: () => <div data-testid="zip-download-route-modal" />,
}))

vi.mock('./settings/ApiConfigCheck', () => ({
  default: () => <div data-testid="api-config-check" />,
}))

function inputByLabel(label: string) {
  if (label === 'API Key') {
    const input = document.body.querySelector('input[type="password"], input[placeholder="sk-..."], input[placeholder="FAL_KEY"]')
    if (input) return input as HTMLInputElement
  }
  const labels = Array.from(document.body.querySelectorAll('label'))
  const target = labels.find((item) => item.textContent?.includes(label))
  const input = target?.querySelector('input')
  if (!input) throw new Error(`Missing input ${label}`)
  return input as HTMLInputElement
}

async function changeInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  await act(async () => {
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

function clickButton(text: string) {
  const button = Array.from(document.body.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`Missing button ${text}`)
  click(button)
  return button as HTMLButtonElement
}

describe('SettingsModal API config draft behavior', () => {
  let container: HTMLDivElement
  let root: Root
  let initialSettings: AppSettings

  beforeEach(() => {
    const profile = createDefaultOpenAIProfile({
      id: 'profile-a',
      name: '主配置',
      baseUrl: 'https://api.saved.example/v1',
      apiKey: 'sk-saved',
      model: 'saved-model',
    })
    initialSettings = normalizeSettings({ ...DEFAULT_SETTINGS, profiles: [profile], activeProfileId: profile.id })
    storeMock.state.showSettings = true
    storeMock.state.settingsTabRequest = 'api'
    storeMock.state.settings = initialSettings
    storeMock.state.tasks = []
    storeMock.state.agentConversations = []
    storeMock.state.reusedTaskApiProfileId = null
    for (const fn of [
      storeMock.state.setShowSettings,
      storeMock.state.setSettings,
      storeMock.state.dismissPresetProfile,
      storeMock.state.dismissPresetProvider,
      storeMock.state.restorePresetProvider,
      storeMock.state.setReusedTaskApiProfile,
      storeMock.state.setConfirmDialog,
      storeMock.state.showToast,
      storeMock.exportData,
      storeMock.importData,
      storeMock.clearData,
      storeMock.submitApiTest,
      nasConfigMock.loadNasSettings,
      nasConfigMock.saveNasSettings,
    ]) fn.mockClear()
    nasConfigMock.saveNasSettings.mockResolvedValue(undefined)
    nasConfigMock.loadNasSettings.mockResolvedValue(initialSettings)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.body.style.overflow = ''
  })

  function render() {
    act(() => {
      root.render(<SettingsModal />)
    })
  }

  it('keeps API field edits in draft until explicit save', async () => {
    render()

    await changeInput(inputByLabel('API Key'), 'sk-draft')
    await changeInput(inputByLabel('模型 ID'), 'draft-model')

    expect(storeMock.state.setSettings).not.toHaveBeenCalled()
    expect(nasConfigMock.saveNasSettings).not.toHaveBeenCalled()
    expect(storeMock.state.settings.profiles[0].apiKey).toBe('sk-saved')
    expect(document.body.textContent).toContain('配置有未保存修改')

    await act(async () => {
      clickButton('保存配置')
    })

    expect(nasConfigMock.saveNasSettings).toHaveBeenCalledTimes(1)
    expect(storeMock.state.setSettings).toHaveBeenCalledTimes(1)
    expect(storeMock.state.settings.profiles[0]).toMatchObject({ apiKey: 'sk-draft', model: 'draft-model' })
  })

  it('does not run a paid API test without the explicit confirmation action', async () => {
    render()

    clickButton('生图测试（可能计费）')

    expect(storeMock.submitApiTest).not.toHaveBeenCalled()
    expect(storeMock.state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '实际生图测试',
      confirmText: '生成测试图片',
      awaitAction: true,
    }))

    const dialogCalls = storeMock.state.setConfirmDialog.mock.calls
    const dialog = dialogCalls[dialogCalls.length - 1]?.[0]
    await act(async () => {
      await dialog.action()
    })
    expect(storeMock.submitApiTest).toHaveBeenCalledWith('profile-a')
  })

  it('keeps old settings when saving the API draft fails', async () => {
    nasConfigMock.saveNasSettings.mockRejectedValueOnce(new Error('NAS 配置保存失败'))
    render()

    await changeInput(inputByLabel('API Key'), 'sk-failed')
    await act(async () => {
      clickButton('保存配置')
    })

    expect(storeMock.state.setSettings).not.toHaveBeenCalled()
    expect(storeMock.state.settings.profiles[0].apiKey).toBe('sk-saved')
    expect(document.body.textContent).toContain('NAS 配置保存失败')
    expect(document.body.textContent).toContain('配置有未保存修改')
  })

  it('retries NAS save with the preserved draft instead of the old store settings', async () => {
    nasConfigMock.saveNasSettings.mockRejectedValueOnce(new Error('NAS 配置保存失败'))
    render()

    await changeInput(inputByLabel('API Key'), 'sk-retry-draft')
    await act(async () => {
      clickButton('保存配置')
    })
    await act(async () => {
      clickButton('NAS 重试保存')
    })

    expect(nasConfigMock.saveNasSettings).toHaveBeenCalledTimes(2)
    expect(nasConfigMock.saveNasSettings.mock.calls[1][0].profiles[0].apiKey).toBe('sk-retry-draft')
    expect(storeMock.state.settings.profiles[0].apiKey).toBe('sk-retry-draft')
  })

  it('keeps a dirty draft when reloading NAS settings', async () => {
    const remote = normalizeSettings({
      ...initialSettings,
      profiles: [{ ...initialSettings.profiles[0], apiKey: 'sk-remote' }],
    })
    nasConfigMock.loadNasSettings.mockResolvedValueOnce(remote)
    render()

    await changeInput(inputByLabel('API Key'), 'sk-local-draft')
    await act(async () => {
      clickButton('NAS 重新读取')
    })

    expect(nasConfigMock.loadNasSettings).toHaveBeenCalledTimes(1)
    expect(storeMock.state.setSettings).toHaveBeenCalledTimes(1)
    expect(storeMock.state.settings.profiles[0].apiKey).toBe('sk-remote')
    expect(inputByLabel('API Key').value).toBe('sk-local-draft')
    expect(document.body.textContent).toContain('本次草稿仍保留')
    expect(document.body.textContent).toContain('服务器当前版本')
  })

  it('asks to save or discard when closing with a dirty API draft', async () => {
    render()

    await changeInput(inputByLabel('API Key'), 'sk-dirty')
    const closeButton = document.body.querySelector('button[aria-label="关闭"]') as HTMLButtonElement
    click(closeButton)

    expect(storeMock.state.setShowSettings).not.toHaveBeenCalledWith(false)
    expect(storeMock.state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '配置尚未保存',
      cancelText: '继续编辑',
      buttons: expect.arrayContaining([
        expect.objectContaining({ label: '放弃修改' }),
        expect.objectContaining({ label: '保存并关闭' }),
      ]),
    }))
  })

  it('keeps profile create and delete inside the draft until save', async () => {
    const second = createDefaultOpenAIProfile({ id: 'profile-b', name: '备用配置', apiKey: 'sk-b' })
    storeMock.state.settings = normalizeSettings({ ...initialSettings, profiles: [initialSettings.profiles[0], second] })
    render()

    clickButton('主配置')
    clickButton('创建新配置')

    expect(storeMock.state.setSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('新配置')

    clickButton('新配置')
    const deleteButton = document.body.querySelector('button[aria-label="删除配置「新配置」"]') as HTMLButtonElement
    click(deleteButton)
    expect(storeMock.state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({ title: '删除配置' }))
    const dialogCalls = storeMock.state.setConfirmDialog.mock.calls
    const dialog = dialogCalls[dialogCalls.length - 1]?.[0]
    act(() => {
      dialog.action()
    })

    expect(storeMock.state.setSettings).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('配置已保存')
    expect(document.body.querySelector('button[aria-label="删除配置「新配置」"]')).toBeNull()
  })

  it('uses an already saved profile without committing dirty draft fields', async () => {
    const second = createDefaultOpenAIProfile({ id: 'profile-b', name: '备用配置', apiKey: 'sk-b', model: 'saved-b' })
    storeMock.state.settings = normalizeSettings({ ...initialSettings, profiles: [initialSettings.profiles[0], second], activeProfileId: 'profile-a' })
    render()
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      clickButton('主配置')
      await Promise.resolve()
    })
    const profileButton = document.body.querySelector('[data-profile-id="profile-b"]')
    if (!profileButton) throw new Error('Missing profile profile-b')
    click(profileButton)
    await changeInput(inputByLabel('模型 ID'), 'dirty-model')
    await act(async () => {
      clickButton('使用此配置')
    })

    expect(nasConfigMock.saveNasSettings).toHaveBeenCalledTimes(1)
    expect(nasConfigMock.saveNasSettings.mock.calls[0][0]).toMatchObject({ activeProfileId: 'profile-b' })
    expect(nasConfigMock.saveNasSettings.mock.calls[0][0].profiles.find((profile: AppSettings['profiles'][number]) => profile.id === 'profile-b')?.model).toBe('saved-b')
    expect(storeMock.state.settings.activeProfileId).toBe('profile-b')
    expect(storeMock.state.settings.profiles.find((profile) => profile.id === 'profile-b')?.model).toBe('saved-b')
  })

  it('keeps non-secret dirty API context after the NAS session expires and login reloads settings', async () => {
    render()

    await changeInput(inputByLabel('API Key'), 'sk-typed-secret')
    await changeInput(inputByLabel('配置名称'), '会话草稿名称')
    await act(async () => {
      await Promise.resolve()
      window.dispatchEvent(new Event('nas-session-expired'))
    })
    act(() => root.unmount())
    container.remove()

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    storeMock.state.settings = normalizeSettings({
      ...initialSettings,
      profiles: [{ ...initialSettings.profiles[0], name: '服务器名称', apiKey: 'sk-server' }],
    })
    render()

    expect(inputByLabel('配置名称').value).toBe('会话草稿名称')
    expect(inputByLabel('API Key').value).toBe('sk-server')
  })

})
