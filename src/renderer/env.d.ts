import type { LittleBirdApi } from '../shared/api'

declare global {
  interface Window {
    /** Present when running inside Electron; undefined when the renderer is opened in a plain browser. */
    littlebird?: LittleBirdApi
  }
}
