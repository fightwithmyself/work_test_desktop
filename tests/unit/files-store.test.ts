import { describe, expect, it, vi } from 'vitest'
import { makeProbeError } from '../../src/core/probe-errors'
import { createFilesStore, type MediaApi } from '../../src/renderer/src/store/files-store'
import type { ProbeResult, Thumbnail, VideoInfo } from '../../src/shared/types'

const info = (durationSec = 3): VideoInfo => ({
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  formatLongName: null,
  durationSec,
  sizeBytes: 1000,
  bitRate: 1000,
  videoStreams: [],
  audioStreams: [],
  subtitleStreamCount: 0,
  hasCoverArt: false,
  hasVideo: true,
  hasAudio: false,
  rotation: 0
})

const thumb: Thumbnail = {
  kind: 'frame',
  dataUrl: 'data:image/jpeg;base64,AAAA',
  timestampSec: 0.3,
  reason: null
}

/** 一个可以手动控制"何时返回"的假 API,用来精确观察 loading → ready 的中间状态 */
function controllableApi(): {
  api: MediaApi
  probes: Map<string, (r: ProbeResult | Error) => void>
  thumbs: Map<string, (r: Thumbnail | Error) => void>
  probeCalls: string[]
  thumbCalls: string[]
} {
  const probes = new Map<string, (r: ProbeResult | Error) => void>()
  const thumbs = new Map<string, (r: Thumbnail | Error) => void>()
  const probeCalls: string[] = []
  const thumbCalls: string[] = []
  const api: MediaApi = {
    probe: (path) =>
      new Promise((resolve, reject) => {
        probeCalls.push(path)
        probes.set(path, (r) => (r instanceof Error ? reject(r) : resolve(r)))
      }),
    thumbnail: (path) =>
      new Promise((resolve, reject) => {
        thumbCalls.push(path)
        thumbs.set(path, (r) => (r instanceof Error ? reject(r) : resolve(r)))
      })
  }
  return { api, probes, thumbs, probeCalls, thumbCalls }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const A = 'C:\\videos\\a.mp4'
const B = 'C:\\videos\\b.mp4'
const C = 'C:\\videos\\c.mp4'

describe('addPaths · 状态流转', () => {
  it('立即(同步)插入 loading 条目,文件名取自路径,骨架屏可以马上显示', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    const result = store.getState().addPaths([A, 'D:\\中文 目录\\视频 (1).mp4'])

    expect(result).toMatchObject({ added: 2, duplicates: 0 })
    const { entries } = store.getState()
    expect(entries.map((e) => e.name)).toEqual(['a.mp4', '视频 (1).mp4'])
    expect(entries.every((e) => e.probe.status === 'loading' && e.thumb.status === 'loading')).toBe(
      true
    )
  })

  it('信息先到、缩略图后到:中间状态是 probe=ready + thumb=loading', async () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    const { settled } = store.getState().addPaths([A])

    h.probes.get(A)!({ ok: true, info: info(7) })
    await flush()
    const mid = store.getState().entries[0]!
    expect(mid.probe).toEqual({ status: 'ready', info: info(7) })
    expect(mid.thumb.status).toBe('loading')

    h.thumbs.get(A)!(thumb)
    await settled
    expect(store.getState().entries[0]!.thumb).toEqual({ status: 'ready', thumbnail: thumb })
  })

  it('所有文件的探测请求同时发出,而不是一个等一个(并发限制在主进程做)', () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    store.getState().addPaths([A, B, C])
    expect(h.probeCalls).toEqual([A, B, C])
  })

  it('探测失败:进入 error 状态保留人话提示,并且不会去请求缩略图', async () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    const { settled } = store.getState().addPaths([A])
    const error = makeProbeError('CORRUPT', 'moov atom not found')
    h.probes.get(A)!({ ok: false, error })
    await settled

    const entry = store.getState().entries[0]!
    expect(entry.probe).toEqual({ status: 'error', error })
    expect(entry.thumb).toEqual({ status: 'none' })
    expect(h.thumbCalls).toEqual([])
  })

  it('IPC 调用本身抛异常:变成人话的 UNKNOWN 错误,不暴露原始异常文本为主提示', async () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    const { settled } = store.getState().addPaths([A])
    h.probes.get(A)!(new Error('Error invoking remote method: at Object.<anonymous> (x.js:1:1)'))
    await settled

    const probe = store.getState().entries[0]!.probe
    expect(probe.status).toBe('error')
    if (probe.status === 'error') {
      expect(probe.error.code).toBe('UNKNOWN')
      expect(probe.error.message).toBe(makeProbeError('UNKNOWN').message)
      expect(probe.error.message).not.toMatch(/Error|at |\.js/)
      // 原始文本仅作为"技术细节"保留
      expect(probe.error.detail).toContain('Error invoking')
    }
  })

  it('缩略图请求失败:信息仍然保留,只是没有缩略图', async () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    const { settled } = store.getState().addPaths([A])
    h.probes.get(A)!({ ok: true, info: info() })
    await flush()
    h.thumbs.get(A)!(new Error('boom'))
    await settled

    const entry = store.getState().entries[0]!
    expect(entry.probe.status).toBe('ready')
    expect(entry.thumb).toEqual({ status: 'none' })
  })

  it('一个文件失败不影响其他文件', async () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    const { settled } = store.getState().addPaths([A, B])
    h.probes.get(A)!({ ok: false, error: makeProbeError('EMPTY_FILE') })
    h.probes.get(B)!({ ok: true, info: info() })
    await flush()
    h.thumbs.get(B)!(thumb)
    await settled

    const [a, b] = store.getState().entries
    expect(a!.probe.status).toBe('error')
    expect(b!.probe.status).toBe('ready')
    expect(b!.thumb.status).toBe('ready')
  })
})

