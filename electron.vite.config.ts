import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
    // Runtime (optimised) assets are served from /public; source masters stay in /assets/source.
    publicDir: resolve('public'),
    resolve: {
      alias: { '@': resolve('src/renderer') },
    },
  },
})
