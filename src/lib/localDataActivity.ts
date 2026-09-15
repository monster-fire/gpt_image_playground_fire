const CHANNEL_NAME = 'gpt-image-playground-local-data-activity'
const RESPONSE_TIMEOUT_MS = 300
const CLEAR_LOCK_KEY = 'gpt-image-playground-clear-lock'
const CLEAR_EPOCH_KEY = 'gpt-image-playground-clear-epoch'
const tabId = `${Date.now()}-${Math.random()}`
let ownsClear = false
let observedEpoch: string | null | undefined
let clearRequestPending = false

let checker: (() => boolean) | null = null
let activeWrites = 0
let channel: BroadcastChannel | null = null

function getChannel() {
  if (typeof BroadcastChannel === 'undefined') return null
  if (channel) return channel
  channel = new BroadcastChannel(CHANNEL_NAME)
  channel.addEventListener('message', (event) => {
    if (event.data?.type === 'cleared') {
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('local-data-cleared-elsewhere'))
      return
    }
    if (event.data?.type !== 'query') return
    if (isLocalActive()) channel?.postMessage({ type: 'active', id: event.data.id })
  })
  return channel
}

// 每次数据库操作都检查持久锁，涵盖后台标签尚未处理广播的时间窗口。
export function assertLocalDataAccess() {
  if (typeof localStorage === 'undefined') return
  const epoch = localStorage.getItem(CLEAR_EPOCH_KEY)
  if (observedEpoch === undefined) observedEpoch = epoch
  if (!ownsClear && observedEpoch !== epoch) throw new Error('其他页面已清空本地数据，请刷新当前页面')
  const raw = localStorage.getItem(CLEAR_LOCK_KEY)
  if (!raw) return
  const lock = JSON.parse(raw) as { owner: string; expiresAt: number }
  if (lock.owner !== tabId && lock.expiresAt > Date.now()) throw new Error('其他页面正在清空本地数据，请稍后再试')
}

function isLocalActive() {
  return activeWrites > 0 || Boolean(checker?.())
}

async function hasOtherTabActivity() {
  const active = getChannel()
  if (!active) return false
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return await new Promise<boolean>((resolve) => {
    let done = false
    const finish = (result: boolean) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      active.removeEventListener('message', onMessage)
      resolve(result)
    }
    const timer = window.setTimeout(() => finish(false), RESPONSE_TIMEOUT_MS)
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'active' || event.data.id !== id) return
      finish(true)
    }
    active.addEventListener('message', onMessage)
    active.postMessage({ type: 'query', id })
  })
}

export function registerLocalDataActivityChecker(fn: () => boolean) {
  checker = fn
  if (typeof localStorage !== 'undefined') observedEpoch = localStorage.getItem(CLEAR_EPOCH_KEY)
  getChannel()
}

export function beginLocalDataWrite() {
  activeWrites++
  getChannel()
  return () => {
    activeWrites = Math.max(0, activeWrites - 1)
  }
}

export async function trackLocalDataWrite<T>(promise: Promise<T>) {
  const end = beginLocalDataWrite()
  try {
    return await promise
  } finally {
    end()
  }
}

export async function hasRecentLocalDataWrite() {
  if (isLocalActive()) return true
  return await hasOtherTabActivity()
}

export async function assertNoRecentLocalDataWrite() {
  if (await hasRecentLocalDataWrite()) throw new Error('其他页面正在写入本地数据，请稍后再试')
}

export async function runExclusiveLocalDataClear<T>(fn: () => Promise<T>) {
  if (clearRequestPending || isLocalActive()) throw new Error('当前页面正在写入本地数据，请稍后再试')
  assertLocalDataAccess()
  if (typeof localStorage === 'undefined') throw new Error('浏览器无法协调本地清理，请检查站点存储权限')
  localStorage.setItem(CLEAR_LOCK_KEY, JSON.stringify({ owner: tabId, expiresAt: Date.now() + 60_000 }))
  clearRequestPending = true
  const end = beginLocalDataWrite()
  try {
    if (await hasOtherTabActivity()) throw new Error('其他页面正在写入本地数据，请稍后再试')
    assertLocalDataAccess()
    ownsClear = true
    observedEpoch = `${Date.now()}-${Math.random()}`
    localStorage.setItem(CLEAR_EPOCH_KEY, observedEpoch)
    const result = await fn()
    getChannel()?.postMessage({ type: 'cleared' })
    return result
  } finally {
    ownsClear = false
    clearRequestPending = false
    const lock = JSON.parse(localStorage.getItem(CLEAR_LOCK_KEY) || 'null') as { owner?: string } | null
    if (lock?.owner === tabId) localStorage.removeItem(CLEAR_LOCK_KEY)
    end()
  }
}

export function resetLocalDataActivityForTests() {
  checker = null
  activeWrites = 0
  channel?.close()
  channel = null
  observedEpoch = undefined
  ownsClear = false
  clearRequestPending = false
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(CLEAR_LOCK_KEY)
    localStorage.removeItem(CLEAR_EPOCH_KEY)
  }
}
