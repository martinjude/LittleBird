import { Game } from './core/Game'
import { SettingsStore } from './core/SettingsStore'
import { loadKeyboardLayout } from './input/labels'

async function boot(): Promise<void> {
  const [settings, keyboardLayout] = await Promise.all([SettingsStore.load(), loadKeyboardLayout()])
  const game = new Game(document.getElementById('viewport')!, document.getElementById('hud')!, settings, keyboardLayout)

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault()
      game.toggleDebug()
    }
  })

  game.start()

  // Handy for poking at the scene from DevTools during development.
  if (import.meta.env.DEV) Object.assign(window, { game })
}

boot().catch((err) => {
  console.error(err)
  document.body.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`
})
