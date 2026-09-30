// ═══════════════════════════════════════════════════════════════════════════
//  El TEXTO del aviso de pago a Logística. Una sola versión.
//
//  Lo usan dos caminos distintos:
//    · el ERP, cuando registras el pago en Compras (src/lib/avisoPagoLogistica)
//    · el atajo del celular, cuando subes el comprobante desde el banco
//      (api/extract.ts?action=comprobante_pago)
//
//  Vive en `api/` y NO en `src/` por una razón dura: una función de Vercel
//  **no puede importar de src/** — no lo traza al bundle y la función arranca
//  en producción con ERR_MODULE_NOT_FOUND. Al revés sí: Vite alcanza cualquier
//  archivo del repo. Así que el archivo compartido tiene que estar de este
//  lado.
//
//  El guión bajo del nombre importa: Vercel no convierte en función a los
//  archivos de `api/` que empiezan con `_`. Sin él, este archivo gastaría uno
//  de los 12 cupos del plan Hobby, que ya están llenos.
//
//  Es una función PURA: recibe datos, devuelve texto. Ni base de datos ni
//  correo, para que se pueda probar imprimiéndola.
// ═══════════════════════════════════════════════════════════════════════════

export const CORREO_LOGISTICA = 'logistica@omniious.com'
export const CORREO_COPIA = 'elias@omniious.com'

/** Los mismos textos que se ven en Compras (LOGISTICS_CFG). */
export const MODO_LOGISTICA: Record<string, string> = {
  pending:            'todavía no se decide cómo llega',
  pickup_to_bodega:   'OMM la recolecta y la lleva a bodega',
  pickup_to_obra:     'OMM la recolecta y la lleva directo a la obra',
  supplier_to_bodega: 'el proveedor la envía a bodega OMM',
  supplier_to_obra:   'el proveedor la envía directo a la obra',
}

export const ESPECIALIDAD: Record<string, string> = {
  esp: 'Especiales', elec: 'Eléctrico', ilum: 'Iluminación',
  cort: 'Cortinas', dist: 'Distribución', proy: 'Proyecto',
}

export interface DatosAviso {
  folio: string
  proveedor: string
  obra: string
  claveLead?: string | null
  concepto?: string | null
  esServicio: boolean
  especialidad?: string | null
  monto: number
  moneda: string
  fecha: string
  metodo: string
  referencia?: string | null
  conComprobante: boolean
  totalOC: number
  pagadoAntes: number
  modoLogistica?: string | null
  entregaEsperada?: string | null
  partidas: Array<{ name?: string; quantity?: number | null; unit?: string | null }>
  /** De dónde salió el registro. Cambia una línea al pie del correo. */
  origen?: 'erp' | 'comprobante'
}

export const dineroAviso = (n: number, moneda: string) =>
  new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + moneda

export const fechaLargaAviso = (iso: string) => {
  // Una fecha 'yyyy-mm-dd' con new Date() se interpreta en UTC y en México se
  // ve un día antes. Se parte a mano.
  const [a, m, d] = (iso || '').split('-').map(Number)
  if (!a || !m || !d) return iso
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']
  return `${d} de ${meses[m - 1]} de ${a}`
}

export function construirAvisoPago(d: DatosAviso): { asunto: string; cuerpo: string; saldada: boolean } {
  const pagadoAhora = d.pagadoAntes + d.monto
  const falta = Math.max(0, d.totalOC - pagadoAhora)
  const saldada = falta < 0.01

  const partidas = d.partidas || []
  const listado = partidas.slice(0, 12)
    .map(i => `  · ${i.name}${i.quantity ? ` — ${i.quantity} ${i.unit || 'pza'}` : ''}`)
    .join('\n')
  const sobran = partidas.length - 12

  const asunto =
    (saldada ? 'OC saldada' : 'Pago registrado') +
    ` · ${d.folio} · ${d.proveedor} · ${dineroAviso(d.monto, d.moneda)}`

  const cuerpo = [
    saldada
      ? `La orden ${d.folio} quedó SALDADA. Ya está pagada completa.`
      : `Se registró un pago de la orden ${d.folio}.`,
    '',
    `Proveedor:  ${d.proveedor}`,
    `Obra:       ${d.obra}${d.claveLead ? ` (${d.claveLead})` : ''}`,
    `Concepto:   ${d.concepto || 'sin descripción'}`,
    `Tipo:       ${d.esServicio ? 'Servicio / destajo' : 'Material'}${d.especialidad ? ` · ${ESPECIALIDAD[d.especialidad] || d.especialidad}` : ''}`,
    '',
    `Pago:       ${dineroAviso(d.monto, d.moneda)} el ${fechaLargaAviso(d.fecha)}`,
    `            ${d.metodo}${d.referencia ? ' · ref. ' + d.referencia : ''}`,
    `Comprobante: ${d.conComprobante ? 'sí, está cargado en el ERP' : 'todavía no se carga'}`,
    '',
    `Total de la orden: ${dineroAviso(d.totalOC, d.moneda)}`,
    `Pagado:            ${dineroAviso(pagadoAhora, d.moneda)}`,
    saldada ? 'Saldo:             0.00 — queda saldada' : `FALTA:             ${dineroAviso(falta, d.moneda)}`,
    '',
    d.esServicio
      ? 'Es una orden de servicio (mano de obra), no lleva material que recolectar.'
      : `Cómo llega: ${MODO_LOGISTICA[d.modoLogistica || 'pending'] || 'sin definir'}.`,
    !d.esServicio && d.entregaEsperada ? `Entrega esperada: ${fechaLargaAviso(String(d.entregaEsperada).slice(0, 10))}` : null,
    !d.esServicio && partidas.length
      ? `\nQué trae (${partidas.length} ${partidas.length === 1 ? 'partida' : 'partidas'}):\n${listado}${sobran > 0 ? `\n  · … y ${sobran} más` : ''}`
      : null,
    '',
    !d.esServicio && !saldada
      ? 'Ojo: la orden todavía trae saldo. Antes de ir por el material, confirma con el proveedor si suelta contra este pago.'
      : null,
    '',
    'La orden completa está en el ERP: https://omm-erp.vercel.app/compras',
    '',
    d.origen === 'comprobante'
      ? '— Aviso automático del ERP de OMM, disparado al subir el comprobante del banco desde el celular. No hace falta contestarlo.'
      : '— Aviso automático del ERP de OMM. No hace falta contestarlo.',
  // OJO: se filtra por null, NO por cadena vacía. Las cadenas vacías de esta
  // lista son los renglones en blanco que separan los bloques del correo;
  // filtrarlas deja un muro de texto ilegible (ya pasó al probarlo).
  ].filter(l => l !== null).join('\n')
    // Un renglón condicional que no aplica deja sus dos blancos pegados.
    .replace(/\n{3,}/g, '\n\n')

  return { asunto, cuerpo, saldada }
}
