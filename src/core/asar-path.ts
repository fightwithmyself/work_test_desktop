/**
 * Electron 打包后,node_modules 里的文件位于 app.asar 这个归档里,但归档里的可执行文件
 * 无法被 spawn。electron-builder 的 asarUnpack 会把它们解包到旁边的 app.asar.unpacked 目录,
 * 所以执行前必须把路径里的 "app.asar" 换成 "app.asar.unpacked"(风险 R-04)。
 *
 * 已经是 unpacked 路径、或者根本不在 asar 里(开发环境)时原样返回。
 */
export function toUnpackedPath(filePath: string): string {
  return filePath.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
}
