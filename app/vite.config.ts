import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Built into ../v3 and served by GitHub Pages at /kakeibo/v3/ while this is a prototype.
export default defineConfig({
  base: '/kakeibo/v3/',
  build: { outDir: '../v3', emptyOutDir: true },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new version waits until the user taps "更新"; the queue in IndexedDB is never touched.
      registerType: 'prompt',
      includeAssets: ['icon-180.png'],
      manifest: {
        name: '家計簿',
        short_name: '家計簿',
        lang: 'ja',
        start_url: '/kakeibo/v3/',
        scope: '/kakeibo/v3/',
        display: 'standalone',
        background_color: '#EFEBE7',
        theme_color: '#EFEBE7',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: { navigateFallback: '/kakeibo/v3/index.html', globPatterns: ['**/*.{js,css,html,png,svg}'] },
    }),
  ],
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
