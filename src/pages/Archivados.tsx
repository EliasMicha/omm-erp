// ═══════════════════════════════════════════════════════════════════════════
// Archivados — el "bote de basura" del CRM
//
// Cuando eliminas un lead o una cotización, el ERP los archiva en vez de
// borrarlos: dejan de aparecer en todas las listas operativas, pero los pagos
// y facturas ligados siguen cuadrando en Contabilidad. Aquí se ven, se
// restauran, y —si no tienen nada colgando— se pueden borrar de verdad.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseAll } from '../lib/supabase'
import {
  restaurarLead, restaurarCotizacion, borrarLeadDefinitivo, borrarCotizacionDefinitivo,
  dependenciasDeLead, dependenciasDeCotizacion, resumenDependencias, type Dependencias,
} from '../lib/archivo'
import { Archive, RotateCcw, Trash2, AlertTriangle, ArrowLeft } from 'lucide-react'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const btnGhost: React.CSSProperties = { background: 'transparent', border: '1px solid #333', color: '#aaa', borderRadius: 8, padding: '6px 10px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }

interface Fila {
  tipo: 'lead' | 'cotizacion'
  id: string
  titulo: string
  sub: string
  archived_at: string
  enCascada: boolean
}

const fmtFecha = (s: string) => new Date(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })

