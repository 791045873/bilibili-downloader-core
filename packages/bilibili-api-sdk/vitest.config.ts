import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      exclude: [
        'src/index.ts', // 纯 re-export 桶文件，无逻辑
        'vitest.config.ts',
        'tests/**',
        'dist/**',
        'node_modules/**',
      ],
      thresholds: {
        statements: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
})
