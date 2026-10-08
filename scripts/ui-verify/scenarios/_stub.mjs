// Scenarios that are listed in the plan but have no implementation yet log one line and pass.
export async function notImplemented(h, meta) {
  h.emit({ t: 'skip', id: meta.id, wave: meta.wave, message: 'not implemented yet' })
}
