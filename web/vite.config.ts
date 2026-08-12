import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * WebContainer needs COOP + COEP on the SPA.
 * Google Picker cannot run under any COEP. Strip COEP (and only COEP) on
 * /drive-picker.html — wrap both setHeader and writeHead; Vite may use either.
 */
function drivePickerNoCoep(): Plugin {
  const isPicker = (url?: string) => {
    const path = (url ?? '').split('?')[0]
    return path === '/drive-picker.html' || path.endsWith('/drive-picker.html')
  }

  const strip = (
    req: { url?: string },
    res: {
      setHeader: (name: string, value: unknown) => unknown
      removeHeader?: (name: string) => void
      writeHead: (...args: unknown[]) => unknown
    },
    next: () => void,
  ) => {
    if (!isPicker(req.url)) {
      next()
      return
    }

    const originalSetHeader = res.setHeader.bind(res)
    res.setHeader = (name: string, value: unknown) => {
      if (String(name).toLowerCase() === 'cross-origin-embedder-policy') {
        return res
      }
      return originalSetHeader(name, value)
    }

    const originalWriteHead = res.writeHead.bind(res)
    res.writeHead = (...args: unknown[]) => {
      try {
        res.removeHeader?.('Cross-Origin-Embedder-Policy')
      } catch {
        /* ignore */
      }
      const headers = args.find(
        (a) => a && typeof a === 'object' && !Array.isArray(a),
      ) as Record<string, unknown> | undefined
      if (headers) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'cross-origin-embedder-policy') {
            delete headers[key]
          }
        }
      }
      return originalWriteHead(...args)
    }

    next()
    res.removeHeader?.('Cross-Origin-Embedder-Policy')
  }

  return {
    name: 'drive-picker-no-coep',
    configureServer(server) {
      server.middlewares.use(strip)
      return () => {
        server.middlewares.use(strip)
      }
    },
    configurePreviewServer(server) {
      server.middlewares.use(strip)
      return () => {
        server.middlewares.use(strip)
      }
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
