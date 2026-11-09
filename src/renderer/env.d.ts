import type { LittleBirdApi } from '../shared/api'

declare global {
  /** package.json version, injected at build time. */
  const __APP_VERSION__: string
  interface Window {
    /** Present when running inside Electron; undefined when the renderer is opened in a plain browser. */
    littlebird?: LittleBirdApi
  }
}
