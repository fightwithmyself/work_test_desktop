import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DroppedFile, RendererApi } from '../shared/api'
import { IPC, type IpcChannel, type IpcRequest, type IpcResponse } from '../shared/ipc-channels'

/** 类型化的 invoke:通道名、请求、响应类型都由 IpcContract 约束 */
function invoke<K extends IpcChannel>(channel: K, request: IpcRequest<K>): Promise<IpcResponse<K>> {
  return ipcRenderer.invoke(channel, request) as Promise<IpcResponse<K>>
}

/**
 * 只暴露白名单函数,不暴露 ipcRenderer 本身:
 * 渲染层既不能订阅任意通道,也不能调用未声明的通道。
 */
const api: RendererApi = {
  app: {
    getInfo: () => invoke(IPC.appInfo, undefined)
  },
  files: {
    pick: () => invoke(IPC.pickFiles, undefined),
    getDroppedPaths: (files: readonly DroppedFile[]) =>
      files.map((file) => {
        try {
          // 新版 Electron 移除了 File.path,只能通过 webUtils 取真实路径(风险 R-03)
          return webUtils.getPathForFile(file as unknown as File)
        } catch {
          return ''
        }
      })
  },
  media: {
    probe: (path: string) => invoke(IPC.probe, { path }),
    thumbnail: (path: string) => invoke(IPC.thumbnail, { path })
  }
}

contextBridge.exposeInMainWorld('api', api)
