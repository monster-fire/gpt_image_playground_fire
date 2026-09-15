import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer as httpServer } from 'node:http'
import { createServer } from 'vite'
import { createApp } from '../server/app.mjs'

const directory = await mkdtemp(join(tmpdir(), 'p1-generation-'))
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
    } else {
      callback.resolve(message.result)
    }
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
    const url = `http://127.0.0.1:${server.httpServer.address().port}/`
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
    await send('Target.activateTarget', { targetId })
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.enable', {}, sessionId)
    await send('Runtime.enable', {}, sessionId)
    const loaded = oncePageLoad(sessionId)
    await send('Page.navigate', { url }, sessionId)
    await loaded
    await send('Page.bringToFront', {}, sessionId)
    return { targetId, sessionId }
  }
  const oncePageLoad = (sessionId) => new Promise((resolve) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
        socket.removeEventListener('message', onMessage)
        resolve()
      }
    }
    socket.addEventListener('message', onMessage)
    setTimeout(resolve, 3000)
  })
  const screenshot = async (page, name) => {
    await send('Target.activateTarget', { targetId: page.targetId })
    await send('Page.bringToFront', {}, page.sessionId)
    const result = await send('Page.captureScreenshot', { format: 'png' }, page.sessionId)
    await writeFile(join(artifacts, name), Buffer.from(result.data, 'base64'))
  }

  const page = await open()
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false }, page.sessionId)
  await waitFor(page.sessionId, "!!document.querySelector('#nas-password') || !!document.querySelector('header')")
  if (await evaluate(page.sessionId, "!!document.querySelector('#nas-password')")) {
    await evaluate(page.sessionId, `(() => {
      const input = document.querySelector('#nas-password')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'p1-browser-only')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await evaluate(page.sessionId, "document.querySelector('form').requestSubmit()")
  }
  await waitFor(page.sessionId, "!!document.querySelector('header')")

  await evaluate(page.sessionId, `(() => {
    const makeImage = (label) => {
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 72
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#2563eb'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#fff'
      ctx.font = '18px sans-serif'
      ctx.fillText(label, 18, 42)
      return canvas.toDataURL('image/png')
    }
    const originalFetch = window.fetch.bind(window)
    window.mockProviderRequests = []
    window.mockProviderImages = []
    window.fetch = async (input, init = {}) => {
      const url = typeof input === 'string' ? input : input?.url
      if (url && url.startsWith('https://mock.provider.test/v1/')) {
        const bodyText = typeof init.body === 'string' ? init.body : ''
        const parsed = bodyText ? JSON.parse(bodyText) : {}
        const image = makeImage(String(window.mockProviderRequests.length + 1))
        window.mockProviderRequests.push({ url, body: parsed, at: Date.now() })
        window.mockProviderImages.push(image)
        await new Promise((resolve) => setTimeout(resolve, 250))
        return new Response(JSON.stringify({ data: [{ b64_json: image.split(',')[1], revised_prompt: parsed.prompt }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return originalFetch(input, init)
    }
  })()`)
  await evaluate(page.sessionId, `(async () => {
    const { useStore } = await import('/src/store.ts')
    const state = useStore.getState()
    const settings = state.settings
    useStore.getState().setSettings({
      ...settings,
      activeProfileId: settings.profiles[0].id,
      profiles: settings.profiles.map((profile, index) => index === 0 ? {
        ...profile,
        provider: 'openai',
        apiMode: 'images',
        baseUrl: 'https://mock.provider.test/v1',
        apiKey: 'mock-key',
        model: 'mock-image',
        apiProxy: false,
      } : profile),
      clearInputAfterSubmit: false,
      persistInputOnRestart: true,
    })
  })()`)

  const clickSubmit = () => `(() => {
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => !button.disabled)
    const button = buttons.reverse().find((item) => item.innerText.includes('生成') || item.getAttribute('aria-label')?.includes('生成'))
    if (!button) throw new Error('submit button not found')
    button.click()
  })()`
  const setPromptPreset = (name, content, prompt) => `(async () => {
    const { useStore, selectPromptPreset } = await import('/src/store.ts')
    const presets = await import('/src/lib/promptPresets.ts')
    useStore.getState().setAppMode('gallery')
    await presets.savePromptPreset({ name: ${JSON.stringify(name)}, content: ${JSON.stringify(content)} })
    const preset = presets.getPromptPresetState().presets.find((item) => item.name === ${JSON.stringify(name)})
    selectPromptPreset(preset.id)
    useStore.getState().setPrompt(${JSON.stringify(prompt)})
    useStore.setState({ galleryFinalPromptEdit: null })
  })()`
  const finalPromptValue = "document.querySelector('textarea[aria-label=\"最终提示词\"]')?.value || document.querySelector('textarea[aria-label=\"鏈€缁堟彁绀鸿瘝\"]')?.value"
  const openFinalPrompt = `(() => {
    const details = Array.from(document.querySelectorAll('details')).find((item) => item.innerText.includes('最终提示词') || item.innerText.includes('鏈€缁堟彁绀鸿瘝'))
    if (details) details.open = true
    return Boolean(details)
  })()`

  await evaluate(page.sessionId, setPromptPreset('server-update-preview', 'server preset v1', 'camera angle'))
  await waitFor(page.sessionId, "(async () => { const { useStore } = await import('/src/store.ts'); const presets = await import('/src/lib/promptPresets.ts'); return Boolean(useStore.getState().galleryPromptPresetId && presets.getPromptPresetSnapshot(useStore.getState().galleryPromptPresetId)?.content === 'server preset v1') })()")
  await evaluate(page.sessionId, `(async () => {
    const presets = await import('/src/lib/promptPresets.ts')
    const preset = presets.getPromptPresetState().presets.find((item) => item.name === 'server-update-preview')
    const state = presets.getPromptPresetState()
    const { nasFetch } = await import('/src/lib/nasAuth.ts')
    const response = await nasFetch('/api/prompt-presets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': state.revision },
      body: JSON.stringify({ presets: state.presets.map((item) => item.id === preset.id ? { id: item.id, name: item.name, content: 'server preset v2' } : { id: item.id, name: item.name, content: item.content }) }),
    })
    if (!response.ok) throw new Error('server preset update failed')
  })()`)
  await evaluate(page.sessionId, clickSubmit())
  await waitFor(page.sessionId, "document.querySelector('[role=\"dialog\"]')?.innerText.includes('server preset v2')")
  await screenshot(page, 'p1-generation-server-update-confirm.png')
  await evaluate(page.sessionId, "Array.from(document.querySelectorAll('button')).find((button) => button.innerText.includes('确认') || button.innerText.includes('纭'))?.click()")
  await waitFor(page.sessionId, "window.mockProviderRequests.length === 1")
  const serverUpdate = await evaluate(page.sessionId, `(() => {
    const state = window.mockProviderRequests[0].body
    const tasks = window.__p1Tasks = []
    return { prompt: state.prompt, requests: window.mockProviderRequests.length }
  })()`)
  if (serverUpdate.prompt !== 'server preset v2\n\n本次用户要求：\ncamera angle') throw new Error(`Updated preset prompt mismatch: ${serverUpdate.prompt}`)

  await waitFor(page.sessionId, "(async () => (await import('/src/store.ts')).useStore.getState().tasks.some((task) => task.status === 'done' && task.prompt === 'server preset v2\\n\\n本次用户要求：\\ncamera angle'))()")

  await evaluate(page.sessionId, setPromptPreset('manual-conflict', 'manual preset v1', 'first object'))
  await waitFor(page.sessionId, "(async () => { const { useStore } = await import('/src/store.ts'); const presets = await import('/src/lib/promptPresets.ts'); return Boolean(useStore.getState().galleryPromptPresetId && presets.getPromptPresetSnapshot(useStore.getState().galleryPromptPresetId)?.content === 'manual preset v1') })()")
  await evaluate(page.sessionId, "(async () => { const { useStore } = await import('/src/store.ts'); useStore.setState({ galleryFinalPromptEdit: { text: 'manual prompt body', source: 'manual preset v1\\n\\n本次用户要求：\\nfirst object' } }) })()")
  await evaluate(page.sessionId, `(async () => {
    const presets = await import('/src/lib/promptPresets.ts')
    const preset = presets.getPromptPresetState().presets.find((item) => item.name === 'manual-conflict')
    const state = presets.getPromptPresetState()
    const { nasFetch } = await import('/src/lib/nasAuth.ts')
    const response = await nasFetch('/api/prompt-presets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': state.revision },
      body: JSON.stringify({ presets: state.presets.map((item) => item.id === preset.id ? { id: item.id, name: item.name, content: 'manual preset v2' } : { id: item.id, name: item.name, content: item.content }) }),
    })
    if (!response.ok) throw new Error('server preset update failed')
  })()`)
  await evaluate(page.sessionId, clickSubmit())
  await waitFor(page.sessionId, "!!document.querySelector('[role=\"dialog\"]')")
  await evaluate(page.sessionId, "Array.from(document.querySelector('[role=\"dialog\"]').querySelectorAll('button')).find((button) => button.innerText.includes('重新') || button.innerText.includes('閲') || button.innerText.includes('组合'))?.click()")
  await waitFor(page.sessionId, "window.mockProviderRequests.length === 2")
  const recomposedPrompt = await evaluate(page.sessionId, 'window.mockProviderRequests[1].body.prompt')
  if (recomposedPrompt !== 'manual preset v2\n\n本次用户要求：\nfirst object') throw new Error(`Recomposed prompt mismatch: ${recomposedPrompt}`)
  await waitFor(page.sessionId, `${finalPromptValue} === 'manual preset v2\\n\\n本次用户要求：\\nfirst object' || ${finalPromptValue} === undefined`)

  await evaluate(page.sessionId, setPromptPreset('manual-use', 'use preset v1', 'second object'))
  await waitFor(page.sessionId, "(async () => { const { useStore } = await import('/src/store.ts'); const presets = await import('/src/lib/promptPresets.ts'); return Boolean(useStore.getState().galleryPromptPresetId && presets.getPromptPresetSnapshot(useStore.getState().galleryPromptPresetId)?.content === 'use preset v1') })()")
  await evaluate(page.sessionId, "(async () => { const { useStore } = await import('/src/store.ts'); useStore.setState({ galleryFinalPromptEdit: { text: 'keep this manual body', source: 'use preset v1\\n\\n本次用户要求：\\nsecond object' } }) })()")
  await evaluate(page.sessionId, `(async () => {
    const presets = await import('/src/lib/promptPresets.ts')
    const preset = presets.getPromptPresetState().presets.find((item) => item.name === 'manual-use')
    const state = presets.getPromptPresetState()
    const { nasFetch } = await import('/src/lib/nasAuth.ts')
    const response = await nasFetch('/api/prompt-presets', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'If-Match': state.revision },
      body: JSON.stringify({ presets: state.presets.map((item) => item.id === preset.id ? { id: item.id, name: item.name, content: 'use preset v2' } : { id: item.id, name: item.name, content: item.content }) }),
    })
    if (!response.ok) throw new Error('server preset update failed')
  })()`)
  await evaluate(page.sessionId, clickSubmit())
  await waitFor(page.sessionId, "!!document.querySelector('[role=\"dialog\"]')")
  await evaluate(page.sessionId, "Array.from(document.querySelector('[role=\"dialog\"]').querySelectorAll('button')).find((button) => button.innerText.includes('使用') || button.innerText.includes('浣') || button.innerText.includes('手改'))?.click()")
  await waitFor(page.sessionId, "window.mockProviderRequests.length === 3")
  const manualPrompt = await evaluate(page.sessionId, 'window.mockProviderRequests[2].body.prompt')
  if (manualPrompt !== 'keep this manual body') throw new Error(`Manual prompt mismatch: ${manualPrompt}`)

  await evaluate(page.sessionId, `(async () => {
    const { useStore } = await import('/src/store.ts')
    useStore.setState({ galleryPromptPresetId: null, galleryFinalPromptEdit: null })
    useStore.getState().setPrompt('same double click prompt')
  })()`)
  await evaluate(page.sessionId, `(() => {
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => !button.disabled)
    const button = buttons.reverse().find((item) => item.innerText.includes('生成') || item.getAttribute('aria-label')?.includes('生成'))
    button.click()
    button.click()
  })()`)
  await waitFor(page.sessionId, "window.mockProviderRequests.length === 4")
  await new Promise((resolve) => setTimeout(resolve, 700))
  const afterDouble = await evaluate(page.sessionId, 'window.mockProviderRequests.length')
  if (afterDouble !== 4) throw new Error(`Double click sent duplicate requests: ${afterDouble}`)

  await evaluate(page.sessionId, `(async () => {
    const { useStore } = await import('/src/store.ts')
    useStore.setState({ galleryPromptPresetId: null, galleryFinalPromptEdit: null })
    useStore.getState().setPrompt('parallel prompt one')
  })()`)
  await evaluate(page.sessionId, clickSubmit())
  await evaluate(page.sessionId, "(async () => { const { useStore } = await import('/src/store.ts'); useStore.getState().setPrompt('parallel prompt two') })()")
  await evaluate(page.sessionId, clickSubmit())
  await waitFor(page.sessionId, "window.mockProviderRequests.length === 6")
  const prompts = await evaluate(page.sessionId, 'window.mockProviderRequests.map((request) => request.body.prompt)')
  if (!prompts.includes('parallel prompt one') || !prompts.includes('parallel prompt two')) throw new Error(`Parallel prompts missing: ${JSON.stringify(prompts)}`)
  await waitFor(page.sessionId, "(async () => (await import('/src/store.ts')).useStore.getState().tasks.filter((task) => task.status === 'done').length >= 6)()", 30000)
  const taskSummary = await evaluate(page.sessionId, `(async () => {
    const { useStore } = await import('/src/store.ts')
    return useStore.getState().tasks.map((task) => ({
      prompt: task.prompt,
      status: task.status,
      outputImages: task.outputImages.length,
      promptManuallyEdited: task.promptManuallyEdited ?? false,
      preset: task.promptPreset?.name ?? null,
    }))
  })()`)
  await screenshot(page, 'p1-generation-gallery-tasks.png')
  await writeFile(join(artifacts, 'p1-generation-evidence.json'), `${JSON.stringify({ prompts, taskSummary, requestCount: prompts.length }, null, 2)}\n`)
  console.log(`PASS: P1 generation prompt submission checks, mocked provider requests=${prompts.length}`)
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
