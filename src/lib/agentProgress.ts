import { useSyncExternalStore } from 'react'
import type { AgentContextImageProgress } from './agentContextImages'

export type AgentProgress = { phase: '准备图片' | '等待响应' | '接收回复' | '生成图片' | '保存结果'; images?: AgentContextImageProgress; startedAt: number }
const progress = new Map<string, AgentProgress>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function setAgentProgress(id: string, phase: AgentProgress['phase'], images?: AgentContextImageProgress) {
  const previous = progress.get(id)
  progress.set(id, { phase, images, startedAt: previous?.phase === phase ? previous.startedAt : Date.now() })
  for (const listener of listeners) listener()
}

export function clearAgentProgress(id: string) {
  progress.delete(id)
  for (const listener of listeners) listener()
}

export function useAgentProgress(id: string) {
  return useSyncExternalStore(subscribe, () => progress.get(id))
}
