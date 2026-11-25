import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'src/panel.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // The component panel runs against the Orca host API in orca plugin test.
      exclude: ['src/**/*.test.ts', 'src/panel.ts']
    }
  }
})
