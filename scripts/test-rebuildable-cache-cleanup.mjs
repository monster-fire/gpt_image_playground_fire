import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'vite'

const server = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, entries: [] },
  server: { host: '127.0.0.1', port: 0 }, logLevel: 'error',
  plugins: [{ name: 'rebuildable-cache-test', configureServer(server) {
    server.middlewares.use('/cache-cleanup-test', (_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Rebuildable cache cleanup test</title>') })
  } }],
})
await server.listen()
const directory = await mkdtemp(join(tmpdir(), 'rebuildable-cache-test-'))
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  let port
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
  if (!port) throw new Error('Browser did not start; set CHROME_PATH')
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  socket = new WebSocket(version.webSocketDebuggerUrl)
  await once(socket, 'open')
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const callback = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) callback.reject(new Error(message.error.message))
    else callback.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const url = `http://127.0.0.1:${server.httpServer.address().port}/cache-cleanup-test`
  const createSession = async () => {
    const { targetId } = await send('Target.createTarget', { url })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Runtime.enable', {}, sessionId)
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return sessionId
  }
  const pageA = await createSession()
  const pageB = await createSession()
  const evaluate = async (sessionId, expression) => {
    const result = await send('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true, timeout: 30000,
      expression,
    }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const run = async (sessionId, fn) => {
    const value = await evaluate(sessionId, `(async () => (await import('/scripts/rebuildable-cache-cleanup.browser.ts')).${fn}())()`)
    console.log(JSON.stringify({ fn, result: value ?? 'passed' }))
    return value
  }
  await run(pageA, 'seedDatabase')
  await run(pageA, 'startDelayedWrites')
  for (let attempt = 0; attempt < 40; attempt++) {
    const status = await run(pageA, 'getDelayedStatus')
    if (status?.waiting >= 2) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await run(pageB, 'clearFromSecondTab')
  await run(pageA, 'releaseDelayedWrites')
  await run(pageA, 'verifyNoLateWrites')
  await send('Browser.close')
} finally {
  socket?.close()
  if (browser.exitCode === null) {
    const closed = once(browser, 'close')
    browser.kill()
    await closed
  }
  await server.close()
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
