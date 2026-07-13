import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// ─────────────────────────────────────────────────────────────────────────────
// Auto-actualización del PWA / Service Worker.
// vite-plugin-pwa está en 'autoUpdate' (skipWaiting + clientsClaim), pero aún así
// el contenido nuevo se aplica hasta la siguiente recarga, por lo que los usuarios
// quedaban en versiones viejas y había que "limpiar caché" a mano.
// Aquí: (1) cuando un SW nuevo toma control, recargamos UNA vez para servir la
// versión nueva; (2) al reenfocar la pestaña, forzamos un chequeo de actualización.
// ─────────────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let refreshing = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // No recargar en la primera instalación (cuando no había SW controlando)
    if (refreshing || !hadController) return
    refreshing = true
    window.location.reload()
  })
  // Al volver a la pestaña, revisar si hay versión nueva
  const checkForUpdate = () => {
    navigator.serviceWorker.getRegistration().then(reg => { reg?.update().catch(() => {}) }).catch(() => {})
  }
  window.addEventListener('focus', checkForUpdate)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate() })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
