import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Incluir iconos en el manifest
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'omm-icon.svg'],
      manifest: {
        name: 'OMM ERP',
        short_name: 'OMM ERP',
        description: 'ERP de OMM Technologies — instalaciones especiales',
        theme_color: '#10B981',
        background_color: '#0a0a0a',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/login',
        // Idiomas y dirección
        lang: 'es-MX',
        dir: 'ltr',
        // Categorías ayudan al sistema operativo a clasificar la app
        categories: ['business', 'productivity'],
        // Iconos generados desde SVG en build
        icons: [
          { src: '/omm-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/omm-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/omm-icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/omm-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // CRÍTICO: el SW nuevo toma control inmediatamente y limpia caches viejos.
        // Sin esto, el SW viejo intercepta requests al endpoint /auth/v1/token y
        // los usuarios quedan atorados en "Entrando..." al hacer login.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        // Cachear todos los assets estáticos del build
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // No cachear las llamadas a Supabase ni a las funciones de Vercel
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /supabase\.co/],
        // Aumentar tamaño max del bundle cacheable a 5MB (Contabilidad es grande)
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Cache de imágenes externas (logos de proveedores, etc.)
            urlPattern: /^https:\/\/.*\.(png|jpg|jpeg|svg|webp)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
        ],
      },
      devOptions: {
        // Para poder probar PWA en local
        enabled: false,
      },
    }),
  ],
})
