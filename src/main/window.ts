import { join } from 'node:path'
import { BrowserWindow } from 'electron'

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false, // 等首帧渲染完再显示,避免白屏闪烁
    title: 'VideoConverter',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => win.show())

  // electron-vite 在开发模式下注入 ELECTRON_RENDERER_URL;生产环境加载打包后的本地文件
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
