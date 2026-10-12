import { useEffect, useState } from 'react'

interface Options {
  onPaths: (paths: string[]) => void
  /** 用户拖了文件进来,但一个路径都没取到(比如从浏览器里拖了张网络图片) */
  onNoPath: () => void
}

const hasFiles = (event: DragEvent): boolean =>
  Array.from(event.dataTransfer?.types ?? []).includes('Files')

/**
 * 整个窗口都是拖放区。
 *
 * - 必须对 dragover 和 drop 调用 preventDefault,否则浏览器的默认行为是"导航到这个文件",
 *   也就是把应用页面换成视频(主进程虽然拦截了导航,但用户会看到拖放"没反应")
 * - dragenter/dragleave 会在子元素之间反复触发,用计数器判断是否真的离开了窗口
 * - 路径通过 preload 的 webUtils.getPathForFile 取得(新版 Electron 的 File 对象没有 path 属性)
 */
export function useFileDrop({ onPaths, onNoPath }: Options): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    let depth = 0

    const onDragEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth += 1
      setDragging(true)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      depth = 0
      setDragging(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return
      const paths = window.api.files.getDroppedPaths(files).filter((p) => p !== '')
      if (paths.length > 0) onPaths(paths)
      else onNoPath()
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [onPaths, onNoPath])

  return dragging
}
