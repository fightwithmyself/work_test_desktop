// 生成 ffprobe 真实输出样本,保存到 tests/fixtures/ffprobe/*.json
// 用法: node scripts/gen-probe-fixtures.mjs
// 说明: 只提交 JSON 文本,生成过程中的媒体文件放在临时目录,不进入仓库。
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')
const ffprobe = require('@ffprobe-installer/ffprobe').path

// 与产品代码(core/probe-parser.ts 的 FFPROBE_JSON_ARGS)保持一致
const PROBE_ARGS = ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams']

const outDir = resolve('tests/fixtures/ffprobe')
mkdirSync(outDir, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'probe-fixtures-'))

const run = (args) => execFileSync(ffmpeg, ['-v', 'error', '-y', ...args], { stdio: 'inherit' })
const video = (rate = '25') => ['-f', 'lavfi', '-i', `testsrc=duration=3:size=640x360:rate=${rate}`]
const audio = (freq = 440) => ['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=3`]

/** 对媒体文件做 ffprobe,抹掉本机绝对路径后保存为样本 */
function save(name, mediaPath) {
  const json = JSON.parse(execFileSync(ffprobe, [...PROBE_ARGS, mediaPath], { encoding: 'utf8' }))
  if (json.format) json.format.filename = basename(mediaPath)
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(json, null, 2) + '\n')
  console.log(`saved ${name}.json`)
}

try {
  // 1 常规:H.264 + AAC
  const normal = join(work, 'normal.mp4')
  run([
    ...video(),
    ...audio(),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    normal
  ])
  save('mp4-h264-aac', normal)

  // 2 无音轨
  const noAudio = join(work, 'no-audio.mp4')
  run([...video(), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', noAudio])
  save('mp4-no-audio', noAudio)

  // 3 纯音频
  const mp3 = join(work, 'audio-only.mp3')
  run([...audio(), '-c:a', 'libmp3lame', '-b:a', '128k', mp3])
  save('mp3-audio-only', mp3)

  // 4 带封面图(attached_pic)的音频
  const cover = join(work, 'cover.png')
  run(['-f', 'lavfi', '-i', 'testsrc=size=300x300:rate=1', '-frames:v', '1', cover])
  const mp3Cover = join(work, 'cover-art.mp3')
  run([
    ...audio(),
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
    mp3Cover
  ])
  save('mp3-cover-art', mp3Cover)

  // 5 旋转元数据(display matrix,新式)
  const rotated = join(work, 'rotated.mp4')
  run(['-display_rotation:v:0', '90', '-i', normal, '-c', 'copy', rotated])
  save('mp4-rotated-display-matrix', rotated)

  // 6 MKV:两条音轨(带语言和标题),时长在 tags 里
  const mkv = join(work, 'multi-audio.mkv')
  run([
    ...video(),
    ...audio(440),
    ...audio(880),
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-metadata:s:a:0',
    'language=eng',
    '-metadata:s:a:0',
    'title=English',
    '-metadata:s:a:1',
    'language=zho',
    '-metadata:s:a:1',
    'title=国语',
    '-shortest',
    mkv
  ])
  save('mkv-multi-audio', mkv)

  // 7 WebM
  const webm = join(work, 'vp9.webm')
  run([
    ...video(),
    ...audio(),
    '-c:v',
    'libvpx-vp9',
    '-crf',
    '40',
    '-b:v',
    '0',
    '-c:a',
    'libopus',
    '-shortest',
    webm
  ])
  save('webm-vp9-opus', webm)

  // 8 GIF
  const gif = join(work, 'anim.gif')
  run([...video('10'), '-t', '2', gif])
  save('gif-animated', gif)

  // 9 NTSC 帧率 30000/1001
  const ntsc = join(work, 'ntsc.mp4')
  run([...video('30000/1001'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', ntsc])
  save('mp4-ntsc-2997', ntsc)

  // 10 带字幕轨
  const srt = join(work, 'sub.srt')
  writeFileSync(srt, '1\n00:00:00,500 --> 00:00:02,000\nhello\n')
  const withSub = join(work, 'with-sub.mp4')
  run([
    ...video(),
    '-i',
    srt,
    '-map',
    '0:v',
    '-map',
    '1:s',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:s',
    'mov_text',
    withSub
  ])
  save('mp4-with-subtitle', withSub)

  // 11 片段化 MP4(常见于录屏/流媒体,容器可能没有总时长)
  const frag = join(work, 'fragmented.mp4')
  run([
    ...video(),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    'frag_keyframe+empty_moov',
    frag
  ])
  save('mp4-fragmented', frag)

  // 12 裸 H.264 码流(没有容器,没有时长信息)
  const raw = join(work, 'raw.h264')
  run([...video(), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-f', 'h264', raw])
  save('h264-raw-stream', raw)
} finally {
  rmSync(work, { recursive: true, force: true })
}
