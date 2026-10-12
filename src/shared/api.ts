import type { AppInfo } from './ipc-channels'
import type { ProbeResult, Thumbnail } from './types'

/**
 * 拖拽得到的文件对象的最小结构。
 * 真实类型是 DOM 的 File;这里只声明需要的部分,让 shared 目录不依赖 DOM 类型库。
 */
export interface DroppedFile {
  readonly name: string
}

/** preload 通过 contextBridge 暴露给渲染层的全部能力,刻意保持最小。 */
export interface RendererApi {
  app: {
    getInfo(): Promise<AppInfo>
  }
  files: {
    /** 打开系统文件选择对话框,支持多选;取消时返回 [] */
    pick(): Promise<string[]>
    /**
     * 把拖拽得到的 File 转成磁盘绝对路径。
     * 新版 Electron 已移除 File.path,必须用 webUtils.getPathForFile(风险 R-03);
     * 拿不到路径的(比如从浏览器拖来的图片)会得到空字符串。
     */
    getDroppedPaths(files: readonly DroppedFile[]): string[]
  }
  media: {
    probe(path: string): Promise<ProbeResult>
    thumbnail(path: string): Promise<Thumbnail>
  }
}
