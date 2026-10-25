import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The FastAPI backend is the single source of truth, including the /api/yahoo relay.
const apiProxy = {
  '/api': {
    target: process.env.API_TARGET ?? 'http://127.0.0.1:8001',
    changeOrigin: true,
  },
};

export default defineConfig({
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    rollupOptions: {
      // Vendor libraries in their own long-cached chunks.
      output: { manualChunks: { react: ['react', 'react-dom', 'react-router-dom'], recharts: ['recharts'] } },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      workbox: {
        // Never serve API responses from the service worker or fall back to the SPA for them.
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'MosaVali',
        short_name: 'MosaVali',
        description: 'Plan, protect and monitor your savings goals.',
        start_url: '/app',
        display: 'standalone',
        background_color: '#050606',
        theme_color: '#050606',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
