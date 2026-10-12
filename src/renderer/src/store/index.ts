import { createFilesStore } from './files-store'

/** 应用里唯一的文件库实例;window.api 由 preload 注入,模块加载时已存在 */
export const useFilesStore = createFilesStore(window.api.media)
