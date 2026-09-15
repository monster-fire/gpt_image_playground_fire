import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { captureLegacySettings, clearLegacyNasSettings, clearNasConfig, loadNasSettings, localOnlySettings, mergeLegacyNasSettings, persistedNasSettings, saveNasSettings, waitForNasConfig } from './nasConfig'

beforeEach(clearNasConfig)
afterEach(() => { clearNasConfig(); clearLegacyNasSettings(); vi.unstubAllGlobals() })
describe('NAS authoritative API configuration', () => {
  it('preserves the sole legacy copy until migration and keeps NAS values on ID conflicts', () => {
    captureLegacySettings({ profiles: [{ ...DEFAULT_SETTINGS.profiles[0], apiKey: 'old-local' }, { ...DEFAULT_SETTINGS.profiles[0], id: 'extra', apiKey: 'extra-local' }] })
    const nas = normalizeSettings({ profiles: [{ ...DEFAULT_SETTINGS.profiles[0], apiKey: 'nas-current' }] })
    expect(JSON.stringify(persistedNasSettings(nas))).toContain('old-local')
    expect(JSON.stringify(persistedNasSettings(nas))).not.toContain('nas-current')
    const merged = mergeLegacyNasSettings(nas)
    expect(merged.profiles[0].apiKey).toBe('nas-current')
    expect(merged.profiles.find((profile) => profile.id === 'extra')?.apiKey).toBe('extra-local')
    clearLegacyNasSettings()
    expect(JSON.stringify(persistedNasSettings(merged))).not.toContain('extra-local')
  })
  it('retains local preferences but removes credentials and provider details', () => {
    const settings = normalizeSettings({ ...DEFAULT_SETTINGS, enterSubmit: false, profiles: [{ ...DEFAULT_SETTINGS.profiles[0], apiKey: 'private-key', baseUrl: 'https://private-provider.example' }] })
    const local = localOnlySettings(settings)
    expect(local.enterSubmit).toBe(false)
    expect(JSON.stringify(local)).not.toContain('private-key')
    expect(JSON.stringify(local)).not.toContain('private-provider.example')
  })
  it('loads NAS profiles and serializes revisions while retaining unknown config fields', async () => {
    const config = { profiles: [{ ...DEFAULT_SETTINGS.profiles[0], apiKey: 'nas-key' }], customProviders: [], extension: { enabled: true } }
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ config, revision: 'r1' }))
      .mockImplementationOnce((_path, init) => Promise.resolve(Response.json({ config: JSON.parse(init.body).config, revision: 'r2' })))
      .mockImplementationOnce((_path, init) => Promise.resolve(Response.json({ config: JSON.parse(init.body).config, revision: 'r3' })))
    vi.stubGlobal('fetch', fetcher)
    const settings = await loadNasSettings(DEFAULT_SETTINGS)
    expect(settings.profiles[0].apiKey).toBe('nas-key')
    const changed = { ...settings, activeProfileId: 'changed' }
    const one = saveNasSettings(changed)
    const two = saveNasSettings(changed)
    await Promise.all([one, two])
    expect(fetcher.mock.calls[1][1].headers.get('If-Match')).toBe('r1')
    expect(fetcher.mock.calls[2][1].headers.get('If-Match')).toBe('r2')
    expect(JSON.parse(fetcher.mock.calls[2][1].body).config.extension).toEqual({ enabled: true })
  })
  it('blocks generation after save conflict until a successful reload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 409 })))
    await expect(saveNasSettings(DEFAULT_SETTINGS)).rejects.toThrow('其他页面')
    await expect(waitForNasConfig()).rejects.toThrow('其他页面')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ config: { profiles: [] }, revision: 'r2' })))
    await loadNasSettings(DEFAULT_SETTINGS)
    await expect(waitForNasConfig()).resolves.toBeUndefined()
  })
})
