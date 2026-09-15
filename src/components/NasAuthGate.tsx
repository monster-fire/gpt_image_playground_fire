import { useEffect, useRef, useState, type ReactNode } from 'react'
import { initStore, stopAllActiveRequests, useStore } from '../store'
import { checkNasSession, expireNasSession, nasFetch, type NasSession } from '../lib/nasAuth'
import { captureLegacySettings, clearLegacyNasSettings, clearNasConfig, getLegacyNasSettings, loadNasSettings, localOnlySettings } from '../lib/nasConfig'
import { clearPromptPresets, loadPromptPresets, setupPromptPresetAutoSync } from '../lib/promptPresets'

let initialized: Promise<void> | null = null

export default function NasAuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'checking' | 'login' | 'config' | 'ready'>('checking')
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState<NasSession | null>(null)
  const attempt = useRef(0)
  const channel = useRef<BroadcastChannel | null>(null)

  const unlock = async () => {
    const current = ++attempt.current
    setBusy(true)
    setError('')
    let verified = false
    try {
      const nextSession = await checkNasSession()
      verified = true
      try { captureLegacySettings(JSON.parse(localStorage.getItem('gpt-image-playground') || '{}').state?.settings) } catch { /* 本地迁移数据无效时不作为运行配置 */ }
      const settings = await loadNasSettings(useStore.getState().settings)
      if (current !== attempt.current) return
      useStore.getState().setSettings(settings)
      initialized ??= initStore().catch((cause) => { initialized = null; throw cause })
      await initialized
      await loadPromptPresets({ force: true }).catch(() => {})
      if (current !== attempt.current) return
      setSession(nextSession)
      setPassword('')
      setPhase('ready')
      if (getLegacyNasSettings()) useStore.getState().setShowSettings(true)
    } catch (cause) {
      if (current !== attempt.current) return
      setError(cause instanceof Error ? cause.message : '连接失败，请重试')
      setPhase(verified ? 'config' : 'login')
    } finally { if (current === attempt.current) setBusy(false) }
  }

  useEffect(() => {
    const lock = () => {
      attempt.current++
      stopAllActiveRequests()
      clearNasConfig()
      clearPromptPresets()
      useStore.setState((state) => ({ settings: localOnlySettings(state.settings), previousPresetConfig: null, lightboxImageId: null, showSettings: false }))
      clearLegacyNasSettings()
      setSession(null)
      setPhase('login')
      setBusy(false)
      setPassword('')
      setError('请登录后继续')
    }
    window.addEventListener('nas-session-expired', lock)
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('nas-auth')
      channel.current.onmessage = () => expireNasSession()
    }
    void unlock()
    return () => {
      attempt.current++
      window.removeEventListener('nas-session-expired', lock)
      channel.current?.close()
    }
  }, [])

  useEffect(() => {
    if (phase !== 'ready' || !session) return
    const stopPresetSync = setupPromptPresetAutoSync()
    const timer = window.setTimeout(expireNasSession, Math.max(0, session.expiresAt - Date.now()))
    const recheck = () => {
      if (document.visibilityState === 'hidden') return
      void checkNasSession().catch(() => expireNasSession())
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      clearTimeout(timer)
      stopPresetSync()
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [phase, session])

  useEffect(() => {
    const logout = async () => {
      try {
        const response = await nasFetch('/api/auth/logout', { method: 'POST' })
        if (!response.ok) throw new Error('退出失败，请检查 NAS 连接后重试')
        channel.current?.postMessage('logout')
        expireNasSession()
      } catch (cause) { useStore.getState().showToast(cause instanceof Error ? cause.message : '退出失败', 'error') }
    }
    window.addEventListener('nas-logout', logout)
    return () => window.removeEventListener('nas-logout', logout)
  }, [])

  if (phase === 'ready') return <>{children}</>

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-12 bg-gray-50 dark:bg-gray-950">
      <form className="w-full max-w-sm space-y-5" onSubmit={async (event) => {
        event.preventDefault()
        if (busy) return
        if (phase === 'config') { await unlock(); return }
        setBusy(true)
        setError('')
        try {
          const response = await nasFetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
          if (!response.ok) throw new Error(response.status === 429 ? '尝试过于频繁，请稍后再试' : response.status === 401 ? '密码不正确' : '登录失败，请稍后重试')
          await unlock()
        } catch (cause) { setError(cause instanceof Error ? cause.message : '无法连接 NAS'); setBusy(false) }
      }}>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">GPT Image Playground</h1>
        {phase === 'checking' ? <p role="status">正在验证登录…</p> : <>
          {phase !== 'config' && <div className="space-y-3">
            <label htmlFor="nas-password" className="block text-sm font-medium">访问密码</label>
            <input id="nas-password" type={visible ? 'text' : 'password'} autoComplete="current-password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full h-12 px-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />显示密码</label>
          </div>}
          {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400 break-words">{error}</p>}
          <button disabled={busy} className="w-full min-h-12 rounded-lg bg-blue-600 text-white font-medium disabled:opacity-50">{busy ? '正在连接…' : phase === 'config' ? '重新读取配置' : '登录'}</button>
        </>}
      </form>
    </main>
  )
}
