import { create } from 'zustand'
import { isProviderReady } from '../../services/api/providers.js'
import { getActiveProvider } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 模型服务 / 数据管理 */
export type SettingsSection = 'general' | 'provider' | 'data'

/** 设置弹窗：侧边栏底部、没有可用厂商时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 没有可用的模型厂商（缺地址、模型或密钥）时打开设置并选中「模型服务」，返回是否已就绪 */
export const ensureProvider = () => {
  if (isProviderReady(getActiveProvider())) {
    return true
  }
  openSettings('provider')
  return false
}
