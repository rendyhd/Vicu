// electron-builder afterPack hook (electron-builder.yml, afterPack): sets the Electron fuses of the
// packaged app, right before it is signed (review 2026-11-13, S-4).
//
// Without fuses anything running as the user can start the signed Vicu.app with
// ELECTRON_RUN_AS_NODE=1 (or NODE_OPTIONS, or --inspect) and run its own code as Vicu, with the
// calendar, microphone, speech and automation access the user gave Vicu. On macOS the app
// therefore no longer runs as Node, takes no Node options from the environment or the command
// line, and loads its code only from app.asar, whose header hash electron-builder writes into
// Info.plist (ElectronAsarIntegrity) and Electron checks.
//
// Windows and Linux are left as they are for now: the browser link there still runs
// resources/native-messaging-host/vicu-bridge.js with the app binary as Node
// (src/main/browser-host-wrapper.ts), which the RunAsNode fuse would break. They can follow once
// the bridge is a program of its own there too, as native/bridge-macos is on macOS.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses'

/** The fuses of a platform (electron-builder's name: darwin, mas, win32, linux), or null to leave them. */
export function fuseConfig(platform) {
  if (platform !== 'darwin' && platform !== 'mas') return null
  return {
    version: FuseVersion.V1,
    // Changing the binary breaks the ad-hoc signature an arm64 Mac needs to start it at all. A
    // release build is signed again by electron-builder right after this hook.
    resetAdHocDarwinSignature: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  }
}

/** The fuses of `config` that the binary does not hold, as readable lines (empty when all are set). */
export function fuseMismatches(config, wire) {
  const problems = []
  for (const [name, index] of Object.entries(FuseV1Options)) {
    if (typeof index !== 'number' || typeof config[index] !== 'boolean') continue
    // The wire holds the character codes of '0' (off) and '1' (on).
    const wanted = config[index] ? 49 : 48
    if (wire[index] !== wanted) problems.push(`${name} should be ${config[index] ? 'on' : 'off'}`)
  }
  return problems
}

export async function afterPack(context) {
  const platform = context.electronPlatformName
  const config = fuseConfig(platform)
  if (!config) {
    console.log(`[fuses] ${platform}: left unchanged (the browser link runs the app binary as Node here)`)
    return
  }
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  // With RunAsNode off the wrapper cannot run the bridge script, so a Mac build without the
  // bridge tool has no browser link. Refuse to pack it.
  const helper = join(app, 'Contents', 'Resources', 'resources', 'bridge', 'vicu-bridge-macos')
  if (!existsSync(helper)) {
    throw new Error('[fuses] resources/bridge/vicu-bridge-macos is not in the app: run `npm run bridge:helper` before electron-builder')
  }
  await context.packager.addElectronFuses(context, config)
  const problems = fuseMismatches(config, await getCurrentFuseWire(app))
  if (problems.length > 0) throw new Error(`[fuses] not set in ${app}: ${problems.join(', ')}`)
  console.log(`[fuses] ${platform}: run as Node, NODE_OPTIONS and --inspect are off; the app loads only from the checked app.asar`)
}

export default afterPack
