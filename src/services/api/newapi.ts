import { ApiError, request } from './http.js'
import { providerHeaders, providerUrl, type Provider } from './providers.js'

/**
 * new-api（https://github.com/QuantumNous/new-api）的「聊天预设一键导入」。
 *
 * new-api 目前只能作为 OAuth 客户端登录外部身份源，不提供授权服务器
 * （没有 /authorize、也没有 OIDC discovery，见 issue #6572），所以第三方应用
 * 拿不到「授权码」这种东西。它给聊天应用准备的官方方式是聊天预设：
 * Root 在「系统设置 → 控制台内容 → 聊天」里配一条带占位符的链接，
 * 用户点一下就会带着自己的令牌跳到目标应用：
 *
 *   {"chat-demo": "https://chat-demo.example.com/?newapi={address}&key={key}"}
 *
 * 这里负责解析这条链接里的 {address}（new-api 服务地址）与 {key}（API 密钥）。
 */

export type NewApiImport = { address: string; key: string }

/** 链接里可能用到的参数名：同时兼容模板写成 address/key 的情况 */
const ADDRESS_PARAMS = ['newapi', 'new_api', 'address', 'base']
const KEY_PARAMS = ['key', 'token', 'apiKey', 'api_key']

export const NEW_API_IMPORT_PARAMS = [...ADDRESS_PARAMS, ...KEY_PARAMS]

const readParam = (params: URLSearchParams, names: string[]) => {
  for (const name of names) {
    const value = params.get(name)?.trim()
    if (value) {
      return value
    }
  }
  return ''
}

/** 从当前页面地址里取出 new-api 导入参数；查询串与 hash 两种写法都认 */
export const parseNewApiImport = (href: string): NewApiImport | null => {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const sources = [url.search]
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  if (hash.includes('=')) {
    sources.push(hash)
  }
  for (const source of sources) {
    const params = new URLSearchParams(source)
    const address = readParam(params, ADDRESS_PARAMS)
    const key = readParam(params, KEY_PARAMS)
    if (address && key) {
      return { address, key }
    }
  }
  return null
}

/** 只接受 http/https 地址，其他协议（javascript: 等）一律拒绝 */
export const normalizeNewApiAddress = (value: string): string | null => {
  let address = value.trim()
  if (!address) {
    return null
  }
  if (!/^https?:\/\//i.test(address)) {
    address = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(address)
      ? `http://${address}`
      : `https://${address}`
  }
  try {
    const url = new URL(address)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** new-api 的 OpenAI 兼容接口在 {address}/v1；{address} 已经带了版本号就不重复拼 */
export const newApiBaseUrl = (address: string): string => {
  const base = address.replace(/\/+$/, '')
  return /\/v\d+$/i.test(base) ? base : `${base}/v1`
}

/**
 * 用刚拿到的密钥拉一次模型列表：new-api 会按用户分组与权限过滤，
 * 拿到的第一个模型就当作默认模型，省去用户手动填。
 */
export const fetchNewApiModels = async (
  provider: Provider,
  signal?: AbortSignal
): Promise<string[]> => {
  const response = await request(providerUrl(provider, '/models'), {
    method: 'GET',
    headers: providerHeaders(provider),
    signal,
  })
  const body: unknown = await response.json().catch(() => null)
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    return []
  }
  return data.flatMap((item) => {
    const id = (item as { id?: unknown } | null)?.id
    return typeof id === 'string' && id ? [id] : []
  })
}

/** 把请求失败的原文压成一句可读的提示 */
export const describeImportError = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.message || error.kind
  }
  return error instanceof Error ? error.message : String(error)
}
