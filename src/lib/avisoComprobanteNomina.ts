// ═══════════════════════════════════════════════════════════════════════════
//  Aviso por correo cuando se sube el comprobante de transferencia de nómina.
//
//  Elias (15-oct-2026): "en cuanto se suba el comprobante le llegue un correo
//  de aviso a Administración, Contabilidad y a mí".
//
//  Sale por /api/gmail?action=send, igual que el aviso de pago a Logística:
//  la cuenta conectada al ERP es elias@omniious.com, así que el correo sale a
//  nombre de Elias. Lleva el comprobante adjunto (si pesa ≤3 MB; si no, liga).
//
//  Igual que avisoPagoLogistica: NUNCA lanza. Si el correo no sale, la
//  pantalla lo dice — dar por avisada a Contabilidad cuando nadie le avisó es
//  peor que no tener el aviso.
// ═══════════════════════════════════════════════════════════════════════════
import { supabase } from './supabase'

export const CORREOS_AVISO_NOMINA = [
  'administracion@omniious.com',
  'contabilidad@omniious.com',
  'elias@omniious.com',
]

export interface LineaAvisoNomina {
  nombre: string
  importe: number
}

export interface DatosAvisoNomina {
  periodo: string                 // "Quincena 1 – Oct 2026"
  archivo: File
  urlComprobante: string | null
  origen: 'pdf' | 'ia'
  pagosEnComprobante: number
  marcados: LineaAvisoNomina[]    // marcados con ESTE comprobante
  sinEmpleado: string[]           // renglones del comprobante que no están en el periodo
  avisos: string[]
  pendientes: LineaAvisoNomina[]  // transferencias del periodo aún sin comprobar
  comprobadas: number             // cuántas del periodo ya están comprobadas (con éste)
  totalComprobado: number
  totalTransferencia: number
}

export interface ResultadoAvisoNomina {
  ok: boolean
  error?: string
}

const TOPE_ADJUNTO = 3 * 1024 * 1024 // el body de Vercel topa en ~4.5 MB y base64 infla 33%

const dinero = (n: number): string =>
  '$' + n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function aBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result || '')
      const coma = s.indexOf(',')
      resolve(coma >= 0 ? s.slice(coma + 1) : '')
    }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

async function quienSoy(): Promise<string> {
  try {
    const { data } = await supabase.auth.getUser()
    const uid = data?.user?.id
    if (!uid) return ''
    const { data: cuenta } = await supabase.from('app_users').select('nombre,email').eq('auth_user_id', uid).maybeSingle()
    return (cuenta?.nombre || cuenta?.email || data?.user?.email || '') as string
  } catch {
    return ''
  }
}

export function armarAvisoNomina(d: DatosAvisoNomina, quien: string): { asunto: string; cuerpo: string } {
  const faltan = d.pendientes.length
  const asunto = `Comprobante de nómina — ${d.periodo}: ${d.marcados.length} pago(s) comprobado(s)` +
    (faltan ? `, faltan ${faltan}` : ' · nómina completa')

  const hora = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })
  const L: string[] = []
  L.push(`Se subió el comprobante de transferencia de la nómina ${d.periodo}.`)
  L.push(`Subió: ${quien || 'usuario del ERP'} · ${hora}`)
  L.push(`Archivo: ${d.archivo.name} (${d.origen === 'ia' ? 'leído con IA' : 'leído del PDF'}; ${d.pagosEnComprobante} renglón(es) de pago)`)
  L.push('')

  const sumaMarcados = d.marcados.reduce((s, m) => s + m.importe, 0)
  L.push(`MARCADOS COMO PAGADOS CON ESTE COMPROBANTE: ${d.marcados.length} · ${dinero(sumaMarcados)}`)
  if (d.marcados.length) for (const m of d.marcados) L.push(`· ${m.nombre} — ${dinero(m.importe)}`)
  else L.push('· Ninguno. Revisa que el archivo sea el comprobante de esta nómina.')

  if (d.sinEmpleado.length) {
    L.push('')
    L.push(`EN EL COMPROBANTE PERO NO EN ESTE PERIODO: ${d.sinEmpleado.length}`)
    for (const s of d.sinEmpleado) L.push(`· ${s}`)
  }

  if (d.avisos.length) {
    L.push('')
    L.push('OJO')
    for (const a of d.avisos) L.push(`· ${a}`)
  }

  L.push('')
  L.push('ESTADO DE LA NÓMINA')
  const total = d.comprobadas + faltan
  L.push(`Transferencias comprobadas: ${d.comprobadas} de ${total} · ${dinero(d.totalComprobado)} de ${dinero(d.totalTransferencia)}`)
  if (faltan) {
    L.push('Faltan por comprobar:')
    for (const p of d.pendientes) L.push(`· ${p.nombre} — ${dinero(p.importe)}`)
  } else {
    L.push('Todas las transferencias del periodo están comprobadas.')
  }

  if (d.urlComprobante) {
    L.push('')
    L.push(`Comprobante: ${d.urlComprobante}`)
  }
  L.push('')
  L.push('— Aviso automático del ERP (Nómina → Periodos → Subir comprobante).')
  return { asunto, cuerpo: L.join('\n') }
}

/** Arma y manda el aviso. No lanza nunca. */
export async function avisarComprobanteNomina(d: DatosAvisoNomina): Promise<ResultadoAvisoNomina> {
  try {
    const { asunto, cuerpo } = armarAvisoNomina(d, await quienSoy())
    const attachments: { filename: string; mime: string; dataB64: string }[] = []
    if (d.archivo.size <= TOPE_ADJUNTO) {
      try {
        const b64 = await aBase64(d.archivo)
        if (b64) attachments.push({ filename: d.archivo.name || 'comprobante', mime: d.archivo.type || 'application/octet-stream', dataB64: b64 })
      } catch { /* sin adjunto: la liga va en el cuerpo */ }
    }
    const r = await fetch('/api/gmail?action=send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: CORREOS_AVISO_NOMINA.join(', '), subject: asunto, body: cuerpo, attachments }),
    })
    const j: any = await r.json().catch(() => null)
    if (!r.ok || !j?.ok) return { ok: false, error: j?.error || `HTTP ${r.status}` }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}