export default function Archivados() {
  const nav = useNavigate()
  const [filas, setFilas] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null)
  const [deps, setDeps] = useState<Record<string, Dependencias>>({})
  const [confirmar, setConfirmar] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: leads }, { data: cots }] = await Promise.all([
      supabaseAll.from('leads').select('id, name, company, status, archived_at').not('archived_at', 'is', null).order('archived_at', { ascending: false }),
      supabaseAll.from('quotations').select('id, name, client_name, stage, total_final, archived_at, archived_reason').not('archived_at', 'is', null).order('archived_at', { ascending: false }),
    ])
    const rows: Fila[] = [
      ...(leads || []).map((l: any) => ({
        tipo: 'lead' as const, id: l.id, titulo: l.name || 'Sin nombre',
        sub: [l.company, l.status].filter(Boolean).join(' · '), archived_at: l.archived_at, enCascada: false,
      })),
      ...(cots || []).map((c: any) => ({
        tipo: 'cotizacion' as const, id: c.id, titulo: c.name || 'Sin nombre',
        sub: [c.client_name, c.stage, c.total_final ? `$${Number(c.total_final).toLocaleString('es-MX', { maximumFractionDigits: 0 })}` : ''].filter(Boolean).join(' · '),
        archived_at: c.archived_at, enCascada: c.archived_reason === 'lead',
      })),
    ].sort((a, b) => (a.archived_at < b.archived_at ? 1 : -1))
    setFilas(rows)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function verDeps(f: Fila) {
    const key = `${f.tipo}:${f.id}`
    if (deps[key]) return
    const d = f.tipo === 'lead' ? await dependenciasDeLead(f.id) : await dependenciasDeCotizacion(f.id)
    setDeps(prev => ({ ...prev, [key]: d }))
  }

  async function restaurar(f: Fila) {
    setBusy(f.id); setMsg(null)
    const r = f.tipo === 'lead' ? await restaurarLead(f.id) : await restaurarCotizacion(f.id)
    setBusy(null)
    if (!r.ok) { setMsg({ texto: r.error || 'No se pudo restaurar', tipo: 'error' }); return }
    setMsg({ texto: `"${f.titulo}" volvió a estar activo${f.tipo === 'lead' ? ' (y sus cotizaciones)' : ''}.`, tipo: 'ok' })
    load()
  }

  async function borrarDefinitivo(f: Fila) {
    setBusy(f.id); setMsg(null); setConfirmar(null)
    const r = f.tipo === 'lead' ? await borrarLeadDefinitivo(f.id) : await borrarCotizacionDefinitivo(f.id)
    setBusy(null)
    if (!r.ok) { setMsg({ texto: r.error || 'No se pudo borrar', tipo: 'error' }); return }
    setMsg({ texto: `"${f.titulo}" se borró definitivamente.`, tipo: 'ok' })
    load()
  }

  const leadsN = filas.filter(f => f.tipo === 'lead').length
  const cotsN = filas.filter(f => f.tipo === 'cotizacion').length

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <button onClick={() => nav('/crm')} style={{ ...btnGhost, marginBottom: 14 }}><ArrowLeft size={13} /> Volver al CRM</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Archive size={20} color="#57FF9A" />
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', margin: 0 }}>Archivados</h1>
      </div>
      <p style={{ color: '#777', fontSize: 13, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
        Lo que eliminaste desde el CRM o Cotizaciones. Ya no aparece en ninguna lista, tablero ni cobranza,
        pero sus pagos y facturas siguen contando en Contabilidad para que cuadre con el banco.
        Desde aquí puedes devolverlo a la operación.
      </p>

      {msg && (
        <div style={{ ...card, borderColor: msg.tipo === 'error' ? '#5a2a2a' : '#2a5a3f', background: msg.tipo === 'error' ? '#1a0e0e' : '#0d1a12', marginBottom: 14, fontSize: 13, color: msg.tipo === 'error' ? '#ff9b9b' : '#57FF9A', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          {msg.tipo === 'error' && <AlertTriangle size={15} style={{ flex: '0 0 auto', marginTop: 1 }} />}
          <span>{msg.texto}</span>
        </div>
      )}

      {loading ? (
        <div style={{ color: '#555', fontSize: 13 }}>Cargando…</div>
      ) : filas.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: '#555', fontSize: 13 }}>
          No hay nada archivado. Cuando elimines un lead o una cotización, aparecerá aquí.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 8 }}>
            {leadsN} lead{leadsN === 1 ? '' : 's'} · {cotsN} cotizacion{cotsN === 1 ? '' : 'es'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filas.map(f => {
              const key = `${f.tipo}:${f.id}`
              const d = deps[key]
              const resumen = d ? resumenDependencias(d) : ''
              const limpio = d ? !resumen : false
              return (
                <div key={key} style={{ ...card, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4, color: f.tipo === 'lead' ? '#2563EB' : '#D97706', background: f.tipo === 'lead' ? '#2563EB22' : '#D9770622', borderRadius: 5, padding: '2px 6px', flex: '0 0 auto' }}>
                      {f.tipo === 'lead' ? 'LEAD' : 'COTIZACIÓN'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.titulo}</div>
                      <div style={{ fontSize: 10, color: '#777', marginTop: 1 }}>
                        {f.sub}{f.sub ? ' · ' : ''}archivado {fmtFecha(f.archived_at)}
                        {f.enCascada && ' · junto con su lead'}
                      </div>
                    </div>
                    <button onClick={() => restaurar(f)} disabled={busy === f.id} style={{ ...btnGhost, color: '#57FF9A', borderColor: '#2a5a3f' }}>
                      <RotateCcw size={13} /> {busy === f.id ? 'Restaurando…' : 'Restaurar'}
                    </button>
                    <button onClick={() => { setConfirmar(confirmar === key ? null : key); verDeps(f) }} title="Borrar definitivamente" style={{ background: 'transparent', border: 'none', color: confirmar === key ? '#DC2626' : '#555', cursor: 'pointer', padding: 4 }}>
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {confirmar === key && (
                    <div style={{ background: '#0a0a0a', border: '1px solid #2a1a1a', borderRadius: 8, padding: 10, fontSize: 12, color: '#bbb', display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {!d ? (
                        <span style={{ color: '#666' }}>Revisando qué tiene ligado…</span>
                      ) : limpio ? (
                        <>
                          <span>No tiene nada ligado. Se puede borrar de la base para siempre — esto <b>no</b> se puede deshacer.</span>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => borrarDefinitivo(f)} disabled={busy === f.id} style={{ background: '#DC2626', border: 'none', color: '#fff', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                              {busy === f.id ? 'Borrando…' : 'Sí, borrar para siempre'}
                            </button>
                            <button onClick={() => setConfirmar(null)} style={btnGhost}>Cancelar</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
                            <AlertTriangle size={14} color="#D97706" style={{ flex: '0 0 auto', marginTop: 1 }} />
                            <span>Tiene {resumen}. Si lo borras de la base, esos registros pierden su referencia y tus números de Contabilidad dejan de cuadrar. Mejor déjalo archivado: ya no aparece en ninguna lista.</span>
                          </span>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setConfirmar(null)} style={{ ...btnGhost, color: '#57FF9A', borderColor: '#2a5a3f' }}>Entendido, dejarlo archivado</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
