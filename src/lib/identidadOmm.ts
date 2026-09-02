// Los datos de la casa que salen en el membrete de cualquier documento.
//
// Elias los captura una vez en Cotizaciones → PDF y quedan en localStorage bajo
// `omm_pdf_header`. Vive aquí para que un documento nuevo no vuelva a inventar
// sus propios defaults: si el RFC se corrige en un lado, se corrige en todos.
//
// El logo NO se declara aquí: es src/assets/logo.ts (OMNIIOUS_LOGO), el mismo
// que ya usan las órdenes de compra, las facturas, la nómina y las pólizas.

export const CLAVE_MEMBRETE = 'omm_pdf_header'

export interface IdentidadOmm {
  razonSocial: string
  rfc: string
  domicilio: string
  codigoPostal: string
  ciudad: string
  regimenFiscal: string
  telefono: string
  email: string
  web: string
  responsableNombre: string
  responsablePuesto: string
}

/**
 * Lo que se sabe de cierto va aquí; lo demás queda como placeholder y se
 * captura desde la pantalla. El RFC ya estaba escrito a mano en
 * estimacionPdf.ts, cobranzaDocs.ts y la facturación — pero NO en el membrete,
 * así que las cotizaciones salían sin él. Aquí queda.
 */
export const IDENTIDAD_DEFAULT: IdentidadOmm = {
  razonSocial: 'OMM Technologies S.A. de C.V.',
  rfc: 'OTE210910PW5',
  domicilio: '[Dirección fiscal pendiente]',
  codigoPostal: '[CP]',
  ciudad: 'Ciudad de México, México',
  regimenFiscal: '601 — General de Ley Personas Morales',
  telefono: '[Teléfono pendiente]',
  email: '[email pendiente]',
  web: 'www.ommtechnologies.mx',
  responsableNombre: 'Elias Gabriel Micha Cohen',
  responsablePuesto: 'Director General',
}

/** Lo capturado, con los defaults de respaldo. Nunca truena. */
export function identidadOmm(): IdentidadOmm {
  try {
    const raw = localStorage.getItem(CLAVE_MEMBRETE)
    return raw ? { ...IDENTIDAD_DEFAULT, ...JSON.parse(raw) } : IDENTIDAD_DEFAULT
  } catch { return IDENTIDAD_DEFAULT }
}

/** Un placeholder no se imprime: mejor dejar el renglón vacío que enseñarlo. */
export const sinPlaceholder = (v?: string | null) =>
  !v || /^\[.*\]$/.test(v.trim()) ? '' : v.trim()

/** El folio de la casa, igual que en la vista de cotizaciones. */
export const folioOmm = (id: string) => `OMM-${String(id || '').substring(0, 8).toUpperCase()}`
