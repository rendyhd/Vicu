// Test-only. Loaded into the Electron main process through `electron --require` by desktop.mjs,
// before any app code runs. Writes one JSON line per HTTP request the app's main process starts with
// electron.net.request (method and URL; never headers or bodies, so no token reaches the log) to the
// file named by VICU_UI_REQUEST_LOG. Nothing in the app depends on it, and it is not packaged.
const fs = require('node:fs')

const file = process.env.VICU_UI_REQUEST_LOG
if (file) {
  try {
    const electron = require('electron')
    const net = electron.net
    const original = net.request.bind(net)
    net.request = (options, ...rest) => {
      try {
        const url = typeof options === 'string' ? options : options.url
        const method = typeof options === 'string' ? 'GET' : (options.method ?? 'GET')
        fs.appendFileSync(file, JSON.stringify({ t: Date.now(), method, url }) + '\n')
      } catch {
        // Logging must never break a request.
      }
      return original(options, ...rest)
    }
  } catch {
    // Not running inside Electron's main process: nothing to observe.
  }
}
