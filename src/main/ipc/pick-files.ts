import { BrowserWindow, dialog } from 'electron'

/** 对话框里默认显示的视频扩展名;"所有文件"过滤器兜底,不会把用户拦住 */
const VIDEO_EXTENSIONS = [
  'mp4',
  'm4v',
  'mov',
  'mkv',
  'webm',
  'avi',
  'flv',
  'wmv',
  'ts',
  'm2ts',
  'mts',
  'mpg',
  'mpeg',
  'vob',
  '3gp',
  'ogv',
  'rmvb'
]

/** 弹出系统"打开文件"对话框(多选)。用户取消返回空数组。 */
export async function pickFiles(sender: Electron.WebContents): Promise<string[]> {
  const parent = BrowserWindow.fromWebContents(sender) ?? undefined
  const options: Electron.OpenDialogOptions = {
    title: '选择要转换的视频',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '视频文件', extensions: VIDEO_EXTENSIONS },
      { name: '所有文件', extensions: ['*'] }
    ]
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : result.filePaths
}
