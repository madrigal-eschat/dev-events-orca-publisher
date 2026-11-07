import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // Only the Orca entry adapter is excluded; this scaffold has no UI source.
      exclude: ['src/worker.ts', 'src/**/*.test.ts']
    }
  }
})
