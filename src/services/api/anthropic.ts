import { readMessageEvent } from './parseEvent.js'
import { ApiError, readErrorResponse, request } from './http.js'
import { providerHeaders, providerUrl, type Provider } from './providers.js'
import { readServerSentEvents } from './sse.js'
import type {
  AssistantBlockParam,
  CreateMessageRequest,
  MessageParam,
  MessageStreamEvent,
} from './types.js'

/** 请求里是否引用了 Files API 上传的文件（纯文本聊天无需 beta 头） */
const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * 非 DeepSeek 专有接口的厂商不认识 latest_reminder 角色与 server tool 块，
 * 发请求前把它们去掉，只保留文本与思考内容；不支持附件时连文件块一起丢掉，
 * 只留下同一轮里的文字，避免对方因为未知字段直接 400。
 */
const toPortableMessages = (
  messages: MessageParam[],
  attachments: boolean
): MessageParam[] =>
  messages.flatMap((message): MessageParam[] => {
    if (message.role === 'latest_reminder') {
      return []
    }
    if (message.role === 'user') {
      if (typeof message.content === 'string' || attachments) {
        return [message]
      }
      const content = message.content.filter((block) => block.type === 'text')
      return content.length > 0 ? [{ role: 'user', content }] : []
    }
    const content = message.content.filter(
      (block): block is Extract<AssistantBlockParam, { type: 'text' | 'thinking' }> =>
        block.type === 'text' || block.type === 'thinking'
    )
    return content.length > 0 ? [{ role: 'assistant', content }] : []
  })

/** 组装 Anthropic 兼容请求体：只有开了 DeepSeek 扩展的厂商才带专有字段 */
const toAnthropicBody = (provider: Provider, body: CreateMessageRequest) => {
  const { extensions, attachments } = provider.features
  return {
    ...(provider.extraBody ?? {}),
    model: body.model,
    system: body.system,
    messages: extensions ? body.messages : toPortableMessages(body.messages, attachments),
    thinking: body.thinking,
    ...(extensions
      ? {
          safety_check: body.safety_check,
          tools: body.tools,
          ...(body.title ? { title: body.title } : {}),
        }
      : {}),
  }
}

/**
 * POST {baseUrl}/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamAnthropic(
  provider: Provider,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(providerUrl(provider, '/messages'), {
    method: 'POST',
    headers: {
      ...providerHeaders(provider, provider.features.attachments && hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...toAnthropicBody(provider, body), stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorPayload(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

const isErrorPayload = (value: unknown): value is { error: { message: string } } =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as { error?: { message?: unknown } }).error?.message === 'string'
