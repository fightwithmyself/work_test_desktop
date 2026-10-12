import { app, ipcMain } from 'electron'
import { IPC, type AppInfo } from '../../shared/ipc-channels'

export function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }))
}
