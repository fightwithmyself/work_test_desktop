import type { ProbeResult, Thumbnail } from './types'

/**
 * IPC 通道名与载荷类型的唯一事实来源,主进程、preload、渲染层共用。
 *
 * 新增通道的步骤:
 * 1. 在 IPC 里加名字
 * 2. 在 IpcContract 里声明请求/响应类型(preload 与 main 会因此在编译期被约束)
 * 3. main/ipc 里用 handle() 注册并校验载荷,preload 里用 invoke() 转发
 */
export const IPC = {
  appInfo: 'app:info',
  pickFiles: 'files:pick',
  probe: 'media:probe',
  thumbnail: 'media:thumbnail'
} as const

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

/** 凡是"针对某个文件"的请求,载荷都只有一个绝对路径 */
export interface PathRequest {
  path: string
}

export interface IpcContract {
  [IPC.appInfo]: { req: undefined; res: AppInfo }
  /** 打开系统文件选择对话框;用户取消时返回空数组 */
  [IPC.pickFiles]: { req: undefined; res: string[] }
  [IPC.probe]: { req: PathRequest; res: ProbeResult }
  [IPC.thumbnail]: { req: PathRequest; res: Thumbnail }
}

export type IpcChannel = keyof IpcContract
export type IpcRequest<K extends IpcChannel> = IpcContract[K]['req']
export type IpcResponse<K extends IpcChannel> = IpcContract[K]['res']
