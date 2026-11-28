import { app } from 'electron'
import { join } from 'path'
import { readFileWithBackup, writeFileAtomic } from '../atomic-file'
import { carrierIdsPath, createFileCarrierIdStore } from '../carrier-id-file'
import type { CarrierIdStore } from '../carrier-discovery'

// `@host/storage`, the Electron side: files in the user data folder. The web build swaps this
// module for src/web/host/storage.ts, which keeps the same documents in the browser's IndexedDB.

const CONFIG_FILENAME = 'config.json'

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILENAME)
}

/** The stored config, parsed; falls back to config.json.bak (and logs it) when the file does not parse. */
export function readStoredConfig<T>(parse: (raw: string) => T): { value: T; recovered: boolean } | null {
  return readFileWithBackup(configPath(), parse)
}

/** Replace the stored config: temp file plus rename, keeping config.json.bak (see atomic-file.ts). */
export function writeStoredConfig(json: string): void {
  writeFileAtomic(configPath(), json, { backup: true })
}

/** The remembered carrier ids (carrier-ids.json). */
export function openCarrierIdStore(): CarrierIdStore {
  return createFileCarrierIdStore(carrierIdsPath(app.getPath('userData')))
}
