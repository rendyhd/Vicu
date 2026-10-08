// E11 (card 4.6 view half): E7 with --motion reduce: changing views is a cross-fade only, no rise,
// no travelling pill. The E1 half (the completion hold) waits for card 4.2 and logs a skip.
import { mouseSwitch } from './_view-switch.mjs'

export const meta = {
  id: 'E11',
  wave: 4,
  title: 'E1 and E7 with --motion reduce: no transforms or overshoot, same hold timing',
}

export default async function run(h) {
  const page = h.page
  await h.resize(1280, 820)
  await h.setMotion('reduce')
  await h.assert('prefers-reduced-motion is emulated as reduce', () => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
  await mouseSwitch(h, page, { full: false })
  h.emit({ t: 'skip', id: meta.id, wave: meta.wave, message: 'E1 half (completion hold) waits for card 4.2' })
  await h.setMotion('full')
  await h.dismiss()
}
