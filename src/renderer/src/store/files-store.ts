import { create } from 'zustand'
import { fileNameFromPath, pathKey } from '@core/path-utils'
import { makeProbeError } from '@core/probe-errors'
import type { ProbeError, ProbeResult, Thumbnail, VideoInfo } from '@shared/types'

/** 文件库只依赖这两个调用,测试时可以传入假实现 */
export interface MediaApi {
  probe(path: string): Promise<ProbeResult>
  thumbnail(path: string): Promise<Thumbnail>
}

export type ProbeState =
  | { status: 'loading' }
  | { status: 'ready'; info: VideoInfo }
  | { status: 'error'; error: ProbeError }

export type ThumbState =
  | { status: 'loading' }
  | { status: 'ready'; thumbnail: Thumbnail }
  /** 没有缩略图可显示(探测失败,或取图通道出错),界面显示占位 */
  | { status: 'none' }

export interface FileEntry {
  id: string
  path: string
  name: string
  probe: ProbeState
  thumb: ThumbState
}

export interface AddResult {
  added: number
  /** 因为已在列表里而被跳过的数量 */
  duplicates: number
  /** 所有新文件的探测与缩略图都完成后 resolve;界面不需要等它,测试需要 */
  settled: Promise<void>
}

export interface FilesState {
  entries: FileEntry[]
  selectedId: string | null
  addPaths: (paths: readonly string[]) => AddResult
  select: (id: string | null) => void
  remove: (id: string) => void
  clear: () => void
}

const unknownError = (err: unknown): ProbeError =>
  makeProbeError('UNKNOWN', err instanceof Error ? err.message : String(err))

export function createFilesStore(api: MediaApi) {
  let seq = 0

  return create<FilesState>()((set, get) => {
    /** 按 id 局部更新;条目在加载途中被移除时,这里什么都不会发生 */
    const patch = (id: string, changes: Partial<FileEntry>): void =>
      set((state) => ({
        entries: state.entries.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry))
      }))

    const load = async (id: string, path: string): Promise<void> => {
      let probe: ProbeResult
      try {
        probe = await api.probe(path)
      } catch (err) {
        probe = { ok: false, error: unknownError(err) }
      }
      if (!probe.ok) {
        patch(id, { probe: { status: 'error', error: probe.error }, thumb: { status: 'none' } })
        return
      }
      // 信息先出现,缩略图后到:列表不必等 ffmpeg 抽帧
      patch(id, { probe: { status: 'ready', info: probe.info } })
      try {
        patch(id, { thumb: { status: 'ready', thumbnail: await api.thumbnail(path) } })
      } catch {
        patch(id, { thumb: { status: 'none' } })
      }
    }

    return {
      entries: [],
      selectedId: null,

      addPaths: (paths) => {
        const seen = new Set(get().entries.map((entry) => pathKey(entry.path)))
        const fresh: FileEntry[] = []
        let duplicates = 0
        for (const path of paths) {
          const key = pathKey(path)
          if (seen.has(key)) {
            duplicates += 1
            continue
          }
          seen.add(key)
          fresh.push({
            id: `file-${++seq}`,
            path,
            name: fileNameFromPath(path),
            probe: { status: 'loading' },
            thumb: { status: 'loading' }
          })
        }
        if (fresh.length > 0) set((state) => ({ entries: [...state.entries, ...fresh] }))
        const settled = Promise.all(fresh.map((entry) => load(entry.id, entry.path))).then(
          () => undefined
        )
        return { added: fresh.length, duplicates, settled }
      },

      select: (id) => set({ selectedId: id }),

      remove: (id) =>
        set((state) => ({
          entries: state.entries.filter((entry) => entry.id !== id),
          selectedId: state.selectedId === id ? null : state.selectedId
        })),

      clear: () => set({ entries: [], selectedId: null })
    }
  })
}
