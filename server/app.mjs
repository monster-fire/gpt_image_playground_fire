import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import http, { createServer } from 'node:http'
import https from 'node:https'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { preparePromptPresetWrite, readPromptPresets, writePromptPresets } from './promptPresets.mjs'

const SESSION_COOKIE = 'gip_session'
const CSRF_HEADER = 'x-csrf-token'
const SESSION_TTL_MS = 168 * 60 * 60 * 1000
const MAX_LOGIN_BODY_BYTES = 16 * 1024
const MAX_CONFIG_BODY_BYTES = 20 * 1024 * 1024
const MAX_PRESETS_BODY_BYTES = 12 * 1024 * 1024
const DEFAULT_PROXY_BODY_BYTES = 700 * 1024 * 1024
const DEFAULT_PROXY_TIMEOUT_MS = 600 * 1000
const AUTH_ERROR_CODE = 'APP_SESSION_EXPIRED'
const REQUEST_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  CSRF_HEADER,
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-app-auth-error',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
])
const RESPONSE_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-app-auth-error',
])

function jsonResponse(res, status, body, headers = {}) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(data)
}

function errorResponse(res, status, code, message, headers = {}) {
  jsonResponse(res, status, { error: { code, message } }, headers)
}

function authError(res) {
  errorResponse(res, 401, AUTH_ERROR_CODE, 'Session expired. Please sign in again.', {
    'X-App-Auth-Error': AUTH_ERROR_CODE,
  })
}

function parseCookies(header = '') {
  const cookies = new Map()
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    if (!key) continue
    cookies.set(key, decodeURIComponent(part.slice(idx + 1).trim()))
  }
  return cookies
}

function makeCookie(value, opts) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax']
  if (opts.secure) parts.push('Secure')
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${opts.maxAge}`)
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`)
  return parts.join('; ')
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function passwordVersion(password) {
  return scryptSync(password, 'gpt-image-playground-app-password-v1', 32).toString('hex')
}

function safeEqualText(a, b) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function serialize() {
  let last = Promise.resolve()
  return async (work) => {
    const run = last.then(work, work)
    last = run.catch(() => {})
    return run
  }
}

async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT') return fallback
    throw err
  }
}

async function atomicWriteJson(path, data) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

async function readBody(req, maxBytes) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) {
      const err = new Error('request body too large')
      err.status = 413
      throw err
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(req, maxBytes) {
  const body = await readBody(req, maxBytes)
  if (!body.length) return {}
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    const err = new Error('invalid json')
    err.status = 400
    throw err
  }
}

function revisionForConfig(config) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex')
}

async function readApiConfig(path) {
  const config = await readJsonFile(path, { profiles: [], customProviders: [] })
  return { config, revision: revisionForConfig(config) }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateApiConfig(config) {
  return isPlainObject(config)
    && (!('profiles' in config) || Array.isArray(config.profiles))
    && (!('customProviders' in config) || Array.isArray(config.customProviders))
}

function parseOrigins(value) {
  return String(value || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function requestOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}

function isSafeSameOrigin(req, appOrigins) {
  const origin = req.headers.origin
  if (!origin) return true
  if (appOrigins.length) return appOrigins.includes(origin)
  return origin === requestOrigin(req)
}

class SessionStore {
  constructor(opts) {
    this.path = opts.path
    this.password = opts.password
    this.version = passwordVersion(opts.password)
    this.sessions = new Map()
    this.enqueue = serialize()
  }

  async load() {
    const data = await readJsonFile(this.path, { passwordVersion: this.version, sessions: [] })
    if (data.passwordVersion !== this.version) {
      this.sessions = new Map()
      await this.save()
      return
    }
    const now = Date.now()
    this.sessions = new Map((data.sessions || [])
      .filter((session) => session.expiresAt > now && typeof session.tokenHash === 'string')
      .map((session) => [session.tokenHash, session]))
    await this.save()
  }

  async save() {
    await this.enqueue(() => atomicWriteJson(this.path, {
      passwordVersion: this.version,
      sessions: [...this.sessions.values()],
    }))
  }

  async create() {
    const token = randomBytes(32).toString('base64url')
    const csrfToken = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + SESSION_TTL_MS
    this.sessions.set(hashToken(token), { tokenHash: hashToken(token), csrfToken, expiresAt })
    await this.save()
    return { token, csrfToken, expiresAt }
  }

  get(token) {
    if (!token) return null
    const session = this.sessions.get(hashToken(token))
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(hashToken(token))
      this.save().catch((err) => console.warn('Failed to persist expired session cleanup', err))
      return null
    }
    return session
  }

  async revoke(token) {
    if (!token) return
    this.sessions.delete(hashToken(token))
    await this.save()
  }
}

class LoginLimiter {
  constructor() {
    this.entries = new Map()
  }

  check(key) {
    const now = Date.now()
    const entry = this.entries.get(key)
    if (!entry || entry.resetAt <= now) return true
    return entry.count < 5
  }

  fail(key) {
    const now = Date.now()
    const entry = this.entries.get(key)
    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + 60_000 })
      return
    }
    entry.count += 1
  }

  reset(key) {
    this.entries.delete(key)
  }
}

