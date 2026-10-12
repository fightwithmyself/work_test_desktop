import { describe, expect, it } from 'vitest'
import { buildCsp } from '../../src/shared/csp'

describe('buildCsp', () => {
  it('生产环境:脚本只允许同源,且不含 unsafe-inline / unsafe-eval', () => {
    const csp = buildCsp(false)
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrc).toBe("script-src 'self'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('生产环境:不允许连接任何外部地址', () => {
    const csp = buildCsp(false)
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toContain('ws://')
    expect(csp).not.toContain('http://')
  })

  it('开发环境:为 Vite HMR 放宽 script-src 与 connect-src', () => {
    const csp = buildCsp(true)
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain('ws://localhost:*')
  })

  it('任何环境都禁止插件、frame、base 与表单提交', () => {
    for (const isDev of [true, false]) {
      const csp = buildCsp(isDev)
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain("frame-src 'none'")
      expect(csp).toContain("base-uri 'none'")
      expect(csp).toContain("form-action 'none'")
    }
  })

  it('任何环境都不允许从远程加载图片/字体(只允许 self 和 data:)', () => {
    for (const isDev of [true, false]) {
      const csp = buildCsp(isDev)
      expect(csp).toContain("img-src 'self' data:")
      expect(csp).toContain("font-src 'self' data:")
    }
  })
})
