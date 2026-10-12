import { contextBridge, ipcRenderer } from 'electron'
import type { RendererApi } from '../shared/api'
import { IPC } from '../shared/ipc-channels'

// 只暴露白名单函数,绝不把 ipcRenderer 本身暴露给渲染层
const api: RendererApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC.appInfo)
  }
}

contextBridge.exposeInMainWorld('api', api)
