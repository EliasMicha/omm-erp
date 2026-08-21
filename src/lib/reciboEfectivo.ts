// ═══════════════════════════════════════════════════════════════════════════
// reciboEfectivo — el papel que respalda un movimiento en efectivo.
//
// El efectivo no deja rastro solo: si Pablo recibe $30,000 para Arcos Bosques,
// lo único que prueba que se entregó es un recibo firmado. Aquí se genera ese
// documento, listo para imprimir y firmar, con folio propio para poder
// referenciarlo después.
//
// Dos formas del mismo papel:
//   RECIBO DE PAGO     (egreso)  — OMM entrega dinero. Firma quien lo recibe.
//   RECIBO DE INGRESO  (ingreso) — OMM recibe dinero. Firma quien lo entrega.
//
// El monto va también con letra: es lo que hace que un recibo no se pueda
// alterar con un trazo de pluma, y es lo que se acostumbra pedir en México.
// ═══════════════════════════════════════════════════════════════════════════

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function menorAMil(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const r = n % 100
  const partes: string[] = []
  if (c > 0) partes.push(CENTENAS[c])
  if (r > 0) {
    if (r < 30) partes.push(UNIDADES[r])
    else {
      const d = Math.floor(r / 10)
      const u = r % 10
      partes.push(u > 0 ? `${DECENAS[d]} y ${UNIDADES[u]}` : DECENAS[d])
    }
  }
  return partes.join(' ')
}

/** «30000.50» → «TREINTA MIL PESOS 50/100 M.N.» */
export function montoConLetra(monto: number, moneda = 'MXN'): string {
  const n = Math.abs(Number(monto) || 0)
  const entero = Math.floor(n)
  const centavos = Math.round((n - entero) * 100)

  let texto: string
  if (entero === 0) texto = 'cero'
  else {
    const millones = Math.floor(entero / 1_000_000)
    const miles = Math.floor((entero % 1_000_000) / 1000)
    const resto = entero % 1000
    const partes: string[] = []
    if (millones > 0) partes.push(millones === 1 ? 'un millón' : `${menorAMil(millones)} millones`)
    if (miles > 0) partes.push(miles === 1 ? 'mil' : `${menorAMil(miles)} mil`)
    if (resto > 0) partes.push(menorAMil(resto))
    texto = partes.join(' ')
  }

  const unidad = moneda === 'USD' ? 'DÓLARES' : moneda === 'EUR' ? 'EUROS' : 'PESOS'
  const sufijo = moneda === 'MXN' ? ' M.N.' : ''
  return `${texto.toUpperCase()} ${unidad} ${String(centavos).padStart(2, '0')}/100${sufijo}`
}

/** RP-260821-417 para pagos, RI-260821-417 para ingresos. */
export function folioRecibo(direccion: string, fecha: string): string {
  const pre = direccion === 'ingreso' ? 'RI' : 'RP'
  const f = (fecha || new Date().toISOString().slice(0, 10)).slice(2).replace(/-/g, '')
  return `${pre}-${f}-${Math.floor(Math.random() * 900 + 100)}`
}

export interface DatosRecibo {
  folio: string
  direccion: string            // 'ingreso' | 'egreso'
  tipo?: string | null         // cobro_cliente | pago_proveedor | nomina
  persona: string
  concepto: string
  monto: number
  moneda?: string | null
  fecha: string
  proyecto?: string | null
  lead?: string | null
  cotizacion?: string | null
  emitidoPor?: string | null
}

const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))

