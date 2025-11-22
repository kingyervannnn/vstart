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
  server: {
    proxy: {
      // Voice API (local Node proxy for STT/TTS)
      '/api': {
        target: 'http://127.0.0.1:3099',
        changeOrigin: true,
      },
      // Local STT server (Faster-Whisper)
      '/stt': {
        target: 'http://127.0.0.1:8090',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stt/, ''),
      },
    },
  },
})
