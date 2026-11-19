import { ApiError } from './client.js'
import { request } from './http.js'
import { providerHeaders, providerUrl, type Provider } from './providers.js'
import { toolsUrl } from './client.js'

/**
 * 语音接口，分两套协议：
 * - Anthropic 兼容（DeepSeek 扩展）：POST {toolsBaseUrl}/asr 与 /tts，TTS 返回裸 PCM 流；
 * - OpenAI 兼容：POST {baseUrl}/audio/transcriptions 与 /audio/speech，
 *   TTS 优先请求 PCM，服务端返回压缩音频时交给播放层解码。
 * 鉴权都用 Authorization: Bearer。
 */

export type TtsVoice = 'stella' | 'tide'

/** TTS 输出的裸 PCM 参数：24kHz、单声道、16-bit 小端 */
export const TTS_SAMPLE_RATE = 24000

/** 朗读音频：PCM 可以边收边播，其他格式（mp3/wav 等）整段解码后播一次 */
export type SpeechAudio =
  | { kind: 'pcm'; stream: ReadableStream<Uint8Array> }
  | { kind: 'encoded'; data: ArrayBuffer }

const readTranscript = (raw: string): string => {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new ApiError('protocol', raw)
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('text' in body) ||
    typeof body.text !== 'string'
  ) {
    throw new ApiError('protocol', raw)
  }
  return body.text
}

/** 语音识别：audio 为 WAV（单声道 16-bit PCM）或 Ogg Opus，时长不超过 120 秒、大小不超过 8 MiB */
export const transcribe = async (
  provider: Provider,
  audio: Blob,
  signal?: AbortSignal
): Promise<string> => {
  const form = new FormData()
  form.append('file', audio, 'recording.wav')
  if (provider.protocol === 'openai') {
    // OpenAI 兼容接口需要显式指定识别模型，缺省用 whisper-1
    form.append('model', provider.voice?.sttModel || 'whisper-1')
    const response = await request(providerUrl(provider, '/audio/transcriptions'), {
      method: 'POST',
      headers: providerHeaders(provider),
      body: form,
      signal,
    })
    return readTranscript(await response.text())
  }
  const response = await request(toolsUrl(provider, '/asr'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: form,
    signal,
  })
  return readTranscript(await response.text())
}

/** 请求朗读音频：OpenAI 兼容接口优先要 PCM，拿不到 PCM 就整段下载交给播放层解码 */
const synthesizeOpenAI = async (
  provider: Provider,
  text: string,
  signal: AbortSignal
): Promise<SpeechAudio> => {
  const response = await request(providerUrl(provider, '/audio/speech'), {
    method: 'POST',
    headers: { ...providerHeaders(provider), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.voice?.ttsModel || '',
      voice: provider.voice?.ttsVoice || 'alloy',
      input: text,
      response_format: 'pcm',
    }),
    signal,
  })
  if (!response.body) {
    throw new ApiError('protocol', '')
  }
  const contentType = (response.headers.get('Content-Type') ?? '').toLowerCase()
  const isPcm =
    contentType.includes('pcm') ||
    contentType.includes('octet-stream') ||
    contentType.includes('l16')
  if (isPcm) {
    return { kind: 'pcm', stream: response.body }
  }
  return { kind: 'encoded', data: await response.arrayBuffer() }
}

/** 语音合成：DeepSeek 兼容接口返回裸 PCM 字节流；服务端默认过滤代码块、表格、引用标记与长公式 */
const synthesizeDeepSeek = async (
  provider: Provider,
  text: string,
  voice: TtsVoice,
  signal: AbortSignal
): Promise<SpeechAudio> => {
  const response = await request(toolsUrl(provider, '/tts'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voice, format: 'pcm', filter_markdown: true }),
    signal,
  })
  if (!response.body) {
    throw new ApiError('protocol', await response.text())
  }
  return { kind: 'pcm', stream: response.body }
}

export const synthesize = (
  provider: Provider,
  text: string,
  voice: TtsVoice,
  signal: AbortSignal
): Promise<SpeechAudio> =>
  provider.protocol === 'openai'
    ? synthesizeOpenAI(provider, text, signal)
    : synthesizeDeepSeek(provider, text, voice, signal)
