import clsx from 'clsx'
import { useState, type ReactNode } from 'react'
import { IconEditOutline16, IconTrashOutline16 } from '../base/icons.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { ApiError, verifyProvider } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  createProvider,
  getProviderPreset,
  maskApiKey,
  normalizeBaseUrl,
  normalizeProvider,
  PROVIDER_PRESETS,
  type Provider,
  type ProviderFeatures,
  type ProviderProtocol,
} from '../../services/api/providers.js'
import {
  removeProvider,
  saveProvider,
  setActiveProvider,
  useSettings,
} from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './Settings.module.css'

/** 额外请求头：每行「名称: 值」；格式不对时返回 null */
const parseHeaders = (text: string): Record<string, string> | undefined | null => {
  const headers: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      continue
    }
    const colon = line.indexOf(':')
    if (colon <= 0) {
      return null
    }
    const name = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (!name) {
      return null
    }
    headers[name] = value
  }
  return Object.keys(headers).length > 0 ? headers : undefined
}

const formatHeaders = (headers?: Record<string, string>) =>
  Object.entries(headers ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')

/** 表单里的一行：标题 + 控件 + 可选说明 */
const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) => (
  <div className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    {children}
    {hint ? <span className={styles.description}>{hint}</span> : null}
  </div>
)

/** 设置里的「模型服务」分组：厂商列表 + 当前使用的厂商 + 增删改 */
export const ProviderSettings = () => {
  const t = useTranslate()
  const providers = useSettings((state) => state.providers)
  const activeProviderId = useSettings((state) => state.activeProviderId)
  const [draft, setDraft] = useState<Provider | null>(null)
  const activeId = activeProviderId ?? providers[0]?.id ?? null

  return (
    <div className={styles.providerSection}>
      <div className={styles.providerHeader}>
        <div className={styles.text}>
          <div className={styles.label}>{t('settingsProviders')}</div>
          <div className={styles.description}>{t('settingsProvidersDescription')}</div>
        </div>
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => setDraft(createProvider())}
        >
          {t('providerAdd')}
        </Button>
      </div>
      <div role="radiogroup" aria-label={t('settingsProviders')} className={styles.providerList}>
        {providers.map((provider) => {
          const active = provider.id === activeId
          return (
            <div
              key={provider.id}
              className={clsx(styles.providerItem, active && styles.providerItemActive)}
            >
              <button
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={provider.name || t('providerUnnamed')}
                className={clsx(styles.providerRadio, active && styles.providerRadioActive)}
                onClick={() => setActiveProvider(provider.id)}
              >
                <span className={styles.providerDot} />
              </button>
              <div className={styles.providerInfo}>
                <div className={styles.providerNameRow}>
                  <span className={styles.providerName}>
                    {provider.name || t('providerUnnamed')}
                  </span>
                  {active ? <span className={styles.providerBadge}>{t('providerInUse')}</span> : null}
                </div>
                <div className={styles.providerMeta}>
                  {t(
                    provider.protocol === 'openai'
                      ? 'providerProtocolOpenaiShort'
                      : 'providerProtocolAnthropicShort'
                  )}
                  {' · '}
                  {provider.model || t('providerModelMissing')}
                  {' · '}
                  {provider.apiKey ? maskApiKey(provider.apiKey) : t('providerNoKey')}
                </div>
              </div>
              <IconButton
                icon={<IconEditOutline16 />}
                tooltip={t('providerEdit')}
                onClick={() => setDraft({ ...provider })}
              />
              <IconButton
                icon={<IconTrashOutline16 />}
                tooltip={t('delete')}
                onClick={() => removeProvider(provider.id)}
              />
            </div>
          )
        })}
        {providers.length === 0 ? (
          <div className={styles.description}>{t('providerEmpty')}</div>
        ) : null}
      </div>
      {draft ? <ProviderEditor initial={draft} onClose={() => setDraft(null)} /> : null}
    </div>
  )
}