function getSession(req, store) {
  const token = parseCookies(req.headers.cookie).get(SESSION_COOKIE)
  const session = store.get(token)
  return session ? { token, session } : null
}

function requireCsrf(req, session) {
  return typeof req.headers[CSRF_HEADER] === 'string' && safeEqualText(req.headers[CSRF_HEADER], session.csrfToken)
}

function authPayload(session) {
  return {
    authenticated: true,
    expiresAt: session.expiresAt,
    csrfToken: session.csrfToken,
  }
}

function copyProxyHeaders(req) {
  const headers = {}
  const connectionTokens = new Set(String(req.headers.connection || '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean))
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (REQUEST_HOP_HEADERS.has(lower) || connectionTokens.has(lower)) continue
    headers[key] = Array.isArray(value) ? value.join(', ') : value
  }
  return headers
}

function copyUpstreamHeaders(upstreamHeaders) {
  const headers = {}
  for (const [key, value] of Object.entries(upstreamHeaders)) {
    const lower = key.toLowerCase()
    if (RESPONSE_HOP_HEADERS.has(lower)) continue
    headers[key] = value
  }
  return headers
}

function limitedStream(stream, maxBytes) {
  let size = 0
  return stream.pipe(new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      if (size > maxBytes) {
        const err = new Error('request body too large')
        err.status = 413
        callback(err)
        return
      }
      callback(null, chunk)
    },
  }))
}

