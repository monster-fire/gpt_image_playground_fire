import { useState, useSyncExternalStore } from 'react'
import { useStore } from '../store'
import { clearLegacyNasSettings, getLegacyNasSettings, getNasConfigStatus, loadNasSettings, mergeLegacyNasSettings, saveNasSettings, subscribeNasConfig } from '../lib/nasConfig'
import { RefreshIcon } from './icons'

export default function NasConfigStatus() {
  const status = useSyncExternalStore(subscribeNasConfig, getNasConfigStatus)
  const [busy, setBusy] = useState(false)
  const failed = status && status !== '已保存到 NAS' && status !== '正在保存到 NAS…'
  return <div className="shrink-0 px-5 py-2 border-b border-gray-200 dark:border-gray-700 text-sm flex flex-wrap items-center gap-3" role="status">
    <span className={failed ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}>{status || 'NAS 配置'}</span>
    {getLegacyNasSettings() && <button className="min-h-11 text-blue-600" onClick={() => useStore.getState().setConfirmDialog({
      title: '迁移旧浏览器配置', message: '将旧浏览器 API 配置合并到 NAS。相同 ID 的配置保留 NAS 版本；保存并重新读取成功后，清除浏览器中的旧配置副本。', confirmText: '合并到 NAS', awaitAction: true,
      action: async () => {
        const state = useStore.getState()
        const merged = mergeLegacyNasSettings(state.settings)
        await saveNasSettings(merged)
        const verified = await loadNasSettings(merged)
        clearLegacyNasSettings()
        state.setSettings(verified)
      },
    })}>迁移旧配置</button>}
    {failed && <>
      <button disabled={busy} onClick={async () => {
        setBusy(true)
        try { await saveNasSettings(useStore.getState().settings) } catch { /* 错误保留在状态栏 */ }
        finally { setBusy(false) }
      }} className="min-h-11 text-blue-600">重试保存</button>
      <button disabled={busy} onClick={() => useStore.getState().setConfirmDialog({
        title: '重新读取 NAS 配置', message: '当前未保存的配置修改将被 NAS 上的配置替换。', confirmText: '重新读取', awaitAction: true,
        action: async () => {
          const settings = await loadNasSettings(useStore.getState().settings)
          useStore.getState().setSettings(settings)
        },
      })} className="min-h-11 inline-flex items-center gap-1 text-gray-600 dark:text-gray-300"><RefreshIcon className="w-4 h-4" />重新读取</button>
    </>}
  </div>
}
