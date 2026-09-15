import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, createDefaultOpenAIProfile, normalizeSettings } from './apiProfiles'
import { apiDraftSnapshot, clearApiSessionDraft, consumeApiSessionDraft, mergeApiDraft, mergePreferenceDraft, sanitizeApiSessionDraft, saveApiSessionDraft, validateApiDraft } from './settingsDraft'

describe('API 配置草稿', () => {
  const current = normalizeSettings(DEFAULT_SETTINGS)
  afterEach(clearApiSessionDraft)

  it('只编辑偏好不会提交草稿中的 API Key', () => {
    const draft = normalizeSettings({ ...current, clearInputAfterSubmit: !current.clearInputAfterSubmit, profiles: current.profiles.map((p) => ({ ...p, apiKey: 'draft-secret' })) })
    const merged = mergePreferenceDraft(draft, current)
    expect(merged.clearInputAfterSubmit).toBe(draft.clearInputAfterSubmit)
    expect(merged.profiles).toEqual(current.profiles)
  })

  it('编辑对象切换不计作配置内容修改', () => {
    expect(apiDraftSnapshot({ ...current, activeProfileId: 'editing-another' })).toBe(apiDraftSnapshot(current))
  })

  it('保存草稿保留期间变化的实际使用配置选择', () => {
    const profiles = [current.profiles[0], { ...current.profiles[0], id: 'second', name: 'second' }]
    const draft = normalizeSettings({ ...current, profiles, activeProfileId: 'second' })
    const latest = normalizeSettings({ ...draft, activeProfileId: current.profiles[0].id, clearInputAfterSubmit: !draft.clearInputAfterSubmit })
    const merged = mergeApiDraft(draft, latest)
    expect(merged.activeProfileId).toBe(current.profiles[0].id)
    expect(merged.clearInputAfterSubmit).toBe(latest.clearInputAfterSubmit)
  })

  it('登录失效后模块内草稿不保存任何密钥或自定义服务商模板', () => {
    const draft = normalizeSettings({
      ...current,
      profiles: [createDefaultOpenAIProfile({ id: 'profile-a', name: '草稿名称', baseUrl: 'https://user:secret@draft.example/v1', apiKey: 'sk-draft', model: 'draft-model' })],
      customProviders: [{ id: 'custom-secret', name: 'Custom Secret', submit: { path: '/secret', body: { token: 'secret-token' } } }],
      activeProfileId: 'profile-a',
    })
    const runtime = normalizeSettings({
      ...current,
      profiles: [createDefaultOpenAIProfile({ id: 'profile-a', name: '运行名称', baseUrl: 'https://saved.example/v1', apiKey: 'sk-saved', model: 'saved-model' })],
      customProviders: [],
      activeProfileId: 'profile-a',
    })

    const snapshot = sanitizeApiSessionDraft(draft, runtime)
    expect(JSON.stringify(snapshot)).not.toContain('sk-draft')
    expect(JSON.stringify(snapshot)).not.toContain('secret-token')
    expect(JSON.stringify(snapshot)).not.toContain('user:secret')
  })

  it('重新登录后只把非敏感编辑覆盖到服务器仍存在的配置', () => {
    const draft = normalizeSettings({
      ...current,
      profiles: [
        createDefaultOpenAIProfile({ id: 'profile-a', name: '草稿名称', baseUrl: 'https://draft.example/v1', apiKey: 'sk-draft', model: 'draft-model' }),
        createDefaultOpenAIProfile({ id: 'deleted-profile', name: '已删草稿', baseUrl: 'https://deleted.example/v1', apiKey: 'sk-deleted' }),
        createDefaultOpenAIProfile({ id: 'new-profile', name: '新建草稿', baseUrl: 'https://new.example/v1', apiKey: 'sk-new' }),
      ],
      activeProfileId: 'profile-a',
    })
    const beforeLogout = normalizeSettings({
      ...current,
      profiles: [
        createDefaultOpenAIProfile({ id: 'profile-a', name: '运行名称', baseUrl: 'https://saved.example/v1', apiKey: 'sk-saved', model: 'saved-model' }),
        createDefaultOpenAIProfile({ id: 'deleted-profile', name: '删除前', apiKey: 'sk-old-deleted' }),
      ],
      activeProfileId: 'profile-a',
    })
    const afterLogin = normalizeSettings({
      ...current,
      profiles: [createDefaultOpenAIProfile({ id: 'profile-a', name: '服务器名称', baseUrl: 'https://server.example/v1', apiKey: 'sk-server', model: 'server-model' })],
      activeProfileId: 'profile-a',
    })

    saveApiSessionDraft(draft, beforeLogout)
    const restored = consumeApiSessionDraft(afterLogin)

    expect(restored?.profiles.find((profile) => profile.id === 'profile-a')).toMatchObject({ name: '草稿名称', baseUrl: 'https://draft.example/v1', apiKey: 'sk-server', model: 'draft-model' })
    expect(restored?.profiles.find((profile) => profile.id === 'deleted-profile')).toBeUndefined()
    expect(restored?.profiles.find((profile) => profile.id === 'new-profile')).toMatchObject({ name: '新建草稿', apiKey: '' })
  })

  it('错误 URL 与嵌入凭据被就地校验', () => {
    for (const baseUrl of ['broken', 'file:///tmp', 'https://user:secret@example.test']) {
      const draft = { ...current, profiles: current.profiles.map((p) => ({ ...p, baseUrl })) }
      expect(Object.values(validateApiDraft(draft))).not.toHaveLength(0)
    }
    expect(validateApiDraft({ ...current, profiles: current.profiles.map((p) => ({ ...p, baseUrl: 'https://example.test/v1' })) })).toEqual({})
  })
})
