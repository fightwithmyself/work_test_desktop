/**
 * 构建 Content-Security-Policy 字符串。
 *
 * - 生产环境:只允许加载本地资源,脚本不允许内联/eval。
 * - 开发环境:Vite 的 HMR 需要 websocket 与 React Refresh 的内联前导脚本,因此放宽 script-src/connect-src。
 * - style-src 保留 'unsafe-inline':Ant Design 的 CSS-in-JS 在运行时注入 <style> 标签。
 *   这只影响样式,不影响脚本执行,风险可接受。
 */
export function buildCsp(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': isDev ? ["'self'", "'unsafe-inline'"] : ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'font-src': ["'self'", 'data:'],
    'connect-src': isDev ? ["'self'", 'ws://localhost:*', 'http://localhost:*'] : ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
    // 注意:frame-ancestors 通过 <meta> 下发会被浏览器忽略并报警告,所以不在这里设置
    'frame-src': ["'none'"]
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}
