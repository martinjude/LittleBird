/** API the preload script exposes to the renderer as `window.littlebird`. */
export interface LittleBirdApi {
  platform: string
  settings: {
    /** Returns the raw saved settings JSON, or null if none exist yet. */
    load(): Promise<unknown>
    save(settings: unknown): Promise<void>
  }
  app: {
    quit(): void
    toggleFullscreen(): void
  }
}

export const IPC = {
  settingsLoad: 'settings:load',
  settingsSave: 'settings:save',
  appQuit: 'app:quit',
  toggleFullscreen: 'window:toggle-fullscreen',
} as const
