// 用 ffmpeg 的 lavfi 虚拟输入生成集成测试要用的媒体文件,输出到 tests/fixtures/generated(已在 .gitignore)。
//
// 用法:
//   node scripts/make-fixtures.ts          (Node 24 原生支持直接运行 .ts,无需额外工具)
//   也会在集成测试启动前由 tests/integration/global-setup.ts 自动调用
//
// 只用 Node 内置模块 + ffmpeg-static,保持它能被 Node 直接运行。
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** 夹具内容变化时递增,旧的生成目录会被自动清掉重建。 */
export const FIXTURE_VERSION = 2

export interface Fixtures {
  dir: string
  // ---- 正常媒体 ----
  /** 640x360, 25fps, 3 秒, H.264 + AAC */
  normal: string
  /** 只有视频流 */
  noAudio: string
  /** 真正的竖屏:360x640 像素 */
  portrait: string
  /** 640x360 存储,带旋转元数据,显示为竖屏 360x640 */
  rotated: string
  /** 0.3 秒,极短 */
  tiny: string
  /** 10 秒:0-0.5s 红, 0.5-5s 绿, 5-10s 蓝,用来验证"取的是 10% 处那一帧" */
  colorBands: string
  audioOnly: string
  /** 带专辑封面的 mp3 */
  coverArt: string
  // ---- 特殊路径(内容与 normal 相同)----
  chinesePath: string
  specialChars: string
  // ---- 异常文件 ----
  /** 64KB 随机字节,扩展名 .mp4 */
  corruptRandom: string
  /** 正常 mp4 被截掉后半部分(缺 moov) */
  truncated: string
  /** 0 字节 .mp4 */
  empty: string
  /** 普通文本文件 .txt */
  textFile: string
  /** 文本内容但扩展名是 .mp4 */
  textAsMp4: string
  /** 一张 PNG 图片 */
  picture: string
  /** 名字叫 xxx.mp4 的文件夹 */
  directoryNamedMp4: string
  /** 不存在的文件 */
  missing: string
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const generatedDir = join(projectRoot, 'tests', 'fixtures', 'generated')

/** 只计算路径,不生成文件。 */
export function getFixtures(): Fixtures {
  const d = generatedDir
  return {
    dir: d,
    normal: join(d, 'normal.mp4'),
    noAudio: join(d, 'no-audio.mp4'),
    portrait: join(d, 'portrait.mp4'),
    rotated: join(d, 'rotated.mp4'),
    tiny: join(d, 'tiny.mp4'),
    colorBands: join(d, 'color-bands.mp4'),
    audioOnly: join(d, 'audio-only.mp3'),
    coverArt: join(d, 'cover-art.mp3'),
    chinesePath: join(d, '中文 目录 with space', '视频 样本 (1).mp4'),
    specialChars: join(d, "special 'dir' [x] 100%", "a'b [c] 50% & more.mp4"),
    corruptRandom: join(d, 'corrupt-random.mp4'),
    truncated: join(d, 'truncated.mp4'),
    empty: join(d, 'empty.mp4'),
    textFile: join(d, 'notes.txt'),
    textAsMp4: join(d, 'fake-video.mp4'),
    picture: join(d, 'picture.png'),
    directoryNamedMp4: join(d, 'folder.mp4'),
    missing: join(d, 'does-not-exist.mp4')
  }
}

const require = createRequire(import.meta.url)
const ffmpegPath = require('ffmpeg-static') as string

function ff(args: string[]): void {
  try {
    execFileSync(ffmpegPath, ['-v', 'error', '-nostdin', '-y', ...args], { stdio: 'pipe' })
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err)
    throw new Error(`ffmpeg 生成夹具失败: ${args.join(' ')}\n${stderr}`, { cause: err })
  }
}

const testsrc = (size: string, seconds: number, rate = 25): string[] => [
  '-f',
  'lavfi',
  '-i',
  `testsrc=duration=${seconds}:size=${size}:rate=${rate}`
]
const sine = (seconds: number, freq = 440): string[] => [
  '-f',
  'lavfi',
  '-i',
  `sine=frequency=${freq}:duration=${seconds}`
]
const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']

