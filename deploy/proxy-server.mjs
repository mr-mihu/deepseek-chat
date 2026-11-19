/**
 * 极小的同源转发代理（零依赖）。
 *
 * 作用：浏览器直接请求第三方模型厂商接口时经常被 CORS 拦住，把请求先发到
 * 本服务（同源），再由它转发出去，就不受浏览器跨域限制。响应按块原样转发，
 * 所以流式输出（SSE）不受影响。
 *
 * 用法：GET|POST /proxy?target=<完整的目标地址>
 * 环境变量：
 *   PORT                 监听端口，默认 8787
 *   PROXY_TOKEN          非空时要求请求头 x-proxy-token 与之一致
 *   PROXY_ALLOWED_HOSTS  允许转发的目标域名，逗号分隔；为空表示不限制
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT ?? 8787)
const TOKEN = (process.env.PROXY_TOKEN ?? '').trim()
const ALLOWED_HOSTS = (process.env.PROXY_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean)

/** 转发时不能原样带过去的逐跳请求头 */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  // 由下面的 fetch 自行协商压缩，避免「已解压的内容 + 原压缩头」对不上
  'accept-encoding',
])

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-max-age': '86400',
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...CORS_HEADERS,
  })
  res.end(payload)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
    res.end('ok')
    return
  }

  if (url.pathname !== '/proxy') {
    json(res, 404, { error: { message: 'not found, use /proxy?target=<url>' } })
    return
  }

  if (TOKEN && req.headers['x-proxy-token'] !== TOKEN) {
    json(res, 401, { error: { message: 'invalid proxy token' } })
    return
  }

  const rawTarget = url.searchParams.get('target') ?? ''
  let target
  try {
    target = new URL(rawTarget)
  } catch {
    json(res, 400, { error: { message: 'missing or invalid target url' } })
    return
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    json(res, 400, { error: { message: 'only http and https targets are supported' } })
    return
  }
  if (ALLOWED_HOSTS.length > 0 && !ALLOWED_HOSTS.includes(target.hostname.toLowerCase())) {
    json(res, 403, { error: { message: `host ${target.hostname} is not allowed` } })
    return
  }

  const headers = {}
  for (const [name, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(name) && name !== 'x-proxy-token' && value !== undefined) {
      headers[name] = Array.isArray(value) ? value.join(', ') : value
    }
  }

  // 客户端断开时同步中断上游请求，避免继续消耗配额
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) {
      controller.abort()
    }
  })

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req

  let upstream
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      // 流式转发请求体（multipart 上传）需要 half duplex
      ...(body ? { duplex: 'half' } : {}),
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (error) {
    if (!controller.signal.aborted) {
      json(res, 502, {
        error: {
          message: `upstream request failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      })
    }
    return
  }

  const responseHeaders = { ...CORS_HEADERS }
  for (const name of ['content-type', 'cache-control', 'x-request-id', 'retry-after']) {
    const value = upstream.headers.get(name)
    if (value) {
      responseHeaders[name] = value
    }
  }
  res.writeHead(upstream.status, responseHeaders)

  if (!upstream.body) {
    res.end()
    return
  }

  const reader = upstream.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      // 上游有数据就立刻下发，不做缓冲，保证 SSE 逐字到达浏览器
      res.write(Buffer.from(value))
    }
  } catch {
    // 上游中断：保持已下发的部分，直接结束响应
  } finally {
    res.end()
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[proxy] listening on :${PORT}`)
  if (ALLOWED_HOSTS.length > 0) {
    console.log(`[proxy] allowed hosts: ${ALLOWED_HOSTS.join(', ')}`)
  } else {
    console.log('[proxy] allowed hosts: any (set PROXY_ALLOWED_HOSTS to restrict)')
  }
})

const shutdown = () => {
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
