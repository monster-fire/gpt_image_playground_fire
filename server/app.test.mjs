import { strict as assert } from 'node:assert'
import { gzipSync } from 'node:zlib'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, request } from 'node:http'
import { test } from 'node:test'
import { createApp } from './app.mjs'

async function listen(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

function postAndAbort(url, headers, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
    })
    req.on('error', (err) => {
      if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') resolve()
      else reject(err)
    })
    req.write(body.slice(0, 2))
    setTimeout(() => {
      req.destroy()
      resolve()
    }, 25)
  })
}

function getRaw(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      res.on('error', reject)
      res.on('aborted', () => reject(Object.assign(new Error('response aborted'), { code: 'RES_ABORTED' })))
    })
    req.on('error', reject)
    req.end()
  })
}

function cookieFrom(res) {
  const cookie = res.headers.get('set-cookie')
  assert.ok(cookie)
  return cookie.split(';')[0]
}

async function login(baseUrl, password = 'secret') {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: baseUrl,
    },
    body: JSON.stringify({ password }),
  })
  const body = await res.json()
  assert.equal(res.status, 200)
  return { cookie: cookieFrom(res), csrfToken: body.csrfToken, expiresAt: body.expiresAt }
}

test('session survives restart, expires, logout revokes it, and password change invalidates persisted sessions', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  try {
    const app = await createApp({ password: 'secret', dataDir, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)

    let res = await fetch(`${server.url}/api/auth/session`, { headers: { Cookie: auth.cookie } })
    assert.equal(res.status, 200)
    let body = await res.json()
    assert.equal(typeof body.expiresAt, 'number')

    res = await fetch(`${server.url}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: auth.cookie },
    })
    assert.equal(res.status, 403)

    res = await fetch(`${server.url}/api/auth/logout`, {
      method: 'POST',
      headers: {
        Cookie: auth.cookie,
        'x-csrf-token': auth.csrfToken,
        Origin: server.url,
      },
    })
    assert.equal(res.status, 200)

    res = await fetch(`${server.url}/api/auth/session`, { headers: { Cookie: auth.cookie } })
    assert.equal(res.status, 401)
    await server.close()

    const app2 = await createApp({ password: 'secret', dataDir, cookieSecure: false })
    const server2 = await listen(app2.handler)
    const auth2 = await login(server2.url)
    await server2.close()

    const app3 = await createApp({ password: 'secret', dataDir, cookieSecure: false })
    const server3 = await listen(app3.handler)
    res = await fetch(`${server3.url}/api/auth/session`, { headers: { Cookie: auth2.cookie } })
    assert.equal(res.status, 200)
    await server3.close()

    const app4 = await createApp({ password: 'changed', dataDir, cookieSecure: false })
    const server4 = await listen(app4.handler)
    res = await fetch(`${server4.url}/api/auth/session`, { headers: { Cookie: auth2.cookie } })
    assert.equal(res.status, 401)
    await server4.close()

    const now = Date.now
    Date.now = () => new Date(auth2.expiresAt).getTime() + 1
    try {
      const app5 = await createApp({ password: 'secret', dataDir, cookieSecure: false })
      const server5 = await listen(app5.handler)
      res = await fetch(`${server5.url}/api/auth/session`, { headers: { Cookie: auth2.cookie } })
      assert.equal(res.status, 401)
      await server5.close()
    } finally {
      Date.now = now
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api proxy blocks anonymous requests even when Authorization is present and strips app headers upstream', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const upstreamRequests = []
  const upstream = await listen((req, res) => {
    upstreamRequests.push(req.headers)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
  })

  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: upstream.url, cookieSecure: false })
    const server = await listen(app.handler)

    let res = await fetch(`${server.url}/api-proxy/responses`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer provider-key',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('x-app-auth-error'), 'APP_SESSION_EXPIRED')
    assert.equal(upstreamRequests.length, 0)

    const auth = await login(server.url)
    res = await fetch(`${server.url}/api-proxy/responses`, {
      method: 'POST',
      headers: {
        Cookie: auth.cookie,
        Authorization: 'Bearer provider-key',
        'Content-Type': 'application/json',
        'x-csrf-token': auth.csrfToken,
        'x-app-auth-error': 'spoofed',
        Origin: server.url,
      },
      body: JSON.stringify({ model: 'gpt-6-astra' }),
    })
    assert.equal(res.status, 200)
    assert.equal(upstreamRequests.length, 1)
    assert.equal(upstreamRequests[0].authorization, 'Bearer provider-key')
    assert.equal(upstreamRequests[0].cookie, undefined)
    assert.equal(upstreamRequests[0]['x-csrf-token'], undefined)
    assert.equal(upstreamRequests[0]['x-app-auth-error'], undefined)

    await server.close()
  } finally {
    await upstream.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('upstream 401 is returned as provider failure and does not masquerade as app session expiry', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const upstream = await listen((_req, res) => {
    res.writeHead(401, {
      'Content-Type': 'application/json',
      'X-App-Auth-Error': 'spoofed',
    })
    res.end(JSON.stringify({ error: { message: 'bad provider key' } }))
  })

  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: upstream.url, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    const res = await fetch(`${server.url}/api-proxy/responses`, {
      method: 'POST',
      headers: {
        Cookie: auth.cookie,
        'x-csrf-token': auth.csrfToken,
        Origin: server.url,
      },
      body: '{}',
    })
    const body = await res.json()
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('x-app-auth-error'), null)
    assert.equal(body.error.message, 'bad provider key')
    await server.close()
  } finally {
    await upstream.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api config supports missing file defaults, If-Match, CSRF, and atomic JSON writes', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const configPath = join(dataDir, 'config', 'gpt-image-playground.json')
  try {
    const app = await createApp({ password: 'secret', dataDir, apiConfigPath: configPath, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)

    let res = await fetch(`${server.url}/api/api-config`, { headers: { Cookie: auth.cookie } })
    let body = await res.json()
    assert.equal(res.status, 200)
    assert.deepEqual(body.config, { profiles: [], customProviders: [] })
    const revision = body.revision

    res = await fetch(`${server.url}/api/api-config`, {
      method: 'PUT',
      headers: {
        Cookie: auth.cookie,
        'Content-Type': 'application/json',
        'If-Match': revision,
        Origin: server.url,
      },
      body: JSON.stringify({ config: { profiles: [{ id: 'p1' }] } }),
    })
    assert.equal(res.status, 403)

    res = await fetch(`${server.url}/api/api-config`, {
      method: 'PUT',
      headers: {
        Cookie: auth.cookie,
        'Content-Type': 'application/json',
        'x-csrf-token': auth.csrfToken,
        Origin: server.url,
      },
      body: JSON.stringify({ config: { profiles: [] } }),
    })
    assert.equal(res.status, 428)

    res = await fetch(`${server.url}/api/api-config`, {
      method: 'PUT',
      headers: {
        Cookie: auth.cookie,
        'Content-Type': 'application/json',
        'x-csrf-token': auth.csrfToken,
        'If-Match': revision,
        Origin: server.url,
      },
      body: JSON.stringify({ config: { profiles: [{ id: 'p1' }] } }),
    })
    body = await res.json()
    assert.equal(res.status, 200)
    assert.notEqual(body.revision, revision)

    const written = JSON.parse(await (await import('node:fs/promises')).readFile(configPath, 'utf8'))
    assert.deepEqual(written, { profiles: [{ id: 'p1' }] })

    res = await fetch(`${server.url}/api/api-config`, {
      method: 'PUT',
      headers: {
        Cookie: auth.cookie,
        'Content-Type': 'application/json',
        'x-csrf-token': auth.csrfToken,
        'If-Match': revision,
        Origin: server.url,
      },
      body: JSON.stringify({ config: { profiles: [] } }),
    })
    assert.equal(res.status, 409)
    await server.close()
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('prompt presets initialize once, require auth and CSRF, support empty lists and persist across restart', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const promptPresetsPath = join(dataDir, 'data', 'prompt-presets.json')
  try {
    const app = await createApp({ password: 'secret', dataDir, promptPresetsPath, cookieSecure: false })
    const server = await listen(app.handler)

    let res = await fetch(`${server.url}/api/prompt-presets`)
    assert.equal(res.status, 401)

    const auth = await login(server.url)
    res = await fetch(`${server.url}/api/prompt-presets`, { headers: { Cookie: auth.cookie } })
    let body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.equal(body.presets.length, 1)
    assert.equal(body.presets[0].name, '女性写真 · 丰腴曲线')
    assert.ok(body.presets[0].content.includes('年轻成年东方女性'))
    const revision = body.revision

    res = await fetch(`${server.url}/api/prompt-presets`, {
      method: 'PUT',
      headers: {
        Cookie: auth.cookie,
        'Content-Type': 'application/json',
        'If-Match': revision,
        Origin: server.url,
      },
      body: JSON.stringify({ presets: [] }),
    })
    assert.equal(res.status, 403)

    res = await fetch(`${server.url}/api/prompt-presets`, {
      method: 'PUT',
      headers: {
        Cookie: auth.cookie,
        'Content-Type': 'application/json',
        'x-csrf-token': auth.csrfToken,
        'If-Match': revision,
        Origin: server.url,
      },
      body: JSON.stringify({ presets: [] }),
    })
    body = await res.json()
    assert.equal(res.status, 200)
    assert.deepEqual(body.presets, [])
    assert.notEqual(body.revision, revision)

    await server.close()

    const app2 = await createApp({ password: 'secret', dataDir, promptPresetsPath, cookieSecure: false })
    const server2 = await listen(app2.handler)
    const auth2 = await login(server2.url)
    res = await fetch(`${server2.url}/api/prompt-presets`, { headers: { Cookie: auth2.cookie } })
    body = await res.json()
    assert.equal(res.status, 200)
    assert.deepEqual(body.presets, [])
    await server2.close()
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('prompt presets reject stale revisions and invalid shapes while preserving current library', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const promptPresetsPath = join(dataDir, 'prompt-presets.json')
  try {
    const app = await createApp({ password: 'secret', dataDir, promptPresetsPath, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    const initial = await (await fetch(`${server.url}/api/prompt-presets`, { headers: { Cookie: auth.cookie } })).json()

    const headers = {
      Cookie: auth.cookie,
      'Content-Type': 'application/json',
      'x-csrf-token': auth.csrfToken,
      'If-Match': initial.revision,
      Origin: server.url,
    }
    let res = await fetch(`${server.url}/api/prompt-presets`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ presets: [{ id: 'portrait', name: '写真', content: '自然光人像' }] }),
    })
    let body = await res.json()
    assert.equal(res.status, 200)
    assert.equal(body.presets[0].id, 'portrait')
    assert.equal(typeof body.presets[0].revision, 'string')
    assert.ok(body.presets[0].createdAt > 0)

    res = await fetch(`${server.url}/api/prompt-presets`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ presets: [] }),
    })
    assert.equal(res.status, 409)

    res = await fetch(`${server.url}/api/prompt-presets`, {
      method: 'PUT',
      headers: { ...headers, 'If-Match': body.revision },
      body: JSON.stringify({ presets: [{ id: 'bad', name: '', content: 'x' }] }),
    })
    assert.equal(res.status, 422)

    const current = await (await fetch(`${server.url}/api/prompt-presets`, { headers: { Cookie: auth.cookie } })).json()
    assert.deepEqual(current.presets.map((preset) => preset.id), ['portrait'])
    await server.close()
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('origin check preserves forwarded host port and supports explicit HTTPS app origin', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  try {
    const app = await createApp({ password: 'secret', dataDir, cookieSecure: false })
    const server = await listen(app.handler)

    let res = await fetch(`${server.url}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://192.168.0.121:11130',
        'X-Forwarded-Proto': 'http',
        'X-Forwarded-Host': '192.168.0.121:11130',
      },
      body: JSON.stringify({ password: 'secret' }),
    })
    assert.equal(res.status, 200)
    await server.close()

    const app2 = await createApp({ password: 'secret', dataDir, cookieSecure: false, appOrigin: 'https://www.example.com' })
    const server2 = await listen(app2.handler)
    res = await fetch(`${server2.url}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.example.com',
        'X-Forwarded-Proto': 'http',
        'X-Forwarded-Host': 'internal:80',
      },
      body: JSON.stringify({ password: 'secret' }),
    })
    assert.equal(res.status, 200)
    await server2.close()
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api proxy rejects absolute and host-relative paths before reaching upstream', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  let upstreamCount = 0
  const upstream = await listen((_req, res) => {
    upstreamCount += 1
    res.end('ok')
  })
  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: `${upstream.url}/v1`, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)

    for (const path of ['/api-proxy/https://evil.example/v1/responses', '/api-proxy/%2F%2Fevil.example/responses']) {
      const res = await fetch(`${server.url}${path}`, {
        headers: { Cookie: auth.cookie },
      })
      assert.equal(res.status, 400)
    }
    assert.equal(upstreamCount, 0)
    await server.close()
  } finally {
    await upstream.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api proxy strips upstream Set-Cookie and preserves base path', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const paths = []
  const upstream = await listen((req, res) => {
    paths.push(req.url)
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'provider_session=secret',
    })
    res.end(JSON.stringify({ ok: true }))
  })
  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: `${upstream.url}/v1`, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    const res = await fetch(`${server.url}/api-proxy/responses?x=1`, { headers: { Cookie: auth.cookie } })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('set-cookie'), null)
    assert.deepEqual(paths, ['/v1/responses?x=1'])
    await server.close()
  } finally {
    await upstream.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api proxy keeps safe response headers after excluded upstream headers', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const upstreamHeaders = []
  const upstream = await listen((req, res) => {
    upstreamHeaders.push(req.headers)
    res.setHeader('Set-Cookie', 'provider_session=secret')
    res.setHeader('X-Safe-Header', 'kept')
    res.end('ok')
  })
  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: upstream.url, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    const res = await getRaw(`${server.url}/api-proxy/responses`, {
      Cookie: auth.cookie,
      Connection: 'X-Drop-Me, X-Another-Drop',
      'X-Drop-Me': 'secret',
      'X-Another-Drop': 'secret',
    })
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['set-cookie'], undefined)
    assert.equal(res.headers['x-safe-header'], 'kept')
    assert.equal(upstreamHeaders[0]['x-drop-me'], undefined)
    assert.equal(upstreamHeaders[0]['x-another-drop'], undefined)
    assert.notEqual(upstreamHeaders[0].connection, 'X-Drop-Me, X-Another-Drop')
    await server.close()
  } finally {
    await upstream.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api proxy preserves gzip response encoding and compressed bytes', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const gzipped = gzipSync('compressed payload')
  const upstream = await listen((_req, res) => {
    res.writeHead(200, {
      'Content-Encoding': 'gzip',
      'Content-Length': String(gzipped.length),
      'Content-Type': 'text/plain',
    })
    res.end(gzipped)
  })
  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: upstream.url, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    const result = await getRaw(`${server.url}/api-proxy/responses`, { Cookie: auth.cookie })
    assert.equal(result.statusCode, 200)
    assert.equal(result.headers['content-encoding'], 'gzip')
    assert.equal(result.headers['content-length'], String(gzipped.length))
    assert.deepEqual(result.body, gzipped)
    await server.close()
  } finally {
    await upstream.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('concurrent config writes serialize same-revision updates so only one succeeds', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const configPath = join(dataDir, 'config', 'gpt-image-playground.json')
  try {
    const app = await createApp({ password: 'secret', dataDir, apiConfigPath: configPath, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    const initial = await (await fetch(`${server.url}/api/api-config`, { headers: { Cookie: auth.cookie } })).json()
    const headers = {
      Cookie: auth.cookie,
      'Content-Type': 'application/json',
      'x-csrf-token': auth.csrfToken,
      'If-Match': initial.revision,
      Origin: server.url,
    }
    const results = await Promise.all([
      fetch(`${server.url}/api/api-config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ config: { profiles: [{ id: 'a' }], extra: true } }),
      }),
      fetch(`${server.url}/api/api-config`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ config: { profiles: [{ id: 'b' }] } }),
      }),
    ])
    assert.deepEqual(results.map((res) => res.status).sort(), [200, 409])
    const finalConfig = await (await fetch(`${server.url}/api/api-config`, { headers: { Cookie: auth.cookie } })).json()
    assert.equal(finalConfig.config.extra, true)
    await server.close()
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api proxy aborts upstream when browser upload disconnects', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  let aborted = false
  const upstream = await listen((req, res) => {
    req.on('aborted', () => {
      aborted = true
      res.destroy()
    })
  })
  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: upstream.url, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    await postAndAbort(`${server.url}/api-proxy/responses`, {
      Cookie: auth.cookie,
      'Content-Type': 'application/json',
      'x-csrf-token': auth.csrfToken,
      Origin: server.url,
    }, '{"data":"large')
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(aborted, true)
    await server.close()
  } finally {
    await upstream.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api proxy returns 502 when upstream connection is refused', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const unused = await listen((_req, res) => res.end('unused'))
  const refusedUrl = unused.url
  await unused.close()
  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: refusedUrl, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    const res = await fetch(`${server.url}/api-proxy/responses`, { headers: { Cookie: auth.cookie } })
    const body = await res.json()
    assert.equal(res.status, 502)
    assert.equal(body.error.code, 'APP_UPSTREAM_ERROR')
    await server.close()
  } finally {
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('api proxy handles upstream reset mid stream without unhandled response errors', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'gip-auth-'))
  const upstream = await listen((_req, res) => {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': '1000000',
    })
    res.write('partial')
    res.destroy()
  })
  try {
    const app = await createApp({ password: 'secret', dataDir, apiProxyUrl: upstream.url, cookieSecure: false })
    const server = await listen(app.handler)
    const auth = await login(server.url)
    try {
      const result = await getRaw(`${server.url}/api-proxy/responses`, { Cookie: auth.cookie })
      assert.equal(result.body.length < 1000000, true)
    } catch (err) {
      assert.match(err.message, /aborted|socket hang up|terminated/i)
    }
    await server.close()
  } finally {
    await upstream.close()
    await rm(dataDir, { recursive: true, force: true })
  }
})

test('APP_PASSWORD is required', async () => {
  await assert.rejects(createApp({ password: '', dataDir: await mkdtemp(join(tmpdir(), 'gip-auth-')) }), /APP_PASSWORD is required/)
})
