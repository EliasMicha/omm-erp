// ═══════════════════════════════════════════════════════════════════════════
// CotizarConIA — de la lista que manda el proveedor a partidas cotizables.
//
// El flujo real: llega un PDF de Lutron, o tres fotos de una hoja, o un Excel.
// Antes eso se capturaba a mano, renglón por renglón, buscando cada part
// number en el catálogo. Aquí se suben todos los archivos juntos, la IA saca
// las partidas y CADA UNA se amarra al catálogo por número de parte.
//
// La pantalla existe para una sola cosa: que una persona confirme antes de
// cotizar. Por eso cada renglón llega marcado —exacto, probable, revisar,
// nuevo— y los que no son exactos se ven distintos. Un keypad Palladiom negro
// y uno satinado se llaman igual y cuestan distinto; el ERP no adivina esa
// diferencia, la enseña.
// ═══════════════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { X, Upload, Sparkles, Loader2, Trash2, Check, AlertTriangle } from 'lucide-react'
import {
  PartidaExtraida, Emparejamiento, ProductoCatalogo, CONFIANZA_CFG,
  indexarCatalogo, emparejar, consolidar, margenDe, variacionCosto,
  PROMPT_SISTEMA, promptExtraccion, parsearRespuesta, normalizarModelo,
} from '../lib/cotizadorIA'

const n = (v: any) => Number(v) || 0
const r2 = (v: number) => Math.round(n(v) * 100) / 100

const fileToBase64 = (file: File) => new Promise<string>((res, rej) => {
  const r = new FileReader()
  r.onload = () => res(String(r.result).split(',')[1] || '')
  r.onerror = rej
  r.readAsDataURL(file)
})

export interface PartidaLista {
  name: string
  marca: string
  modelo: string
  cantidad: number
  costo: number
  precioPublico: number
  catalogId?: string | null
}

interface Renglon extends Emparejamiento {
  key: string
  incluir: boolean
  costoFinal: number
  margen: number
  productoId: string | null   // '' = ninguno (producto nuevo)
}

