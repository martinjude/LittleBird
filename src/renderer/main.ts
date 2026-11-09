import { Game } from './core/Game'
import { SettingsStore } from './core/SettingsStore'
import { loadKeyboardLayout } from './input/labels'
import { loadRapier } from './physics/Physics'
import { GltfHeliModel } from './vehicles/GltfHeliModel'

const loading = document.getElementById('loading')!
const status = loading.querySelector('.status')!

/** Shows a loading step and lets the browser paint it before the next (blocking) step runs. */
async function step(text: string): Promise<void> {
  status.textContent = text
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
}

async function boot(): Promise<void> {
  await step('Loading physics, model and settings…')
  const [settings, keyboardLayout, rapier, heliModel] = await Promise.all([
    SettingsStore.load(),
    loadKeyboardLayout(),
    loadRapier(),
    // Built by `npm run model:littlebird`; fall back to the primitive placeholder if it's missing.
    GltfHeliModel.load('models/littlebird.glb').catch((err) => {
      console.warn('Could not load the Little Bird model, using the placeholder', err)
      return undefined
    }),
  ])

  await step('Generating the valley…')
  const game = new Game(
    document.getElementById('viewport')!,
    document.getElementById('hud')!,
    settings,
    keyboardLayout,
    rapier,
    heliModel,
  )

  window.addEventListener('keydown', (e) => {
    if (e.code === 'F3') {
      e.preventDefault()
      game.toggleDebug()
    }
  })

  await step('Compiling shaders…')
  game.start()
  await new Promise((r) => setTimeout(r, 300))
  loading.classList.add('done')
  setTimeout(() => loading.remove(), 600)

  // Handy for poking at the scene from DevTools during development.
  if (import.meta.env.DEV) Object.assign(window, { game })
}

boot().catch((err) => {
  console.error(err)
  status.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`
})
