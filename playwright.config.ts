import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1, // Electron 应用有单实例锁,不能并行
  reporter: 'list',
  outputDir: 'test-results'
})