export default function CotizarConIA({ catalogo, moneda, onCerrar, onAgregar, onCargos }: {
  catalogo: ProductoCatalogo[]
  moneda: 'MXN' | 'USD'
  onCerrar: () => void
  onAgregar: (partidas: PartidaLista[]) => void
  onCargos?: (c: { moneda?: 'MXN' | 'USD'; fletes?: number; descuentoPct?: number }) => void
}) {
  const [archivos, setArchivos] = useState<File[]>([])
  const [analizando, setAnalizando] = useState('')
  const [error, setError] = useState('')
  const [renglones, setRenglones] = useState<Renglon[]>([])
  const [cargos, setCargos] = useState<{ moneda?: string; fletes: number; descuentoPct: number }>({ fletes: 0, descuentoPct: 0 })
  const [dandoAlta, setDandoAlta] = useState(false)
  const [busqueda, setBusqueda] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const idx = useMemo(() => indexarCatalogo(catalogo), [catalogo])
  const catById = useMemo(() => new Map(catalogo.map(p => [p.id, p])), [catalogo])

  const F = (v: number) => (moneda === 'USD' ? 'US$' : '$') + n(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  function agregarArchivos(lista: FileList | null) {
    if (!lista) return
    setArchivos(prev => [...prev, ...Array.from(lista)])
    setError('')
  }

  /** Lee un archivo con la IA. Cada archivo es su propia petición: así ninguna
   *  pasa del límite de tiempo del servidor por más hojas que traiga. */
  async function leerArchivo(file: File): Promise<{ items: any[]; cargos: any }> {
    const ext = (file.name.split('.').pop() || '').toLowerCase()
    const texto = promptExtraccion()
    let content: any
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      content = [{ type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: await fileToBase64(file) } }, { type: 'text', text: texto }]
    } else if (ext === 'pdf') {
      content = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await fileToBase64(file) } }, { type: 'text', text: texto }]
    } else {
      const t = await file.text()
      content = [{ type: 'text', text: `${texto}\n\nArchivo (${file.name}):\n${t.substring(0, 60000)}` }]
    }
    const res = await fetch('/api/anthropic', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 16000, system: PROMPT_SISTEMA, messages: [{ role: 'user', content }] }),
    })
    const data = await res.json()
    if (data.error) throw new Error(data.error.message || 'Error de la IA')
    const txt = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const parsed = parsearRespuesta(txt)
    return {
      items: (parsed.items || []).map((it: any) => ({ ...it, archivo: file.name })),
      cargos: { moneda: parsed.moneda, fletes: n(parsed.fletes) + n(parsed.factorImportacion), descuentoPct: n(parsed.descuentoPct) },
    }
  }

  async function analizar() {
    if (archivos.length === 0) { setError('Sube al menos un archivo.'); return }
    setError('')
    const todas: PartidaExtraida[] = []
    let cg = { moneda: undefined as any, fletes: 0, descuentoPct: 0 }
    try {
      for (let i = 0; i < archivos.length; i++) {
        setAnalizando(`Leyendo ${archivos[i].name} (${i + 1} de ${archivos.length})…`)
        const { items, cargos: c } = await leerArchivo(archivos[i])
        for (const it of items) {
          todas.push({
            name: String(it.name || '').trim(),
            modelo: String(it.modelo || '').trim(),
            marca: String(it.marca || '').trim() || 'Lutron',
            cantidad: n(it.cantidad) || 1,
            costoUnitario: n(it.costoUnitario),
            archivo: it.archivo,
          })
        }
        if (c.moneda && !cg.moneda) cg.moneda = c.moneda
        cg.fletes += n(c.fletes)
        if (n(c.descuentoPct) > cg.descuentoPct) cg.descuentoPct = n(c.descuentoPct)
      }
      const utiles = todas.filter(p => p.name || p.modelo)
      if (utiles.length === 0) throw new Error('No se detectaron partidas en los archivos.')
      const cons = consolidar(utiles)
      setRenglones(cons.map((ex, i) => {
        const m = emparejar(ex, idx)
        return {
          ...m,
          key: `r${i}_${normalizarModelo(ex.modelo) || i}`,
          incluir: true,
          // El costo del documento manda: es lo que el proveedor cobra HOY.
          // El del catálogo puede tener meses. La diferencia se enseña aparte.
          costoFinal: n(ex.costoUnitario) || n(m.producto?.cost),
          margen: margenDe(m.producto),
          productoId: m.producto?.id || null,
        }
      }))
      setCargos({ moneda: cg.moneda, fletes: r2(cg.fletes), descuentoPct: cg.descuentoPct })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setAnalizando('')
    }
  }

  const set = (key: string, campo: Partial<Renglon>) =>
    setRenglones(prev => prev.map(r => r.key === key ? { ...r, ...campo } : r))

  function elegirProducto(key: string, prodId: string) {
    const p = prodId ? catById.get(prodId) || null : null
    setRenglones(prev => prev.map(r => {
      if (r.key !== key) return r
      return {
        ...r, productoId: prodId || null, producto: p,
        confianza: p ? 'exacto' : 'nuevo',
        motivo: p ? 'Elegido a mano' : 'Se dará de alta como producto nuevo',
        margen: margenDe(p),
      }
    }))
    setBusqueda(b => ({ ...b, [key]: '' }))
  }

  const incluidos = renglones.filter(r => r.incluir)
  const sinRevisar = incluidos.filter(r => r.confianza === 'dudoso' || r.confianza === 'nuevo')
  const totalCosto = incluidos.reduce((s, r) => s + n(r.costoFinal) * n(r.extraido.cantidad), 0)
  const totalPublico = incluidos.reduce((s, r) => s + r2(n(r.costoFinal) * n(r.margen)) * n(r.extraido.cantidad), 0)

  /** Da de alta en el catálogo los renglones sin producto. Así el catálogo
   *  crece con cada lista que entra, en vez de quedarse chico para siempre. */
  async function altaEnCatalogo() {
    const nuevos = incluidos.filter(r => !r.productoId && (r.extraido.modelo || r.extraido.name))
    if (nuevos.length === 0) { alert('No hay productos nuevos por dar de alta.'); return }
    if (!confirm(`Dar de alta ${nuevos.length} producto(s) en el catálogo?\n\nSe guardan con su marca, modelo, costo y precio público. Los podrás ajustar después en Catálogo.`)) return
    setDandoAlta(true)
    try {
      const filas = nuevos.map(r => ({
        name: r.extraido.name || r.extraido.modelo,
        marca: r.extraido.marca || null,
        modelo: r.extraido.modelo || null,
        sku: r.extraido.modelo || null,
        system: /lutron/i.test(r.extraido.marca) ? 'Control de iluminacion' : 'General',
        specialty: 'esp',
        unit: 'pza',
        cost: r2(r.costoFinal),
        precio_venta: r2(n(r.costoFinal) * n(r.margen)),
        moneda,
        is_active: true,
      }))
      const { data, error: e } = await supabase.from('catalog_products').insert(filas).select('id,modelo')
      if (e) { alert('No se pudieron dar de alta: ' + e.message); return }
      // Amarrar los renglones a los productos recién creados
      const porModelo = new Map(((data as any[]) || []).map(p => [normalizarModelo(p.modelo), p.id]))
      setRenglones(prev => prev.map(r => {
        if (r.productoId) return r
        const id = porModelo.get(normalizarModelo(r.extraido.modelo))
        return id ? { ...r, productoId: id, confianza: 'exacto', motivo: 'Recién dado de alta' } : r
      }))
      alert(`${filas.length} producto(s) agregados al catálogo.`)
    } finally { setDandoAlta(false) }
  }

  function agregar() {
    if (incluidos.length === 0) { alert('No hay partidas seleccionadas.'); return }
    if (sinRevisar.length > 0 && !confirm(
      `${sinRevisar.length} partida(s) no están confirmadas contra el catálogo (marcadas "Revisar" o "Nuevo").\n\n` +
      `Se van a agregar con el precio que capturaste. ¿Continuar?`)) return
    onAgregar(incluidos.map(r => ({
      name: r.producto?.name || r.extraido.name || r.extraido.modelo,
      marca: r.producto?.marca || r.extraido.marca || '',
      modelo: r.producto?.modelo || r.extraido.modelo || '',
      cantidad: n(r.extraido.cantidad) || 1,
      costo: r2(r.costoFinal),
      precioPublico: r2(n(r.costoFinal) * n(r.margen)),
      catalogId: r.productoId,
    })))
    if (onCargos) onCargos({
      moneda: (cargos.moneda === 'USD' || cargos.moneda === 'MXN') ? cargos.moneda : undefined,
      fletes: cargos.fletes || undefined,
      descuentoPct: cargos.descuentoPct || undefined,
    })
    onCerrar()
  }

  const th: React.CSSProperties = { padding: '6px 8px', fontSize: 9, fontWeight: 600, color: '#555', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '5px 8px', fontSize: 11, color: '#ccc', borderBottom: '1px solid #161616', verticalAlign: 'top' }
  const inp: React.CSSProperties = { background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 4, padding: '3px 6px', fontSize: 11, fontFamily: 'inherit', outline: 'none' }

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f0f', border: '1px solid #222', borderRadius: 12, width: '100%', maxWidth: 1280, display: 'flex', flexDirection: 'column' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #222' }}>
          <Sparkles size={16} style={{ color: '#A78BFA' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Cotizar con IA</div>
          <span style={{ fontSize: 11, color: '#666' }}>sube la lista del proveedor — PDF, fotos, Excel o texto</span>
          <button onClick={onCerrar} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {/* Archivos */}
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e1e1e' }}>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); agregarArchivos(e.dataTransfer.files) }}
            onClick={() => fileRef.current?.click()}
            style={{ border: '1px dashed #333', borderRadius: 8, padding: '14px 16px', textAlign: 'center', cursor: 'pointer', background: '#111' }}>
            <Upload size={16} style={{ color: '#666' }} />
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Arrastra aquí los archivos o haz clic para elegirlos</div>
            <div style={{ fontSize: 10, color: '#555', marginTop: 2 }}>Puedes subir varias hojas o fotos de la misma lista: se juntan en una sola cotización.</div>
          </div>
          <input ref={fileRef} type="file" multiple accept=".pdf,image/*,.csv,.txt" style={{ display: 'none' }}
            onChange={e => { agregarArchivos(e.target.files); e.currentTarget.value = '' }} />

          {archivos.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
              {archivos.map((f, i) => (
                <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 20, padding: '3px 10px', color: '#ccc' }}>
                  {f.name}
                  <span onClick={() => setArchivos(p => p.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: '#666' }}>✕</span>
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <button onClick={analizar} disabled={!!analizando || archivos.length === 0}
              style={{ padding: '7px 14px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', borderRadius: 6, cursor: analizando || !archivos.length ? 'default' : 'pointer', border: '1px solid #A78BFA55', background: archivos.length ? '#A78BFA22' : '#161616', color: archivos.length ? '#A78BFA' : '#555', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {analizando ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
              {analizando ? 'Analizando…' : 'Analizar y emparejar con el catálogo'}
            </button>
            {analizando && <span style={{ fontSize: 11, color: '#888' }}>{analizando}</span>}
            {error && <span style={{ fontSize: 11, color: '#DC2626' }}>{error}</span>}
          </div>
        </div>

        {renglones.length > 0 && (
          <>
            {/* Resumen */}
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', padding: '10px 16px', background: '#121212', borderBottom: '1px solid #1e1e1e' }}>
              <span style={{ fontSize: 11, color: '#888' }}><b style={{ color: '#fff' }}>{incluidos.length}</b> partidas</span>
              {(['exacto', 'probable', 'dudoso', 'nuevo'] as const).map(c => {
                const q = incluidos.filter(r => r.confianza === c).length
                if (!q) return null
                return <span key={c} style={{ fontSize: 11, color: CONFIANZA_CFG[c].color }}>{q} {CONFIANZA_CFG[c].label.toLowerCase()}</span>
              })}
              <span style={{ fontSize: 11, color: '#888' }}>Costo <b style={{ color: '#ccc' }}>{F(totalCosto)}</b></span>
              <span style={{ fontSize: 11, color: '#888' }}>Público <b style={{ color: '#10B981' }}>{F(totalPublico)}</b></span>
              {cargos.fletes > 0 && <span style={{ fontSize: 11, color: '#D9A441' }}>Fletes/importación {F(cargos.fletes)}</span>}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button onClick={altaEnCatalogo} disabled={dandoAlta}
                  style={{ padding: '5px 10px', fontSize: 11, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid #2a2a2a', background: 'transparent', color: '#888' }}>
                  {dandoAlta ? 'Dando de alta…' : 'Dar de alta los nuevos en catálogo'}
                </button>
                <button onClick={agregar}
                  style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid #10B98155', background: '#10B98122', color: '#10B981' }}>
                  <Check size={12} style={{ verticalAlign: -2 }} /> Agregar {incluidos.length} a la cotización
                </button>
              </div>
            </div>

            {sinRevisar.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', background: '#D9A44111', borderBottom: '1px solid #D9A44133' }}>
                <AlertTriangle size={14} style={{ color: '#D9A441' }} />
                <span style={{ fontSize: 11, color: '#D9A441' }}>
                  {sinRevisar.length} partida(s) sin confirmar. Un número de parte que no está en el catálogo NO se empareja por parecido de nombre a propósito:
                  dos acabados del mismo keypad se llaman igual y cuestan distinto.
                </span>
              </div>
            )}

            {/* Tabla de revisión */}
            <div style={{ overflow: 'auto', maxHeight: '58vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#161616', position: 'sticky', top: 0, zIndex: 1 }}>
                  {['', 'Del documento', 'Match', 'Producto del catálogo', 'Cant.', 'Costo', 'Margen', 'Público', 'Importe'].map((h, i) => (
                    <th key={i} style={{ ...th, textAlign: i >= 4 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {renglones.map(r => {
                    const cfg = CONFIANZA_CFG[r.confianza]
                    const publico = r2(n(r.costoFinal) * n(r.margen))
                    const varia = variacionCosto({ ...r.extraido, costoUnitario: r.costoFinal }, r.producto)
                    const q = busqueda[r.key] || ''
                    const sugerencias = q.length >= 2
                      ? catalogo.filter(p => {
                          const t = q.toLowerCase()
                          return String(p.name || '').toLowerCase().includes(t) || String(p.modelo || '').toLowerCase().includes(t) || String(p.sku || '').toLowerCase().includes(t)
                        }).slice(0, 8)
                      : []
                    return (
                      <tr key={r.key} style={{ opacity: r.incluir ? 1 : 0.4, background: r.confianza === 'nuevo' ? '#17121f' : r.confianza === 'dudoso' ? '#1d1a10' : 'transparent' }}>
                        <td style={td}>
                          <input type="checkbox" checked={r.incluir} onChange={e => set(r.key, { incluir: e.target.checked })} style={{ accentColor: '#10B981' }} />
                        </td>
                        <td style={{ ...td, maxWidth: 260 }}>
                          <div style={{ color: '#fff', fontSize: 11 }}>{r.extraido.name || '—'}</div>
                          <div style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>{r.extraido.modelo || 'sin número de parte'}</div>
                          {r.extraido.archivo && <div style={{ fontSize: 9, color: '#444' }}>{r.extraido.archivo}</div>}
                        </td>
                        <td style={td}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: cfg.color + '22', color: cfg.color, whiteSpace: 'nowrap' }}>{cfg.label}</span>
                          <div style={{ fontSize: 9, color: '#666', marginTop: 3, maxWidth: 150 }}>{r.motivo}</div>
                        </td>
                        <td style={{ ...td, minWidth: 250 }}>
                          {r.producto ? (
                            <div>
                              <div style={{ fontSize: 11, color: '#ccc' }}>{r.producto.name}</div>
                              <div style={{ fontSize: 10, color: '#10B981', fontFamily: 'monospace' }}>{r.producto.modelo || r.producto.sku}</div>
                              <span onClick={() => elegirProducto(r.key, '')} style={{ fontSize: 9, color: '#666', cursor: 'pointer', textDecoration: 'underline' }}>quitar</span>
                            </div>
                          ) : (
                            <div style={{ fontSize: 10, color: '#A78BFA', marginBottom: 3 }}>Se agregará como producto nuevo</div>
                          )}
                          <input value={q} placeholder="Buscar otro del catálogo…"
                            onChange={e => setBusqueda(b => ({ ...b, [r.key]: e.target.value }))}
                            style={{ ...inp, width: '100%', marginTop: 3 }} />
                          {sugerencias.length > 0 && (
                            <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 4, marginTop: 2, maxHeight: 140, overflowY: 'auto' }}>
                              {sugerencias.map(p => (
                                <div key={p.id} onClick={() => elegirProducto(r.key, p.id)}
                                  style={{ padding: '4px 7px', fontSize: 10, color: '#ccc', cursor: 'pointer', borderBottom: '1px solid #1a1a1a' }}>
                                  <span style={{ color: '#10B981', fontFamily: 'monospace' }}>{p.modelo || p.sku || '—'}</span> · {String(p.name || '').slice(0, 48)}
                                  <span style={{ color: '#666' }}> · {F(n(p.cost))}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {r.alternativas.length > 0 && !q && (
                            <div style={{ fontSize: 9, color: '#666', marginTop: 3 }}>
                              Parecidos:{' '}
                              {r.alternativas.map((a, i) => (
                                <span key={a.id} onClick={() => elegirProducto(r.key, a.id)}
                                  style={{ color: '#2563EB', cursor: 'pointer', textDecoration: 'underline', marginRight: 6 }}>
                                  {a.modelo || a.sku || a.name}{i < r.alternativas.length - 1 ? '' : ''}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <input type="number" step="any" value={r.extraido.cantidad}
                            onChange={e => set(r.key, { extraido: { ...r.extraido, cantidad: n(e.target.value) } })}
                            style={{ ...inp, width: 55, textAlign: 'right' }} />
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <input type="number" step="any" value={r.costoFinal}
                            onChange={e => set(r.key, { costoFinal: n(e.target.value) })}
                            style={{ ...inp, width: 80, textAlign: 'right' }} />
                          {varia !== null && Math.abs(varia) >= 0.05 && (
                            <div style={{ fontSize: 9, color: varia > 0 ? '#D9A441' : '#10B981', marginTop: 2 }}
                              title={`El catálogo tenía ${F(n(r.producto?.cost))}`}>
                              {varia > 0 ? '+' : ''}{Math.round(varia * 100)}% vs catálogo
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <input type="number" step="0.05" value={r.margen}
                            onChange={e => set(r.key, { margen: n(e.target.value) })}
                            title="Precio público = costo × margen. Se propone el margen con el que ya se vendía ese producto."
                            style={{ ...inp, width: 55, textAlign: 'right' }} />
                        </td>
                        <td style={{ ...td, textAlign: 'right', color: '#10B981', fontWeight: 600 }}>{F(publico)}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{F(publico * n(r.extraido.cantidad))}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