/** 确定性的"随机"字节(固定种子),保证每次生成的损坏文件完全一致。 */
function pseudoRandomBytes(length: number, seed = 12345): Buffer {
  const out = Buffer.alloc(length)
  let state = seed
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    out[i] = state >>> 24
  }
  // 保证文件头不会碰巧像某种容器(避免测试不稳定)
  out[0] = 0x00
  out[1] = 0x01
  out[2] = 0x02
  out[3] = 0x03
  return out
}

/** 生成全部夹具并返回路径。已是最新版本则直接复用。 */
export function ensureFixtures(): Fixtures {
  const f = getFixtures()
  const stamp = join(f.dir, '.version')
  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === String(FIXTURE_VERSION)) {
    return f
  }

  rmSync(f.dir, { recursive: true, force: true })
  mkdirSync(f.dir, { recursive: true })

  // ---- 正常媒体 ----
  ff([...testsrc('640x360', 3), ...sine(3), ...h264, '-c:a', 'aac', '-shortest', f.normal])
  ff([...testsrc('640x360', 3), ...h264, f.noAudio])
  ff([...testsrc('360x640', 2), ...h264, f.portrait])
  ff(['-display_rotation:v:0', '90', '-i', f.normal, '-c', 'copy', f.rotated])
  ff([...testsrc('320x180', 0.3), ...h264, f.tiny])
  ff([
    '-filter_complex',
    'color=c=red:s=320x180:r=25:d=0.5[a];color=c=green:s=320x180:r=25:d=4.5[b];' +
      'color=c=blue:s=320x180:r=25:d=5[c];[a][b][c]concat=n=3:v=1:a=0',
    ...h264,
    f.colorBands
  ])
  ff([...sine(3), '-c:a', 'libmp3lame', '-b:a', '128k', f.audioOnly])

  const cover = join(f.dir, 'cover-source.png')
  ff(['-f', 'lavfi', '-i', 'testsrc=size=300x300:rate=1', '-frames:v', '1', cover])
  ff([
    ...sine(3),
    '-i',
    cover,
    '-map',
    '0:a',
    '-map',
    '1:v',
    '-c:a',
    'libmp3lame',
    '-c:v',
    'mjpeg',
    '-id3v2_version',
    '3',
    '-disposition:v:0',
    'attached_pic',
    f.coverArt
  ])
  ff(['-f', 'lavfi', '-i', 'testsrc=size=200x100:rate=1', '-frames:v', '1', f.picture])

  // ---- 特殊路径:内容复制 normal,这样"路径有问题"和"内容有问题"不会混在一起 ----
  for (const target of [f.chinesePath, f.specialChars]) {
    mkdirSync(join(target, '..'), { recursive: true })
    copyFileSync(f.normal, target)
  }

  // ---- 异常文件 ----
  writeFileSync(f.corruptRandom, pseudoRandomBytes(64 * 1024))
  const whole = readFileSync(f.normal)
  writeFileSync(f.truncated, whole.subarray(0, Math.floor(whole.length * 0.35)))
  writeFileSync(f.empty, '')
  writeFileSync(f.textFile, 'this is just a text note, not a video.\n')
  writeFileSync(f.textAsMp4, 'this is just a text note, not a video.\n')
  mkdirSync(f.directoryNamedMp4, { recursive: true })

  writeFileSync(stamp, String(FIXTURE_VERSION))
  return f
}

// 作为脚本直接运行时:生成并打印结果
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const started = Date.now()
  const fixtures = ensureFixtures()
  const size = (p: string): string =>
    existsSync(p) && statSync(p).isFile() ? `${statSync(p).size} B` : '—'
  for (const [name, path] of Object.entries(fixtures)) {
    if (name !== 'dir') console.log(`${name.padEnd(18)} ${size(path).padStart(10)}  ${path}`)
  }
  console.log(`\n夹具目录: ${fixtures.dir}  (${Date.now() - started} ms)`)
}
