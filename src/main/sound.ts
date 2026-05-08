import { app, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { loadConfig, saveConfig } from './config'

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'])

export function getDefaultSoundPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'done.mp3')
    : path.join(app.getAppPath(), 'resources', 'done.mp3')
}

function getSoundsDir(): string {
  const dir = path.join(app.getPath('userData'), 'sounds')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function getCurrentSoundPath(): string {
  const config = loadConfig()
  const custom = config?.task_completion_sound_path
  if (custom && fs.existsSync(custom)) return custom
  return getDefaultSoundPath()
}

export function getSoundInfo(): { path: string; fileName: string; isDefault: boolean } {
  const config = loadConfig()
  const custom = config?.task_completion_sound_path
  if (custom && fs.existsSync(custom)) {
    return { path: custom, fileName: path.basename(custom), isDefault: false }
  }
  const defaultPath = getDefaultSoundPath()
  return { path: defaultPath, fileName: path.basename(defaultPath), isDefault: true }
}

export async function pickAndCopySoundFile(
  parent: BrowserWindow | null
): Promise<{ success: true; path: string; fileName: string } | { success: false; error: string }> {
  const dialogResult = parent
    ? await dialog.showOpenDialog(parent, {
        title: 'Choose task completion sound',
        properties: ['openFile'],
        filters: [
          { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] },
        ],
      })
    : await dialog.showOpenDialog({
        title: 'Choose task completion sound',
        properties: ['openFile'],
        filters: [
          { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'] },
        ],
      })

  if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
    return { success: false, error: 'cancelled' }
  }

  const sourcePath = dialogResult.filePaths[0]
  const ext = path.extname(sourcePath).toLowerCase()
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { success: false, error: 'Unsupported audio format' }
  }

  try {
    const stat = fs.statSync(sourcePath)
    if (stat.size > 10 * 1024 * 1024) {
      return { success: false, error: 'File too large (max 10MB)' }
    }

    const soundsDir = getSoundsDir()
    const fileName = path.basename(sourcePath)
    const destPath = path.join(soundsDir, `completion${ext}`)

    // Remove any prior custom file (could have a different extension)
    for (const f of fs.readdirSync(soundsDir)) {
      if (f.startsWith('completion.')) {
        try { fs.unlinkSync(path.join(soundsDir, f)) } catch { /* ignore */ }
      }
    }

    fs.copyFileSync(sourcePath, destPath)

    const config = loadConfig()
    if (config) {
      config.task_completion_sound_path = destPath
      saveConfig(config)
    }

    return { success: true, path: destPath, fileName }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to copy file' }
  }
}

export function resetSoundToDefault(): void {
  const soundsDir = getSoundsDir()
  if (fs.existsSync(soundsDir)) {
    for (const f of fs.readdirSync(soundsDir)) {
      if (f.startsWith('completion.')) {
        try { fs.unlinkSync(path.join(soundsDir, f)) } catch { /* ignore */ }
      }
    }
  }
  const config = loadConfig()
  if (config) {
    config.task_completion_sound_path = null
    saveConfig(config)
  }
}

export function readSoundBytes(): { success: true; data: Uint8Array; mimeType: string } | { success: false; error: string } {
  const filePath = getCurrentSoundPath()
  try {
    const buf = fs.readFileSync(filePath)
    return {
      success: true,
      data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      mimeType: mimeForExt(path.extname(filePath).toLowerCase()),
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to read sound file' }
  }
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    case '.ogg': return 'audio/ogg'
    case '.m4a': return 'audio/mp4'
    case '.aac': return 'audio/aac'
    case '.flac': return 'audio/flac'
    default: return 'audio/mpeg'
  }
}
