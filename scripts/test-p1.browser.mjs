import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'vite'
import { createApp } from '../server/app.mjs'

const directory = await mkdtemp(join(tmpdir(), 'p1-ui-'))
const artifacts = join(process.cwd(), '.omx', 'diagnostics', 'p1')
await mkdir(artifacts, { recursive: true })
const app = await createApp({ password: 'p1-browser-only', dataDir: join(directory, 'data'), apiConfigPath: join(directory, 'config.json'), cookieSecure: false })
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
      await new Promise((r) => setTimeout(r, 100))
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
    }
    else callback.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const key = ++id
    pending.set(key, { resolve, reject, method, params })
    socket.send(JSON.stringify({ id: key, method, params, sessionId }))
  })
  const evaluate = async (sessionId, expression, timeout = 20000) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout }, sessionId)
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (sessionId, expression, timeoutMs = 20000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (await evaluate(sessionId, expression)) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`Timed out: ${expression}`)
  }
  const open = async () => {
    const { targetId } = await send('Target.createTarget', { url: `http://127.0.0.1:${server.httpServer.address().port}/` })
    await send('Target.activateTarget', { targetId })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    await send('Page.bringToFront', {}, sessionId)
    return { targetId, sessionId }
  }
  const bringToFront = async (page) => {
    await send('Target.activateTarget', { targetId: page.targetId })
    await send('Page.bringToFront', {}, page.sessionId)
  }
  const screenshot = async (page, name) => {
    await bringToFront(page)
    const result = await send('Page.captureScreenshot', { format: 'png' }, page.sessionId)
    await writeFile(join(artifacts, name), Buffer.from(result.data, 'base64'))
  }
  const verifyKeyboardClearance = async (page, width, height) => {
    const result = await evaluate(page.sessionId, `(() => {
      const original = window.visualViewport
      const listeners = new Map()
      const viewport = {
        width: ${width},
        height: ${Math.max(320, height - 320)},
        offsetTop: 0,
        offsetLeft: 0,
        pageTop: 0,
        pageLeft: 0,
        scale: 1,
        addEventListener(type, listener) {
          if (!listeners.has(type)) listeners.set(type, new Set())
          listeners.get(type).add(listener)
        },
        removeEventListener(type, listener) {
          listeners.get(type)?.delete(listener)
        },
        dispatch(type) {
          for (const listener of listeners.get(type) ?? []) listener.call(viewport, new Event(type))
        },
      }
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
      window.dispatchEvent(new Event('resize'))
      viewport.dispatch('resize')
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const bar = document.querySelector('[data-input-bar]')
        const submit = Array.from(bar?.querySelectorAll('button') ?? []).find((button) => /发送|开始生成|生成图像|遮罩编辑|请先配置 API|配置 API|打开设置|停止生成/.test(button.getAttribute('aria-label') || button.textContent || ''))
        if (!bar || !submit) {
          Object.defineProperty(window, 'visualViewport', { configurable: true, value: original })
          window.dispatchEvent(new Event('resize'))
          resolve({ ok: false, reason: 'input bar or submit button missing' })
          return
        }
        const style = getComputedStyle(bar)
        const rect = submit.getBoundingClientRect()
        const expectedBottom = window.innerHeight - viewport.height - viewport.offsetTop + 8
        const expectedMaxHeight = viewport.height - 16
        const ok = Math.abs(parseFloat(style.bottom) - expectedBottom) <= 1
          && Math.abs(parseFloat(style.maxHeight) - expectedMaxHeight) <= 1
          && style.overflowY === 'auto'
          && rect.bottom <= viewport.height + viewport.offsetTop
        submit.click()
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: original })
        window.dispatchEvent(new Event('resize'))
        resolve({
          ok,
          bottom: style.bottom,
          maxHeight: style.maxHeight,
          overflowY: style.overflowY,
          buttonBottom: rect.bottom,
          viewportBottom: viewport.height + viewport.offsetTop,
          expectedBottom,
          expectedMaxHeight,
        })
      })))
    })()`)
    if (!result.ok) throw new Error(`Keyboard clearance failed ${width}: ${JSON.stringify(result)}`)
    await new Promise((r) => setTimeout(r, 100))
    return result
  }

  const one = await open()
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, one.sessionId)
  await waitFor(one.sessionId, "!!document.querySelector('#nas-password')")
  await evaluate(one.sessionId, `(() => { const input = document.querySelector('#nas-password'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'p1-browser-only'); input.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await evaluate(one.sessionId, "document.querySelector('form').requestSubmit()")
  await waitFor(one.sessionId, "!!document.querySelector('header')")

  await evaluate(one.sessionId, `(async () => { const p = await import('/src/lib/promptPresets.ts'); await p.savePromptPreset({ name: 'P1 Browser Preset', content: 'natural light, crisp details' }) })()`)
  const two = await open()
  await waitFor(two.sessionId, "document.body.innerText.includes('P1 Browser Preset')")
  if (await evaluate(one.sessionId, "JSON.stringify(localStorage).includes('natural light, crisp details')")) throw new Error('Preset library leaked into localStorage')
  await evaluate(one.sessionId, `(async () => { const { useStore, selectPromptPreset } = await import('/src/store.ts'); const p = await import('/src/lib/promptPresets.ts'); selectPromptPreset(p.getPromptPresetState().presets.find(p => p.name === 'P1 Browser Preset').id); useStore.getState().setPrompt('quiet window still life') })()`)
  await waitFor(one.sessionId, "!!document.querySelector('textarea')")
  const preview = await evaluate(one.sessionId, "Array.from(document.querySelectorAll('textarea')).map((el) => el.value).join('\\n')")
  if (!preview.includes('quiet window still life') || !preview.includes('natural light')) throw new Error('Gallery preset composition incorrect')
  await evaluate(one.sessionId, `(() => {
    const details = Array.from(document.querySelectorAll('details')).find((item) => item.innerText.includes('最终提示词'))
    if (!details) throw new Error('Final prompt editor not found')
    details.open = true
    const textarea = document.querySelector('textarea[aria-label="最终提示词"]')
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'manual final prompt survives modes')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await waitFor(one.sessionId, "document.querySelector('textarea[aria-label=\"最终提示词\"]')?.value === 'manual final prompt survives modes'")
  await evaluate(one.sessionId, `(async () => {
    const { useStore } = await import('/src/store.ts')
    useStore.getState().setAppMode('agent')
    await new Promise((resolve) => setTimeout(resolve, 50))
    useStore.getState().setAppMode('gallery')
  })()`)
  await waitFor(one.sessionId, "document.querySelector('textarea[aria-label=\"最终提示词\"]')?.value === 'manual final prompt survives modes'")
  await evaluate(one.sessionId, "(async () => { const { useStore } = await import('/src/store.ts'); useStore.getState().setSettings({ ...useStore.getState().settings, persistInputOnRestart: true }) })()")
  await new Promise((r) => setTimeout(r, 300))
  await send('Page.reload', { ignoreCache: true }, one.sessionId)
  await waitFor(one.sessionId, "!!document.querySelector('header') && document.body.innerText.includes('P1 Browser Preset')", 30000)
  await waitFor(one.sessionId, `(() => {
    const details = Array.from(document.querySelectorAll('details')).find((item) => item.innerText.includes('最终提示词'))
    if (!details) return false
    details.open = true
    return document.querySelector('textarea[aria-label="最终提示词"]')?.value === 'manual final prompt survives modes'
  })()`, 30000)
  await screenshot(one, 'gallery-desktop.png')

  const keyboardChecks = []
  for (const [width, height] of [[390, 844], [360, 740]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true }, one.sessionId)
    await bringToFront(one)
    await new Promise((r) => setTimeout(r, 300))
    if (await evaluate(one.sessionId, 'document.documentElement.scrollWidth > innerWidth')) throw new Error(`Mobile overflow ${width}`)
    keyboardChecks.push({ width, height, ...(await verifyKeyboardClearance(one, width, height)) })
    await screenshot(one, `gallery-${width}.png`)
  }
  await evaluate(one.sessionId, "(async () => (await import('/src/store.ts')).useStore.getState().setShowSettings(true, 'data'))()")
  await waitFor(one.sessionId, "!!document.querySelector('[role=\"dialog\"]')")
  await screenshot(one, 'storage-mobile.png')
  await evaluate(one.sessionId, "(async () => (await import('/src/store.ts')).useStore.getState().setShowSettings(false))()")
  await waitFor(one.sessionId, "!document.querySelector('[role=\"dialog\"]')")

  await evaluate(one.sessionId, `(async () => {
    const { useStore } = await import('/src/store.ts')
    const db = await import('/src/lib/db.ts')
    const makeImage = (i, variant) => {
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 72
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = 'hsl(' + ((i * 17 + variant * 80) % 360) + ' 75% 55%)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(255,255,255,.86)'
      ctx.fillRect(8 + variant * 6, 8 + variant * 5, 42, 24)
      ctx.fillStyle = '#111827'
      ctx.font = '16px sans-serif'
      ctx.fillText(String(i), 16, 50)
      return canvas.toDataURL('image/png')
    }
    const rounds = []
    const messages = []
    for (let i = 0; i < 100; i++) {
      const r = 'round-' + i
      const u = 'user-' + i
      const a = 'assistant-' + i
      const inputs = ['input-' + i + '-0', 'input-' + i + '-1']
      for (let j = 0; j < inputs.length; j++) {
        await db.putImage({ id: inputs[j], dataUrl: makeImage(i, j), createdAt: i + 1, source: 'upload', width: 96, height: 72 })
      }
      rounds.push({ id: r, index: i + 1, parentRoundId: i ? 'round-' + (i - 1) : null, userMessageId: u, assistantMessageId: a, prompt: 'P1 image round ' + i, inputImageIds: inputs, outputTaskIds: [], status: 'done', error: null, createdAt: i + 1, finishedAt: i + 2 })
      messages.push(
        { id: u, role: 'user', content: 'Round ' + (i + 1) + ' refs', roundId: r, inputImageIds: inputs, createdAt: i + 1 },
        { id: a, role: 'assistant', content: 'Recorded references for round ' + (i + 1), roundId: r, createdAt: i + 2 },
      )
    }
    const conversation = { id: 'long-conversation', title: 'P1 100 Round Visual Test', activeRoundId: 'round-99', rounds, messages, createdAt: 1, updatedAt: 101 }
    await db.putAgentConversation(conversation)
    await (await import('/src/lib/nasConfig.ts')).waitForNasConfig()
    window.originalReads = 0
    const originalGet = IDBObjectStore.prototype.get
    IDBObjectStore.prototype.get = function(key) {
      if (this.name === 'images') window.originalReads++
      return originalGet.call(this, key)
    }
    useStore.setState({ appMode: 'agent', agentConversations: [conversation], activeAgentConversationId: conversation.id, tasks: [], prompt: '' })
    window.scrollTo(0, 0)
  })()`, 60000)
  await waitFor(one.sessionId, "document.body.innerText.includes('P1 100 Round Visual Test')")
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, one.sessionId)
  await bringToFront(one)
  await waitFor(one.sessionId, "document.querySelectorAll('[data-agent-chat-image-thumb]').length > 0")
  await waitFor(one.sessionId, `(() => {
    const imgs = Array.from(document.querySelectorAll('[data-agent-chat-image-thumb-img]')).filter((img) => {
      const rect = img.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < innerHeight && img.naturalWidth > 0 && img.naturalHeight > 0
    })
    return imgs.length > 0
  })()`, 30000)
  const initialReads = await evaluate(one.sessionId, 'window.originalReads')
  if (initialReads <= 0 || initialReads >= 200) throw new Error(`Expected lazy first-view original reads between 1 and 199, got ${initialReads}`)
  await screenshot(one, 'agent-first-view-mobile.png')
  await evaluate(one.sessionId, 'window.scrollTo(0, document.scrollingElement.scrollHeight)')
  await waitFor(one.sessionId, `(() => {
    const imgs = Array.from(document.querySelectorAll('[data-agent-chat-image-thumb-img]')).filter((img) => {
      const rect = img.getBoundingClientRect()
      return rect.bottom > 0 && rect.top < innerHeight && img.naturalWidth > 0 && img.naturalHeight > 0
    })
    return imgs.length > 0
  })()`, 30000)
  const afterScrollReads = await evaluate(one.sessionId, 'window.originalReads')
  if (afterScrollReads <= initialReads || afterScrollReads >= 200) throw new Error(`Expected scroll-triggered lazy reads under 200, got initial=${initialReads}, after=${afterScrollReads}`)
  if (await evaluate(one.sessionId, 'document.documentElement.scrollWidth > innerWidth')) throw new Error('Agent mobile overflow 390')
  await screenshot(one, 'agent-after-scroll-mobile.png')

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, one.sessionId)
  await bringToFront(one)
  await new Promise((r) => setTimeout(r, 300))
  if (await evaluate(one.sessionId, 'document.documentElement.scrollWidth > innerWidth')) throw new Error('Agent desktop overflow')
  await screenshot(one, 'agent-100-rounds-desktop.png')

  await evaluate(one.sessionId, `(() => {
    const thumb = document.querySelector('[data-agent-chat-image-thumb]')
    thumb.focus()
    thumb.click()
  })()`)
  await waitFor(one.sessionId, "!!document.querySelector('[data-lightbox-root] img.saveable-image') && document.querySelector('[data-lightbox-root] img.saveable-image').naturalWidth > 0")
  const firstLightboxId = await evaluate(one.sessionId, "document.querySelector('[data-lightbox-root] img.saveable-image').dataset.imageId")
  await evaluate(one.sessionId, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))")
  await waitFor(one.sessionId, `document.querySelector('[data-lightbox-root] img.saveable-image')?.dataset.imageId !== ${JSON.stringify(firstLightboxId)}`)
  await screenshot(one, 'agent-lightbox-next.png')
  await evaluate(one.sessionId, "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))")
  await waitFor(one.sessionId, "!document.querySelector('[data-lightbox-root]')")
  const focusRestored = await evaluate(one.sessionId, "document.activeElement?.matches('[data-agent-chat-image-thumb]') === true")
  if (!focusRestored) throw new Error('Lightbox focus was not restored to the opener')

  await evaluate(two.sessionId, `(async () => { const p = await import('/src/lib/promptPresets.ts'); await p.deletePromptPreset(p.getPromptPresetState().presets.find(p => p.name === 'P1 Browser Preset').id) })()`)
  await waitFor(one.sessionId, "!document.body.innerText.includes('P1 Browser Preset')")
  const evidence = {
    initialReads,
    afterScrollReads,
    firstLightboxId,
    keyboardChecks,
    keyboardNote: 'Chrome visualViewport height/resize simulation only; real mobile soft keyboard still needs device acceptance.',
    screenshots: [
      'gallery-desktop.png',
      'gallery-390.png',
      'gallery-360.png',
      'storage-mobile.png',
      'agent-first-view-mobile.png',
      'agent-after-scroll-mobile.png',
      'agent-100-rounds-desktop.png',
      'agent-lightbox-next.png',
    ],
  }
  await writeFile(join(artifacts, 'p1-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(`PASS: P1 browser checks, lazy original reads initial=${initialReads}, afterScroll=${afterScrollReads}`)
  await send('Browser.close')
} finally {
  socket?.close()
  if (browser.exitCode === null) {
    const closed = once(browser, 'close')
    browser.kill()
    await closed
  }
  await server.close()
  backend.closeAllConnections()
  await new Promise((resolve) => backend.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
