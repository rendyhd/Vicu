import { contextBridge, ipcRenderer } from 'electron'
import { createApi } from '../shared/api-factory'

// The channels live in src/shared/api-factory.ts, shared with the web host.
const api = createApi({
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  // Page callbacks only ever receive the payload. The IpcRendererEvent carries `sender` (the
  // ipcRenderer itself), which must not cross the context bridge.
  on: (channel, listener) => {
    const handler = (_event: unknown, ...args: unknown[]): void => listener(...args)
    ipcRenderer.on(channel, handler)
    return () => { ipcRenderer.removeListener(channel, handler) }
  },
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  windowMaterial: process.argv.includes('--vicu-window-material=mica') ? 'mica' : 'none',
})

contextBridge.exposeInMainWorld('api', api)
