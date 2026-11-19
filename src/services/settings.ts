import { create } from 'zustand'
import {
  createProvider,
  getProviderPreset,
  normalizeProvider,
  runtimeConfig,
  type Provider,
} from './api/providers.js'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 本机设置，存 localStorage：模型厂商配置、语言、主题、位置、朗读音色、
 * 深度思考与智能搜索开关、侧边栏收起状态。
 */
type Settings = {
  /** 已配置的模型厂商，可多个；当前使用 activeProviderId 指定的那一个 */
  providers: Provider[]
  activeProviderId: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  providers: 'chat-demo:providers',
  activeProvider: 'chat-demo:active-provider',
  /** 旧版本的单一 API Key，仅用于升级时迁移 */
  legacyApiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 部署时预置的厂商没有 id，用名称/地址推导一个稳定 id，保证每次打开都选中同一个 */
const seedId = (seed: unknown, index: number) => {
  const record =
    typeof seed === 'object' && seed !== null ? (seed as Record<string, unknown>) : {}
  const raw = String(record.name ?? record.baseUrl ?? record.id ?? `seed-${index}`)
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `seed-${slug || index}`
}

/**
 * 厂商配置的初始值：优先用本机保存的，其次用部署时 config.js 预置的，
 * 最后把旧版本的单一 API Key 迁移成一个 DeepSeek 厂商，升级后无需重新输入密钥。
 */
const readProviders = (): Provider[] => {
  const stored = read(KEYS.providers)
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored)
      if (Array.isArray(parsed)) {
        const providers = parsed
          .map((item) => normalizeProvider(item))
          .filter((item): item is Provider => item !== null)
        if (providers.length > 0) {
          return providers
        }
      }
    } catch {
      // 数据损坏时按未保存过处理
    }
  }

  const seeds = runtimeConfig().providers ?? []
  const seeded = seeds.flatMap((seed, index) => {
    const provider = normalizeProvider({ ...(seed as object), id: seedId(seed, index) })
    return provider ? [provider] : []
  })
  if (seeded.length > 0) {
    return seeded
  }

  const legacyKey = read(KEYS.legacyApiKey) ?? ''
  if (legacyKey) {
    // 迁移完成后清掉旧键，避免以后删除厂商时又冒出来
    write(KEYS.legacyApiKey, null)
  }
  return [createProvider(getProviderPreset('deepseek'), { id: 'deepseek', apiKey: legacyKey })]
}

const initialProviders = readProviders()

const initialActiveProviderId = (): string | null => {
  const saved = read(KEYS.activeProvider)
  if (saved && initialProviders.some((provider) => provider.id === saved)) {
    return saved
  }
  return initialProviders[0]?.id ?? null
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

export const useSettings = create<Settings>(() => ({
  providers: initialProviders,
  activeProviderId: initialActiveProviderId(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

const persistProviders = (providers: Provider[]) =>
  write(KEYS.providers, JSON.stringify(providers))

/** 当前使用的厂商；配置被删空时为 null */
export const getActiveProvider = (): Provider | null => {
  const { providers, activeProviderId } = useSettings.getState()
  return providers.find((provider) => provider.id === activeProviderId) ?? providers[0] ?? null
}

/** 订阅当前厂商，组件里用它读取模型与能力 */
export const useActiveProvider = (): Provider | null =>
  useSettings(
    (state) =>
      state.providers.find((provider) => provider.id === state.activeProviderId) ??
      state.providers[0] ??
      null
  )

/** 新增或更新一个厂商；第一个厂商会自动成为当前使用的厂商 */
export const saveProvider = (provider: Provider) => {
  const { providers, activeProviderId } = useSettings.getState()
  const exists = providers.some((item) => item.id === provider.id)
  const next = exists
    ? providers.map((item) => (item.id === provider.id ? provider : item))
    : [...providers, provider]
  persistProviders(next)
  const stillActive = next.some((item) => item.id === activeProviderId)
  const nextActive = stillActive ? activeProviderId : (next[0]?.id ?? null)
  if (nextActive !== activeProviderId) {
    write(KEYS.activeProvider, nextActive)
  }
  useSettings.setState({ providers: next, activeProviderId: nextActive })
}

export const removeProvider = (id: string) => {
  const { providers, activeProviderId } = useSettings.getState()
  const next = providers.filter((provider) => provider.id !== id)
  persistProviders(next)
  const nextActive =
    activeProviderId === id ? (next[0]?.id ?? null) : (activeProviderId ?? next[0]?.id ?? null)
  write(KEYS.activeProvider, nextActive)
  useSettings.setState({ providers: next, activeProviderId: nextActive })
}

export const setActiveProvider = (id: string) => {
  write(KEYS.activeProvider, id)
  useSettings.setState({ activeProviderId: id })
}

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
