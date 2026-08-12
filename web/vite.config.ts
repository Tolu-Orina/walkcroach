import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * WebContainer needs COOP + COEP on the SPA.
 * Google Picker cannot run under any COEP (including credentialless) — Chrome
 * still requires CORP on cross-origin iframes. Serve /drive-picker.html with
 * COOP only (no COEP) so the popup can host docs.google.com/picker.
 */
function drivePickerNoCoep(): Plugin {
  const stripCoep = (
    req: { url?: string },
    res: {
      setHeader: (name: string, value: number | string | readonly string[]) => unknown
    },
    next: () => void,
  ) => {
    const url = req.url?.split('?')[0] ?? ''
    if (url === '/drive-picker.html' || url.endsWith('/drive-picker.html')) {
      const originalSetHeader = res.setHeader.bind(res)
      res.setHeader = (name: string, value: number | string | readonly string[]) => {
        if (String(name).toLowerCase() === 'cross-origin-embedder-policy') {
          return res
        }
        return originalSetHeader(name, value)
      }
    }
    next()
  }
  return {
    name: 'drive-picker-no-coep',
    configureServer(server) {
      server.middlewares.use(stripCoep)
    },
    configurePreviewServer(server) {
      server.middlewares.use(stripCoep)
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), drivePickerNoCoep()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
})
