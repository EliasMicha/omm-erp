import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// ─────────────────────────────────────────────────────────────────────────────
// KILL SWITCH del Service Worker / PWA.
// El PWA fue desactivado (selfDestroying) porque el SW viejo se quedaba sirviendo
// versiones cacheadas y "no entraba la actualización". Aquí, en cada arranque:
// si hay algún SW registrado, lo desregistramos, borramos todos los caches y
// recargamos UNA sola vez (guardado en sessionStorage para no ciclar). Tras esa
// recarga ya no queda SW y la app siempre carga la versión más reciente de la red.
// ─────────────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(async (regs) => {
    if (!regs || regs.length === 0) return
    await Promise.allSettled(regs.map((r) => r.unregister()))
    try {
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.allSettled(keys.map((k) => caches.delete(k)))
      }
    } catch { /* noop */ }
    if (!sessionStorage.getItem('sw_killed')) {
      sessionStorage.setItem('sw_killed', '1')
      window.location.reload()
    }
  }).catch(() => { /* noop */ })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