describe('addPaths · 去重', () => {
  it('同一批里重复的路径只添加一次', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    const result = store.getState().addPaths([A, A, B])
    expect(result).toMatchObject({ added: 2, duplicates: 1 })
    expect(store.getState().entries).toHaveLength(2)
  })

  it('已在列表里的文件再次导入会被跳过,并且不再发探测请求', () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    store.getState().addPaths([A])
    const again = store.getState().addPaths([A, B])
    expect(again).toMatchObject({ added: 1, duplicates: 1 })
    expect(h.probeCalls).toEqual([A, B])
  })

  it('Windows 路径大小写/斜杠不同也算重复', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    store.getState().addPaths(['C:\\Videos\\A.mp4'])
    expect(store.getState().addPaths(['c:/videos/a.MP4']).duplicates).toBe(1)
  })

  it('POSIX 路径区分大小写', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    store.getState().addPaths(['/home/A.mp4'])
    expect(store.getState().addPaths(['/home/a.mp4']).added).toBe(1)
  })

  it('空数组什么都不做,settled 立即完成', async () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    const result = store.getState().addPaths([])
    expect(result).toMatchObject({ added: 0, duplicates: 0 })
    await result.settled
    expect(store.getState().entries).toEqual([])
  })

  it('条目 id 唯一,移除后再添加也不会复用', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    store.getState().addPaths([A, B])
    const firstIds = store.getState().entries.map((e) => e.id)
    store.getState().remove(firstIds[0]!)
    store.getState().addPaths([C])
    const ids = store.getState().entries.map((e) => e.id)
    expect(new Set([...firstIds, ...ids]).size).toBe(3)
  })
})

describe('select / remove / clear', () => {
  it('选中与取消选中', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    store.getState().addPaths([A])
    const id = store.getState().entries[0]!.id
    store.getState().select(id)
    expect(store.getState().selectedId).toBe(id)
    store.getState().select(null)
    expect(store.getState().selectedId).toBeNull()
  })

  it('移除:只移除目标条目;移除选中项会清掉选中,移除其他项不影响选中', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    store.getState().addPaths([A, B, C])
    const [a, b, c] = store.getState().entries
    store.getState().select(b!.id)

    store.getState().remove(c!.id)
    expect(store.getState().entries.map((e) => e.name)).toEqual(['a.mp4', 'b.mp4'])
    expect(store.getState().selectedId).toBe(b!.id)

    store.getState().remove(b!.id)
    expect(store.getState().selectedId).toBeNull()
    expect(store.getState().entries.map((e) => e.id)).toEqual([a!.id])
  })

  it('移除一个不存在的 id 不会出错', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    store.getState().addPaths([A])
    expect(() => store.getState().remove('nope')).not.toThrow()
    expect(store.getState().entries).toHaveLength(1)
  })

  it('加载途中被移除:后到的结果不会让它"复活",也不会报错', async () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    const { settled } = store.getState().addPaths([A])
    store.getState().remove(store.getState().entries[0]!.id)

    h.probes.get(A)!({ ok: true, info: info() })
    await flush()
    h.thumbs.get(A)!(thumb)
    await settled
    expect(store.getState().entries).toEqual([])
  })

  it('clear:清空列表与选中', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    store.getState().addPaths([A, B])
    store.getState().select(store.getState().entries[0]!.id)
    store.getState().clear()
    expect(store.getState()).toMatchObject({ entries: [], selectedId: null })
  })

  it('清空之后可以再次导入同一个文件', () => {
    const { api } = controllableApi()
    const store = createFilesStore(api)
    store.getState().addPaths([A])
    store.getState().clear()
    expect(store.getState().addPaths([A])).toMatchObject({ added: 1, duplicates: 0 })
  })
})

describe('订阅', () => {
  it('每次状态变化都会通知订阅者(界面据此重绘)', async () => {
    const h = controllableApi()
    const store = createFilesStore(h.api)
    const listener = vi.fn()
    store.subscribe(listener)
    const { settled } = store.getState().addPaths([A])
    const afterAdd = listener.mock.calls.length
    expect(afterAdd).toBeGreaterThan(0)
    h.probes.get(A)!({ ok: true, info: info() })
    await flush()
    h.thumbs.get(A)!(thumb)
    await settled
    expect(listener.mock.calls.length).toBeGreaterThan(afterAdd)
  })
})
