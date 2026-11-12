import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

// Default base for the local dev/build setup. For another location build with
// `vite build --base=/other/path/` (see `npm run build:vps`).
const BASE = '/pixelstudio/dist/';

export default defineConfig({
  base: BASE,
  build: { outDir: 'dist', target: 'es2022' },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Pixel Art Studio',
        short_name: 'Pixel Art Studio',
        description: 'Pixel art and animation editor',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#1b1b22',
        theme_color: '#25252e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