function buildUpstreamUrl(apiProxyUrl, pathname, search) {
  const base = new URL(apiProxyUrl.endsWith('/') ? apiProxyUrl : `${apiProxyUrl}/`)
  const upstreamPath = pathname.slice('/api-proxy/'.length)
  const decodedPath = decodeURIComponent(upstreamPath)
  if (!decodedPath || decodedPath.startsWith('/') || decodedPath.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(decodedPath)) {
    const err = new Error('bad proxy path')
    err.status = 400
    throw err
  }
  const url = new URL(upstreamPath + search, base)
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`
  if (url.origin !== base.origin || !url.pathname.startsWith(basePath)) {
    const err = new Error('bad proxy path')
    err.status = 400
    throw err
  }
  return url
}

function shouldCheckWrite(req) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method || '')
}

async function proxyRequest(req, res, upstreamUrl, opts) {
  const client = upstreamUrl.protocol === 'https:' ? https : http
  const controller = new AbortController()
  req.on('aborted', () => controller.abort())
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })

  const upstreamReq = client.request(upstreamUrl, {
    method: req.method,
    headers: copyProxyHeaders(req),
    signal: controller.signal,
    timeout: opts.timeoutMs,
  })
  upstreamReq.on('timeout', () => {
    upstreamReq.destroy(Object.assign(new Error('upstream timeout'), { status: 502 }))
  })

  const upstreamResPromise = new Promise((resolve, reject) => {
    upstreamReq.once('response', resolve)
    upstreamReq.once('error', reject)
  })

  const requestBodyPromise = ['GET', 'HEAD'].includes(req.method || '')
    ? Promise.resolve(upstreamReq.end())
    : pipeline(limitedStream(req, opts.maxBodyBytes), upstreamReq)
  requestBodyPromise.catch(() => {})

  let upstreamRes
  try {
    upstreamRes = await upstreamResPromise
  } catch (err) {
    if (controller.signal.aborted) {
      err.status = 499
      throw err
    }
    err.status = 502
    throw err
  }

  res.writeHead(upstreamRes.statusCode || 502, copyUpstreamHeaders(upstreamRes.headers))
  try {
    await pipeline(upstreamRes, res)
    await requestBodyPromise
  } catch (err) {
    if (controller.signal.aborted) {
      err.status = 499
      throw err
    }
    err.status = 502
    throw err
  }
}

export async function createApp(opts = {}) {
  const password = opts.password ?? process.env.APP_PASSWORD
  if (!password) throw new Error('APP_PASSWORD is required')

  const dataDir = opts.dataDir ?? process.env.DATA_DIR ?? '/data'
  const apiConfigPath = opts.apiConfigPath ?? process.env.API_CONFIG_PATH ?? '/config/gpt-image-playground.json'
  const promptPresetsPath = opts.promptPresetsPath ?? process.env.PROMPT_PRESETS_PATH ?? join(dataDir, 'prompt-presets.json')
  const apiProxyUrl = opts.apiProxyUrl || process.env.API_PROXY_URL || 'https://api.openai.com/v1'
  const cookieSecure = opts.cookieSecure ?? process.env.COOKIE_SECURE !== 'false'
  const appOrigins = parseOrigins(opts.appOrigin ?? process.env.APP_ORIGIN)
  const proxyTimeoutMs = Number(opts.proxyTimeoutMs ?? process.env.PROXY_TIMEOUT_MS ?? DEFAULT_PROXY_TIMEOUT_MS)
  await mkdir(dataDir, { recursive: true })

  const store = new SessionStore({ path: join(dataDir, 'sessions.json'), password })
  await store.load()
  const limiter = new LoginLimiter()
  const writeConfig = serialize()
  const writePromptPresetLibrary = serialize()

  async function handler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)

      if (req.method === 'GET' && url.pathname === '/api/auth/session') {
        const auth = getSession(req, store)
        if (!auth) return authError(res)
        return jsonResponse(res, 200, authPayload(auth.session))
      }

      if (req.method === 'GET' && url.pathname === '/api/auth/check') {
        const auth = getSession(req, store)
        if (!auth) return authError(res)
        res.writeHead(204, { 'Cache-Control': 'no-store' })
        return res.end()
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/login') {
        if (!isSafeSameOrigin(req, appOrigins)) return errorResponse(res, 403, 'APP_BAD_ORIGIN', 'Origin mismatch.')
        const key = req.socket.remoteAddress || 'unknown'
        if (!limiter.check(key)) return errorResponse(res, 429, 'APP_LOGIN_RATE_LIMITED', 'Too many login attempts.')
        const body = await readJsonBody(req, MAX_LOGIN_BODY_BYTES)
        if (typeof body.password !== 'string' || !safeEqualText(body.password, password)) {
          limiter.fail(key)
          return errorResponse(res, 401, 'APP_BAD_PASSWORD', 'Wrong password.')
        }
        limiter.reset(key)
        const session = await store.create()
        return jsonResponse(res, 200, authPayload(session), {
          'Set-Cookie': makeCookie(session.token, {
            secure: cookieSecure,
            maxAge: Math.floor(SESSION_TTL_MS / 1000),
            expires: new Date(session.expiresAt),
          }),
        })
      }

      if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
        const auth = getSession(req, store)
        if (!auth) return authError(res)
        if (!isSafeSameOrigin(req, appOrigins)) return errorResponse(res, 403, 'APP_BAD_ORIGIN', 'Origin mismatch.')
        if (!requireCsrf(req, auth.session)) return errorResponse(res, 403, 'APP_CSRF_REJECTED', 'CSRF check failed.')
        await store.revoke(auth.token)
        return jsonResponse(res, 200, { authenticated: false }, {
          'Set-Cookie': makeCookie('', {
            secure: cookieSecure,
            maxAge: 0,
            expires: new Date(0),
          }),
        })
      }

      if (url.pathname === '/api/api-config') {
        const auth = getSession(req, store)
        if (!auth) return authError(res)

        if (req.method === 'GET') return jsonResponse(res, 200, await readApiConfig(apiConfigPath))

        if (req.method === 'PUT') {
          if (!isSafeSameOrigin(req, appOrigins)) return errorResponse(res, 403, 'APP_BAD_ORIGIN', 'Origin mismatch.')
          if (!requireCsrf(req, auth.session)) return errorResponse(res, 403, 'APP_CSRF_REJECTED', 'CSRF check failed.')
          const ifMatch = req.headers['if-match']
          if (typeof ifMatch !== 'string' || !ifMatch) return errorResponse(res, 428, 'APP_REVISION_REQUIRED', 'If-Match is required.')
          const body = await readJsonBody(req, MAX_CONFIG_BODY_BYTES)
          if (!body || typeof body !== 'object' || !('config' in body)) return errorResponse(res, 400, 'APP_BAD_CONFIG', 'Missing config.')
          if (!validateApiConfig(body.config)) return errorResponse(res, 400, 'APP_BAD_CONFIG', 'Invalid config shape.')
          const result = await writeConfig(async () => {
            const current = await readApiConfig(apiConfigPath)
            if (ifMatch !== current.revision) {
              const err = new Error('revision mismatch')
              err.status = 409
              throw err
            }
            await atomicWriteJson(apiConfigPath, body.config)
            return readApiConfig(apiConfigPath)
          })
          return jsonResponse(res, 200, result)
        }
      }

      if (url.pathname === '/api/prompt-presets') {
        const auth = getSession(req, store)
        if (!auth) return authError(res)

        if (req.method === 'GET') return jsonResponse(res, 200, await readPromptPresets(promptPresetsPath))

        if (req.method === 'PUT') {
          if (!isSafeSameOrigin(req, appOrigins)) return errorResponse(res, 403, 'APP_BAD_ORIGIN', 'Origin mismatch.')
          if (!requireCsrf(req, auth.session)) return errorResponse(res, 403, 'APP_CSRF_REJECTED', 'CSRF check failed.')
          const ifMatch = req.headers['if-match']
          if (typeof ifMatch !== 'string' || !ifMatch) return errorResponse(res, 428, 'APP_REVISION_REQUIRED', 'If-Match is required.')
          const body = await readJsonBody(req, MAX_PRESETS_BODY_BYTES)
          if (!body || typeof body !== 'object' || !('presets' in body)) return errorResponse(res, 400, 'APP_BAD_PRESETS', 'Missing presets.')
          const result = await writePromptPresetLibrary(async () => {
            const current = await readPromptPresets(promptPresetsPath)
            if (ifMatch !== current.revision) {
              const err = new Error('revision mismatch')
              err.status = 409
              throw err
            }
            let library
            try {
              library = preparePromptPresetWrite(body.presets, current)
            } catch {
              const err = new Error('invalid prompt presets')
              err.status = 422
              throw err
            }
            await writePromptPresets(promptPresetsPath, library)
            return readPromptPresets(promptPresetsPath)
          })
          return jsonResponse(res, 200, result)
        }
      }

      if (url.pathname.startsWith('/api-proxy/')) {
        const auth = getSession(req, store)
        if (!auth) return authError(res)
        if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method || '')) {
          return errorResponse(res, 405, 'APP_METHOD_NOT_ALLOWED', 'Method not allowed.')
        }
        if (shouldCheckWrite(req)) {
          if (!isSafeSameOrigin(req, appOrigins)) return errorResponse(res, 403, 'APP_BAD_ORIGIN', 'Origin mismatch.')
          if (!requireCsrf(req, auth.session)) return errorResponse(res, 403, 'APP_CSRF_REJECTED', 'CSRF check failed.')
        }

        await proxyRequest(req, res, buildUpstreamUrl(apiProxyUrl, url.pathname, url.search), {
          maxBodyBytes: opts.maxProxyBodyBytes ?? DEFAULT_PROXY_BODY_BYTES,
          timeoutMs: proxyTimeoutMs,
        })
        return
      }

      return errorResponse(res, 404, 'APP_NOT_FOUND', 'Not found.')
    } catch (err) {
      if (err?.status === 400) return errorResponse(res, 400, 'APP_BAD_REQUEST', 'Bad request.')
      if (err?.status === 409) return errorResponse(res, 409, 'APP_REVISION_MISMATCH', 'Config revision changed.')
      if (err?.status === 413) return errorResponse(res, 413, 'APP_BODY_TOO_LARGE', 'Request body too large.')
      if (err?.status === 422) return errorResponse(res, 422, 'APP_BAD_PRESETS', 'Invalid prompt presets.')
      if (err?.status === 499 || err?.name === 'AbortError' || err?.code === 'ABORT_ERR') {
        if (!res.headersSent) return errorResponse(res, 499, 'APP_CLIENT_CLOSED', 'Client closed request.')
        return res.destroy()
      }
      if (err?.status === 502 || err?.code === 'ECONNREFUSED' || err?.code === 'ECONNRESET') {
        if (!res.headersSent) return errorResponse(res, 502, 'APP_UPSTREAM_ERROR', 'Upstream request failed.')
        return res.destroy(err)
      }
      console.error(err)
      if (res.headersSent) return res.destroy(err)
      return errorResponse(res, 500, 'APP_INTERNAL_ERROR', 'Internal server error.')
    }
  }

  return { handler, store }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.APP_SERVER_PORT || 3000)
  const app = await createApp()
  createServer(app.handler).listen(port, '127.0.0.1', () => {
    console.log(`NAS auth server listening on 127.0.0.1:${port}`)
  })
}
