import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { toUnpackedPath } from '../../core/asar-path'
import { runProcess, SpawnError } from './process-runner'

export type BinaryName = 'ffmpeg' | 'ffprobe'

export interface BinaryLocation {
  path: string
  /** custom:用户在设置里指定;bundled:随应用打包的 */
  source: 'custom' | 'bundled'
}

export interface LocatedBinaries {
  ffmpeg: BinaryLocation
  ffprobe: BinaryLocation
}

export type LocatorErrorCode = 'BINARY_NOT_FOUND' | 'BINARY_NOT_RUNNABLE'

export class LocatorError extends Error {
  readonly code: LocatorErrorCode
  readonly binary: BinaryName
  constructor(code: LocatorErrorCode, binary: BinaryName, message: string) {
    super(message)
    this.name = 'LocatorError'
    this.code = code
    this.binary = binary
  }
}

export interface LocateOptions {
  /** 设置里自定义的 ffmpeg 路径;空字符串/null/undefined 表示用内置 */
  customFfmpegPath?: string | null
  customFfprobePath?: string | null
  /** 测试用:替换"取内置路径"的方式 */
  resolveBundled?: () => { ffmpeg: string | null; ffprobe: string | null }
}

const exeName = (name: BinaryName): string => (process.platform === 'win32' ? `${name}.exe` : name)

/**
 * 默认的"内置二进制路径"来源:ffmpeg-static 与 @ffprobe-installer/ffprobe。
 * 用 createRequire(__filename):无论是开发环境、vitest,还是打包进 asar 后的主进程,
 * 都能从当前文件所在位置向上找到 node_modules。
 */
function defaultResolveBundled(): { ffmpeg: string | null; ffprobe: string | null } {
  const req = createRequire(__filename)
  const ffmpeg = req('ffmpeg-static') as string | null
  const ffprobe = (req('@ffprobe-installer/ffprobe') as { path?: string }).path ?? null
  return { ffmpeg, ffprobe }
}

function assertFile(path: string, binary: BinaryName, origin: string): string {
  let ok: boolean
  try {
    ok = existsSync(path) && statSync(path).isFile()
  } catch {
    ok = false
  }
  if (!ok) {
    throw new LocatorError('BINARY_NOT_FOUND', binary, `找不到${origin}的 ${binary}:${path}`)
  }
  return path
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/**
 * 确定要使用的 ffmpeg / ffprobe 可执行文件(同步,只检查文件存在,不运行它)。
 *
 * 优先级:
 * 1. 设置里自定义的路径
 * 2. 自定义了 ffmpeg 但没自定义 ffprobe:先找 ffmpeg 同目录下的 ffprobe(版本更可能匹配)
 * 3. 随应用内置的(打包后自动把 app.asar 换成 app.asar.unpacked)
 *
 * 自定义路径指向不存在的文件时抛错,而不是悄悄回退到内置版本 —— 用户明确指定了,
 * 就应该被告知它不对,而不是在不知情的情况下用了另一个版本。
 */
export function locateBinaries(options: LocateOptions = {}): LocatedBinaries {
  const customFfmpeg = clean(options.customFfmpegPath)
  const customFfprobe = clean(options.customFfprobePath)
  const bundled = (options.resolveBundled ?? defaultResolveBundled)()

  const locate = (
    name: BinaryName,
    custom: string | null,
    bundledPath: string | null
  ): BinaryLocation => {
    if (custom) return { path: assertFile(custom, name, '自定义路径中的'), source: 'custom' }

    if (name === 'ffprobe' && customFfmpeg) {
      const sibling = join(dirname(customFfmpeg), exeName('ffprobe'))
      if (existsSync(sibling)) return { path: sibling, source: 'custom' }
    }

    if (!bundledPath) {
      throw new LocatorError(
        'BINARY_NOT_FOUND',
        name,
        `当前平台没有内置的 ${name},请在设置中指定路径。`
      )
    }
    return { path: assertFile(toUnpackedPath(bundledPath), name, '内置的'), source: 'bundled' }
  }

  return {
    ffmpeg: locate('ffmpeg', customFfmpeg, bundled.ffmpeg),
    ffprobe: locate('ffprobe', customFfprobe, bundled.ffprobe)
  }
}

/**
 * 真正运行一次 `<binary> -version`,确认它是可用的 ffmpeg/ffprobe 并返回版本号。
 * 设置页保存自定义路径前、应用启动自检时使用。
 */
export async function verifyBinary(
  path: string,
  binary: BinaryName,
  timeoutMs = 8000
): Promise<{ version: string }> {
  try {
    const run = await runProcess(path, ['-version'], { timeoutMs }).result
    const match = new RegExp(`^${binary} version (\\S+)`, 'm').exec(run.stdout)
    if (run.exitCode !== 0 || !match?.[1]) {
      throw new LocatorError(
        'BINARY_NOT_RUNNABLE',
        binary,
        `${path} 不是可用的 ${binary}(没有得到正确的版本信息)。`
      )
    }
    return { version: match[1] }
  } catch (err) {
    if (err instanceof LocatorError) throw err
    const reason = err instanceof SpawnError ? err.message : String(err)
    throw new LocatorError('BINARY_NOT_RUNNABLE', binary, `无法运行 ${binary}:${reason}`)
  }
}
