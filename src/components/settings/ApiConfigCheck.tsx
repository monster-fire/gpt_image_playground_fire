import { useEffect, useRef, useState } from 'react'
import type { ApiProfile } from '../../types'
import { buildApiUrl, readClientDevProxyConfig, shouldUseApiProxy } from '../../lib/devProxy'
import { providerFetch } from '../../lib/nasAuth'

export default function ApiConfigCheck({ profile }: { profile: ApiProfile }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const requestRef = useRef<{ id: number; controller: AbortController } | null>(null)
  const requestIdRef = useRef(0)
  const profileKey = `${profile.id}|${profile.provider}|${profile.baseUrl}|${profile.apiKey}|${profile.apiProxy}`

  useEffect(() => {
    requestRef.current?.controller.abort()
    requestRef.current = null
    requestIdRef.current += 1
    setBusy(false)
    setResult('')
  }, [profileKey])

  useEffect(() => () => {
    requestRef.current?.controller.abort()
  }, [])

  return <div className="border-t border-gray-200 dark:border-gray-700 pt-3 text-sm">
    <button disabled={busy} className="min-h-11 text-blue-600 disabled:opacity-40" onClick={async () => {
      if (profile.provider !== 'openai') { setResult('该服务商未定义轻量检查接口；连接、鉴权及模型能力未验证'); return }
      if (!profile.apiKey.trim()) { setResult('请先填写 API Key'); return }
      requestRef.current?.controller.abort()
      const controller = new AbortController()
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      requestRef.current = { id: requestId, controller }
      setBusy(true)
      setResult('')
      const timer = window.setTimeout(() => controller.abort(), 15000)
      const updateResult = (message: string) => {
        if (requestRef.current?.id !== requestId) return
        setResult(message)
      }
      try {
        const response = await providerFetch(buildApiUrl(profile.baseUrl, 'models', readClientDevProxyConfig(), shouldUseApiProxy(profile.apiProxy)), {
          headers: { Authorization: `Bearer ${profile.apiKey}` }, signal: controller.signal,
        })
        if (requestRef.current?.id !== requestId) return
        if (response.status === 404 || response.status === 405) updateResult('模型列表接口不可用；鉴权及图片模型能力未验证')
        else if (response.status === 401 || response.status === 403) updateResult(`已收到 HTTP ${response.status}；访问被拒绝，请检查供应商凭据或访问限制`)
        else if (!response.ok) updateResult(`已收到 HTTP ${response.status}；鉴权及模型能力未验证`)
        else {
          const body = await response.json()
          updateResult(Array.isArray(body?.data) ? '模型列表可读取；该请求已通过访问检查，实际图片生成能力未验证' : '已收到响应但格式不符合模型列表；鉴权及模型能力未验证')
        }
      } catch (error) {
        updateResult(error instanceof Error && error.name === 'AbortError' ? '连接检查超过 15 秒；鉴权及模型能力未验证' : '未能读取模型列表，请检查网络或响应格式；鉴权及模型能力未验证')
      } finally {
        clearTimeout(timer)
        if (requestRef.current?.id === requestId) {
          requestRef.current = null
          setBusy(false)
        }
      }
    }}>{busy ? '正在检查连接…' : '检查连接（模型列表）'}</button>
    {result && <p role="status" className="break-words text-gray-600 dark:text-gray-300">{result}</p>}
  </div>
}
