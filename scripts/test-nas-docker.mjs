import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'

const exec = promisify(execFile)
const docker = async (...args) => (await exec('docker', args, { windowsHide: true, timeout: 60000 })).stdout.trim()
const directory = await mkdtemp(join(tmpdir(), 'nas-docker-test-'))
await mkdir(join(directory, 'config'))
await mkdir(join(directory, 'data'))
let upstreamCalls = 0
const upstream = createServer(async (req, res) => {
  upstreamCalls++
  assert.equal(req.headers.cookie, undefined)
  assert.equal(req.headers['x-csrf-token'], undefined)
  assert.equal(req.headers.authorization, 'Bearer supplier-test')
  for await (const _chunk of req) { /* 消费测试正文 */ }
  res.writeHead(401, { 'Content-Type': 'application/json', 'X-App-Auth-Error': 'APP_SESSION_EXPIRED', 'Set-Cookie': 'bad=upstream' })
  res.end('{"error":{"message":"Invalid supplier key"}}')
})
upstream.listen(0, '0.0.0.0')
await once(upstream, 'listening')
let container
try {
  container = await docker('run', '--detach', '-p', '127.0.0.1::80',
    '-e', 'APP_PASSWORD=docker-test-only', '-e', 'COOKIE_SECURE=false', '-e', 'ENABLE_API_PROXY=true',
    '-e', 'DEFAULT_API_URL=https://static-secret.example/v1?apiKey=runtime-static-secret',
    '-e', `API_PROXY_URL=http://host.docker.internal:${upstream.address().port}/v1`,
    '--mount', `type=bind,source=${join(directory, 'config')},target=/config`,
    '--mount', `type=bind,source=${join(directory, 'data')},target=/data`, 'gpt-image-playground:p0-test')
  const address = await docker('port', container, '80/tcp')
  if (!address) throw new Error(await docker('logs', container))
  let url = `http://${address}`
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const ready = await fetch(`${url}/api/auth/session`)
      if (ready.status === 401 && ready.headers.get('x-app-auth-error') === 'APP_SESSION_EXPIRED') break
    } catch { /* 等待服务就绪 */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  await docker('exec', container, 'nginx', '-t')
  const anonymous = await fetch(`${url}/api-proxy/responses`, { method: 'POST', headers: { Authorization: 'Bearer supplier-test' }, body: '{}' })
  assert.equal(anonymous.status, 401)
  assert.equal(upstreamCalls, 0)
  const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify({ password: 'docker-test-only' }) })
  assert.equal(login.status, 200)
  const session = await login.json()
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const headers = { Cookie: cookie, Origin: url, 'X-CSRF-Token': session.csrfToken, 'Content-Type': 'application/json' }
  const config = await (await fetch(`${url}/api/api-config`, { headers })).json()
  const saved = await fetch(`${url}/api/api-config`, { method: 'PUT', headers: { ...headers, 'If-Match': config.revision }, body: JSON.stringify({ config: { profiles: [{ id: 'test', apiKey: 'docker-private-key' }], customProviders: [] } }) })
  assert.equal(saved.status, 200)
  assert.equal(JSON.parse(await readFile(join(directory, 'config', 'gpt-image-playground.json'), 'utf8')).profiles[0].apiKey, 'docker-private-key')
  const proxied = await fetch(`${url}/api-proxy/responses`, { method: 'POST', headers: { ...headers, Authorization: 'Bearer supplier-test' }, body: '{}' })
  assert.equal(proxied.status, 401)
  assert.equal(proxied.headers.get('x-app-auth-error'), null)
  assert.equal(proxied.headers.get('set-cookie'), null)
  assert.equal(upstreamCalls, 1)
  await docker('restart', container)
  url = `http://${await docker('port', container, '80/tcp')}`
  headers.Origin = url
  let restored
  for (let attempt = 0; attempt < 100; attempt++) {
    try { restored = await fetch(`${url}/api/auth/session`, { headers }); if (restored.ok) break } catch { /* 等待容器重启 */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal((await restored.json()).expiresAt, session.expiresAt)
  const html = await (await fetch(url)).text()
  const scripts = [...html.matchAll(/src="([^\"]+\.js)"/g)].map((match) => match[1])
  assert.ok(scripts.length)
  for (const script of scripts) {
    const text = await (await fetch(new URL(script, url))).text()
    assert.ok(!text.includes('docker-private-key') && !text.includes('docker-test-only'))
    assert.ok(!text.includes('runtime-static-secret') && !text.includes('static-secret.example'))
    assert.ok(!text.includes('__VITE_NAS_AUTH_ENABLED_PLACEHOLDER__'))
  }
  assert.equal((await fetch(`${url}/api/auth/logout`, { method: 'POST', headers })).status, 200)
  assert.equal((await fetch(`${url}/api/api-config`, { headers })).status, 401)
  console.log('PASS: production nginx config, port Origin, auth-before-proxy, upstream credential isolation, config disk write, restart session, static secret exclusion, logout')
} catch (error) {
  if (container) console.error(await docker('logs', container).catch(() => 'Container logs unavailable'))
  throw error
} finally {
  if (container) await docker('stop', container).catch(() => {})
  if (container) await docker('rm', container).catch(() => {})
  upstream.closeAllConnections()
  await new Promise((resolve) => upstream.close(resolve))
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
