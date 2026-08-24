// ═══════════════════════════════════════════════════════════════════════════
// ImportarCatalogo — subir una lista de precios completa, con vista previa.
//
// La regla de oro: NADA se escribe en el catálogo antes de que una persona vea
// qué va a pasar. Una lista de miles de renglones con la columna equivocada
// puede reventar todos los precios del ERP en un clic, y eso se descubre
// semanas después, cotizando mal.
//
// Por eso la pantalla tiene tres pasos y no se puede saltar ninguno:
//   1. Archivo   — se lee local, sin mandar nada a ningún lado
//   2. Columnas  — se detectan solas y se corrigen a mano si hace falta
//   3. Previa    — cuántos entran, a cuántos les sube el precio y en cuánto
// ═══════════════════════════════════════════════════════════════════════════
import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { X, Upload, Loader2, Check, AlertTriangle, FileSpreadsheet } from 'lucide-react'
import {
  Mapeo, MAPEO_VACIO, FilaCruda, FilaImport, ACCION_CFG,
  detectarColumnas, prepararFilas, resumir, leerArchivo,
} from '../lib/importadorCatalogo'

const n = (v: any) => Number(v) || 0

const CAMPOS: Array<{ k: keyof Mapeo; label: string; req?: boolean; ayuda: string }> = [
  { k: 'modelo', label: 'Número de parte', req: true, ayuda: 'La identidad del producto. Sin esto no se puede saber si ya existe.' },
  { k: 'name', label: 'Nombre / descripción', req: true, ayuda: 'Lo que se ve en la cotización.' },
  { k: 'costo', label: 'Costo', ayuda: 'Lo que le cuesta a OMM. Si no viene, se calcula desde la lista con el descuento de compra.' },
  { k: 'precioVenta', label: 'Precio de venta', ayuda: 'Lo que cobra OMM. Si no viene, se usa la lista, o costo × margen.' },
  { k: 'precioLista', label: 'Precio de lista', ayuda: 'El MSRP del fabricante.' },
  { k: 'marca', label: 'Marca', ayuda: '' },
  { k: 'descripcion', label: 'Descripción larga', ayuda: '' },
  { k: 'unidad', label: 'Unidad', ayuda: '' },
]

