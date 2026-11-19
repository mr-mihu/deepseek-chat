/** 构建期注入的默认 API 地址，见 rspack.config.ts 的 createConfig */
export const API_ORIGIN = __API_ORIGIN__

const ORIGIN = API_ORIGIN.replace(/\/+$/, '')

/** 内置 DeepSeek 兼容接口前缀（Anthropic 兼容格式） */
export const DEFAULT_BASE_URL = `${ORIGIN}/anthropic/v1`

/** DeepSeek 的语音接口前缀（ASR / TTS） */
export const DEFAULT_TOOLS_BASE_URL = `${ORIGIN}/v1/tools`

/** Files API 与通过 file_id 引用图片时必传的 beta 头 */
export const FILES_BETA = 'files-api-2025-04-14'
