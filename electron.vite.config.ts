import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // Runtime (optimised) assets are served from /public; source masters stay in /assets/source.
    publicDir: resolve('public'),
    resolve: {
      alias: { '@': resolve('src/renderer') },
    },
  },
})
