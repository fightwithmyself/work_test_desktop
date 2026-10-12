/**
 * 从路径里取文件名,同时兼容 Windows(\ 和 /)与 POSIX 路径。
 * 末尾多余的分隔符会被忽略;取不到时退回原字符串。
 */
export function fileNameFromPath(filePath: string): string {
  const parts = filePath.split(/[\\/]+/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? filePath
}

const WINDOWS_STYLE = /^(?:[a-zA-Z]:[\\/]|\\\\)/

/**
 * 用于"是不是同一个文件"的比较键。
 * Windows 路径不区分大小写、两种斜杠等价:`C:/A/b.mp4` 与 `c:\a\B.mp4` 是同一个文件,
 * 不应该被当成两个文件重复导入。POSIX 路径区分大小写,保持原样。
 */
export function pathKey(filePath: string): string {
  return WINDOWS_STYLE.test(filePath) ? filePath.replace(/\//g, '\\').toLowerCase() : filePath
}
