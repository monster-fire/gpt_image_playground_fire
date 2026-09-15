import { useEffect, useRef, useState } from 'react'
import { commitDataImport, exportData, previewDataImport, useStore } from '../store'
import type { BackupPreviewResult } from '../lib/backupPreview'
import { getLocalDataSummary, type LocalDataSummary } from '../lib/db'

const scopeLabels = {
  tasks: '任务与对话',
  images: '原图',
  thumbnails: '缩略图',
  config: 'API 配置',
  preferences: '界面偏好',
  presets: '服务器预设',
}

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function getScopeLogicalBytes(summary: LocalDataSummary | null, scope: Record<string, boolean>) {
  if (!summary) return 0
  return (scope.tasks ? summary.tasks.logicalBytes + summary.agentConversations.logicalBytes : 0)
    + (scope.images ? summary.images.logicalBytes : 0)
    + (scope.thumbnails ? summary.thumbnails.logicalBytes : 0)
}

function getScopeSummary(summary: LocalDataSummary | null, scope: Record<string, boolean>) {
  if (!summary) return ''
  return [
    scope.tasks ? `任务 ${summary.tasks.count} 个、对话 ${summary.agentConversations.count} 个` : null,
    scope.images ? `原图 ${summary.images.count} 张` : null,
    scope.thumbnails ? `缩略图 ${summary.thumbnails.count} 张` : null,
    scope.config ? 'API 配置待读取最新服务器版本' : null,
    scope.presets ? '服务器预设待读取最新版本' : null,
  ].filter(Boolean).join('；')
}

