import { app, ipcMain } from 'electron'
import { makeProbeError } from '../../core/probe-errors'
import { placeholderDataUrl } from '../../core/thumbnail'
import { IPC, type AppInfo, type IpcChannel, type IpcResponse } from '../../shared/ipc-channels'
import type { ProbeResult, Thumbnail } from '../../shared/types'
import { createMediaService, type MediaService } from '../services/media-service'
import { pickFiles } from './pick-files'
import { isTrustedSenderUrl, validatePathRequest } from './validate'

type Handler<K extends IpcChannel> = (
  payload: unknown,
  sender: Electron.WebContents
) => Promise<IpcResponse<K>> | IpcResponse<K>

/**
 * 类型化的 ipcMain.handle:
 * - 通道名与返回值类型受 IpcContract 约束
 * - 统一做"发送方是否可信"检查
 * - 载荷以 unknown 传入,强制每个 handler 自己校验
 * - 兜底 try/catch:handler 出意外也只返回 fallback,不把堆栈抛给渲染层
 */
function handle<K extends IpcChannel>(
  channel: K,
  fallback: () => IpcResponse<K>,
  handler: Handler<K>
): void {
  ipcMain.handle(channel, async (event, payload: unknown) => {
    if (!isTrustedSenderUrl(event.senderFrame?.url, process.env['ELECTRON_RENDERER_URL'])) {
      console.warn(`[ipc] 拒绝来自不可信页面的调用: ${channel} <- ${event.senderFrame?.url}`)
      return fallback()
    }
    try {
      return await handler(payload, event.sender)
    } catch (err) {
      console.error(`[ipc] ${channel} 处理失败:`, err)
      return fallback()
    }
  })
}

const invalidProbe = (): ProbeResult => ({ ok: false, error: makeProbeError('INVALID_PATH') })
const invalidThumbnail = (): Thumbnail => ({
  kind: 'placeholder',
  dataUrl: placeholderDataUrl('video'),
  timestampSec: null,
  reason: 'extract-failed'
})

export function registerIpc(media: MediaService = createMediaService()): void {
  handle(
    IPC.appInfo,
    () => ({ name: '', version: '', electron: '', chrome: '', node: '', platform: '' }),
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform
    })
  )

  handle(
    IPC.pickFiles,
    () => [],
    (_payload, sender) => pickFiles(sender)
  )

  handle(IPC.probe, invalidProbe, (payload) => {
    const checked = validatePathRequest(payload)
    return checked.ok ? media.probe(checked.value.path) : invalidProbe()
  })

  handle(IPC.thumbnail, invalidThumbnail, (payload) => {
    const checked = validatePathRequest(payload)
    return checked.ok ? media.thumbnail(checked.value.path) : invalidThumbnail()
  })
}
