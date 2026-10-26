import { useEffect } from 'react'
import Conversaciones from '../components/whatsapp/Conversaciones'
import { enviarWhatsApp } from '../lib/whatsappSend'

// /wa — las conversaciones del número de OMM a pantalla completa, sin el menú
// del ERP, para instalarla en el celular como app ("Agregar a pantalla de
// inicio") con el nombre "WhatsApp OMM".
//
// El manifest, el icono y el nombre los escoge index.html según la ruta con la
// que se CARGÓ la página (window.__appWA). iPhone lee el manifest al cargar y
// no ve cambios hechos después desde React: si se llegó aquí navegando dentro
// del ERP (p. ej. desde el login), al agregarla a la pantalla de inicio quedaba
// "OMM ERP" abriendo /login. Por eso, si la página no cargó ya en /wa, se
// recarga una vez aquí mismo.

declare global { interface Window { __appWA?: boolean } }

export default function WhatsAppApp() {
  const recargar = typeof window !== 'undefined' && window.__appWA === false
  useEffect(() => {
    if (recargar) { window.location.replace(window.location.pathname + window.location.search); return }
    const titulo = document.title
    document.title = 'WhatsApp OMM'
    const fondo = document.body.style.background
    document.body.style.background = '#0b141a'
    const tc = document.head.querySelector('meta[name="theme-color"]')
    const tcAntes = tc?.getAttribute('content') ?? null
    tc?.setAttribute('content', '#111b21')
    return () => {
      document.title = titulo
      document.body.style.background = fondo
      if (tc && tcAntes !== null) tc.setAttribute('content', tcAntes)
    }
  }, [recargar])

  if (recargar) return <div style={{ position: 'fixed', inset: 0, background: '#0b141a' }} />
  return <Conversaciones enviar={enviarWhatsApp} modo="app" />
}
