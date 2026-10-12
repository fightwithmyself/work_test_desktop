import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import { buildCsp } from './src/shared/csp'

/** 把 <!--CSP--> 占位符替换成 CSP meta:开发环境放宽(HMR),生产环境严格。 */
function cspPlugin(): Plugin {
  let isDev = false
  return {
    name: 'inject-csp',
    configResolved(config) {
      isDev = config.command === 'serve'
    },
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${buildCsp(isDev)}" />`
      return html.replace('<!--CSP-->', meta)
    }
  }
}

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@core': resolve(__dirname, 'src/core')
}

export default defineConfig({
  main: {
    resolve: { alias }
  },
  preload: {
    resolve: { alias }
  },
  renderer: {
    resolve: { alias: { ...alias, '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react(), cspPlugin()]
  }
})
