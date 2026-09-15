import { useEffect, useState } from 'react'
import { clearRebuildableCaches, getLocalStorageSummary, type LocalStorageSummary } from '../lib/localStorageStats'
import { RefreshIcon, TrashIcon } from './icons'

type LocalStoragePanelProps = {
  onCleared?: (summary: LocalStorageSummary) => void
}

function formatBytes(bytes: number | undefined) {
  if (typeof bytes !== 'number') return '不可用'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function formatTime(value: number | null) {
  if (!value) return '尚未检查'
  return new Date(value).toLocaleString()
}

function StatRow({ label, count, bytes }: { label: string; count: number; bytes: number }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-gray-600 dark:text-gray-300">{label}</span>
      <span className="text-right tabular-nums text-gray-900 dark:text-gray-100">{count} 项 · {formatBytes(bytes)}</span>
    </div>
  )
}

export default function LocalStoragePanel({ onCleared }: LocalStoragePanelProps) {
  const [summary, setSummary] = useState<LocalStorageSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      setSummary(await getLocalStorageSummary())
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取本地存储统计失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const clearCache = async () => {
    setClearing(true)
    setError(null)
    try {
      const next = await clearRebuildableCaches()
      setSummary(next)
      onCleared?.(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : '清理缓存失败')
    } finally {
      setClearing(false)
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">本地存储</h3>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">统计浏览器本地历史、原图和可重建缓存；站点空间为浏览器估算值。</p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading || clearing}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-gray-200 px-3 text-sm text-gray-700 transition hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
        >
          <RefreshIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {error && <div role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

      <div className="mt-4 divide-y divide-gray-100 dark:divide-white/10">
        <StatRow label="任务记录" count={summary?.data.tasks.count ?? 0} bytes={summary?.data.tasks.logicalBytes ?? 0} />
        <StatRow label="原图" count={summary?.data.images.count ?? 0} bytes={summary?.data.images.logicalBytes ?? 0} />
        <StatRow label="Agent 对话" count={summary?.data.agentConversations.count ?? 0} bytes={summary?.data.agentConversations.logicalBytes ?? 0} />
        <StatRow label="可重建缓存" count={summary?.rebuildableCache.count ?? 0} bytes={summary?.rebuildableCache.logicalBytes ?? 0} />
      </div>

      <div className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/[0.04] dark:text-gray-400">
        <div>站点空间：{formatBytes(summary?.siteEstimate?.usage)} / {formatBytes(summary?.siteEstimate?.quota)}</div>
        <div className="mt-1">最近检查：{formatTime(summary?.checkedAt ?? null)}</div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500 dark:text-gray-400">清理缓存只删除缩略图和 Agent 发送副本，原图、任务、对话和配置保持不变。</p>
        <button
          type="button"
          onClick={clearCache}
          disabled={loading || clearing || !summary?.rebuildableCache.count}
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-gray-900 px-3 text-sm text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
        >
          <TrashIcon className="h-4 w-4" />
          {clearing ? '清理中' : '清理可重建缓存'}
        </button>
      </div>
    </section>
  )
}
