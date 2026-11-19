import { createId } from '../../utils/id.js'
import { DEFAULT_BASE_URL, DEFAULT_TOOLS_BASE_URL, FILES_BETA } from './origin.js'

/**
 * 模型厂商配置：接口地址 + 协议 + 模型 + 密钥，保存在本机 localStorage。
 * 应用本身没有后端，浏览器直接请求厂商接口；也可以在部署时通过 config.js
 * 提供同源转发地址（proxyUrl），由 Docker 里的代理服务代为转发，避免跨域限制。
 */

/** 接口协议：openai 走 /chat/completions，anthropic 走 /messages */
export type ProviderProtocol = 'openai' | 'anthropic'

/**
 * 厂商能力开关。DeepSeek 专有扩展（安全审核、自动标题、服务端工具、latest_reminder）
 * 只对它自己的兼容接口有效，其他厂商一律关闭，避免带出对方不认识的字段。
 */
export type ProviderFeatures = {
  /** DeepSeek 专有接口扩展 */
  extensions: boolean
  /** Files API 附件上传 */
  attachments: boolean
  /** 联网搜索与阅读链接（依赖 extensions） */
  webSearch: boolean
  /** 语音输入与朗读（依赖 toolsBaseUrl） */
  voice: boolean
}

export type ProviderVoice = {
  /** 朗读（TTS）模型，如 tts-1；留空表示这个厂商不支持朗读 */
  ttsModel: string
  /** 朗读音色，如 alloy */
  ttsVoice: string
  /** 语音输入（STT）模型，如 whisper-1；留空表示不支持语音输入 */
  sttModel: string
}

export type Provider = {
  id: string
  /** 展示名，如「硅基流动」 */
  name: string
  protocol: ProviderProtocol
  /** 接口地址，含版本路径，如 https://api.openai.com/v1 */
  baseUrl: string
  model: string
  apiKey: string
  features: ProviderFeatures
  /** 语音接口地址（DeepSeek 为 {origin}/v1/tools），为空表示不支持语音 */
  toolsBaseUrl?: string
  /** OpenAI 兼容协议的语音配置（/audio/speech 与 /audio/transcriptions） */
  voice?: ProviderVoice
  /** 合并进请求体的额外字段，如 reasoning_effort、temperature */
  extraBody?: Record<string, unknown>
  /** 额外请求头 */
  headers?: Record<string, string>
}

export const EMPTY_FEATURES: ProviderFeatures = {
  extensions: false,
  attachments: false,
  webSearch: false,
  voice: false,
}