/** 厂商编辑弹窗：预设、地址、模型、密钥、能力开关与高级选项 */
const ProviderEditor = ({
  initial,
  onClose,
}: {
  initial: Provider
  onClose: () => void
}) => {
  const t = useTranslate()
  const [draft, setDraft] = useState(initial)
  const [presetKey, setPresetKey] = useState('')
  const [headersText, setHeadersText] = useState(() => formatHeaders(initial.headers))
  const [extraBodyText, setExtraBodyText] = useState(() =>
    initial.extraBody ? JSON.stringify(initial.extraBody, null, 2) : ''
  )
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)

  const patch = (value: Partial<Provider>) => {
    setDraft((current) => ({ ...current, ...value }))
    setTestResult(null)
    setError(null)
  }

  const patchFeature = (key: keyof ProviderFeatures, value: boolean) => {
    setDraft((current) => ({
      ...current,
      features: {
        ...current.features,
        [key]: value,
        // 联网搜索依赖 DeepSeek 扩展，关掉扩展时一起关掉
        ...(key === 'extensions' && !value ? { webSearch: false } : {}),
      },
    }))
    setTestResult(null)
  }

  const applyPreset = (key: string) => {
    setPresetKey(key)
    const preset = getProviderPreset(key)
    if (!preset) {
      return
    }
    const next = createProvider(preset, { id: draft.id, apiKey: draft.apiKey })
    setDraft(next)
    setHeadersText(formatHeaders(next.headers))
    setExtraBodyText('')
    setTestResult(null)
    setError(null)
  }

  /** 校验并收敛成合法配置；不合法时在表单里给出原因 */
  const buildProvider = (): Provider | null => {
    const baseUrl = normalizeBaseUrl(draft.baseUrl)
    if (!baseUrl.trim() || !draft.model.trim()) {
      setError(t('providerIncomplete'))
      return null
    }
    const headers = parseHeaders(headersText)
    if (headers === null) {
      setError(t('providerHeadersInvalid'))
      return null
    }
    let extraBody: Record<string, unknown> | undefined
    const raw = extraBodyText.trim()
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('not an object')
        }
        extraBody = parsed as Record<string, unknown>
      } catch {
        setError(t('providerExtraBodyInvalid'))
        return null
      }
    }
    const provider = normalizeProvider({
      ...draft,
      baseUrl,
      name: draft.name.trim(),
      model: draft.model.trim(),
      headers,
      extraBody,
    })
    if (!provider) {
      setError(t('providerIncomplete'))
      return null
    }
    return provider
  }

  const describeError = (caught: unknown) => {
    if (!(caught instanceof ApiError)) {
      return caught instanceof Error ? caught.message : String(caught)
    }
    switch (classifyApiError(caught)) {
      case 'unauthorized':
        return t('apiKeyInvalid')
      case 'network':
        return t('commonNetworkErrorToast')
      default:
        return caught.message
    }
  }

  const testConnection = async () => {
    const provider = buildProvider()
    if (!provider) {
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await verifyProvider(provider)
      setTestResult({
        ok: true,
        text: t(result === 'ok' ? 'providerTestOk' : 'providerTestUnsupported'),
      })
    } catch (caught) {
      setTestResult({
        ok: false,
        text: t('providerTestFailed', { message: describeError(caught) }),
      })
    } finally {
      setTesting(false)
    }
  }

  const save = () => {
    const provider = buildProvider()
    if (!provider) {
      return
    }
    saveProvider(provider)
    onClose()
  }

  const anthropic = draft.protocol === 'anthropic'
  const protocolOptions: { value: ProviderProtocol; label: string }[] = [
    { value: 'openai', label: t('providerProtocolOpenai') },
    { value: 'anthropic', label: t('providerProtocolAnthropic') },
  ]

  return (
    <Modal
      title={t(initial.name || initial.model ? 'providerEdit' : 'providerAdd')}
      closable
      className={styles.providerDialog}
      mainClassName={styles.editorMain}
      onClose={onClose}
      footer={
        <div className={styles.editorActions}>
          <Button
            variant="outlined"
            size="m"
            disabled={testing}
            onClick={() => void testConnection()}
          >
            {t(testing ? 'providerTesting' : 'providerTest')}
          </Button>
          <Button variant="outlined" size="m" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button size="m" onClick={save}>
            {t('providerSave')}
          </Button>
        </div>
      }
    >
      <div className={styles.editor}>
        <Field label={t('providerPreset')}>
          <Select
            ariaLabel={t('providerPreset')}
            value={presetKey}
            placeholder={t('providerPresetCustom')}
            options={PROVIDER_PRESETS.map((preset) => ({
              value: preset.key,
              label: preset.name,
            }))}
            onChange={applyPreset}
          />
        </Field>
        <Field label={t('providerName')} hint={t('providerNameHint')}>
          <input
            className={styles.input}
            value={draft.name}
            placeholder={t('providerNamePlaceholder')}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </Field>
        <Field label={t('providerProtocol')}>
          <Select
            ariaLabel={t('providerProtocol')}
            value={draft.protocol}
            options={protocolOptions}
            onChange={(protocol) =>
              patch({
                protocol: protocol as ProviderProtocol,
                features:
                  protocol === 'anthropic'
                    ? draft.features
                    : {
                        extensions: false,
                        attachments: false,
                        webSearch: false,
                        voice: false,
                      },
              })
            }
          />
        </Field>
        <Field label={t('providerBaseUrl')} hint={t('providerBaseUrlHint')}>
          <input
            className={styles.input}
            value={draft.baseUrl}
            placeholder={
              anthropic ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'
            }
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => patch({ baseUrl: event.target.value })}
          />
        </Field>
        <Field label={t('providerModel')} hint={t('providerModelHint')}>
          <input
            className={styles.input}
            value={draft.model}
            placeholder={anthropic ? 'claude-sonnet-4-5' : 'gpt-4o-mini'}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => patch({ model: event.target.value })}
          />
        </Field>
        <Field label={t('providerApiKey')} hint={t('providerApiKeyHint')}>
          <input
            className={styles.input}
            type="password"
            value={draft.apiKey}
            placeholder="sk-..."
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => patch({ apiKey: event.target.value })}
          />
        </Field>
        {anthropic ? (
          <div className={styles.featureGroup}>
            <span className={styles.fieldLabel}>{t('providerFeatures')}</span>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={draft.features.extensions}
                onChange={(event) => patchFeature('extensions', event.target.checked)}
              />
              {t('providerFeatureExtensions')}
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={draft.features.attachments}
                onChange={(event) => patchFeature('attachments', event.target.checked)}
              />
              {t('providerFeatureAttachments')}
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={draft.features.webSearch}
                disabled={!draft.features.extensions}
                onChange={(event) => patchFeature('webSearch', event.target.checked)}
              />
              {t('providerFeatureWebSearch')}
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={draft.features.voice}
                onChange={(event) => patchFeature('voice', event.target.checked)}
              />
              {t('providerFeatureVoice')}
            </label>
            {draft.features.voice ? (
              <Field label={t('providerToolsUrl')} hint={t('providerToolsUrlHint')}>
                <input
                  className={styles.input}
                  value={draft.toolsBaseUrl ?? ''}
                  placeholder="https://api.deepseek.com/v1/tools"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => patch({ toolsBaseUrl: event.target.value })}
                />
              </Field>
            ) : null}
          </div>
        ) : null}
        <details className={styles.advanced}>
          <summary>{t('providerAdvanced')}</summary>
          <div className={styles.advancedBody}>
            <Field label={t('providerHeaders')} hint={t('providerHeadersHint')}>
              <textarea
                className={styles.textarea}
                rows={2}
                value={headersText}
                placeholder={'HTTP-Referer: https://example.com'}
                spellCheck={false}
                onChange={(event) => {
                  setHeadersText(event.target.value)
                  setTestResult(null)
                }}
              />
            </Field>
            <Field label={t('providerExtraBody')} hint={t('providerExtraBodyHint')}>
              <textarea
                className={styles.textarea}
                rows={3}
                value={extraBodyText}
                placeholder={'{ "temperature": 0.7 }'}
                spellCheck={false}
                onChange={(event) => {
                  setExtraBodyText(event.target.value)
                  setTestResult(null)
                }}
              />
            </Field>
          </div>
        </details>
        {error ? <div className={styles.error}>{error}</div> : null}
        {testResult ? (
          <div
            className={clsx(styles.testResult, testResult.ok ? styles.testOk : styles.error)}
            role="status"
          >
            {testResult.text}
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
