import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { KpiCard, Badge, Btn, EmptyState } from './layout/UI'
import { Search, ChevronRight, ChevronDown, AlertTriangle, RefreshCw, Plus, X, FileText, Link2 } from 'lucide-react'
import {
  cargarExpedientes, agregarAlExpediente, excluirDelExpediente, quitarAjuste,
  ESTATUS_EXP, type EstatusExpediente, type Expediente, type DocExp,
} from '../lib/expedientesAnticipo'

// ─────────────────────────────────────────────────────────────────────────────
//  Expediente de anticipo: anticipo -> factura(s) de producto -> egreso.
//  La cadena se arma sola leyendo TipoRelacion 07 de cada CFDI; lo que falte
//  se asigna a mano sin tocar lo que dice el comprobante.
// ─────────────────────────────────────────────────────────────────────────────

const M = (n: number) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = (d?: string | null) => (d ? String(d).slice(0, 10) : '—')
const nombre = (d: DocExp) => [d.serie, d.folio].filter(Boolean).join('-') || d.uuid.slice(0, 8)

const input: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13, background: '#0e0e0e', border: '1px solid #2a2a2a',
  borderRadius: 8, color: '#eee', fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function ExpedientesAnticipo({ direccion }: { direccion: 'emitida' | 'recibida' }) {
  const { user } = useAuth()
  const quien = user?.nombre || user?.email || 'sistema'
  const [exps, setExps] = useState<Expediente[]>([])
  const [cands, setCands] = useState<DocExp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<EstatusExpediente | 'todos'>('todos')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [asignando, setAsignando] = useState<{ exp: Expediente; rol: 'producto' | 'egreso' } | null>(null)

  const load = async () => {
    setLoading(true); setError('')
    try { const r = await cargarExpedientes(direccion); setExps(r.expedientes); setCands(r.candidatas) }
    catch (e: any) { setError('No se pudo cargar: ' + (e?.message || String(e))) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [direccion])

  const resumen = useMemo(() => {
    const r: Record<EstatusExpediente, { n: number; monto: number }> = {
      abierto: { n: 0, monto: 0 }, en_aplicacion: { n: 0, monto: 0 },
      completo: { n: 0, monto: 0 }, inconsistente: { n: 0, monto: 0 },
    }
    for (const e of exps) { r[e.estatus].n++; r[e.estatus].monto += e.porAplicar > 0 ? e.porAplicar : 0 }
    return r
  }, [exps])

  const lista = useMemo(() => {
    const s = q.toLowerCase().trim()
    return exps.filter(e => {
      if (filtro !== 'todos' && e.estatus !== filtro) return false
      if (!s) return true
      return (e.anticipo.contraparte || '').toLowerCase().includes(s)
        || nombre(e.anticipo).toLowerCase().includes(s)
        || e.anticipo.uuid.includes(s)
    })
  }, [exps, q, filtro])

  async function accion(fn: () => Promise<void>) {
    try { await fn(); await load() } catch (e: any) { setError(e?.message || String(e)) }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#666' }}>
          La cadena se arma leyendo la relación <b style={{ color: '#888' }}>07 · CFDI por aplicación de anticipo</b> de cada comprobante.
        </span>
        <Btn onClick={load} style={{ marginLeft: 'auto' }}><RefreshCw size={13} /> Recargar</Btn>
      </div>

      {error && <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 10, color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
        {(['abierto', 'en_aplicacion', 'completo', 'inconsistente'] as EstatusExpediente[]).map(k => (
          <div key={k} onClick={() => setFiltro(filtro === k ? 'todos' : k)} style={{ cursor: 'pointer', opacity: filtro === 'todos' || filtro === k ? 1 : 0.45 }}>
            <KpiCard label={ESTATUS_EXP[k].label} value={resumen[k].n} color={ESTATUS_EXP[k].color}
              icon={k === 'inconsistente' ? <AlertTriangle size={16} /> : <FileText size={16} />} />
            <div style={{ fontSize: 10, color: '#555', marginTop: -6, paddingLeft: 14 }}>
              {k === 'completo' ? 'sin saldo por aplicar' : `${M(resumen[k].monto)} por aplicar`}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por contraparte, folio o UUID…" style={{ ...input, width: '100%', paddingLeft: 30 }} />
        </div>
        {filtro !== 'todos' && <Btn size="sm" onClick={() => setFiltro('todos')}>Quitar filtro: {ESTATUS_EXP[filtro].label}</Btn>}
        <span style={{ fontSize: 11, color: '#666' }}>{lista.length} de {exps.length} expedientes</span>
      </div>

      {loading ? <div style={{ color: '#666', fontSize: 12, padding: 20 }}>Cargando…</div>
        : lista.length === 0 ? <EmptyState message="Ningún expediente coincide." />
        : (
        <div style={{ border: '1px solid #1f1f1f', borderRadius: 10, overflow: 'hidden' }}>
          {lista.map(e => {
            const cfg = ESTATUS_EXP[e.estatus]
            const open = abierto === e.anticipo.id
            return (
              <div key={e.anticipo.id} style={{ borderBottom: '1px solid #161616' }}>
                <div onClick={() => setAbierto(open ? null : e.anticipo.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${cfg.color}`, flexWrap: 'wrap' }}>
                  {open ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
                  <Badge label={cfg.label} color={cfg.color} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 74 }}>{nombre(e.anticipo)}</span>
                  <span style={{ fontSize: 12, color: '#ccc', flex: 1, minWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.anticipo.contraparte || '—'}</span>
                  <span style={{ fontSize: 11, color: '#777' }}>{fecha(e.anticipo.fecha)}</span>
                  <span style={{ fontSize: 10, color: '#666', minWidth: 96, textAlign: 'center' }}>
                    {e.productos.length} prod · {e.egresos.length} egr
                  </span>
                  <span style={{ fontSize: 12, color: '#aaa', minWidth: 104, textAlign: 'right' }} title="Anticipo">{M(e.anticipo.total)}</span>
                  <span style={{ fontSize: 12, color: '#10B981', minWidth: 104, textAlign: 'right' }} title="Aplicado por egresos">{M(e.totalEgresos)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: e.porAplicar > 0.05 ? '#D97706' : '#555', minWidth: 104, textAlign: 'right' }} title="Por aplicar">
                    {e.porAplicar > 0.05 ? M(e.porAplicar) : '—'}
                  </span>
                </div>

                {open && (
                  <div style={{ padding: '4px 12px 14px 38px', background: '#0b0b0b' }}>
                    {e.motivos.length > 0 && (
                      <div style={{ background: '#2a1414', border: '1px solid #5a2a2a', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                        {e.motivos.map((m, i) => <div key={i} style={{ fontSize: 11, color: '#f87171' }}>⚠ {m}</div>)}
                      </div>
                    )}
                    <Eslabon titulo="1 · Factura de anticipo" color="#2563EB" docs={[e.anticipo]} />
                    <Eslabon titulo="2 · Factura(s) de producto" color="#D97706" docs={e.productos}
                      vacio="Todavía no se factura producto contra este anticipo."
                      onAgregar={() => setAsignando({ exp: e, rol: 'producto' })}
                      onQuitar={(d) => accion(() => d.manual
                        ? quitarAjuste(e.anticipo.id, d.id, 'producto')
                        : excluirDelExpediente(e.anticipo.id, d.id, 'producto', quien, 'Excluido desde el expediente'))} />
                    <Eslabon titulo="3 · Egreso de aplicación" color="#10B981" docs={e.egresos}
                      vacio="Falta el egreso que aplica el anticipo."
                      onAgregar={() => setAsignando({ exp: e, rol: 'egreso' })}
                      onQuitar={(d) => accion(() => d.manual
                        ? quitarAjuste(e.anticipo.id, d.id, 'egreso')
                        : excluirDelExpediente(e.anticipo.id, d.id, 'egreso', quien, 'Excluido desde el expediente'))} />
                    <div style={{ display: 'flex', gap: 18, marginTop: 10, fontSize: 11, color: '#888', flexWrap: 'wrap' }}>
                      <span>Anticipo <b style={{ color: '#eee' }}>{M(e.anticipo.total)}</b></span>
                      <span>Producto facturado <b style={{ color: '#eee' }}>{M(e.totalProductos)}</b></span>
                      <span>Aplicado <b style={{ color: '#10B981' }}>{M(e.totalEgresos)}</b></span>
                      <span>Por aplicar <b style={{ color: e.porAplicar > 0.05 ? '#D97706' : '#555' }}>{M(e.porAplicar)}</b></span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {asignando && (
        <ModalAsignar exp={asignando.exp} rol={asignando.rol} candidatas={cands} quien={quien}
          onClose={() => setAsignando(null)}
          onListo={() => { setAsignando(null); load() }}
          onError={setError} />
      )}
    </div>
  )
}

function Eslabon({ titulo, color, docs, vacio, onAgregar, onQuitar }: {
  titulo: string; color: string; docs: DocExp[]; vacio?: string
  onAgregar?: () => void; onQuitar?: (d: DocExp) => void
}) {
  return (
    <div style={{ marginBottom: 10, borderLeft: `2px solid ${color}44`, paddingLeft: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '.05em' }}>{titulo}</span>
        {onAgregar && (
          <button onClick={onAgregar} title="Asignar una factura a mano"
            style={{ background: 'transparent', border: '1px solid #333', color: '#888', borderRadius: 6, fontSize: 10, padding: '1px 7px', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 3 }}>
            <Plus size={10} /> asignar
          </button>
        )}
      </div>
      {docs.length === 0 ? (
        <div style={{ fontSize: 11, color: '#666' }}>{vacio || '—'}</div>
      ) : docs.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '3px 0', fontSize: 11, color: '#bbb', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: '#eee', minWidth: 72 }}>{nombre(d)}</span>
          <span style={{ color: '#777' }}>{fecha(d.fecha)}</span>
          <span style={{ color: '#aaa' }}>{M(d.total)}</span>
          {d.estado === 'cancelada' && <span style={{ fontSize: 9, fontWeight: 700, color: '#DC2626', border: '1px solid #DC262655', borderRadius: 4, padding: '1px 4px' }}>CANCELADA</span>}
          {d.manual && <span title={d.nota_manual || 'Asignado a mano'} style={{ fontSize: 9, fontWeight: 700, color: '#A78BFA', border: '1px solid #A78BFA55', borderRadius: 4, padding: '1px 4px' }}>MANUAL</span>}
          <span style={{ fontSize: 9.5, color: '#444', fontFamily: 'monospace' }}>{d.uuid.slice(0, 8)}</span>
          {onQuitar && (
            <button onClick={() => onQuitar(d)} title={d.manual ? 'Quitar la asignación manual' : 'Excluir del expediente (el CFDI lo relaciona, pero no corresponde)'}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 0, marginLeft: 'auto' }}><X size={12} /></button>
          )}
        </div>
      ))}
    </div>
  )
}

function ModalAsignar({ exp, rol, candidatas, quien, onClose, onListo, onError }: {
  exp: Expediente; rol: 'producto' | 'egreso'; candidatas: DocExp[]; quien: string
  onClose: () => void; onListo: () => void; onError: (s: string) => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<DocExp | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  const tipo = rol === 'egreso' ? 'E' : 'I'
  const res = useMemo(() => {
    const s = q.toLowerCase().trim()
    const base = candidatas.filter(c => c.tipo_comprobante === tipo)
    if (!s) return base.slice(0, 40)
    return base.filter(c => nombre(c).toLowerCase().includes(s)
      || (c.contraparte || '').toLowerCase().includes(s)
      || c.uuid.includes(s)).slice(0, 40)
  }, [candidatas, q, tipo])

  async function guardar() {
    if (!sel) return
    setGuardando(true)
    try { await agregarAlExpediente(exp.anticipo.id, sel.id, rol, quien, nota); onListo() }
    catch (e: any) { onError('No se pudo asignar: ' + (e?.message || String(e))); setGuardando(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 14, width: 'min(740px,100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f1f1f' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            Asignar {rol === 'egreso' ? 'egreso de aplicación' : 'factura de producto'}
          </div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
            Al expediente del anticipo <b style={{ color: '#eee' }}>{nombre(exp.anticipo)}</b> · {M(exp.anticipo.total)} · {exp.anticipo.contraparte}
          </div>
          <div style={{ fontSize: 10.5, color: '#D9A441', marginTop: 6 }}>
            Las relaciones del CFDI no se modifican. Esto se guarda encima, con quién y por qué, y se puede revertir.
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #1f1f1f' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)}
            placeholder={`Buscar ${rol === 'egreso' ? 'egreso' : 'factura'} por folio, contraparte o UUID…`} style={{ ...input, width: '100%' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {res.length === 0 ? <div style={{ padding: 20, color: '#666', fontSize: 12 }}>Sin resultados.</div> : res.map(c => (
            <div key={c.id} onClick={() => setSel(c)}
              style={{ padding: '8px 10px', borderBottom: '1px solid #191919', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center',
                       background: sel?.id === c.id ? '#10B98118' : 'transparent', borderRadius: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 72 }}>{nombre(c)}</span>
              <span style={{ fontSize: 12, color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.contraparte || '—'}</span>
              <span style={{ fontSize: 11, color: '#777' }}>{fecha(c.fecha)}</span>
              <span style={{ fontSize: 12, color: '#aaa' }}>{M(c.total)}</span>
              {Math.abs(c.total - exp.anticipo.total) <= 0.05 && (
                <span title="Mismo monto que el anticipo" style={{ fontSize: 9, fontWeight: 700, color: '#10B981', border: '1px solid #10B98155', borderRadius: 4, padding: '1px 4px' }}>= ANTICIPO</span>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid #1f1f1f' }}>
          <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Por qué se asigna a mano (queda registrado)" style={{ ...input, width: '100%', marginBottom: 10 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardar} disabled={!sel || guardando}>
              <Link2 size={13} /> {guardando ? 'Asignando…' : 'Asignar al expediente'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
