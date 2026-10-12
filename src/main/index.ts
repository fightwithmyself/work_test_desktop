import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc/register'
import { applySecurityPolicy } from './security'
import { createMainWindow } from './window'

let mainWindow: BrowserWindow | null = null

// 单实例:第二次启动时不开新窗口,而是唤起已有窗口
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  applySecurityPolicy()

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    registerIpc()
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
