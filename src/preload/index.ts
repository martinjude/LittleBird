import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type LittleBirdApi } from '../shared/api'

const api: LittleBirdApi = {
  platform: process.platform,
  settings: {
    load: () => ipcRenderer.invoke(IPC.settingsLoad),
    save: (settings) => ipcRenderer.invoke(IPC.settingsSave, settings),
  },
  app: {
    quit: () => ipcRenderer.send(IPC.appQuit),
    toggleFullscreen: () => ipcRenderer.send(IPC.toggleFullscreen),
  },
}

contextBridge.exposeInMainWorld('littlebird', api)