export default function BackupPanel({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [scope, setScope] = useState({ tasks: true, images: true, thumbnails: false, config: false, preferences: false, presets: false })
  const [summary, setSummary] = useState<LocalDataSummary | null>(null)
  const [preview, setPreview] = useState<BackupPreviewResult | null>(null)
  const [overwrite, setOverwrite] = useState(false)
  const [missingConfirmed, setMissingConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<string[]>([])
  const controller = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const selected = Object.values(scope).some(Boolean)
  const estimateText = getScopeSummary(summary, scope)
  const estimateBytes = getScopeLogicalBytes(summary, scope)

  useEffect(() => {
    let cancelled = false
    void getLocalDataSummary()
      .then((next) => { if (!cancelled) setSummary(next) })
      .catch(() => { if (!cancelled) setSummary(null) })
    return () => { cancelled = true }
  }, [])

  const run = async (action: (signal: AbortSignal) => Promise<void | boolean>) => {
    if (busy) return
    controller.current = new AbortController()
    setBusy(true)
    onBusyChange?.(true)
    setResults([])
    try { return await action(controller.current.signal) }
    catch (error) { setResults([error instanceof Error ? error.message : '数据操作失败']) }
    finally { setBusy(false); onBusyChange?.(false); setProgress(''); controller.current = null }
  }

  const conflicts = preview ? Object.values(preview.conflicts).flat() : []

  return <section className="border-t border-gray-200 dark:border-gray-700 py-4 space-y-3">
    <h4 className="font-semibold text-sm">备份与恢复</h4>
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {Object.entries(scopeLabels).map(([key, label]) => <label key={key} className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" disabled={busy} checked={scope[key as keyof typeof scope]} onChange={(event) => setScope({ ...scope, [key]: event.target.checked })} />{label}
      </label>)}
    </div>
    {scope.config && <p className="text-sm text-amber-700 dark:text-amber-400">API 配置包含密钥及自定义请求凭据，请妥善保管备份。</p>}
    {!scope.images && <p className="text-xs text-gray-500">本次范围不包含原图。</p>}
    {estimateText && <p className="text-xs text-gray-500">导出前预估：{estimateText}；压缩前逻辑大小估算 {formatBytes(estimateBytes)}。服务器配置和预设会在导出时读取最新版本。</p>}
    <div className="flex flex-wrap gap-3">
      <button className="min-h-11 text-blue-600 disabled:opacity-40" disabled={busy || !selected} onClick={() => {
        const state = useStore.getState()
        state.setConfirmDialog({ title: '导出备份', message: `范围：${Object.entries(scope).filter(([, value]) => value).map(([key]) => scopeLabels[key as keyof typeof scopeLabels]).join('、')}。${estimateText ? `预估：${estimateText}；压缩前逻辑大小估算 ${formatBytes(estimateBytes)}。` : ''}${scope.config ? '备份包含供应商凭据。' : ''}`, confirmText: '开始导出', awaitAction: true, action: () => run(async (signal) => {
          try {
            const result = await exportData({ exportTasks: scope.tasks, exportImages: scope.images, exportThumbnails: scope.thumbnails, exportConfig: scope.config, exportPreferences: scope.preferences, exportPromptPresets: scope.presets, signal, onProgress: setProgress })
            setResults(result.messages)
          } catch (error) {
            setResults([error instanceof Error ? `导出失败：${error.message}` : '导出失败'])
            return false
          }
        }) })
      }}>导出所选数据</button>
      <button className="min-h-11 text-blue-600 disabled:opacity-40" disabled={busy || !selected} onClick={() => input.current?.click()}>选择 ZIP 预览</button>
      {busy && <button className="min-h-11 text-red-600" onClick={() => controller.current?.abort()}>停止后续操作</button>}
    </div>
    <input ref={input} type="file" accept=".zip" multiple hidden onChange={(event) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ''
      if (!files.length) return
      void run(async (signal) => {
        setProgress('正在校验备份…')
        setPreview(null)
        setOverwrite(false)
        setMissingConfirmed(false)
        const next = await previewDataImport(files, { ...scope })
        if (!signal.aborted) setPreview(next)
      })
    }} />
    {preview && <div className="space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3 text-sm">
      <p>任务 {preview.counts.tasks} · 对话 {preview.counts.agentConversations} · 原图 {preview.counts.images} · 缩略图 {preview.counts.thumbnails} · API 配置 {preview.settings.reduce((n, item) => n + (item.profiles?.length ?? 0), 0)} · 预设 {preview.counts.promptPresets}</p>
      <p>API 配置项 {preview.settings.reduce((n, item) => n + (item.profiles?.length ?? 0) + (item.customProviders?.length ?? 0), 0)} · 界面偏好 {preview.counts.preferences}</p>
      <p>重复 {conflicts.filter((c) => c.status === 'same').length} · 冲突 {conflicts.filter((c) => c.status === 'different').length} · 缺图引用 {preview.missingImageRefs.length}</p>
      <p>API 配置冲突 {preview.conflicts.settings.filter((c) => c.status === 'different').length} 个</p>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy} checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />使用导入版本覆盖冲突项（默认保留当前版本）</label>
      {preview.missingImageRefs.length > 0 && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" disabled={busy} checked={missingConfirmed} onChange={(event) => setMissingConfirmed(event.target.checked)} />确认继续导入缺少原图的历史</label>}
      <div className="flex gap-4">
        <button className="min-h-11 text-blue-600 disabled:opacity-40" disabled={busy || !selected || (scope.tasks && preview.missingImageRefs.length > 0 && !missingConfirmed)} onClick={() => void run(async (signal) => {
          const nextResults = await commitDataImport(preview, { ...scope, overwrite, missingConfirmed, signal, onProgress: setProgress })
          setResults(nextResults)
          if (!signal.aborted) setPreview(null)
        })}>确认导入所选范围</button>
        <button disabled={busy} className="min-h-11" onClick={() => setPreview(null)}>取消预览</button>
      </div>
    </div>}
    {progress && <p role="status" className="text-sm">{progress}</p>}
    {results.length > 0 && <ul role="status" className="space-y-1 text-sm">{results.map((result, index) => <li key={index}>{result}</li>)}</ul>}
  </section>
}
