import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveDialogDefaultPath, directoryFromSelectedFile } from '../dialog-path'

describe('dialog-path helpers', () => {
  const root = join(tmpdir(), `vicu-dialog-path-${process.pid}-${Date.now()}`)
  const existingDir = join(root, 'existing')
  const missingDir = join(root, 'missing')
  const fallbackDir = join(root, 'fallback')

  beforeEach(() => {
    mkdirSync(existingDir, { recursive: true })
    mkdirSync(fallbackDir, { recursive: true })
    writeFileSync(join(existingDir, 'marker.txt'), 'ok')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('uses a persisted directory that still exists', () => {
    expect(resolveDialogDefaultPath(existingDir, fallbackDir)).toBe(existingDir)
  })

  it('falls back when persisted directory is missing', () => {
    expect(resolveDialogDefaultPath(missingDir, fallbackDir)).toBe(fallbackDir)
  })

  it('falls back when persisted directory is null or empty', () => {
    expect(resolveDialogDefaultPath(null, fallbackDir)).toBe(fallbackDir)
    expect(resolveDialogDefaultPath(undefined, fallbackDir)).toBe(fallbackDir)
    expect(resolveDialogDefaultPath('', fallbackDir)).toBe(fallbackDir)
  })

  it('derives the directory from a selected file path', () => {
    expect(directoryFromSelectedFile(join(existingDir, 'sound.mp3'))).toBe(existingDir)
  })
})
