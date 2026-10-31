import { useEffect, useRef, useState } from 'react'
import { FileText, ImageOff } from 'lucide-react'
import { supabase } from '../../lib/supabase'

// Fotos, notas de voz, videos y documentos de los chats de WhatsApp (2026-10-28).
//
// El webhook guarda cada archivo en Storage con el wa_message_id en el nombre, pero
// no siempre escribe whatsapp_messages.media_path. La RPC wa_media(ids) busca dónde
// quedó (agent-documents, obra-reportes o cotizaciones-pdf) y aquí se firma una URL
// de 6 horas para verlo. Los buckets son privados: sin la URL firmada no se abre nada.

export interface MsgMedio { id: string; kind: string | null; media_path: string | null; body: string | null; created_at: string }
export interface Medio { url: string; mime: string; nombre: string; bucket: string; path: string }

const TIPOS_CON_ARCHIVO = new Set(['image', 'audio', 'voice', 'video', 'document', 'sticker'])
export function tieneArchivo(m: MsgMedio): boolean {
  return !!m.media_path || TIPOS_CON_ARCHIVO.has(m.kind || '')
}

// Resuelve (una sola vez por mensaje) dónde está el archivo y su URL firmada.
// Devuelve id → Medio, o null si ese mensaje trae archivo pero no se guardó.
export function useMedios(msgs: MsgMedio[]): Record<string, Medio | null> {
  const [medios, setMedios] = useState({} as Record<string, Medio | null>)
  const pedidos = useRef(new Set() as Set<string>)

  useEffect(() => {
    const faltan = msgs.filter(m => tieneArchivo(m) && !pedidos.current.has(m.id))
    if (!faltan.length) return
    faltan.forEach(m => pedidos.current.add(m.id))
    let vivo = true
    ;(async () => {
      const ubicados: { id: string; bucket: string; path: string; mime: string }[] = []
      // Los de grupos ya traen su ruta (whatsapp_grupo_mensajes.media_path).
      const deGrupo = (m: MsgMedio) => !!m.media_path && m.media_path.startsWith('grupos/')
      for (const m of faltan) if (deGrupo(m)) ubicados.push({ id: m.id, bucket: 'agent-documents', path: m.media_path!, mime: '' })
      const porBuscar = faltan.filter(m => !deGrupo(m))
      const { data, error } = porBuscar.length ? await supabase.rpc('wa_media', { p_ids: porBuscar.map(m => m.id) }) : { data: [], error: null }
      if (!error) {
        for (const r of (data || []) as any[]) ubicados.push({ id: r.id, bucket: r.bucket, path: r.path, mime: r.mime || '' })
      } else {
        // Sin la RPC (aún no aplicada) al menos se intenta con media_path en agent-documents.
        for (const m of porBuscar) if (m.media_path) ubicados.push({ id: m.id, bucket: 'agent-documents', path: m.media_path, mime: '' })
      }
      const res: Record<string, Medio | null> = {}
      // Uno recién llegado puede no estar en Storage todavía (el webhook lo sube
      // mientras procesa): se vuelve a buscar en la siguiente recarga.
      const reciente = (m: MsgMedio) => Date.now() - new Date(m.created_at).getTime() < 5 * 60_000
      for (const m of faltan) { if (reciente(m)) pedidos.current.delete(m.id); else res[m.id] = null }
      const porBucket: Record<string, typeof ubicados> = {}
      for (const u of ubicados) (porBucket[u.bucket] = porBucket[u.bucket] || []).push(u)
      for (const bucket of Object.keys(porBucket)) {
        const lista = porBucket[bucket]
        const { data: firmadas } = await supabase.storage.from(bucket).createSignedUrls(lista.map(u => u.path), 6 * 3600)
        ;(firmadas || []).forEach((f: any, i: number) => {
          const u = lista[i]
          if (f?.signedUrl) res[u.id] = { url: f.signedUrl, mime: u.mime || mimeDeNombre(u.path), nombre: nombreDe(u.path), bucket, path: u.path }
        })
      }
      if (vivo) setMedios(prev => ({ ...prev, ...res }))
    })().catch(() => { /* sin archivo: se queda el texto del mensaje */ })
    return () => { vivo = false }
  }, [msgs])

  return medios
}

