import { open, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { classifyReadFailure, isStillImageFormat, makeProbeError } from '../../core/probe-errors'
import { FFPROBE_JSON_ARGS, parseProbeOutput } from '../../core/probe-parser'
import type { ProbeResult } from '../../shared/types'
import { runProcess, SpawnError } from './process-runner'

export interface ProbeDeps {
  ffprobePath: string
  /** 单次探测的超时,默认 20 秒(网络盘、移动硬盘可能很慢) */
  timeoutMs?: number
}

const HEADER_BYTES = 512

async function readHeader(path: string): Promise<Uint8Array | null> {
  let handle
  try {
    handle = await open(path, 'r')
    const buffer = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

/**
 * 探测一个媒体文件,返回 VideoInfo 或"结构化错误"(永远不抛异常)。
 *
 * 先用文件系统做廉价检查(不存在 / 是目录 / 空文件 / 无权限),通过后才启动 ffprobe,
 * 这样每种失败都能给用户一个准确的说法,而不是统一的"读取失败"。
 */
export async function probeFile(filePath: string, deps: ProbeDeps): Promise<ProbeResult> {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) {
    return { ok: false, error: makeProbeError('INVALID_PATH') }
  }

  // ---- 1. 文件系统检查 ----
  let size: number
  try {
    const info = await stat(filePath)
    if (info.isDirectory()) return { ok: false, error: makeProbeError('NOT_A_FILE') }
    if (!info.isFile()) return { ok: false, error: makeProbeError('NOT_A_FILE') }
    size = info.size
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return { ok: false, error: makeProbeError('FILE_NOT_FOUND') }
    if (code === 'EACCES' || code === 'EPERM')
      return { ok: false, error: makeProbeError('NO_PERMISSION') }
    return { ok: false, error: makeProbeError('UNKNOWN', String(err)) }
  }
  if (size === 0) return { ok: false, error: makeProbeError('EMPTY_FILE') }

  const header = await readHeader(filePath)
  if (header === null) return { ok: false, error: makeProbeError('NO_PERMISSION') }

  // ---- 2. 运行 ffprobe ----
  let run
  try {
    run = await runProcess(deps.ffprobePath, [...FFPROBE_JSON_ARGS, filePath], {
      timeoutMs: deps.timeoutMs ?? 20_000
    }).result
  } catch (err) {
    const detail = err instanceof SpawnError ? err.message : String(err)
    return { ok: false, error: makeProbeError('FFPROBE_UNAVAILABLE', detail) }
  }

  if (run.timedOut) return { ok: false, error: makeProbeError('TIMEOUT') }

  const evidence = { filePath, stderr: run.stderr, header }
  if (run.exitCode !== 0) return { ok: false, error: classifyReadFailure(evidence) }

  // ---- 3. 解析并判断"这是不是视频/音频" ----
  let json: unknown
  try {
    json = JSON.parse(run.stdout)
  } catch {
    return {
      ok: false,
      error: makeProbeError('UNKNOWN', `ffprobe 输出无法解析:${run.stdout.slice(0, 200)}`)
    }
  }

  const info = parseProbeOutput(json)
  if (!info.hasVideo && !info.hasAudio) {
    return { ok: false, error: classifyReadFailure(evidence) }
  }
  // 单张图片(png/jpg)ffprobe 也读得出来,但它不是用户要转换的视频
  if (info.hasVideo && !info.hasAudio && isStillImageFormat(info.formatName)) {
    return {
      ok: false,
      error: { ...makeProbeError('NOT_MEDIA'), message: '这是一张图片,不是视频。' }
    }
  }

  return { ok: true, info }
}
