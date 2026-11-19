import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The web version (src/web): the renderer and the portable part of the main process in one page,
// served next to a Vikunja server. `@host` is the web side of the host seam here (src/web/host);
// the desktop build maps it to src/main/host (electron.vite.config.ts).
//
// Dev: `npm run dev:web` serves the page and forwards /api to a Vikunja server
// (VICU_WEB_API, default the local test server), so the page and the API share one origin, as they
// do behind the container's proxy.
export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  // The app owns the root of its origin: the session cookie's path starts at /api, and an OIDC
  // sign-in comes back to /auth/openid/<provider>.
  base: '/',
  publicDir: resolve(__dirname, 'src/web/public'),
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true,
    // Scripts loaded by URL stay files: the page's CSP allows scripts from 'self' only.
    assetsInlineLimit: (file: string) => (file.endsWith('.js') ? false : undefined),
  },
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.0.0'),
  },
  resolve: {
    alias: {
      '@host': resolve(__dirname, 'src/web/host'),
      '@': resolve(__dirname, 'src/renderer'),
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.VICU_WEB_API || 'http://127.0.0.1:3456', changeOrigin: true },
    },
  },
  preview: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.VICU_WEB_API || 'http://127.0.0.1:3456', changeOrigin: true },
    },
  },
})
