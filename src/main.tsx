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

// ─────────────────────────────────────────────────────────────────────────────
// COT-08: la rueda del mouse cambia el valor de un <input type="number"> que
// tiene el foco. Alguien escribe una cantidad, baja con la rueda para seguir
// leyendo la cotización y la cantidad se mueve sin que lo note — y se guarda.
// Hay 237 campos numéricos en el ERP; en vez de parchar uno por uno, aquí se
// quita el foco del campo en cuanto llega la rueda: el navegador ya no tiene a
// quién cambiarle el valor y la página se desplaza normal. El blur dispara el
// onBlur de siempre, que guarda lo que la persona tecleó, no lo que movió la rueda.
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('wheel', () => {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type === 'number') el.blur()
}, { passive: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
