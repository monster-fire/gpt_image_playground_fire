import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'vite'
import { createApp } from '../server/app.mjs'

const directory = await mkdtemp(join(tmpdir(), 'nas-ui-test-'))
const artifactDir = join(process.cwd(), '.omx', 'diagnostics', 'p0')
await mkdir(artifactDir, { recursive: true })
const app = await createApp({ password: 'browser-test-only', dataDir: join(directory, 'data'), apiConfigPath: join(directory, 'config.json'), cookieSecure: false })
const backend = httpServer(app.handler)
backend.listen(0, '127.0.0.1')
await once(backend, 'listening')
const server = await createServer({
  define: { 'import.meta.env.VITE_NAS_AUTH_ENABLED': JSON.stringify('true') },
  server: { host: '127.0.0.1', port: 0, proxy: { '/api/': { target: `http://127.0.0.1:${backend.address().port}` } } },
  logLevel: 'error',
})
await server.listen()
const browser = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', `--user-data-dir=${join(directory, 'browser')}`, 'about:blank',
], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  let port
  for (let attempt = 0; attempt < 100; attempt++) {
    try { port = (await readFile(join(directory, 'browser', 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
  if (!port) throw new Error('Chrome did not start')
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
  const url = `http://127.0.0.1:${server.httpServer.address().port}/`
  const open = async () => {
    const { targetId } = await send('Target.createTarget', { url })
    return (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId
  }
  const evaluate = async (sessionId, expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 15000 }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (sessionId, expression) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(sessionId, expression)) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  const screenshot = async (sessionId, name) => {
    const result = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
    await writeFile(join(artifactDir, name), Buffer.from(result.data, 'base64'))
  }
  const one = await open()
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, one)
  await waitFor(one, "!!document.querySelector('#nas-password')")
  if (await evaluate(one, "!!document.querySelector('header')")) throw new Error('Private workspace visible before login')
  await screenshot(one, 'login-desktop.png')
  const login = async (password) => {
    await evaluate(one, `(() => {
      const input = document.querySelector('#nas-password')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(password)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await evaluate(one, "document.querySelector('form').requestSubmit()")
  }
  await login('wrong-password')
  await waitFor(one, "document.body.innerText.includes('密码不正确')")
  if (await evaluate(one, "document.querySelector('#nas-password').value") !== 'wrong-password') throw new Error('Failed login cleared password')
  await login('browser-test-only')
  await waitFor(one, "!!document.querySelector('header')")
  const cookies = await send('Network.getCookies', { urls: [url] }, one)
  const cookie = cookies.cookies.find((cookie) => cookie.name === 'gip_session')
  if (!cookie?.httpOnly || cookie.sameSite !== 'Lax' || Math.abs(cookie.expires - Date.now() / 1000 - 604800) > 20) throw new Error('Invalid session cookie policy')
  const two = await open()
  await waitFor(two, "!!document.querySelector('header')")
  await evaluate(one, `(async () => {
    const { useStore } = await import('/src/store.ts')
    const settings = useStore.getState().settings
    useStore.getState().setSettings({ profiles: settings.profiles.map((p, i) => i ? p : { ...p, apiKey: 'browser-supplier-key', name: 'NAS saved profile' }) })
    await (await import('/src/lib/nasConfig.ts')).waitForNasConfig()
    useStore.getState().setPrompt('kept local draft')
  })()`)
  const saved = JSON.parse(await readFile(join(directory, 'config.json'), 'utf8'))
  if (saved.profiles[0].apiKey !== 'browser-supplier-key') throw new Error('Config was not saved to NAS')
  if (await evaluate(one, "JSON.stringify(localStorage).includes('browser-supplier-key')")) throw new Error('Supplier key persisted in localStorage')
  await send('Page.reload', {}, one)
  await waitFor(one, "!!document.querySelector('header')")
  if (!await evaluate(one, "(async () => (await import('/src/store.ts')).useStore.getState().settings.profiles[0].apiKey === 'browser-supplier-key')()")) throw new Error('NAS config not restored after refresh')
  await screenshot(one, 'workspace-desktop.png')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, one)
  await screenshot(one, 'workspace-mobile.png')
  if (await evaluate(one, 'document.documentElement.scrollWidth > innerWidth')) throw new Error('Mobile horizontal overflow')
  await evaluate(one, `(async () => {
    const { useStore } = await import('/src/store.ts')
    useStore.getState().setLightboxImageId('missing-a', ['missing-a', 'missing-b'])
  })()`)
  await waitFor(one, "document.body.innerText.includes('图片不存在')")
  await screenshot(one, 'lightbox-missing-mobile.png')
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' }, one)
  await waitFor(one, "document.body.innerText.includes('2 / 2')")
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }, one)
  await waitFor(one, "!document.querySelector('[data-lightbox-root]')")
  await evaluate(one, "window.dispatchEvent(new Event('nas-logout'))")
  await waitFor(one, "!!document.querySelector('#nas-password')")
  await waitFor(two, "!!document.querySelector('#nas-password')")
  if (await evaluate(one, "(async () => (await import('/src/store.ts')).useStore.getState().settings.profiles[0].apiKey)()")) throw new Error('Key retained after logout')
  await screenshot(one, 'login-mobile.png')
  const status = await evaluate(one, "fetch('/api/api-config').then(r => r.status)")
  if (status !== 401) throw new Error('Config accessible after logout')
  console.log('PASS: login, wrong password, fixed cookie expiry, reload, NAS save, no persisted key, desktop/mobile, missing lightbox navigation/Escape, multi-tab logout, revoked config access')
  await send('Browser.close')
} finally {
  socket?.close()
  if (browser.exitCode === null) { const closed = once(browser, 'close'); browser.kill(); await closed }
  await server.close()
  backend.closeAllConnections()
  await new Promise((resolve) => backend.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
