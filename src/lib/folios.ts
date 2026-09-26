// ─────────────────────────────────────────────────────────────────────────────
//  Folios OMM — como se MUESTRAN. El dato lo genera la base de datos.
//
//   Lead        PILO
//   Cotizacion  PILO-ES01        (se muestra COT-PILO-ES01 mientras no cierre)
//   Compra      PILO-ES01-C03
//
//  El nucleo nunca cambia: al pasar a contrato solo se cae el prefijo COT-.
//  Si el folio cambiara de verdad, las compras, transferencias y facturas
//  hechas durante la cotizacion quedarian apuntando a un codigo muerto.
// ─────────────────────────────────────────────────────────────────────────────

/** Etapas en las que la cotizacion ya es venta: ahi el folio va sin COT-. */
const ETAPAS_VENDIDAS = ['contrato', 'estimacion']

export function prefijoFolio(stage?: string | null): string {
  return ETAPAS_VENDIDAS.includes(String(stage || '')) ? '' : 'COT-'
}

/** El folio como se lee en pantalla y en el PDF. */
export function folioMostrado(folio?: string | null, stage?: string | null): string {
  return folio ? prefijoFolio(stage) + folio : ''
}

/**
 * Forma compacta: solo letras y numeros. Es como se compara contra el concepto
 * de una transferencia, porque cada banco maltrata el texto a su manera.
 */
export function folioCompacto(txt?: string | null): string {
  return (txt || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * El identificador visible de una orden de compra.
 *
 * De 2026-09 en adelante es el folio OMM (PILO-IE01-C03). El consecutivo
 * OC-AAMM-nnn sigue en la base como referencia historica y es el folio de las
 * compras de bodega, que no cuelgan de ninguna cotizacion — asi que leerlo
 * desde aqui siempre da el numero correcto, sin tener que saber cual es cual.
 */
export function folioOC(po: any): string {
  return po?.folio || po?.po_number || ''
}
