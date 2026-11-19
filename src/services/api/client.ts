import { streamAnthropic } from './anthropic.js'
import { ApiError, request } from './http.js'
import { streamOpenAI } from './openai.js'
import { providerHeaders, providerUrl, type Provider } from './providers.js'
import type { CreateMessageRequest, FileObject, FilePurpose, MessageStreamEvent } from './types.js'

export { ApiError, type ApiErrorKind } from './http.js'
export { API_ORIGIN, DEFAULT_BASE_URL, DEFAULT_TOOLS_BASE_URL } from './origin.js'
export type { Provider, ProviderPreset, ProviderProtocol } from './providers.js'

/** 语音等工具接口的地址（如 DeepSeek 的 {origin}/v1/tools） */
const toolsBaseUrl = (provider: Provider) => provider.toolsBaseUrl?.replace(/\/+$/, '') ?? ''

/** 拼接工具接口地址；没配置工具地址时按协议错误处理 */
export const toolsUrl = (provider: Provider, path: string): string => {
  const base = toolsBaseUrl(provider)
  if (!base) {
    throw new ApiError('protocol', 'tools endpoint is not configured')
  }
  return providerUrl({ ...provider, baseUrl: base }, path)
}

/**
 * 用 GET /models 校验厂商配置（不产生费用）。
 * 部分兼容服务没有实现 /models，返回 404 / 405 时按「无法校验」处理，真正的错误留到对话时报出来。
 */
export const verifyProvider = async (
  provider: Provider,
  signal?: AbortSignal
): Promise<'ok' | 'unsupported'> => {
  try {
    await request(providerUrl(provider, '/models'), {
      method: 'GET',
      headers: providerHeaders(provider),
      signal,
    })
    return 'ok'
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
      return 'unsupported'
    }
    throw error
  }
}

/**
 * POST {baseUrl}/files 上传附件（仅支持 Files API 的厂商，即 DeepSeek 兼容接口）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  provider: Provider,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(providerUrl(provider, '/files'), {
    method: 'POST',
    headers: providerHeaders(provider, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE {baseUrl}/files/{file_id} */
export const deleteFile = async (provider: Provider, fileId: string): Promise<void> => {
  await request(providerUrl(provider, `/files/${encodeURIComponent(fileId)}`), {
    method: 'DELETE',
    headers: providerHeaders(provider, true),
  })
}

/**
 * 按厂商协议发流式对话请求：Anthropic 兼容接口产出官方事件，OpenAI 兼容接口
 * 由适配层翻译成同样的事件序列，上层逻辑不区分协议。
 */
export const streamChat = (
  provider: Provider,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> =>
  provider.protocol === 'openai'
    ? streamOpenAI(provider, body, signal)
    : streamAnthropic(provider, body, signal)
