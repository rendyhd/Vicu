import { app, systemPreferences, type WebContents } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { handleTrusted } from '../secure-ipc'
import { isLinux, isMac, isWindows } from '../platform'
import { powershellPath } from '../system-tools'
import type {
  VoiceAvailability,
  VoiceErrorCode,
  VoiceEvent,
  VoiceEventEnvelope,
  VoiceStartResult,
} from '../../shared/voice-types'
import { parseHelperLine } from './helper-protocol'
import { runHelperSession, type VoiceSessionHandle } from './helper-session'

// Voice input for the main window (docs/voice-input.md): one listening session at a time, run by
// a platform speech helper and streamed to the window that started it as `voice:event`.
//
//   macOS    resources/voice/vicu-speech-macos (Apple's SFSpeechRecognizer, on the Mac when the
//            language allows it), built by scripts/build-voice-helper.mjs
//   Windows  resources/voice/voice-windows.ps1 (System.Speech, the offline desktop recognizer)
//   Linux    none: the window falls back to the composer
//
// The microphone is asked for on the first use, never at start-up.

function resourcePath(...parts: string[]): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'resources', ...parts)
    : join(app.getAppPath(), 'resources', ...parts)
}

interface HelperCommand {
  command: string
  args: string[]
  engine: VoiceAvailability['engine']
}

function helperCommand(extra: string[] = []): HelperCommand | null {
  if (isMac) {
    const path = resourcePath('voice', 'vicu-speech-macos')
    return existsSync(path) ? { command: path, args: extra, engine: 'macos-speech' } : null
  }
  if (isWindows) {
    const path = resourcePath('voice', 'voice-windows.ps1')
    if (!existsSync(path)) return null
    return {
      command: powershellPath(),
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path, ...extra.map((a) => (a === '--check' ? '-Check' : a))],
      engine: 'windows-speech',
    }
  }
  return null
}

const UNSUPPORTED_REASON = 'Voice input is not available on this system.'
const MISSING_HELPER_REASON = 'Voice input is not part of this build of Vicu.'
export const MIC_DENIED_REASON = 'Vicu may not use the microphone. Allow it in System Settings, Privacy & Security, Microphone.'

let availabilityCache: { at: number; value: VoiceAvailability } | null = null
const AVAILABILITY_TTL_MS = 60_000

function runCheck(command: HelperCommand): Promise<VoiceAvailability> {
  return new Promise((resolve) => {
    execFile(command.command, command.args, { timeout: 8000, windowsHide: true }, (_err, stdout) => {
      for (const line of String(stdout ?? '').split(/\r?\n/)) {
        const message = parseHelperLine(line)
        if (message?.kind === 'check') {
          const { check } = message
          if (!check.available) {
            resolve({ available: false, engine: command.engine, onDevice: false, reason: 'Speech recognition is not available for your language on this computer.' })
          } else if (check.authorization === 'denied' || check.authorization === 'restricted') {
            resolve({ available: false, engine: command.engine, onDevice: check.onDevice, reason: 'Vicu may not use speech recognition. Allow it in System Settings, Privacy & Security, Speech Recognition.' })
          } else {
            resolve({ available: true, engine: command.engine, onDevice: check.onDevice })
          }
          return
        }
        if (message?.kind === 'event' && message.event.type === 'error') {
          resolve({ available: false, engine: command.engine, onDevice: false, reason: message.event.message })
          return
        }
      }
      resolve({ available: false, engine: command.engine, onDevice: false, reason: UNSUPPORTED_REASON })
    })
  })
}

export async function getVoiceAvailability(force = false): Promise<VoiceAvailability> {
  if (isLinux) return { available: false, engine: 'none', onDevice: false, reason: UNSUPPORTED_REASON }
  if (!force && availabilityCache && Date.now() - availabilityCache.at < AVAILABILITY_TTL_MS) return availabilityCache.value
  const command = helperCommand(['--check'])
  let value: VoiceAvailability
  if (!command) {
    value = { available: false, engine: 'none', onDevice: false, reason: isMac || isWindows ? MISSING_HELPER_REASON : UNSUPPORTED_REASON }
  } else {
    value = await runCheck(command)
    if (value.available && isMac && systemPreferences.getMediaAccessStatus('microphone') === 'denied') {
      value = { ...value, available: false, reason: MIC_DENIED_REASON }
    }
  }
  availabilityCache = { at: Date.now(), value }
  return value
}

