/** IPC 通道名与载荷类型的唯一事实来源,主进程、preload、渲染层共用。 */
export const IPC = {
  appInfo: 'app:info'
} as const

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}
