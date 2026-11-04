// ═══════════════════════════════════════════════════════════════════════════
//  Guardar un archivo (PDF, XML, ZIP) de forma que funcione en el celular.
//
//  Por qué existe: el ERP en iPhone corre como app de inicio (PWA,
//  display standalone). Ahí un <a target="_blank"> o window.open() abre el PDF
//  en un visor sin botón de compartir, así que se puede ver pero NO guardar.
//  Y <a download> tampoco hace nada en ese modo.
//
//  Solución: bajar el archivo con fetch y, en celular, abrir la hoja de
//  compartir del sistema con el archivo (navigator.share con files). Desde ahí
//  sale "Guardar en Archivos", WhatsApp, Mail, etc. En computadora se descarga
//  como siempre.
//
//  Safari pide que share() salga de un toque del usuario. Si la descarga tardó
//  y el permiso del toque ya venció (NotAllowedError), se muestra un botón
//  "Guardar" y el siguiente toque abre la hoja de compartir.
// ═══════════════════════════════════════════════════════════════════════════

function esCelular(): boolean {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true
  // iPad con iPadOS se presenta como Mac, pero tiene pantalla táctil.
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1
}

function tipoDe(nombre: string): string {
  const n = nombre.toLowerCase()
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (n.endsWith('.xml')) return 'application/xml'
  if (n.endsWith('.zip')) return 'application/zip'
  if (n.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  return 'application/octet-stream'
}

/** Nombre de archivo sin caracteres que el sistema no acepta. */
export function nombreSeguro(s: string): string {
  return String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'archivo'
}

function descargarComoSiempre(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// navigator.share / canShare con archivos: los tipos de TS varían por versión
// de lib.dom, por eso se usan a través de esta interfaz explícita.
interface NavegadorQueComparte {
  canShare?: (d: { files: File[] }) => boolean
  share?: (d: { files: File[]; title?: string }) => Promise<void>
}

function nav(): NavegadorQueComparte {
  return navigator as unknown as NavegadorQueComparte
}

/** Botón de respaldo cuando Safari ya no deja abrir la hoja de compartir sola. */
function pedirToque(archivo: File) {
  const fondo = document.createElement('div')
  fondo.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom));font-family:Inter,system-ui,sans-serif'
  const caja = document.createElement('div')
  caja.style.cssText = 'background:#141414;border:1px solid #2a2a2a;border-radius:14px;padding:16px;width:100%;max-width:420px;box-sizing:border-box'
  const titulo = document.createElement('div')
  titulo.textContent = 'Archivo listo'
  titulo.style.cssText = 'color:#fff;font-size:15px;font-weight:700;margin-bottom:4px'
  const nombre = document.createElement('div')
  nombre.textContent = archivo.name
  nombre.style.cssText = 'color:#888;font-size:12px;margin-bottom:14px;word-break:break-all'
  const guardar = document.createElement('button')
  guardar.textContent = 'Guardar / compartir'
  guardar.style.cssText = 'width:100%;padding:12px;border:none;border-radius:10px;background:#10B981;color:#000;font-size:15px;font-weight:700;font-family:inherit;margin-bottom:8px'
  const cerrar = document.createElement('button')
  cerrar.textContent = 'Cancelar'
  cerrar.style.cssText = 'width:100%;padding:10px;border:1px solid #2a2a2a;border-radius:10px;background:transparent;color:#aaa;font-size:14px;font-family:inherit'
  const quitar = () => fondo.remove()
  guardar.onclick = () => {
    const n = nav()
    quitar()
    if (n.share) n.share({ files: [archivo], title: archivo.name }).catch(() => { /* cancelado por el usuario */ })
    else descargarComoSiempre(archivo, archivo.name)
  }
  cerrar.onclick = quitar
  fondo.onclick = (e) => { if (e.target === fondo) quitar() }
  caja.appendChild(titulo); caja.appendChild(nombre); caja.appendChild(guardar); caja.appendChild(cerrar)
  fondo.appendChild(caja)
  document.body.appendChild(fondo)
}

/** Guarda un archivo ya generado (blob). En celular abre la hoja de compartir. */
export async function guardarBlob(blob: Blob, nombre: string): Promise<void> {
  const limpio = nombreSeguro(nombre)
  const n = nav()
  if (esCelular() && n.canShare && n.share) {
    const archivo = new File([blob], limpio, { type: blob.type || tipoDe(limpio) })
    let puede = false
    try { puede = n.canShare({ files: [archivo] }) } catch { puede = false }
    if (puede) {
      try {
        await n.share({ files: [archivo], title: limpio })
        return
      } catch (e: any) {
        if (e && e.name === 'AbortError') return // el usuario cerró la hoja
        pedirToque(archivo)                      // venció el permiso del toque
        return
      }
    }
  }
  descargarComoSiempre(blob, limpio)
}

/** Baja un archivo de una URL del ERP y lo guarda. Lanza error si falla. */
export async function guardarDesdeUrl(url: string, nombre: string): Promise<void> {
  const r = await fetch(url)
  if (!r.ok) throw new Error('No se pudo descargar el archivo (HTTP ' + r.status + ')')
  const blob = await r.blob()
  await guardarBlob(blob, nombre)
}

/** URL del proxy de FacturAPI para el PDF o XML de un CFDI. */
export function urlFacturaApi(facturapiId: string, modo: 'test' | 'live', ext: 'pdf' | 'xml'): string {
  return '/api/facturapi?action=download_' + ext + '&mode=' + modo + '&id=' + encodeURIComponent(facturapiId)
}

export interface DatosNombreFactura {
  serie?: string | null
  folio?: string | null
  uuid_fiscal?: string | null
  direccion?: string | null
  receptor_nombre?: string | null
  emisor_nombre?: string | null
}

/** "Factura A102 DESARROLLOS CHAC MOOL.pdf" */
export function nombreFactura(f: DatosNombreFactura, ext: 'pdf' | 'xml'): string {
  const folio = (f.serie || '') + (f.folio || '') || (f.uuid_fiscal || '').slice(0, 8)
  const quien = f.direccion === 'recibida' ? f.emisor_nombre : f.receptor_nombre
  return nombreSeguro('Factura ' + folio + (quien ? ' ' + quien : '')) + '.' + ext
}

/** PDF o XML de una factura timbrada, con aviso si algo falla. */
export async function guardarFactura(f: DatosNombreFactura & { facturapi_id?: string | null; sandbox?: boolean | null }, ext: 'pdf' | 'xml'): Promise<void> {
  if (!f.facturapi_id) { alert('Esta factura no tiene ID de FacturAPI'); return }
  try {
    await guardarDesdeUrl(urlFacturaApi(f.facturapi_id, f.sandbox ? 'test' : 'live', ext), nombreFactura(f, ext))
  } catch (e: any) {
    alert('No se pudo descargar el ' + ext.toUpperCase() + ': ' + (e?.message || e))
  }
}