/** Abre el recibo en una ventana nueva, listo para imprimir o guardar en PDF. */
export function generarReciboEfectivo(d: DatosRecibo) {
  const esIngreso = d.direccion === 'ingreso'
  const titulo = esIngreso ? 'RECIBO DE INGRESO' : 'RECIBO DE PAGO'
  const moneda = d.moneda || 'MXN'
  const fechaTxt = (() => {
    try {
      return new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
    } catch { return d.fecha }
  })()
  const importe = Number(d.monto || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  // Quién firma cambia según la dirección del dinero: en un pago firma quien
  // lo recibe, en un ingreso firma quien lo entrega.
  const leyenda = esIngreso
    ? `OMM Technologies SA de CV declara haber <b>RECIBIDO</b> de <b>${esc(d.persona)}</b> la cantidad indicada, por el concepto que se describe.`
    : `Recibí de <b>OMM Technologies SA de CV</b> la cantidad indicada, por el concepto que se describe, quedando conforme y sin nada más que reclamar por este concepto.`
  const etiquetaFirma = esIngreso ? 'Entregó' : 'Recibió'
  const nombreFirma = d.persona

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.folio)}</title><style>
    *{box-sizing:border-box;font-family:Arial,Helvetica,sans-serif}
    body{margin:0;color:#111}
    .hoja{padding:38px 44px;page-break-after:always}
    .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111;padding-bottom:10px}
    .logo{font-size:32px;font-weight:800;letter-spacing:1px}
    .sub{font-size:11px;color:#666;margin-top:2px}
    .folio{font-size:16px;font-weight:700}
    .tt{font-size:17px;font-weight:800;margin:22px 0 4px;text-transform:uppercase;letter-spacing:.5px}
    .linea{height:2px;background:#111;width:64px;margin-bottom:18px}
    table.meta{width:100%;border-collapse:collapse;font-size:12.5px}
    table.meta td{padding:5px 0;vertical-align:top}
    table.meta td.k{color:#666;width:150px}
    .importe{margin:22px 0;border:2px solid #111;border-radius:6px;padding:14px 16px}
    .importe .num{font-size:26px;font-weight:800}
    .importe .letra{font-size:11.5px;color:#333;margin-top:4px;line-height:1.4}
    .leyenda{font-size:12px;line-height:1.6;margin-top:6px}
    .firmas{display:flex;gap:70px;margin-top:70px}
    .fw{flex:1;text-align:center;font-size:12px}
    .ln{border-top:1px solid #111;margin-bottom:6px;height:1px}
    .pie{margin-top:34px;font-size:9.5px;color:#888;border-top:1px solid #ddd;padding-top:8px}
    @media print{.hoja{padding:26px 32px}}
  </style></head><body>
  <div class="hoja">
    <div class="hd">
      <div><div class="logo">OMM</div><div class="sub">OMM Technologies SA de CV · RFC OTE210910PW5</div></div>
      <div style="text-align:right"><div class="folio">${esc(d.folio)}</div><div class="sub">${esc(fechaTxt)}</div></div>
    </div>

    <div class="tt">${titulo}</div><div class="linea"></div>

    <table class="meta">
      <tr><td class="k">${esIngreso ? 'Recibido de' : 'Pagado a'}</td><td><b>${esc(d.persona)}</b></td></tr>
      <tr><td class="k">Concepto</td><td>${esc(d.concepto) || '—'}</td></tr>
      ${d.lead ? `<tr><td class="k">Cliente / Lead</td><td>${esc(d.lead)}</td></tr>` : ''}
      ${d.cotizacion ? `<tr><td class="k">Cotización</td><td>${esc(d.cotizacion)}</td></tr>` : ''}
      ${d.proyecto ? `<tr><td class="k">Proyecto</td><td>${esc(d.proyecto)}</td></tr>` : ''}
      <tr><td class="k">Forma</td><td>Efectivo</td></tr>
    </table>

    <div class="importe">
      <div class="num">$${importe} <span style="font-size:14px;font-weight:600;color:#555">${esc(moneda)}</span></div>
      <div class="letra">(${montoConLetra(d.monto, moneda)})</div>
    </div>

    <div class="leyenda">${leyenda}</div>

    <div class="firmas">
      <div class="fw"><div class="ln"></div>${esc(nombreFirma) || etiquetaFirma}<div class="sub">${etiquetaFirma} · Nombre y firma</div></div>
      <div class="fw"><div class="ln"></div>OMM Technologies<div class="sub">${esIngreso ? 'Recibió' : 'Entregó'} · Nombre y firma</div></div>
    </div>

    <div class="pie">
      Documento interno de control de efectivo. No es un comprobante fiscal digital (CFDI).
      ${d.emitidoPor ? `Emitido por ${esc(d.emitidoPor)}.` : ''}
    </div>
  </div>
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
  </body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
  else alert('El navegador bloqueó la ventana del recibo. Permite las ventanas emergentes de este sitio.')
}
