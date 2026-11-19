import { initStorage } from './host/storage'
import { finishOidcRedirect, initSession } from './session'

// The web version's entry point. The order matters:
//
// 1. The stored documents are loaded (the main-process code reads its config synchronously).
// 2. A sign-in that left for the identity provider is finished, when this load is its way back.
// 3. The host starts: it registers the handlers and puts `window.api` on the page.
// 4. Only then the renderer is loaded; it reads `window.api` while its modules are evaluated.

async function boot(): Promise<void> {
  await initStorage()
  initSession()
  await finishOidcRedirect()
  const { startHost } = await import('./host-start')
  await startHost()
  // Through a glob, so the web host's typecheck does not pull the whole renderer in a second time.
  const renderer = Object.values(import.meta.glob('../renderer/main.tsx'))[0]
  if (!renderer) throw new Error('The renderer entry was not found')
  await renderer()
}

boot().catch((err: unknown) => {
  console.error('[vicu] could not start:', err)
  const root = document.getElementById('root')
  // The catalogs are not loaded yet at this point, so this one sentence is English.
  if (root) root.textContent = 'Vicu could not start. Reload the page to try again.'
})
