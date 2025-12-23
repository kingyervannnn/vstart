import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(),tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
    minify: false,
  },
  server: {
    // Increase body size limit for image uploads
    // Vite uses http-proxy-middleware which has no default body size limit
    proxy: {
      // Voice API (local Node proxy for STT/TTS)
      '/api': {
        target: 'http://127.0.0.1:3099',
        changeOrigin: true,
      },
      // Gmail API (local Node proxy for Gmail integration)
      '/gmail': {
        target: 'http://127.0.0.1:3500',
        changeOrigin: true,
      },
      // Notes API (local Obsidian-compatible vault sync)
      '/notes': {
        target: 'http://127.0.0.1:3400',
        changeOrigin: true,
      },
      // Local STT server (Faster-Whisper)
      '/stt': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stt/, ''),
      },
      // Image search proxy server
      '/image-search': {
        target: 'http://127.0.0.1:3300',
        changeOrigin: true,
        timeout: 60000, // 60 second timeout for large uploads
        ws: false, // Disable websocket proxying
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Preserve all headers
            const headers = req.headers
            Object.keys(headers).forEach(key => {
              if (headers[key]) {
                proxyReq.setHeader(key, headers[key])
              }
            })
            // Ensure Content-Length is set if present
            if (req.headers['content-length']) {
              proxyReq.setHeader('Content-Length', req.headers['content-length'])
            }
          })
          proxy.on('error', (err, req, res) => {
            console.error('Proxy error:', err.message)
          })
        },
      },
      // Lens image serving (for Google Lens public URLs)
      '/lens-image': {
        target: 'http://127.0.0.1:3300',
        changeOrigin: true,
        timeout: 30000,
      },
      // Upload for lens endpoint - proxy to image search server
      '/upload-for-lens': {
        target: 'http://127.0.0.1:3300',
        changeOrigin: true,
        timeout: 60000,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            // Preserve all headers for multipart form data
            const headers = req.headers
            Object.keys(headers).forEach(key => {
              if (headers[key] && key.toLowerCase() !== 'host') {
                proxyReq.setHeader(key, headers[key])
              }
            })
            // Ensure Content-Length is set if present
            if (req.headers['content-length']) {
              proxyReq.setHeader('Content-Length', req.headers['content-length'])
            }
            console.log(`[Vite Proxy] Forwarding ${req.method} ${req.url} to http://127.0.0.1:3300${req.url}`)
          })
          proxy.on('proxyRes', (proxyRes, req, res) => {
            console.log(`[Vite Proxy] Response: ${proxyRes.statusCode} for ${req.url}`)
          })
          proxy.on('error', (err, req, res) => {
            console.error('[Vite Proxy] Error:', err.message)
          })
        },
      },
    },
  },
})
