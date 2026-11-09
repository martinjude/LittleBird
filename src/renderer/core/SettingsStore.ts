import { mergeSettings, type Settings } from '../../shared/settings'

/** Loads settings through the preload bridge and saves changes (debounced). */
export class SettingsStore {
  private saveTimer: ReturnType<typeof setTimeout> | undefined

  private constructor(readonly value: Settings) {}

  static async load(): Promise<SettingsStore> {
    let raw: unknown = null
    try {
      raw = (await window.littlebird?.settings.load()) ?? null
    } catch (err) {
      console.warn('Could not load settings, using defaults', err)
    }
    return new SettingsStore(mergeSettings(raw))
  }

  /** Call after mutating `value`. */
  changed(): void {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      window.littlebird?.settings.save(this.value).catch((err) => console.warn('Could not save settings', err))
    }, 500)
  }
}
