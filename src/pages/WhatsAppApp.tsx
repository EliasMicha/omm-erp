import { useEffect } from 'react'
import Conversaciones from '../components/whatsapp/Conversaciones'
import { enviarWhatsApp } from '../lib/whatsappSend'

// /wa — las conversaciones del número de OMM a pantalla completa, sin el menú
// del ERP, para instalarla en el celular como app ("Agregar a pantalla de
// inicio"). Mientras esta pantalla está abierta, el <head> apunta a su propio
// manifest e icono: así el celular la instala como "WhatsApp OMM" y la abre
// directo aquí, no en el login del ERP.

function ponerHead(sel: string, crear: () => HTMLElement, attr: string, valor: string): () => void {
  let el = document.head.querySelector(sel) as HTMLElement | null
  const existia = !!el
  const antes = el?.getAttribute(attr) ?? null
  if (!el) { el = crear(); document.head.appendChild(el) }
  el.setAttribute(attr, valor)
  return () => {
    if (!el) return
    if (!existia) el.remove()
    else if (antes !== null) el.setAttribute(attr, antes)
  }
}

export default function WhatsAppApp() {
  useEffect(() => {
    const titulo = document.title
    document.title = 'WhatsApp OMM'
    const link = (rel: string) => () => { const l = document.createElement('link'); l.rel = rel; return l }
    const meta = (name: string) => () => { const m = document.createElement('meta'); m.name = name; return m }
    const deshacer = [
      ponerHead('link[rel="manifest"]', link('manifest'), 'href', '/wa-manifest.json'),
      ponerHead('link[rel="apple-touch-icon"]', link('apple-touch-icon'), 'href', '/wa-apple-touch-icon.png'),
      ponerHead('meta[name="apple-mobile-web-app-title"]', meta('apple-mobile-web-app-title'), 'content', 'WhatsApp OMM'),
      ponerHead('meta[name="theme-color"]', meta('theme-color'), 'content', '#111b21'),
    ]
    const fondo = document.body.style.background
    document.body.style.background = '#0b141a'
    return () => { document.title = titulo; document.body.style.background = fondo; deshacer.forEach(f => f()) }
  }, [])

  return <Conversaciones enviar={enviarWhatsApp} modo="app" />
}
