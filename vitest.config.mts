import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': resolve('src/renderer') },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
