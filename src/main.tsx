import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { supabaseAll } from './lib/supabase'

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

// ─────────────────────────────────────────────────────────────────────────────
// Toda llamada a nuestras funciones /api/* lleva el token de la sesión.
// /api/anthropic dejó de atender a quien no lo trae (2026-10-26: alguien usó la
// URL abierta para gastar ~$230 USD de Opus en una mañana). En vez de tocar los
// ~30 lugares que la llaman, se agrega aquí, una vez. Si la llamada ya trae su
// propio Authorization, no se toca.
// ─────────────────────────────────────────────────────────────────────────────
const fetchOriginal = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const destino = new URL(url, window.location.href)
    const esNuestra = destino.pathname.startsWith('/api/') &&
      (destino.origin === window.location.origin || destino.hostname === 'omm-erp.vercel.app')
    if (esNuestra) {
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined))
      if (!headers.has('Authorization')) {
        const { data } = await supabaseAll.auth.getSession()
        const token = data.session?.access_token
        if (token) {
          headers.set('Authorization', `Bearer ${token}`)
          return fetchOriginal(input, { ...init, headers })
        }
      }
    }
  } catch { /* si algo falla aquí, la llamada sale como siempre */ }
  return fetchOriginal(input, init)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
