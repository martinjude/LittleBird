import { join } from 'node:path'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { IPC } from '../shared/api'

// Prefer the discrete GPU on dual-GPU laptops.
app.commandLine.appendSwitch('force_high_performance_gpu')

const isDev = !app.isPackaged
const settingsPath = () => join(app.getPath('userData'), 'settings.json')

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    show: false,
    backgroundColor: '#000000',
    title: 'LittleBird',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The game loop must keep running when the window is unfocused.
      backgroundThrottling: false,
      // Engine sound should start with the game, not wait for a click.
      autoplayPolicy: 'no-user-gesture-required',
    },
  })

  win.once('ready-to-show', () => win.show())

  // No application menu (Alt would otherwise pop it up mid-flight), so handle the
  // couple of shortcuts it used to provide ourselves.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen())
      event.preventDefault()
    } else if (isDev && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      win.webContents.toggleDevTools()
      event.preventDefault()
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devUrl) win.loadURL(devUrl)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  return win
}

function registerIpc(): void {
  ipcMain.handle(IPC.settingsLoad, async () => {
    try {
      return JSON.parse(await readFile(settingsPath(), 'utf8'))
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.settingsSave, async (_event, settings: unknown) => {
    const path = settingsPath()
    await mkdir(app.getPath('userData'), { recursive: true })
    // Write-then-rename so a crash mid-write never leaves a truncated file.
    await writeFile(`${path}.tmp`, JSON.stringify(settings, null, 2), 'utf8')
    await rename(`${path}.tmp`, path)
  })

  ipcMain.on(IPC.appQuit, () => app.quit())

  ipcMain.on(IPC.toggleFullscreen, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setFullScreen(!win.isFullScreen())
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