/** 内置可选厂商；名称只用于预填，保存后就是普通的自定义配置 */
export type ProviderPreset = {
  key: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  features?: Partial<ProviderFeatures>
  toolsBaseUrl?: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    protocol: 'anthropic',
    baseUrl: DEFAULT_BASE_URL,
    model: 'deepseek-flash',
    features: { extensions: true, attachments: true, webSearch: true, voice: true },
    toolsBaseUrl: DEFAULT_TOOLS_BASE_URL,
  },
  {
    key: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    key: 'deepseek-openai',
    name: 'DeepSeek（OpenAI 兼容）',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    key: 'siliconflow',
    name: '硅基流动',
    protocol: 'openai',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
  },
  {
    key: 'dashscope',
    name: '阿里云百炼',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  {
    key: 'zhipu',
    name: '智谱 GLM',
    protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  {
    key: 'moonshot',
    name: 'Kimi / Moonshot',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  {
    key: 'openrouter',
    name: 'OpenRouter',
    protocol: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
  },
  {
    key: 'ollama',
    name: 'Ollama（本机）',
    protocol: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
  },
  {
    key: 'lmstudio',
    name: 'LM Studio（本机）',
    protocol: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
  },
]

export const getProviderPreset = (key: string) =>
  PROVIDER_PRESETS.find((preset) => preset.key === key)

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

const asString = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback

const asStringRecord = (value: unknown): Record<string, string> | undefined => {
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0].trim() !== ''
  )
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

/** 补全协议前缀、去掉结尾斜杠；本机地址默认 http，其余默认 https */
export const normalizeBaseUrl = (value: string): string => {
  let url = value.trim().replace(/\/+$/, '')
  if (!url) {
    return ''
  }
  if (!/^https?:\/\//i.test(url)) {
    url = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(url)
      ? `http://${url}`
      : `https://${url}`
  }
  return url
}

const normalizeFeatures = (
  value: unknown,
  protocol: ProviderProtocol
): ProviderFeatures => {
  const record = asRecord(value)
  const features: ProviderFeatures = {
    extensions: record?.extensions === true,
    attachments: record?.attachments === true,
    webSearch: record?.webSearch === true,
    voice: record?.voice === true,
  }
  // 只有 Anthropic 兼容接口才有这些 DeepSeek 扩展；OpenAI 协议一律关闭。
  return protocol === 'anthropic'
    ? { ...features, webSearch: features.extensions && features.webSearch }
    : EMPTY_FEATURES
}

/** OpenAI 兼容的语音配置；三项都为空时视为不支持语音 */
const normalizeVoice = (value: unknown, protocol: ProviderProtocol): ProviderVoice | undefined => {
  if (protocol !== 'openai') {
    return undefined
  }
  const record = asRecord(value)
  if (!record) {
    return undefined
  }
  const voice: ProviderVoice = {
    ttsModel: asString(record.ttsModel).trim(),
    ttsVoice: asString(record.ttsVoice).trim(),
    sttModel: asString(record.sttModel).trim(),
  }
  return voice.ttsModel || voice.ttsVoice || voice.sttModel ? voice : undefined
}

/** 把任意来源（localStorage、config.js、用户输入）的数据收敛成合法的厂商配置 */
export const normalizeProvider = (value: unknown): Provider | null => {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const protocol: ProviderProtocol = record.protocol === 'anthropic' ? 'anthropic' : 'openai'
  const baseUrl = normalizeBaseUrl(asString(record.baseUrl))
  if (!baseUrl) {
    return null
  }
  const features = normalizeFeatures(record.features, protocol)
  const toolsBaseUrl = normalizeBaseUrl(asString(record.toolsBaseUrl))
  const voice = normalizeVoice(record.voice, protocol)
  return {
    id: asString(record.id).trim() || createId(),
    name: asString(record.name).trim() || hostOf(baseUrl),
    protocol,
    baseUrl,
    model: asString(record.model).trim(),
    apiKey: asString(record.apiKey),
    features,
    ...(features.voice && toolsBaseUrl ? { toolsBaseUrl } : {}),
    ...(voice ? { voice } : {}),
    ...(asRecord(record.extraBody) ? { extraBody: record.extraBody as Record<string, unknown> } : {}),
    ...(asStringRecord(record.headers) ? { headers: asStringRecord(record.headers) } : {}),
  }
}

const hostOf = (baseUrl: string) => {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/** 用预设（或空配置）创建厂商，返回可直接编辑的完整对象 */
export const createProvider = (preset?: ProviderPreset, seed?: Partial<Provider>): Provider => {
  const features = { ...EMPTY_FEATURES, ...preset?.features, ...seed?.features }
  const protocol = seed?.protocol ?? preset?.protocol ?? 'openai'
  return {
    id: seed?.id ?? createId(),
    name: seed?.name ?? preset?.name ?? '',
    protocol,
    baseUrl: seed?.baseUrl ?? preset?.baseUrl ?? '',
    model: seed?.model ?? preset?.model ?? '',
    apiKey: seed?.apiKey ?? '',
    features: protocol === 'anthropic' ? features : EMPTY_FEATURES,
    ...(seed?.toolsBaseUrl ?? preset?.toolsBaseUrl
      ? { toolsBaseUrl: seed?.toolsBaseUrl ?? preset?.toolsBaseUrl }
      : {}),
    ...(seed?.voice ? { voice: seed.voice } : {}),
    ...(seed?.extraBody ? { extraBody: seed.extraBody } : {}),
    ...(seed?.headers ? { headers: seed.headers } : {}),
  }
}

/** 部署时通过 config.js 预置的厂商（管理员配置，用户仍可在设置里修改） */
export type RuntimeConfig = {
  /** 同源转发地址，如 /api/proxy；为空时浏览器直连厂商 */
  proxyUrl?: string
  /** 转发服务要求的令牌，公网部署时建议设置 */
  proxyToken?: string
  /** 首次打开时预置的厂商 */
  providers?: unknown[]
  /** 左上角标题，空则用内置文案 */
  appName?: string
  /** 左上角标题旁的 logo 图片地址，可以是同源相对路径 */
  logoUrl?: string
}

let runtimeCache: RuntimeConfig | null = null

const normalizeRuntimeConfig = (value: unknown): RuntimeConfig => {
  const record = asRecord(value)
  if (!record) {
    return {}
  }
  return {
    // proxyUrl 可能是同源相对路径（如 /api/proxy），不能按接口地址补协议
    proxyUrl: asString(record.proxyUrl).trim() || undefined,
    proxyToken: asString(record.proxyToken).trim() || undefined,
    providers: Array.isArray(record.providers) ? record.providers : undefined,
    appName: asString(record.appName).trim() || undefined,
    logoUrl: asString(record.logoUrl).trim() || undefined,
  }
}

/** 读取 config.js 注入的运行时配置；没有时返回空对象 */
export const runtimeConfig = (): RuntimeConfig => {
  runtimeCache ??= normalizeRuntimeConfig(
    typeof window === 'undefined' ? undefined : window.__CHAT_DEMO_CONFIG__
  )
  return runtimeCache
}

/** 清掉运行时配置缓存（仅测试与热更新使用） */
export const resetRuntimeConfig = () => {
  runtimeCache = null
}

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i

const isLoopbackUrl = (url: string) => LOOPBACK.test(url.replace(/^https?:\/\//i, ''))

const withProxy = (url: string): string => {
  const { proxyUrl } = runtimeConfig()
  // 目标是浏览器所在的这台机器时不要走服务器代理：
  // 容器里的 127.0.0.1 指的是容器自己，不是用户的机器。
  if (!proxyUrl || isLoopbackUrl(url)) {
    return url
  }
  // proxyUrl 可能带查询串，如 /api/proxy?x=1
  const separator = proxyUrl.includes('?') ? '&' : '?'
  return `${proxyUrl}${separator}target=${encodeURIComponent(url)}`
}

/** 拼接接口地址；baseUrl 已经带上该路径时不重复追加，代理部署时自动改写到同源地址 */
export const providerUrl = (provider: Provider, path: string): string => {
  const base = provider.baseUrl.replace(/\/+$/, '')
  const url = base.endsWith(path) ? base : `${base}${path}`
  return withProxy(url)
}

/** 鉴权与协议头；beta 为 true 时附带 Files API 的 beta 头 */
export const providerHeaders = (
  provider: Provider,
  beta = false
): Record<string, string> => {
  const { proxyUrl, proxyToken } = runtimeConfig()
  return {
    ...(provider.protocol === 'anthropic'
      ? {
          'x-api-key': provider.apiKey,
          // Anthropic 官方要求；DeepSeek 兼容接口忽略该头
          'anthropic-version': '2023-06-01',
        }
      : { Authorization: `Bearer ${provider.apiKey}` }),
    ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
    ...(proxyUrl && proxyToken ? { 'x-proxy-token': proxyToken } : {}),
    ...provider.headers,
  }
}

/** 该厂商是否支持某项扩展能力 */
export const supportsFeature = (
  provider: Provider | null | undefined,
  feature: keyof ProviderFeatures
): boolean => {
  if (!provider) {
    return false
  }
  if (feature === 'voice') {
    return supportsReadAloud(provider) || supportsVoiceInput(provider)
  }
  if (provider.protocol !== 'anthropic' || !provider.features[feature]) {
    return false
  }
  if (feature === 'webSearch') {
    return provider.features.extensions
  }
  return true
}

/**
 * 朗读（TTS）：DeepSeek 兼容接口用 /v1/tools/tts，OpenAI 兼容接口用 /audio/speech，
 * 后者需要在厂商配置里填 TTS 模型才启用。
 */
export const supportsReadAloud = (provider: Provider | null | undefined): boolean => {
  if (!provider) {
    return false
  }
  if (provider.protocol === 'openai') {
    return !!provider.voice?.ttsModel
  }
  return provider.features.voice && !!provider.toolsBaseUrl
}

/** 语音输入（STT）：DeepSeek 兼容接口用 /v1/tools/asr，OpenAI 兼容接口用 /audio/transcriptions */
export const supportsVoiceInput = (provider: Provider | null | undefined): boolean => {
  if (!provider) {
    return false
  }
  if (provider.protocol === 'openai') {
    return !!provider.voice?.sttModel
  }
  return provider.features.voice && !!provider.toolsBaseUrl
}

const isLocalHost = (baseUrl: string) =>
  /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(baseUrl)

/** 可以开始对话：地址、模型齐全，并且有密钥（本机服务允许免密钥） */
export const isProviderReady = (provider: Provider | null | undefined): boolean => {
  if (!provider || !provider.baseUrl || !provider.model) {
    return false
  }
  return provider.apiKey.trim() !== '' || isLocalHost(provider.baseUrl)
}

/** 已保存密钥的展示掩码：太短的密钥整体打码，避免泄露 */
export const maskApiKey = (apiKey: string) => {
  if (!apiKey) {
    return ''
  }
  if (apiKey.length <= 8) {
    return '*'.repeat(8)
  }
  return `${apiKey.slice(0, 3)}${'*'.repeat(Math.min(apiKey.length - 3, 24))}`
}
