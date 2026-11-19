import { translate, type TranslationMessage } from '../i18n/index.js'
import {
  describeImportError,
  fetchNewApiModels,
  NEW_API_IMPORT_PARAMS,
  newApiBaseUrl,
  normalizeNewApiAddress,
  parseNewApiImport,
  type NewApiImport,
} from './api/newapi.js'
import { normalizeProvider, type Provider } from './api/providers.js'
import { saveProvider, setActiveProvider, useSettings } from './settings.js'

/**
 * new-api「聊天预设一键导入」在本应用这一侧的实现：
 * 页面带上 ?newapi={address}&key={key} 打开时，自动建好并切换到这个 new-api 厂商。
 * new-api 不提供 OAuth 授权服务器，这是双方现有能力下最接近「点一下授权」的方式。
 */

const IMPORT_NAME = 'New API'

/** 清掉地址栏里的密钥与地址，避免令牌留在浏览器历史和后续请求的 Referer 里 */
const cleanUrl = () => {
  const url = new URL(window.location.href)
  const hashHadParams = url.hash.includes('=')
  for (const name of NEW_API_IMPORT_PARAMS) {
    url.searchParams.delete(name)
  }
  const next = `${url.pathname}${url.search}${hashHadParams ? '' : url.hash}`
  window.history.replaceState(null, '', next || '/')
}

/** 已有同地址的厂商就沿用它的名字，否则用「New API」，重名时补上主机名 */
const pickName = (providers: Provider[], address: string, existing?: Provider) => {
  if (existing?.name) {
    return existing.name
  }
  if (!providers.some((provider) => provider.name === IMPORT_NAME)) {
    return IMPORT_NAME
  }
  try {
    return `${IMPORT_NAME}（${new URL(address).host}）`
  } catch {
    return IMPORT_NAME
  }
}

/**
 * 保存并启用一个指向 new-api 的厂商。
 * 模型列表拉不到（密钥无效、地址不通、被跨域拦截）时仍然保存配置，
 * 由用户在设置里核对，避免白跑一趟。
 */
export const importNewApiProvider = async (
  { address, key }: NewApiImport,
  signal?: AbortSignal
): Promise<{ provider: Provider; modelMissing: boolean }> => {
  const server = normalizeNewApiAddress(address)
  if (!server) {
    throw new Error(translate('newApiAddressInvalid'))
  }
  const baseUrl = newApiBaseUrl(server)
  const { providers } = useSettings.getState()
  const existing = providers.find(
    (provider) => provider.baseUrl.replace(/\/+$/, '') === baseUrl
  )
  const provider = normalizeProvider({
    id: existing?.id,
    name: pickName(providers, server, existing),
    protocol: 'openai',
    baseUrl,
    model: existing?.model ?? '',
    apiKey: key,
  })
  if (!provider) {
    throw new Error(translate('newApiAddressInvalid'))
  }

  let model = provider.model
  try {
    const models = await fetchNewApiModels(provider, signal)
    model = models[0] ?? model
  } catch {
    // 拿不到模型列表时保留原模型（可能为空），让用户在设置里确认
  }

  const saved = { ...provider, model }
  saveProvider(saved)
  setActiveProvider(saved.id)
  return { provider: saved, modelMissing: !saved.model }
}

/**
 * 页面启动时执行一次：没有导入参数就什么都不做（返回 null）。
 * 返回的提示交给界面层弹 toast。
 */
export const applyNewApiImport = async (): Promise<TranslationMessage | null> => {
  if (typeof window === 'undefined') {
    return null
  }
  const params = parseNewApiImport(window.location.href)
  if (!params) {
    return null
  }
  cleanUrl()
  try {
    const { modelMissing } = await importNewApiProvider(params)
    return { key: modelMissing ? 'newApiImportedNoModel' : 'newApiImported' }
  } catch (error) {
    return {
      key: 'newApiImportFailed',
      params: { message: describeImportError(error) },
    }
  }
}
