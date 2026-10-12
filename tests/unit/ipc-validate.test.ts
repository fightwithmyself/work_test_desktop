import nodePath from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTrustedSenderUrl, validatePathRequest } from '../../src/main/ipc/validate'

const win = nodePath.win32
const posix = nodePath.posix

describe('validatePathRequest · 合法载荷', () => {
  it.each([
    ['盘符路径', 'C:\\videos\\a.mp4', 'C:\\videos\\a.mp4'],
    ['正斜杠写法会被规范化', 'C:/videos/a.mp4', 'C:\\videos\\a.mp4'],
    [
      '含中文和空格',
      'D:\\中文 目录 with space\\视频 样本 (1).mp4',
      'D:\\中文 目录 with space\\视频 样本 (1).mp4'
    ],
    ['.. 段会被规范化掉', 'C:\\a\\..\\b.mp4', 'C:\\b.mp4'],
    ['UNC 网络路径', '\\\\nas\\share\\a.mp4', '\\\\nas\\share\\a.mp4'],
    ['\\\\?\\ 长路径前缀', '\\\\?\\C:\\very\\long\\a.mp4', '\\\\?\\C:\\very\\long\\a.mp4']
  ])('Windows · %s', (_name, input, expected) => {
    expect(validatePathRequest({ path: input }, win)).toEqual({
      ok: true,
      value: { path: expected }
    })
  })

  it('POSIX 绝对路径', () => {
    expect(validatePathRequest({ path: '/home/me/a.mp4' }, posix)).toEqual({
      ok: true,
      value: { path: '/home/me/a.mp4' }
    })
  })

  it('多余字段被忽略,返回值里只有 path', () => {
    const result = validatePathRequest({ path: 'C:\\a.mp4', evil: 'x', __proto__: { y: 1 } }, win)
    expect(result).toEqual({ ok: true, value: { path: 'C:\\a.mp4' } })
  })
})

describe('validatePathRequest · 非法载荷一律拒绝', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['字符串而不是对象', 'C:\\a.mp4'],
    ['数字', 42],
    ['数组', ['C:\\a.mp4']],
    ['空对象', {}],
    ['path 是数字', { path: 42 }],
    ['path 是 null', { path: null }],
    ['path 是数组', { path: ['C:\\a.mp4'] }],
    ['path 是对象', { path: { toString: () => 'C:\\a.mp4' } }],
    ['path 为空字符串', { path: '' }]
  ])('%s', (_name, payload) => {
    const result = validatePathRequest(payload, win)
    expect(result.ok).toBe(false)
  })

  it.each([
    ['纯文件名', 'a.mp4'],
    ['./ 相对', '.\\a.mp4'],
    ['../ 相对', '..\\a.mp4'],
    ['带子目录的相对路径', 'videos\\a.mp4'],
    ['盘符相对(C:a.mp4)', 'C:a.mp4'],
    ['只有根没有盘符', '\\a.mp4'],
    ['只有根没有盘符(正斜杠)', '/a.mp4']
  ])('Windows 相对/不明确的路径:%s', (_name, input) => {
    const result = validatePathRequest({ path: input }, win)
    expect(result.ok).toBe(false)
  })

  it('POSIX 相对路径被拒绝', () => {
    expect(validatePathRequest({ path: 'a.mp4' }, posix).ok).toBe(false)
    expect(validatePathRequest({ path: '../a.mp4' }, posix).ok).toBe(false)
  })

  it('含空字符的路径被拒绝(空字符截断是经典的路径校验绕过手法)', () => {
    expect(validatePathRequest({ path: 'C:\\a.mp4\0.txt' }, win).ok).toBe(false)
  })

  it('Windows 设备路径被拒绝', () => {
    expect(validatePathRequest({ path: '\\\\.\\COM1' }, win).ok).toBe(false)
    expect(validatePathRequest({ path: '\\\\.\\pipe\\x' }, win).ok).toBe(false)
    expect(validatePathRequest({ path: '//./COM1' }, win).ok).toBe(false)
  })

  it('超长路径被拒绝,刚好在上限内的放行', () => {
    const prefix = 'C:\\'
    const ok = prefix + 'a'.repeat(32_767 - prefix.length)
    expect(validatePathRequest({ path: ok }, win).ok).toBe(true)
    expect(validatePathRequest({ path: ok + 'a' }, win).ok).toBe(false)
  })

  it('拒绝时给出原因,方便日志排查', () => {
    const result = validatePathRequest({ path: 'a.mp4' }, win)
    expect(result).toEqual({ ok: false, reason: expect.stringContaining('绝对路径') })
  })
})

describe('isTrustedSenderUrl', () => {
  const dev = 'http://localhost:5173/'

  it('打包后的 file:// 页面可信', () => {
    expect(isTrustedSenderUrl('file:///F:/app/out/renderer/index.html', undefined)).toBe(true)
  })

  it('开发服务器同源页面可信', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/', dev)).toBe(true)
    expect(isTrustedSenderUrl('http://localhost:5173/#/x?y=1', dev)).toBe(true)
  })

  it('开发服务器的不同端口/不同主机不可信', () => {
    expect(isTrustedSenderUrl('http://localhost:5174/', dev)).toBe(false)
    expect(isTrustedSenderUrl('http://evil.com:5173/', dev)).toBe(false)
    expect(isTrustedSenderUrl('http://localhost.evil.com:5173/', dev)).toBe(false)
  })

  it('生产环境(没有 dev 地址)下,任何 http(s) 页面都不可信', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/', undefined)).toBe(false)
    expect(isTrustedSenderUrl('https://example.com/', undefined)).toBe(false)
  })

  it('空地址、无法解析的地址不可信', () => {
    expect(isTrustedSenderUrl(undefined, dev)).toBe(false)
    expect(isTrustedSenderUrl('', dev)).toBe(false)
    expect(isTrustedSenderUrl('not a url', dev)).toBe(false)
    expect(isTrustedSenderUrl('http://localhost:5173/', 'not a url')).toBe(false)
  })

  it('about:blank、data: 等不可信', () => {
    expect(isTrustedSenderUrl('about:blank', dev)).toBe(false)
    expect(isTrustedSenderUrl('data:text/html,hi', dev)).toBe(false)
  })
})
