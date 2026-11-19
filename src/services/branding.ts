import { runtimeConfig } from './api/providers.js'

/**
 * 品牌信息：部署时通过 config.js（容器里的 CHAT_APP_NAME / CHAT_APP_LOGO）
 * 注入，用来替换左上角的标题与 logo。没配置时返回 null，界面回退到内置文案。
 */
export const branding = (): { name: string | null; logoUrl: string | null } => {
  const { appName, logoUrl } = runtimeConfig()
  return {
    name: appName?.trim() || null,
    logoUrl: logoUrl?.trim() || null,
  }
}

/** 把浏览器标签页标题（以及 favicon）换成部署时配置的名字 */
export const applyDocumentBranding = () => {
  const { name, logoUrl } = branding()
  if (name) {
    document.title = name
  }
  if (logoUrl) {
    const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const icon = existing ?? document.createElement('link')
    if (!existing) {
      icon.rel = 'icon'
      document.head.append(icon)
    }
    icon.href = logoUrl
  }
}
