import { join } from 'path'
import { JsonFileStore } from './json-file-store'
import {
  CARRIER_IDS_FILENAME,
  createDocumentCarrierIdStore,
  emptyCarrierIdFile,
  parseCarrierIdFile,
  type CarrierIdFile,
  type CarrierIdStore,
} from './carrier-discovery'

/** The carrier ids kept in `carrier-ids.json` in the user data folder (the desktop's store). */
export function createFileCarrierIdStore(path: string): CarrierIdStore {
  const file = new JsonFileStore<CarrierIdFile>({
    path,
    backup: false,
    label: 'carrier ids', // i18n-ignore: log label
    empty: emptyCarrierIdFile,
    parse: parseCarrierIdFile,
  })
  file.load()
  // The file is a few hundred bytes and written only when a carrier appears or disappears (or once
  // a day), so a synchronous write is simpler than an async one and leaves nothing running.
  return createDocumentCarrierIdStore({
    get state() { return file.state },
    save: () => file.saveSync(),
  })
}

export function carrierIdsPath(userDataDir: string): string {
  return join(userDataDir, CARRIER_IDS_FILENAME)
}