function nombreDe(path: string): string {
  const n = path.split('/').pop() || path
  return n.replace(/^\d{10,}-/, '').replace(/^wa[-_]wamid\.[^.]+/, 'archivo')
}
function mimeDeNombre(path: string): string {
  const p = path.toLowerCase()
  if (/\.(jpe?g|png|webp|gif|heic)$/.test(p)) return 'image/' + (p.endsWith('png') ? 'png' : 'jpeg')
  if (/\.(ogg|opus|mp3|m4a|aac|webm|wav)$/.test(p)) return 'audio/ogg'
  if (/\.(mp4|mov|3gp)$/.test(p)) return 'video/mp4'
  if (p.endsWith('.pdf')) return 'application/pdf'
  return 'application/octet-stream'
}

// Un renglón de archivo dentro de la burbuja del mensaje.
export function VistaMedio(props: { m: MsgMedio; medio: Medio | null | undefined }) {
  const { m, medio } = props
  const caja = { background: 'rgba(0,0,0,.18)', borderRadius: 6, marginBottom: 4, overflow: 'hidden' as const }

  if (medio === undefined) {
    return <div style={{ ...caja, padding: '8px 10px', fontSize: 12.5, opacity: 0.7 }}>Cargando archivo…</div>
  }
  if (medio === null) {
    if (!tieneArchivo(m)) return null
    return (
      <div style={{ ...caja, padding: '6px 8px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6, opacity: 0.75 }}>
        <ImageOff size={15} style={{ flexShrink: 0 }} /> {etiquetaTipo(m.kind)} no guardado en el ERP
      </div>
    )
  }
  const tipo = medio.mime.split('/')[0]
  const esFoto = tipo === 'image' || m.kind === 'image' || m.kind === 'sticker'
  const esAudio = tipo === 'audio' || m.kind === 'audio' || m.kind === 'voice'
  const esVideo = tipo === 'video' || m.kind === 'video'

  if (esFoto) {
    return (
      <a href={medio.url} target="_blank" rel="noreferrer" style={{ display: 'block', ...caja }}>
        <img src={medio.url} alt="Foto" loading="lazy" style={{ display: 'block', maxWidth: '100%', maxHeight: 340, objectFit: 'contain', margin: '0 auto' }} />
      </a>
    )
  }
  if (esAudio) {
    return (
      <div style={{ ...caja, padding: 6 }}>
        <audio controls preload="metadata" src={medio.url} style={{ width: 260, maxWidth: '100%', display: 'block' }} />
        <a href={medio.url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: '#9de1cf', display: 'inline-block', marginTop: 3 }}>Si no se reproduce, ábrelo aquí</a>
      </div>
    )
  }
  if (esVideo) {
    return (
      <div style={caja}>
        <video controls playsInline preload="metadata" src={medio.url} style={{ display: 'block', maxWidth: '100%', maxHeight: 340 }} />
      </div>
    )
  }
  return (
    <a href={medio.url} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 6, ...caja, padding: '6px 8px', fontSize: 13, overflowWrap: 'anywhere', color: 'inherit', textDecoration: 'none' }}>
      <FileText size={16} style={{ flexShrink: 0 }} /> {medio.nombre}
    </a>
  )
}

function etiquetaTipo(kind: string | null): string {
  if (kind === 'image' || kind === 'sticker') return 'Foto'
  if (kind === 'audio' || kind === 'voice') return 'Audio'
  if (kind === 'video') return 'Video'
  return 'Archivo'
}

// "[image]", "[audio]"… no dicen nada si ya se ve el archivo.
export function esMarcadorDeTipo(body: string | null): boolean {
  return !body || /^\[(image|audio|voice|video|document|sticker)\]$/.test(body.trim())
}
