import nodePath from 'node:path'
import type { PathRequest } from '../../shared/ipc-channels'

/**
 * IPC 载荷校验。渲染进程是"不可信"的(哪怕是我们自己的页面,也可能被注入脚本),
 * 所以主进程对每一个收到的载荷都按"未知输入"处理,不依赖 TypeScript 类型。
 */

export type Validated<T> = { ok: true; value: T } | { ok: false; reason: string }

/** Windows 的路径上限是 32767 个 UTF-16 单元 */
const MAX_PATH_LENGTH = 32_767

export type PathApi = Pick<typeof nodePath, 'isAbsolute' | 'normalize' | 'sep'>

/**
 * 校验"针对某个文件"的请求:形如 { path: string },且 path 是绝对路径。
 *
 * 只检查"形状"和"路径写法"。路径是否存在由服务层负责并以结构化错误
 * (FILE_NOT_FOUND 等)返回给界面——那样用户看到的是"找不到这个文件,可能已被移动或删除",
 * 而不是一个被丢弃的请求。
 */
export function validatePathRequest(
  payload: unknown,
  pathApi: PathApi = nodePath
): Validated<PathRequest> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, reason: '载荷必须是对象' }
  }
  const raw = (payload as Record<string, unknown>)['path']
  if (typeof raw !== 'string') return { ok: false, reason: 'path 必须是字符串' }
  if (raw.length === 0) return { ok: false, reason: 'path 不能为空' }
  if (raw.length > MAX_PATH_LENGTH) return { ok: false, reason: 'path 过长' }
  if (raw.includes('\0')) return { ok: false, reason: 'path 含有空字符' }
  // Windows 设备路径(\\.\COM1、\\.\pipe\xxx)不是文件,拒绝;\\?\ 长路径前缀是合法的,放行
  if (/^[\\/]{2}\.[\\/]/.test(raw)) return { ok: false, reason: '不支持设备路径' }
  if (!pathApi.isAbsolute(raw)) return { ok: false, reason: 'path 必须是绝对路径' }
  // Windows 下 `\a.mp4` 会被 isAbsolute 判为绝对路径,但它指向"当前盘符"的根目录,
  // 含义取决于进程状态,不可靠,拒绝
  if (pathApi.sep === '\\' && /^[\\/](?![\\/])/.test(raw)) {
    return { ok: false, reason: 'path 缺少盘符' }
  }
  return { ok: true, value: { path: pathApi.normalize(raw) } }
}

/**
 * 只接受来自我们自己页面的调用:
 * - 打包后页面是 file:// 协议
 * - 开发时是 electron-vite 的 dev server 地址
 * 其他来源(比如被导航走之后的外部页面、子 frame)一律拒绝。
 */
export function isTrustedSenderUrl(url: string | undefined, devUrl: string | undefined): boolean {
  if (!url) return false
  if (url.startsWith('file://')) return true
  if (devUrl) {
    try {
      return new URL(url).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return false
}