export default function ImportarCatalogo({ onCerrar, onListo }: {
  onCerrar: () => void
  onListo: () => void
}) {
  const [paso, setPaso] = useState<1 | 2 | 3>(1)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [hoja, setHoja] = useState('')
  const [columnas, setColumnas] = useState<string[]>([])
  const [crudas, setCrudas] = useState<FilaCruda[]>([])
  const [mapeo, setMapeo] = useState<Mapeo>(MAPEO_VACIO)
  const [existentes, setExistentes] = useState<any[]>([])
  const [margen, setMargen] = useState(2)
  const [descuentoCompra, setDescuentoCompra] = useState(0)
  const [marcaDefault, setMarcaDefault] = useState('Lutron')
  const [moneda, setMoneda] = useState<'USD' | 'MXN'>('USD')
  const [especialidad, setEspecialidad] = useState('esp')
  const [sistema, setSistema] = useState('Control de iluminacion')
  const [leyendo, setLeyendo] = useState(false)
  const [aplicando, setAplicando] = useState('')
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function elegir(file: File) {
    setLeyendo(true); setError('')
    try {
      const { columnas: cols, filas, hoja: h } = await leerArchivo(file)
      setArchivo(file); setColumnas(cols); setCrudas(filas); setHoja(h)
      setMapeo(detectarColumnas(cols))
      // El catálogo completo se trae una sola vez: con 2,000+ productos, pedir
      // fila por fila sería una consulta por renglón del archivo.
      const todos: any[] = []
      for (let off = 0; off < 50000; off += 1000) {
        const { data } = await supabase.from('catalog_products')
          .select('id,modelo,sku,cost,precio_venta').order('id').range(off, off + 999)
        if (!data || data.length === 0) break
        todos.push(...data)
        if (data.length < 1000) break
      }
      setExistentes(todos)
      setPaso(2)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally { setLeyendo(false) }
  }

  const filas: FilaImport[] = useMemo(() => {
    if (!mapeo.modelo || crudas.length === 0) return []
    return prepararFilas(crudas, mapeo, existentes, {
      margenDefault: margen,
      descuentoCompraPct: descuentoCompra || undefined,
      marcaDefault,
    })
  }, [crudas, mapeo, existentes, margen, descuentoCompra, marcaDefault])

  const res = useMemo(() => resumir(filas), [filas])
  const aplicables = filas.filter(f => f.accion === 'nuevo' || f.accion === 'sube' || f.accion === 'baja')

  async function aplicar() {
    if (aplicables.length === 0) { alert('No hay nada que aplicar.'); return }
    const nuevos = aplicables.filter(f => f.accion === 'nuevo')
    const cambios = aplicables.filter(f => f.accion !== 'nuevo')
    if (!confirm(
      `Se van a escribir ${aplicables.length} productos:\n\n` +
      `· ${nuevos.length} altas nuevas\n` +
      `· ${cambios.length} actualizaciones de precio\n\n` +
      `Los ${res.iguales} sin cambio, ${res.sinParte} sin número de parte y ${res.sinPrecio} sin precio NO se tocan.\n\n¿Continuar?`
    )) return

    setAplicando('Preparando…')
    let altas = 0, updates = 0
    try {
      // Altas en bloques: un insert de 3,000 filas se cae por tamaño.
      for (let i = 0; i < nuevos.length; i += 200) {
        const bloque = nuevos.slice(i, i + 200)
        setAplicando(`Dando de alta ${i + bloque.length} de ${nuevos.length}…`)
        const { error: e } = await supabase.from('catalog_products').insert(bloque.map(f => ({
          name: f.name,
          description: f.descripcion || null,
          marca: f.marca || null,
          modelo: f.modelo,
          sku: f.modelo,
          system: sistema,
          specialty: especialidad,
          type: 'material',
          unit: f.unidad || 'pza',
          cost: f.costo,
          precio_venta: f.precioVenta,
          precio_lista: f.precioLista || null,
          moneda,
          iva_rate: 0.16,
          is_active: true,
          precio_actualizado_at: new Date().toISOString(),
        })))
        if (e) throw new Error('Al dar de alta: ' + e.message)
        altas += bloque.length
      }

      // Actualizaciones: una por producto, en tandas paralelas de 25.
      for (let i = 0; i < cambios.length; i += 25) {
        const bloque = cambios.slice(i, i + 25)
        setAplicando(`Actualizando precios ${i + bloque.length} de ${cambios.length}…`)
        await Promise.all(bloque.map(f => supabase.from('catalog_products').update({
          cost: f.costo,
          precio_venta: f.precioVenta,
          precio_lista: f.precioLista || null,
          precio_actualizado_at: new Date().toISOString(),
        }).eq('id', f.existenteId!)))
        updates += bloque.length
      }
      setResultado(`Listo: ${altas} productos nuevos y ${updates} precios actualizados.`)
      onListo()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally { setAplicando('') }
  }

  const th: React.CSSProperties = { padding: '6px 8px', fontSize: 9, fontWeight: 600, color: '#555', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '4px 8px', fontSize: 11, color: '#ccc', borderBottom: '1px solid #161616' }
  const inp: React.CSSProperties = { background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 7px', fontSize: 11, fontFamily: 'inherit', outline: 'none' }

  const Kpi = ({ label, v, color, nota }: { label: string; v: any; color: string; nota?: string }) => (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: '8px 12px', minWidth: 110 }}>
      <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color, marginTop: 2 }}>{v}</div>
      {nota ? <div style={{ fontSize: 9, color: '#555' }}>{nota}</div> : null}
    </div>
  )

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9998, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 16, overflow: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0f0f0f', border: '1px solid #222', borderRadius: 12, width: '100%', maxWidth: 1180, display: 'flex', flexDirection: 'column' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderBottom: '1px solid #222' }}>
          <FileSpreadsheet size={16} style={{ color: '#10B981' }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Importar lista de precios</div>
          <div style={{ display: 'flex', gap: 4, marginLeft: 10 }}>
            {[[1, 'Archivo'], [2, 'Columnas'], [3, 'Vista previa']].map(([p, l]) => (
              <span key={p as number} style={{
                fontSize: 10, padding: '2px 9px', borderRadius: 20,
                background: paso === p ? '#10B98122' : 'transparent',
                border: '1px solid ' + (paso === p ? '#10B98155' : '#2a2a2a'),
                color: paso === p ? '#10B981' : (paso > (p as number) ? '#666' : '#444'),
              }}>{p as number}. {l as string}</span>
            ))}
          </div>
          <button onClick={onCerrar} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {error && (
          <div style={{ padding: '8px 16px', background: '#DC262611', borderBottom: '1px solid #DC262633', fontSize: 11, color: '#DC2626' }}>{error}</div>
        )}
        {resultado && (
          <div style={{ padding: '10px 16px', background: '#10B98111', borderBottom: '1px solid #10B98133', fontSize: 12, color: '#10B981', fontWeight: 600 }}>{resultado}</div>
        )}

        {/* ── Paso 1: archivo ── */}
        {paso === 1 && (
          <div style={{ padding: 20 }}>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) elegir(f) }}
              onClick={() => fileRef.current?.click()}
              style={{ border: '1px dashed #333', borderRadius: 10, padding: '32px 20px', textAlign: 'center', cursor: 'pointer', background: '#111' }}>
              {leyendo ? <Loader2 size={22} style={{ color: '#10B981' }} className="spin" /> : <Upload size={22} style={{ color: '#666' }} />}
              <div style={{ fontSize: 13, color: '#ccc', marginTop: 8 }}>{leyendo ? 'Leyendo el archivo…' : 'Arrastra el Excel o haz clic para elegirlo'}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>.xlsx, .xls o .csv · el archivo se lee en tu navegador, no se sube a ningún lado</div>
            </div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) elegir(f); e.currentTarget.value = '' }} />
          </div>
        )}

        {/* ── Paso 2: columnas ── */}
        {paso === 2 && (
          <div style={{ padding: '16px 20px' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
              <b style={{ color: '#fff' }}>{crudas.length.toLocaleString('es-MX')}</b> filas en la hoja «{hoja}» de {archivo?.name}.
              Las columnas se detectaron solas — corrige la que haga falta.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 10, marginBottom: 16 }}>
              {CAMPOS.map(c => (
                <div key={c.k}>
                  <div style={{ fontSize: 10, color: c.req ? '#ccc' : '#666', marginBottom: 3 }}>
                    {c.label}{c.req ? ' *' : ''}
                  </div>
                  <select value={mapeo[c.k]} onChange={e => setMapeo(m => ({ ...m, [c.k]: e.target.value }))}
                    style={{ ...inp, width: '100%', borderColor: c.req && !mapeo[c.k] ? '#DC2626' : '#2a2a2a' }}>
                    <option value="">— ninguna —</option>
                    {columnas.map(col => <option key={col} value={col}>{col}</option>)}
                  </select>
                  {c.ayuda && <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{c.ayuda}</div>}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', padding: '12px 14px', background: '#111', border: '1px solid #1f1f1f', borderRadius: 8 }}>
              {[
                ['Marca por defecto', <input key="m" value={marcaDefault} onChange={e => setMarcaDefault(e.target.value)} style={{ ...inp, width: 110 }} />],
                ['Moneda', <select key="mo" value={moneda} onChange={e => setMoneda(e.target.value as any)} style={{ ...inp, width: 80 }}><option>USD</option><option>MXN</option></select>],
                ['Sistema', <select key="s" value={sistema} onChange={e => setSistema(e.target.value)} style={{ ...inp, width: 160 }}>
                  {['Control de iluminacion', 'Lutron', 'Iluminacion', 'Electrico', 'Cortinas', 'Audio', 'Redes', 'CCTV', 'General'].map(s => <option key={s}>{s}</option>)}
                </select>],
                ['Especialidad', <select key="e" value={especialidad} onChange={e => setEspecialidad(e.target.value)} style={{ ...inp, width: 90 }}>
                  {['esp', 'elec', 'ilum'].map(s => <option key={s}>{s}</option>)}
                </select>],
                ['Margen si no hay venta', <input key="mg" type="number" step="0.05" value={margen} onChange={e => setMargen(n(e.target.value))} style={{ ...inp, width: 70, textAlign: 'right' }} />],
                ['% desc. de compra', <input key="d" type="number" step="1" value={descuentoCompra} onChange={e => setDescuentoCompra(n(e.target.value))} title="Si la lista solo trae precio de lista, el costo se calcula restándole este descuento" style={{ ...inp, width: 70, textAlign: 'right' }} />],
              ].map(([l, el], i) => (
                <div key={i}>
                  <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>{l as string}</div>
                  {el as any}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={() => setPaso(1)} style={{ padding: '7px 14px', fontSize: 12, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid #2a2a2a', background: 'transparent', color: '#888' }}>Atrás</button>
              <button onClick={() => setPaso(3)} disabled={!mapeo.modelo || !mapeo.name}
                style={{ padding: '7px 16px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', borderRadius: 6, cursor: mapeo.modelo && mapeo.name ? 'pointer' : 'default', border: '1px solid #10B98155', background: mapeo.modelo && mapeo.name ? '#10B98122' : '#161616', color: mapeo.modelo && mapeo.name ? '#10B981' : '#555' }}>
                Ver qué va a pasar →
              </button>
            </div>
          </div>
        )}

        {/* ── Paso 3: vista previa ── */}
        {paso === 3 && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '14px 20px', borderBottom: '1px solid #1e1e1e' }}>
              <Kpi label="Nuevos" v={res.nuevos} color="#10B981" />
              <Kpi label="Sube el precio" v={res.suben} color="#D9A441" nota={res.subeProm != null ? `+${Math.round(res.subeProm * 100)}% promedio` : ''} />
              <Kpi label="Baja el precio" v={res.bajan} color="#2563EB" nota={res.bajaProm != null ? `${Math.round(res.bajaProm * 100)}% promedio` : ''} />
              <Kpi label="Sin cambio" v={res.iguales} color="#666" />
              <Kpi label="Sin número de parte" v={res.sinParte} color={res.sinParte ? '#DC2626' : '#666'} nota="no se importan" />
              <Kpi label="Sin precio" v={res.sinPrecio} color={res.sinPrecio ? '#DC2626' : '#666'} nota="no se importan" />
            </div>

            {(res.subeProm != null && res.subeProm > 0.5) || (res.bajaProm != null && res.bajaProm < -0.5) ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', background: '#DC262611', borderBottom: '1px solid #DC262633' }}>
                <AlertTriangle size={14} style={{ color: '#DC2626' }} />
                <span style={{ fontSize: 11, color: '#DC2626' }}>
                  Los precios se mueven muchísimo respecto al catálogo. Revisa que la columna de costo sea la correcta antes de aplicar —
                  suele ser que se mapeó el precio de lista donde va el costo, o al revés.
                </span>
              </div>
            ) : null}

            <div style={{ overflow: 'auto', maxHeight: '48vh' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#161616', position: 'sticky', top: 0, zIndex: 1 }}>
                  {['Fila', 'Acción', 'Número de parte', 'Nombre', 'Costo', 'Antes', 'Venta', 'Lista'].map((h, i) => (
                    <th key={i} style={{ ...th, textAlign: i >= 4 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filas.slice(0, 300).map((f, i) => {
                    const cfg = ACCION_CFG[f.accion]
                    return (
                      <tr key={i} style={{ opacity: f.accion === 'igual' ? 0.45 : 1 }}>
                        <td style={{ ...td, color: '#555' }}>{f.fila}</td>
                        <td style={td}><span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 4, background: cfg.color + '22', color: cfg.color }}>{cfg.label}</span></td>
                        <td style={{ ...td, fontFamily: 'monospace', color: '#10B981' }}>{f.modelo || '—'}</td>
                        <td style={{ ...td, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</td>
                        <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>{f.costo.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                        <td style={{ ...td, textAlign: 'right', color: '#666' }}>
                          {f.costoAnterior != null ? f.costoAnterior.toLocaleString('es-MX', { minimumFractionDigits: 2 }) : '—'}
                          {f.variacion != null && Math.abs(f.variacion) >= 0.01 && (
                            <span style={{ color: f.variacion > 0 ? '#D9A441' : '#2563EB', marginLeft: 5 }}>
                              {f.variacion > 0 ? '+' : ''}{Math.round(f.variacion * 100)}%
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>{f.precioVenta.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                        <td style={{ ...td, textAlign: 'right', color: '#666' }}>{f.precioLista ? f.precioLista.toLocaleString('es-MX', { minimumFractionDigits: 2 }) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {filas.length > 300 && (
                <div style={{ padding: '8px 20px', fontSize: 10, color: '#666', textAlign: 'center' }}>
                  Se muestran 300 de {filas.length.toLocaleString('es-MX')} filas. Los totales de arriba sí cuentan todas.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '12px 20px', borderTop: '1px solid #1e1e1e' }}>
              <button onClick={() => setPaso(2)} disabled={!!aplicando}
                style={{ padding: '7px 14px', fontSize: 12, fontFamily: 'inherit', borderRadius: 6, cursor: 'pointer', border: '1px solid #2a2a2a', background: 'transparent', color: '#888' }}>← Corregir columnas</button>
              {aplicando && <span style={{ fontSize: 11, color: '#888' }}><Loader2 size={12} className="spin" style={{ verticalAlign: -2 }} /> {aplicando}</span>}
              <button onClick={aplicar} disabled={!!aplicando || aplicables.length === 0}
                style={{ marginLeft: 'auto', padding: '8px 18px', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', borderRadius: 6, cursor: aplicando || !aplicables.length ? 'default' : 'pointer', border: '1px solid #10B98155', background: aplicables.length ? '#10B98122' : '#161616', color: aplicables.length ? '#10B981' : '#555' }}>
                <Check size={13} style={{ verticalAlign: -2 }} /> Aplicar {aplicables.length.toLocaleString('es-MX')} productos
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
