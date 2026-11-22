import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 950,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/hls.js') || id.includes('node_modules/mpegts.js')) {
            return 'vendor-media-engines'
          }
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'vendor-firebase-sync'
          }
          if (id.includes('node_modules/dexie')) {
            return 'vendor-dexie-db'
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
})
