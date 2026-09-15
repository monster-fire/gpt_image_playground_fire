import { useEffect, useState } from 'react'
import { useAgentProgress } from '../lib/agentProgress'

export default function AgentProgressLabel({ conversationId }: { conversationId: string }) {
  const progress = useAgentProgress(conversationId)
  const [showPreparation, setShowPreparation] = useState(false)
  useEffect(() => {
    setShowPreparation(false)
    if (progress?.phase !== '准备图片') return
    const timer = window.setTimeout(() => setShowPreparation(true), Math.max(0, 200 - (Date.now() - progress.startedAt)))
    return () => clearTimeout(timer)
  }, [progress?.phase, progress?.startedAt])
  if (!progress || (progress.phase === '准备图片' && !showPreparation)) return <span role="status">正在准备…</span>
  return <span role="status">{progress.phase}{progress.images ? ` · 已检查 ${progress.images.checked}${progress.images.total == null ? '' : `/${progress.images.total}`} 张，已处理 ${progress.images.processed} 张` : '…'}</span>
}
