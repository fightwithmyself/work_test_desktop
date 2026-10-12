import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getFixtures } from '../../scripts/make-fixtures'
import { locateBinaries } from '../../src/main/services/ffmpeg-locator'
import { runProcess } from '../../src/main/services/process-runner'

export const fixtures = getFixtures()
export const bins = locateBinaries()
export const ffmpegPath = bins.ffmpeg.path
export const ffprobePath = bins.ffprobe.path

/** 读 JPEG 的宽高(解析 SOF 段),不需要图像库。 */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let i = 2 // 跳过 FFD8
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('不是合法的 JPEG 段')
    const marker = bytes[i + 1]!
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!
    // SOF0..SOF15(不含 DHT=C4、JPG=C8、DAC=CC)
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: (bytes[i + 5]! << 8) | bytes[i + 6]!,
        width: (bytes[i + 7]! << 8) | bytes[i + 8]!
      }
    }
    i += 2 + length
  }
  throw new Error('JPEG 里没找到尺寸信息')
}

export function dataUrlToBytes(dataUrl: string, mime: string): Buffer {
  const prefix = `data:${mime};base64,`
  if (!dataUrl.startsWith(prefix))
    throw new Error(`不是 ${mime} 的 data URL: ${dataUrl.slice(0, 40)}`)
  return Buffer.from(dataUrl.slice(prefix.length), 'base64')
}

/** 把一张 JPEG 缩成 1×1 像素,返回它的平均 RGB,用来判断"这一帧是红的还是绿的"。 */
export async function averageColor(jpeg: Uint8Array): Promise<{ r: number; g: number; b: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'vc-color-'))
  try {
    const file = join(dir, 'frame.jpg')
    writeFileSync(file, jpeg)
    const run = await runProcess(
      ffmpegPath,
      [
        '-v',
        'error',
        '-nostdin',
        '-i',
        file,
        '-vf',
        'scale=1:1',
        '-frames:v',
        '1',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1'
      ],
      { stdout: 'buffer' }
    ).result
    const px = run.stdoutBuffer!
    return { r: px[0]!, g: px[1]!, b: px[2]! }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 进程是否还活着(signal 0 只探测不发信号)。 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * 统计命令行里含有某个标记的 cmd.exe / ffmpeg.exe 进程数量(仅 Windows)。
 * 用独一无二的标记避免把别的程序(或其他测试里的 ffmpeg)算进来。
 */
export function countProcessesWithMarker(marker: string): Promise<number> {
  const script =
    `(Get-CimInstance Win32_Process -Filter "Name='cmd.exe' OR Name='ffmpeg.exe'" | ` +
    `Where-Object { $_.CommandLine -like '*${marker}*' } | Measure-Object).Count`
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
      (err, stdout) => {
        if (err) reject(err)
        else resolve(Number(stdout.trim()))
      }
    )
  })
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
