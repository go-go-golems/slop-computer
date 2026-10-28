import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Development: `pnpm dev` serves the Workshop on :5173 and proxies the server's
// paths to `slop serve` (start it with --dev-origin http://localhost:5173).
// The Host header is kept (changeOrigin: false), so the server sees the dev
// origin and accepts its cookies and CSRF checks. The production build is
// served by the binary under /static/workshop/.
const target = process.env.SLOP_DEV_SERVER ?? 'http://127.0.0.1:8080'
const proxy = Object.fromEntries(['/api', '/auth', '/device', '/_/', '/_slop', '/static'].map(p => [p, { target, changeOrigin: false }]))

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/workshop/' : '/',
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
}))
