#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const os = require('os')

function getContextFilePath() {
  const platform = process.platform
  let base
  if (platform === 'win32') {
    base = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'vicu')
  } else if (platform === 'darwin') {
    base = path.join(os.homedir(), 'Library', 'Application Support', 'vicu')
  } else {
    base = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'vicu')
  }
  return path.join(base, 'browser-context.json')
}

const CONTEXT_FILE = getContextFilePath()

function ensureDir() {
  const dir = path.dirname(CONTEXT_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function writeContext(data) {
  ensureDir()
  const content = JSON.stringify({ ...data, timestamp: Date.now() })
  const tmp = CONTEXT_FILE + '.tmp'
  try {
    fs.writeFileSync(tmp, content, 'utf-8')
    fs.renameSync(tmp, CONTEXT_FILE)
  } catch {
    // Fallback: direct write
    try { fs.writeFileSync(CONTEXT_FILE, content, 'utf-8') } catch { /* ignore */ }
  }
}

function deleteContext() {
  try { fs.unlinkSync(CONTEXT_FILE) } catch { /* ignore */ }
}

// Native messaging protocol: read 4-byte LE uint32 length, then JSON
let inputBuffer = Buffer.alloc(0)

process.stdin.on('data', (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk])

  while (inputBuffer.length >= 4) {
    const msgLen = inputBuffer.readUInt32LE(0)
    if (inputBuffer.length < 4 + msgLen) break

    const msgBytes = inputBuffer.slice(4, 4 + msgLen)
    inputBuffer = inputBuffer.slice(4 + msgLen)

    try {
      const msg = JSON.parse(msgBytes.toString('utf-8'))
      if (msg.type === 'tab' && msg.url) {
        writeContext({ url: msg.url, title: msg.title || '' })
      } else if (msg.type === 'clear') {
        deleteContext()
      }
    } catch { /* ignore parse errors */ }
  }
})

process.stdin.on('end', () => {
  deleteContext()
  process.exit(0)
})

process.stdin.on('error', () => {
  deleteContext()
  process.exit(1)
})
