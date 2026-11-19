import { ApiError, readErrorResponse, request } from './http.js'
import { providerHeaders, providerUrl, type Provider } from './providers.js'
import { readServerSentEvents } from './sse.js'
import type {
  CreateMessageRequest,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
} from './types.js'

/**
 * OpenAI 兼容协议（/chat/completions）适配层：把 SSE 增量翻译成应用内部的
 * MessageStreamEvent，让回复合并、思考展示、停止生成等逻辑与 Anthropic 协议共用。
 * 只使用两种最通用的增量字段：正文 content、推理 reasoning_content（部分厂商用 reasoning）。
 */

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type ChatDelta = {
  content?: string | null
  reasoning_content?: string | null
  reasoning?: string | null
}

type ChatChunk = {
  id?: string
  model?: string
  choices?: {
    delta?: ChatDelta
    message?: ChatDelta
    finish_reason?: string | null
  }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
  }
  error?: { message?: string }
}

/** 把内部消息（含文件块、思考块、服务端工具块）收敛成纯文本对话 */
const textOfBlocks = (blocks: ReadonlyArray<{ type: string; text?: string }>) =>
  blocks
    .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
    .filter((text) => text !== '')
    .join('\n\n')

const toChatMessages = (body: CreateMessageRequest): ChatMessage[] => {
  const messages: ChatMessage[] = []
  let reminder = ''
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      reminder = message.content
      continue
    }
    const content =
      typeof message.content === 'string' ? message.content : textOfBlocks(message.content)
    if (content.trim() === '') {
      continue
    }
    messages.push({ role: message.role, content })
  }
  // latest_reminder 没有对应的 OpenAI 角色，并入 system 的开头更通用
  const system = [body.system.trim(), reminder ? `当前上下文：${reminder}` : '']
    .filter(Boolean)
    .join('\n\n')
  return system ? [{ role: 'system', content: system }, ...messages] : messages
}

const toUsage = (usage: NonNullable<ChatChunk['usage']>): MessageUsage => ({
  input_tokens: usage.prompt_tokens ?? 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  output_tokens: usage.completion_tokens ?? 0,
})

/** finish_reason → 应用内的结束原因 */
const toStopReason = (reason: string | null | undefined): StopReason => {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}

type StreamState = {
  started: boolean
  /** 下一个可用的块序号 */
  index: number
  blockIndex: number
  blockType: '' | 'text' | 'thinking'
  stopReason: StopReason
  usage?: MessageUsage
}

const createState = (): StreamState => ({
  started: false,
  index: 0,
  blockIndex: -1,
  blockType: '',
  stopReason: 'end_turn',
})

/** 追加一段正文或思考：切换类型时先结束上一个块，再开新块 */
const appendDelta = (
  state: StreamState,
  out: MessageStreamEvent[],
  type: 'text' | 'thinking',
  value: string
) => {
  if (state.blockType !== type) {
    if (state.blockType !== '') {
      out.push({ type: 'content_block_stop', index: state.blockIndex })
    }
    state.blockIndex = state.index++
    state.blockType = type
    out.push({
      type: 'content_block_start',
      index: state.blockIndex,
      content_block:
        type === 'text'
          ? { type: 'text', text: '' }
          : { type: 'thinking', thinking: '', signature: '' },
    })
  }
  out.push({
    type: 'content_block_delta',
    index: state.blockIndex,
    delta:
      type === 'text'
        ? { type: 'text_delta', text: value }
        : { type: 'thinking_delta', thinking: value },
  })
}

const reasoningOf = (delta: ChatDelta | undefined) => {
  if (typeof delta?.reasoning_content === 'string') {
    return delta.reasoning_content
  }
  return typeof delta?.reasoning === 'string' ? delta.reasoning : ''
}

const contentOf = (delta: ChatDelta | undefined) =>
  typeof delta?.content === 'string' ? delta.content : ''

/** 收尾：关掉未结束的内容块，补上结束原因与用量，再结束消息 */
const finish = (state: StreamState): MessageStreamEvent[] => {
  const out: MessageStreamEvent[] = []
  if (state.blockType !== '') {
    out.push({ type: 'content_block_stop', index: state.blockIndex })
  }
  out.push({
    type: 'message_delta',
    delta: { stop_reason: state.stopReason, stop_sequence: null },
    ...(state.usage ? { usage: state.usage } : {}),
  })
  out.push({ type: 'message_stop' })
  return out
}

/** 有些服务忽略 stream 参数直接返回完整 JSON，这里按一次性响应解析 */
const readWholeResponse = (provider: Provider, text: string): MessageStreamEvent[] => {
  let payload: ChatChunk
  try {
    payload = JSON.parse(text) as ChatChunk
  } catch {
    throw new ApiError('protocol', text)
  }
  if (payload.error?.message) {
    throw new ApiError('http', payload.error.message)
  }
  const choice = payload.choices?.[0]
  if (!choice) {
    throw new ApiError('protocol', text)
  }
  const state = createState()
  const out: MessageStreamEvent[] = [
    {
      type: 'message_start',
      message: { id: payload.id ?? '', model: payload.model ?? provider.model },
    },
  ]
  state.started = true
  state.stopReason = toStopReason(choice.finish_reason)
  const thinking = reasoningOf(choice.message)
  if (thinking) {
    appendDelta(state, out, 'thinking', thinking)
  }
  const content = contentOf(choice.message)
  if (content) {
    appendDelta(state, out, 'text', content)
  }
  if (payload.usage) {
    state.usage = toUsage(payload.usage)
  }
  return [...out, ...finish(state)]
}

/**
 * POST {baseUrl}/chat/completions（stream: true），把每个增量翻译成内部事件。
 * 收到 [DONE]（或流结束）即收尾；流中带 error 帧时抛出 ApiError。
 */
export async function* streamOpenAI(
  provider: Provider,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await request(providerUrl(provider, '/chat/completions'), {
    method: 'POST',
    headers: {
      ...providerHeaders(provider),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      ...(provider.extraBody ?? {}),
      model: body.model,
      messages: toChatMessages(body),
      stream: true,
    }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  if (!contentType.includes('text/event-stream')) {
    yield* readWholeResponse(provider, await response.text())
    return
  }

  const state = createState()
  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
    }
    let chunk: ChatChunk
    try {
      chunk = JSON.parse(data) as ChatChunk
    } catch {
      continue
    }
    if (chunk.error?.message) {
      throw new ApiError('stream', chunk.error.message)
    }
    const out: MessageStreamEvent[] = []
    if (!state.started) {
      state.started = true
      out.push({
        type: 'message_start',
        message: { id: chunk.id ?? '', model: chunk.model ?? provider.model },
      })
    }
    const choice = chunk.choices?.[0]
    const thinking = reasoningOf(choice?.delta)
    if (thinking) {
      appendDelta(state, out, 'thinking', thinking)
    }
    const content = contentOf(choice?.delta)
    if (content) {
      appendDelta(state, out, 'text', content)
    }
    if (chunk.usage) {
      state.usage = toUsage(chunk.usage)
    }
    if (choice?.finish_reason) {
      state.stopReason = toStopReason(choice.finish_reason)
    }
    yield* out
  }
  // 一条有效增量都没有时按断流处理，交给调用方显示网络类错误
  if (!state.started) {
    throw new ApiError('interrupted', '')
  }
  yield* finish(state)
}
