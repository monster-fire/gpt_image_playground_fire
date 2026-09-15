import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'vite'
import { createApp } from '../server/app.mjs'

const directory = await mkdtemp(join(tmpdir(), 'local-clear-'))
const artifacts = join(process.cwd(), '.omx', 'diagnostics', 'p1')
await mkdir(artifacts, { recursive: true })
const app = await createApp({ password: 'local-clear-only', dataDir: join(directory, 'data'), apiConfigPath: join(directory, 'config.json'), cookieSecure: false })
const backend = httpServer(app.handler)
backend.listen(0, '127.0.0.1')
await once(backend, 'listening')
const server = await createServer({ server: { host: '127.0.0.1', port: 0, proxy: { '/api/': { target: `http://127.0.0.1:${backend.address().port}` } } }, logLevel: 'error' })
await server.listen()
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-debugging-port=0',
  `--user-data-dir=${join(directory, 'browser')}`,
  'about:blank',
], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  let port
  for (let i = 0; i < 100; i++) {
    try {
      port = (await readFile(join(directory, 'browser', 'DevToolsActivePort'), 'utf8')).split('\n')[0]
      break
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  if (!port) throw new Error('Chrome did not start')
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  socket = new WebSocket(version.webSocketDebuggerUrl)
  await once(socket, 'open')
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const callback = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) {
      const summary = callback.params?.expression
        ? `${callback.method}: ${callback.params.expression.slice(0, 240)}`
        : callback.method
      callback.reject(new Error(`${message.error.message} (${summary})`))
    } else {
      callback.resolve(message.result)
    }
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const key = ++id
    pending.set(key, { resolve, reject, method, params })
    socket.send(JSON.stringify({ id: key, method, params, sessionId }))
  })
  const open = async () => {
    const url = `http://127.0.0.1:${server.httpServer.address().port}/`
    const { targetId } = await send('Target.createTarget', { url })
    await send('Target.activateTarget', { targetId })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    await send('Page.bringToFront', {}, sessionId)
    return { targetId, sessionId }
  }
  const evaluate = async (sessionId, expression, timeout = 20000) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (sessionId, expression, timeoutMs = 20000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(sessionId, expression)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  const login = async (page) => {
    await waitFor(page.sessionId, "!!document.querySelector('#nas-password') || !!document.querySelector('header')")
    if (await evaluate(page.sessionId, "!!document.querySelector('#nas-password')")) {
      await evaluate(page.sessionId, `(() => {
        const input = document.querySelector('#nas-password')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'local-clear-only')
        input.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('form').requestSubmit()
      })()`)
      await waitFor(page.sessionId, "!!document.querySelector('header')")
    }
  }

  const first = await open()
  const second = await open()
  await login(first)
  await login(second)

  const seedScript = `(async () => {
    const { useStore } = await import('/src/store.ts')
    const db = await import('/src/lib/db.ts')
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
    await db.putImage({ id: 'seed-image', dataUrl, source: 'upload', createdAt: 1 })
    await db.putImageThumbnail({ id: 'seed-image', thumbnailDataUrl: dataUrl, thumbnailVersion: db.CURRENT_THUMBNAIL_VERSION })
    await db.putTask({ id: 'seed-task', prompt: 'seed', params: (await import('/src/types.ts')).DEFAULT_PARAMS, inputImageIds: [], outputImages: ['seed-image'], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1 })
    await db.putAgentConversation({ id: 'seed-conv', title: 'seed', activeRoundId: null, rounds: [], messages: [], createdAt: 1, updatedAt: 1 })
    await db.putAgentContextImageIfSourceMatches({ id: 'seed-image', dataUrl, version: 1 }, dataUrl, await db.getRebuildableCacheEpoch())
    await (await import('/src/lib/nasConfig.ts')).waitForNasConfig()
    useStore.setState({ tasks: [{ id: 'running-task', prompt: 'running', params: (await import('/src/types.ts')).DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null }] })
    return await db.getLocalDataSummary()
  })()`
  const seeded = await evaluate(first.sessionId, seedScript)

  const runningReject = await evaluate(second.sessionId, `(async () => {
    const { clearData } = await import('/src/store.ts')
    try {
      await clearData({ clearConfig: false, clearPreferences: false, clearTasks: true })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), summary: await (await import('/src/lib/db.ts')).getLocalDataSummary() }
    }
  })()`)
  if (runningReject.ok) throw new Error('Clear unexpectedly succeeded while another page had a running Agent task')
  if (runningReject.summary.tasks.count !== seeded.tasks.count || runningReject.summary.images.count !== seeded.images.count) {
    throw new Error(`Clear mutated stores after running rejection: ${JSON.stringify(runningReject.summary)}`)
  }

  await evaluate(first.sessionId, "(async () => { const { useStore } = await import('/src/store.ts'); useStore.setState({ tasks: [] }) })()")
  await evaluate(second.sessionId, `(async () => {
    const { useStore } = await import('/src/store.ts')
    const settings = useStore.getState().settings
    useStore.getState().setSettings({ ...settings, clearInputAfterSubmit: true, enterSubmit: true, agentScrollToBottomAfterSubmit: false })
  })()`)
  await waitFor(second.sessionId, "(async () => !(await (await import('/src/lib/localDataActivity.ts')).hasRecentLocalDataWrite()))()")
  const activityAfterRunningReject = await evaluate(second.sessionId, `(async () => {
    const { useStore } = await import('/src/store.ts')
    const activity = await import('/src/lib/localDataActivity.ts')
    return {
      hasRecent: await activity.hasRecentLocalDataWrite(),
      tasks: useStore.getState().tasks.map((task) => ({ id: task.id, status: task.status })),
      runningRounds: useStore.getState().agentConversations.flatMap((conversation) => conversation.rounds).filter((round) => round.status === 'running').length,
    }
  })()`)
  const writeDuringClear = await evaluate(first.sessionId, `(async () => {
    const activity = await import('/src/lib/localDataActivity.ts')
    const db = await import('/src/lib/db.ts')
    localStorage.setItem('gpt-image-playground-clear-lock', JSON.stringify({ owner: 'other-tab', expiresAt: Date.now() + 60000 }))
    try {
      await db.putImage({ id: 'blocked-during-clear', dataUrl: 'data:image/png;base64,AQID', source: 'upload', createdAt: 2 })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    } finally {
      localStorage.removeItem('gpt-image-playground-clear-lock')
    }
  })()`)
  if (writeDuringClear.ok) throw new Error('putImage succeeded while another page clear lock was active')

  const clearResult = await evaluate(second.sessionId, `(async () => {
    const { clearData, useStore } = await import('/src/store.ts')
    const db = await import('/src/lib/db.ts')
    try {
      await clearData({ clearConfig: false, clearPreferences: false, clearTasks: true })
      return {
        ok: true,
        summary: await db.getLocalDataSummary(),
        settings: useStore.getState().settings,
        configProfileCount: (await (await import('/src/lib/nasConfig.ts')).loadNasSettings(useStore.getState().settings)).profiles.length,
        activityBefore: ${JSON.stringify(activityAfterRunningReject)},
      }
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        summary: await db.getLocalDataSummary(),
        settings: useStore.getState().settings,
        activityBefore: ${JSON.stringify(activityAfterRunningReject)},
      }
    }
  })()`, 30000)
  if (!clearResult.ok) {
    await writeFile(join(artifacts, 'local-clear-multipage-evidence.json'), `${JSON.stringify({
      runningReject,
      writeDuringClear,
      clearResult,
      blocker: 'clearData stayed locally active after a previous running-task rejection',
    }, null, 2)}\n`)
    throw new Error(`clearData remained blocked after running rejection: ${clearResult.message}`)
  }
  for (const [name, summary] of Object.entries(clearResult.summary)) {
    if (summary.count !== 0) throw new Error(`${name} was not cleared: ${JSON.stringify(summary)}`)
  }
  const expectedPreferences = { clearInputAfterSubmit: true, enterSubmit: true, agentScrollToBottomAfterSubmit: false }
  if (clearResult.settings.clearInputAfterSubmit !== expectedPreferences.clearInputAfterSubmit
    || clearResult.settings.enterSubmit !== expectedPreferences.enterSubmit
    || clearResult.settings.agentScrollToBottomAfterSubmit !== expectedPreferences.agentScrollToBottomAfterSubmit) {
    await writeFile(join(artifacts, 'local-clear-multipage-evidence.json'), `${JSON.stringify({ runningReject, writeDuringClear, clearResult, blocker: 'local preferences changed during clear' }, null, 2)}\n`)
    throw new Error('Local preferences were not preserved')
  }
  if (clearResult.configProfileCount < 1) throw new Error('Server API config was cleared unexpectedly')

  const staleWrite = await evaluate(first.sessionId, `(async () => {
    const db = await import('/src/lib/db.ts')
    try {
      await db.putTask({ id: 'stale-task', prompt: 'stale', params: (await import('/src/types.ts')).DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1 })
      return { ok: true }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })()`)
  if (staleWrite.ok || !staleWrite.message.includes('刷新')) throw new Error(`Old page putTask did not reject with refresh hint: ${JSON.stringify(staleWrite)}`)

  await send('Page.reload', { ignoreCache: true }, first.sessionId)
  await login(first)
  const refreshedWrite = await evaluate(first.sessionId, `(async () => {
    const db = await import('/src/lib/db.ts')
    await db.putTask({ id: 'fresh-task', prompt: 'fresh', params: (await import('/src/types.ts')).DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'done', error: null, createdAt: 1, finishedAt: 2, elapsed: 1 })
    return await db.getLocalDataSummary()
  })()`)
  if (refreshedWrite.tasks.count !== 1) throw new Error(`Refreshed page could not write after clear: ${JSON.stringify(refreshedWrite)}`)

  const evidence = {
    runningReject,
    writeDuringClear,
    clearSummary: clearResult.summary,
    preferences: {
      clearInputAfterSubmit: clearResult.settings.clearInputAfterSubmit,
      enterSubmit: clearResult.settings.enterSubmit,
      agentScrollToBottomAfterSubmit: clearResult.settings.agentScrollToBottomAfterSubmit,
    },
    configProfileCount: clearResult.configProfileCount,
    staleWrite,
    refreshedWrite,
  }
  await writeFile(join(artifacts, 'local-clear-multipage-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log('PASS: multipage local clear lock/epoch checks')
  void send('Browser.close').catch(() => undefined)
} finally {
  socket?.close()
  if (browser.exitCode === null) {
    const closed = once(browser, 'close')
    browser.kill()
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 3000))])
  }
  await server.close()
  backend.closeAllConnections()
  await new Promise((resolve) => backend.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
