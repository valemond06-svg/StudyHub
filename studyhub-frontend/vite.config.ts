import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function getLocalApiToken(): string {
  if (process.env.STUDYHUB_API_TOKEN) {
    return process.env.STUDYHUB_API_TOKEN.trim()
  }
  const userHome = process.env.USERPROFILE || process.env.HOME || ''
  const tokenFile = path.join(userHome, '.studyhub', 'api_token')
  try {
    if (fs.existsSync(tokenFile)) {
      return fs.readFileSync(tokenFile, 'utf-8').trim()
    }
  } catch {
    // Ignore if not accessible
  }
  return ''
}

const proxyAuthConfigure = (proxy: any) => {
  proxy.on('proxyReq', (proxyReq: any) => {
    const token = getLocalApiToken()
    if (token && !proxyReq.getHeader('authorization')) {
      proxyReq.setHeader('authorization', `Bearer ${token}`)
    }
  })
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @ts-expect-error vitest config
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8765',
        changeOrigin: true,
        configure: proxyAuthConfigure,
      },
      '/media': {
        target: 'http://localhost:8765',
        changeOrigin: true,
        configure: proxyAuthConfigure,
      },
      '/video': {
        target: 'http://localhost:8765',
        changeOrigin: true,
        configure: proxyAuthConfigure,
      },
    },
  },
})