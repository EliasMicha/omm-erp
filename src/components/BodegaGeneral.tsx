import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Btn, KpiCard, EmptyState, Loading } from './layout/UI'
import { Warehouse, PackagePlus, Search, X, Trash2, AlertTriangle, Save } from 'lucide-react'
import {
  cargarBodega, guardarConteo,
  type FilaBodega, type ResumenBodega, type LineaConteo,
} from '../lib/bodegaGeneral'

// ─────────────────────────────────────────────────────────────────────────────
//  Bodega general: el material que ya es nuestro y no pertenece a ninguna obra.
//  Es lo que se puede reasignar a un proyecto para volverlo dinero.
// ─────────────────────────────────────────────────────────────────────────────

const F = (n: number) => Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const M = (n: number) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', fontSize: 13, background: '#0e0e0e', border: '1px solid #2a2a2a',
  borderRadius: 8, color: '#eee', fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function BodegaGeneral({ isMobile }: { isMobile?: boolean }) {
  const [filas, setFilas] = useState<FilaBodega[]>([])
  const [resumen, setResumen] = useState<ResumenBodega | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [conteo, setConteo] = useState(false)
  const [soloSinCosto, setSoloSinCosto] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const r = await cargarBodega()
      setFilas(r.filas); setResumen(r.resumen)
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const lista = useMemo(() => {
    const s = q.toLowerCase().trim()
    return filas.filter(f => {
      if (soloSinCosto && f.costo != null) return false
      if (!s) return true
      return (f.descripcion || '').toLowerCase().includes(s)
        || (f.marca || '').toLowerCase().includes(s)
        || (f.modelo || '').toLowerCase().includes(s)
    })
  }, [filas, q, soloSinCosto])

  if (loading) return <Loading />

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        <KpiCard label="Productos distintos" value={F(resumen?.productos || 0)} icon={<Warehouse size={16} />} />
        <KpiCard label="Piezas en bodega" value={F(resumen?.piezas || 0)} color="#2563EB" icon={<PackagePlus size={16} />} />
        <KpiCard label="Valor MXN" value={M(resumen?.valorMXN || 0)} color="#10B981" icon={<Warehouse size={16} />} />
        <KpiCard label="Valor USD" value={M(resumen?.valorUSD || 0)} color="#A78BFA" icon={<Warehouse size={16} />} />
      </div>

      {/* Un producto sin costo en el catalogo no vale cero: vale "no sabemos".
          Decirlo de frente evita que el valor de la bodega se lea como exacto. */}
      {!!resumen?.sinCosto && (
        <div
          onClick={() => setSoloSinCosto(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 12,
            background: soloSinCosto ? '#D9770622' : '#D9770611', border: '1px solid #D9770644',
            borderRadius: 10, padding: '10px 12px', color: '#D97706', fontSize: 12,
          }}>
          <AlertTriangle size={15} />
          <span>
            <b>{resumen.sinCosto}</b> producto{resumen.sinCosto === 1 ? '' : 's'} ({F(resumen.piezasSinCosto)} pza) sin costo en el catálogo.
            No están sumando al valor de arriba — el valor real de la bodega es mayor.
            <span style={{ color: '#fff', marginLeft: 6 }}>{soloSinCosto ? 'Ver todo ›' : 'Ver cuáles ›'}</span>
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar en bodega…"
            style={{ ...inputStyle, paddingLeft: 30 }} />
        </div>
        <Btn variant="primary" onClick={() => setConteo(true)}><PackagePlus size={14} /> Conteo físico</Btn>
      </div>

      {lista.length === 0 ? (
        <EmptyState message={filas.length === 0
          ? 'La bodega está vacía. Usa "Conteo físico" para subir lo que ya tienes.'
          : 'Ningún producto coincide con la búsqueda.'} />
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #1f1f1f', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#0f0f0f', color: '#777', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px' }}>Marca</th>
                <th style={{ padding: '10px 12px' }}>Modelo</th>
                <th style={{ padding: '10px 12px' }}>Descripción</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Existencia</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Costo unit.</th>
                <th style={{ padding: '10px 12px', textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((f, i) => (
                <tr key={(f.catalog_product_id || '') + i} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
                  <td style={{ padding: '8px 12px' }}>{f.marca || '—'}</td>
                  <td style={{ padding: '8px 12px' }}>{f.modelo || '—'}</td>
                  <td style={{ padding: '8px 12px', color: '#eee' }}>{f.descripcion || '—'}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: '#fff', fontSize: 14 }}>
                    {F(f.en_bodega)} <span style={{ color: '#666', fontSize: 11, fontWeight: 400 }}>{f.unit}</span>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: f.costo == null ? '#D97706' : '#aaa' }}>
                    {f.costo == null ? 'sin costo' : M(f.costo) + ' ' + f.moneda}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: f.valor == null ? '#444' : '#10B981' }}>
                    {f.valor == null ? '—' : M(f.valor) + ' ' + f.moneda}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {conteo && <ModalConteo filas={filas} onClose={() => setConteo(false)} onSaved={() => { setConteo(false); load() }} />}
    </div>
  )
}

// ═══════════════════════════ CONTEO FÍSICO ═══════════════════════════
// Se captura CUÁNTO HAY en el estante, no cuánto se agrega. El delta contra lo
// que el sistema creía lo calcula el sistema: pedirle al usuario que haga esa
// resta a mano es de donde salen los inventarios que no cuadran.
function ModalConteo({ filas, onClose, onSaved }: { filas: FilaBodega[]; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth()
  const [cat, setCat] = useState<any[]>([])
  const [busca, setBusca] = useState('')
  const [lineas, setLineas] = useState<LineaConteo[]>([])
  const [motivo, setMotivo] = useState('Conteo físico de bodega')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [cargandoCat, setCargandoCat] = useState(true)

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('catalog_products')
        .select('id,name,description,marca,modelo,unit,cost,moneda')
        .order('marca')
      setCat((data as any[]) || [])
      setCargandoCat(false)
    })()
  }, [])

  const existencia = useMemo(() => {
    const m: Record<string, number> = {}
    for (const f of filas) if (f.catalog_product_id) m[f.catalog_product_id] = f.en_bodega
    return m
  }, [filas])

  const resultados = useMemo(() => {
    const s = busca.toLowerCase().trim()
    if (s.length < 2) return []
    const yaKeys = new Set(lineas.map(l => l.catalog_product_id))
    return cat.filter(c => {
      if (yaKeys.has(c.id)) return false
      return (c.marca || '').toLowerCase().includes(s)
        || (c.modelo || '').toLowerCase().includes(s)
        || (c.description || '').toLowerCase().includes(s)
        || (c.name || '').toLowerCase().includes(s)
    }).slice(0, 25)
  }, [cat, busca, lineas])

  const agregar = (c: any) => {
    const sistema = existencia[c.id] || 0
    setLineas(ls => [...ls, {
      key: c.id + '-' + Math.random().toString(36).slice(2, 7),
      catalog_product_id: c.id,
      descripcion: c.description || c.name || '',
      marca: c.marca || null,
      modelo: c.modelo || null,
      unit: c.unit || 'pza',
      contado: sistema,
      sistema,
    }])
    setBusca('')
  }

  const setContado = (key: string, v: string) =>
    setLineas(ls => ls.map(l => l.key === key ? { ...l, contado: Math.max(0, Number(v) || 0) } : l))

  const conCambio = lineas.filter(l => l.contado !== l.sistema)
  const entradas = conCambio.filter(l => l.contado > l.sistema)
  const salidas = conCambio.filter(l => l.contado < l.sistema)

  async function guardar() {
    if (!conCambio.length) { setError('Ningún renglón cambia la existencia. Ajusta alguna cantidad o cierra.'); return }
    setSaving(true); setError('')
    try {
      await guardarConteo(lineas, {
        motivo,
        // movido_por apunta al empleado (igual que el resto del libro), no al
        // usuario de auth: si no hay empleado ligado se deja nulo y queda el nombre.
        movidoPor: user?.employee_id || null,
        movidoPorNombre: user?.nombre || user?.email || null,
      })
      onSaved()
    } catch (e: any) {
      setError('No se guardó: ' + (e?.message || String(e)))
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 14, width: 'min(880px,100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f1f1f', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Conteo físico de bodega</div>
            <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>
              Anota cuántas piezas HAY en el estante. El sistema calcula la diferencia.
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: '14px 20px', borderBottom: '1px solid #1f1f1f' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
            <input autoFocus value={busca} onChange={e => setBusca(e.target.value)}
              placeholder={cargandoCat ? 'Cargando catálogo…' : 'Buscar producto por marca, modelo o descripción…'}
              disabled={cargandoCat} style={{ ...inputStyle, paddingLeft: 30 }} />
          </div>
          {resultados.length > 0 && (
            <div style={{ marginTop: 6, maxHeight: 220, overflowY: 'auto', border: '1px solid #222', borderRadius: 8 }}>
              {resultados.map(c => (
                <div key={c.id} onClick={() => agregar(c)}
                  style={{ padding: '8px 12px', borderBottom: '1px solid #191919', cursor: 'pointer', fontSize: 12, color: '#ccc', display: 'flex', justifyContent: 'space-between', gap: 10 }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#181818')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <span><b style={{ color: '#fff' }}>{c.marca || '—'}</b> {c.modelo || ''} — {c.description || c.name}</span>
                  <span style={{ color: '#666', whiteSpace: 'nowrap' }}>hay {F(existencia[c.id] || 0)}</span>
                </div>
              ))}
            </div>
          )}
          {busca.trim().length >= 2 && resultados.length === 0 && !cargandoCat && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#777' }}>
              Sin resultados. Si el producto no existe en el catálogo, hay que darlo de alta ahí primero.
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {lineas.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: '#555', fontSize: 12 }}>
              Busca arriba y ve agregando lo que cuentes.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: '#777', textAlign: 'left' }}>
                  <th style={{ padding: '10px 6px' }}>Producto</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', width: 90 }}>Sistema</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', width: 110 }}>Contado</th>
                  <th style={{ padding: '10px 6px', textAlign: 'right', width: 90 }}>Δ</th>
                  <th style={{ width: 34 }}></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map(l => {
                  const d = l.contado - l.sistema
                  return (
                    <tr key={l.key} style={{ borderTop: '1px solid #1a1a1a', color: '#ccc' }}>
                      <td style={{ padding: '8px 6px' }}>
                        <div style={{ color: '#eee' }}>{l.descripcion}</div>
                        <div style={{ color: '#666', fontSize: 10 }}>{[l.marca, l.modelo].filter(Boolean).join(' · ') || '—'}</div>
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', color: '#777' }}>{F(l.sistema)}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        <input type="number" min={0} value={String(l.contado)}
                          onChange={e => setContado(l.key, e.target.value)}
                          style={{ ...inputStyle, textAlign: 'right', padding: '5px 8px' }} />
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: d === 0 ? '#444' : d > 0 ? '#10B981' : '#DC2626' }}>
                        {d === 0 ? '—' : (d > 0 ? '+' : '') + F(d)}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'center' }}>
                        <button onClick={() => setLineas(ls => ls.filter(x => x.key !== l.key))}
                          style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid #1f1f1f' }}>
          {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 8, color: '#f87171', fontSize: 11, marginBottom: 10 }}>{error}</div>}
          <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo / nota del conteo"
            style={{ ...inputStyle, marginBottom: 10 }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: '#888' }}>
              {conCambio.length === 0
                ? <span style={{ color: '#666' }}>Nada por guardar todavía.</span>
                : <>Se van a registrar <b style={{ color: '#10B981' }}>{entradas.length} entrada{entradas.length === 1 ? '' : 's'}</b>
                   {' y '}<b style={{ color: '#DC2626' }}>{salidas.length} salida{salidas.length === 1 ? '' : 's'}</b>.
                   {lineas.length - conCambio.length > 0 && <span style={{ color: '#666' }}> {lineas.length - conCambio.length} renglón(es) sin cambio se ignoran.</span>}</>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Btn onClick={onClose}>Cancelar</Btn>
              <Btn variant="primary" onClick={guardar} disabled={saving || conCambio.length === 0}>
                <Save size={13} /> {saving ? 'Guardando…' : 'Guardar conteo'}
              </Btn>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
