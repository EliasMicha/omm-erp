import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Desactivamos el PWA: genera un SW que se auto-elimina y limpia todos los
      // caches en los clientes (soluciona los "no entra la actualización" por SW viejo).
      selfDestroying: true,
      registerType: 'autoUpdate',
      // Incluir iconos en el manifest
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'omm-icon.svg'],
      // El manifest NO lo genera el plugin: vive en public/manifest.webmanifest
      // y index.html escoge cuál ligar según la ruta con la que se abrió la
      // página (/wa usa public/wa-manifest.json). iPhone lee el manifest al
      // cargar y no se entera si se cambia después, así que tiene que salir
      // bien desde el HTML.
      manifest: false,
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
