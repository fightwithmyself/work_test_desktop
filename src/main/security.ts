import { app, session } from 'electron'

/**
 * 全局安全策略,对"所有" webContents 生效(包括以后新建的),作为纵深防御:
 * - 拒绝任何导航(will-navigate / will-redirect)
 * - 拒绝 window.open / target=_blank
 * - 禁止 <webview>
 * - 拒绝所有权限请求(摄像头、麦克风、地理位置等本应用都用不到)
 */
export function applySecurityPolicy(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => event.preventDefault())
    contents.on('will-redirect', (event) => event.preventDefault())
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  })

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false)
    )
    session.defaultSession.setPermissionCheckHandler(() => false)
  })
}
