import type { AppInfo } from './ipc-channels'

/** preload 通过 contextBridge 暴露给渲染层的全部能力,保持最小。 */
export interface RendererApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
}