/** On macOS, ask for the microphone the first time; null when it may be used. Also used by local speech. */
export async function ensureMicrophone(): Promise<VoiceErrorCode | null> {
  if (!isMac) return null
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return null
  if (status === 'denied' || status === 'restricted') return 'mic-denied'
  const granted = await systemPreferences.askForMediaAccess('microphone').catch(() => false)
  availabilityCache = null
  return granted ? null : 'mic-denied'
}

interface ActiveSession {
  id: number
  sender: WebContents
  handle: VoiceSessionHandle | null
  /** "stop" arrived while the helper was still starting. */
  stopRequested: boolean
}

let nextSessionId = 1
let active: ActiveSession | null = null

function send(session: ActiveSession, event: VoiceEvent): void {
  if (session.sender.isDestroyed()) return
  const envelope: VoiceEventEnvelope = { sessionId: session.id, event }
  session.sender.send('voice:event', envelope)
}

async function startSession(sender: WebContents, locale: string | undefined): Promise<VoiceStartResult> {
  if (active) {
    // A session the window lost track of (a reload) is replaced; one it still runs is not.
    if (active.sender !== sender && !active.sender.isDestroyed()) {
      return { success: false, code: 'busy', error: 'Voice input is in use in another window.' }
    }
    active.handle?.cancel()
    active = null
  }
  // No --check first (PowerShell alone takes a second to start): the helper reports its own problems.
  if (isLinux || !helperCommand()) {
    return { success: false, code: 'unsupported', error: isLinux ? UNSUPPORTED_REASON : MISSING_HELPER_REASON }
  }
  const session: ActiveSession = { id: nextSessionId++, sender, handle: null, stopRequested: false }
  active = session

  const micProblem = await ensureMicrophone()
  if (micProblem) {
    if (active === session) active = null
    return { success: false, code: micProblem, error: MIC_DENIED_REASON }
  }
  if (active !== session) return { success: false, code: 'failed', error: 'Voice input was cancelled.' }

  const command = helperCommand(locale && isWindows ? ['-Locale', locale] : [])
  if (!command) {
    active = null
    return { success: false, code: 'unsupported', error: MISSING_HELPER_REASON }
  }
  const child = spawn(command.command, command.args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  session.handle = runHelperSession(child, (event) => {
    send(session, event)
    // A permission or engine problem may change what Settings should say.
    if (event.type === 'error') availabilityCache = null
    if ((event.type === 'final' || event.type === 'error') && active === session) active = null
  })
  if (session.stopRequested) session.handle.stop()
  sender.once('destroyed', () => {
    if (active === session) {
      session.handle?.cancel()
      active = null
    }
  })
  return { success: true, sessionId: session.id }
}

function sessionFor(sender: WebContents, id: unknown): ActiveSession | null {
  return active && active.sender === sender && (id === undefined || active.id === id) ? active : null
}

export function registerVoiceIpc(): void {
  handleTrusted('voice:availability', (_event, force?: boolean) => getVoiceAvailability(force === true))
  handleTrusted('voice:start', (event, options?: { locale?: string }) => {
    const locale = typeof options?.locale === 'string' && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(options.locale) ? options.locale : undefined
    return startSession(event.sender, locale)
  })
  // Stop and cancel take no session id while the start is still running (the window has none yet).
  handleTrusted('voice:stop', (event, id?: number) => {
    const session = sessionFor(event.sender, id)
    if (!session) return false
    if (session.handle) session.handle.stop()
    else session.stopRequested = true
    return true
  })
  handleTrusted('voice:cancel', (event, id?: number) => {
    const session = sessionFor(event.sender, id)
    if (!session) return false
    session.handle?.cancel()
    active = null
    return true
  })
}

/** Ends a session still running when the app quits, so no helper is left behind. */
export function cancelVoiceSession(): void {
  active?.handle?.cancel()
  active = null
}
