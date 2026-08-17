// ═══════════════════════════════════════════════════════════════════════════
// CobranzaPendientes — widget del Dashboard (DG).
// Obras por cobrar como pendientes ("[Proyecto] — Hablar al cliente y enviar
// estado de cuenta") + seguimiento por screenshot (respuesta del cliente).
//   • Cada obra: editas los NOMBRES del cliente (como salen en WhatsApp) para
//     que el match automático del seguimiento funcione → cobranza_obra.contactos
//   • Sección "Sin asignar": seguimientos que la IA no logró ligar → los asignas.
//   • RESOLVER CON LO QUE YA EXISTE: desde el mismo pendiente, un clic deja un
//     BORRADOR en Gmail con el estado de cuenta (PDF) o con una factura ya
//     timbrada (PDF + XML). Nunca se envía solo — el envío lo decides tú.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadObrasPorCobrar, ObraPorCobrar } from '../lib/cobranzaCalc'
import type { FacturaRow } from '../lib/cobranzaDocs'
import {
  loadFacturasEmitidas, sugerirFacturas, buscarFacturas, ligarFacturaAObra,
  adjuntoFactura, adjuntoEstadoCuenta, crearBorrador, textoEstadoCuenta, textoFactura,
} from '../lib/cobranzaDocs'
import { DollarSign, ChevronRight, ChevronDown, MessageCircle, Clock, Users, FileText, Mail, Search, Link2 } from 'lucide-react'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const input: React.CSSProperties = { background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: '7px 10px', color: '#fff', fontSize: 13, width: '100%', outline: 'none' }
const money = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')
const btn = (color: string): React.CSSProperties => ({ background: color + '22', border: '1px solid ' + color + '55', color, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' })

const EST_CFG: Record<string, { label: string; color: string }> = {
  promesa_pago: { label: 'Prometió pagar', color: '#10B981' },
  pidio_info: { label: 'Pidió info', color: '#2563EB' },
  objecion: { label: 'Objeción', color: '#DC2626' },
  sin_respuesta: { label: 'Sin respuesta', color: '#D97706' },
  pagado: { label: 'Pagado', color: '#57FF9A' },
  otro: { label: 'Seguimiento', color: '#888' },
}

interface Seg {
  id: string; lead_id: string | null; cliente_nombre: string | null; estado: string | null
  contenido: string | null; proximo_paso: string | null; proxima_fecha: string | null
  fecha_promesa_pago: string | null; monto_prometido: number | null; created_at: string
}

export default function CobranzaPendientes({ isMobile = false }: { isMobile?: boolean }) {
  const navigate = useNavigate()
  const [obras, setObras] = useState<ObraPorCobrar[]>([])
  const [segByLead, setSegByLead] = useState<Record<string, Seg>>({})
  const [sinAsignar, setSinAsignar] = useState<Seg[]>([])
  const [contactos, setContactos] = useState<Record<string, string>>({})
  const [correos, setCorreos] = useState<Record<string, string>>({})
  const [facturas, setFacturas] = useState<FacturaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [verTodas, setVerTodas] = useState(false)
  const [expand, setExpand] = useState<string | null>(null)
  // ── resolver (borradores) ──
  const [gmailConn, setGmailConn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string>('')                        // clave de la acción en curso
  const [msg, setMsg] = useState<{ leadId: string; ok: boolean; text: string; url?: string } | null>(null)
  const [buscar, setBuscar] = useState<Record<string, string>>({})
  const [conXml, setConXml] = useState(true)

  useEffect(() => {
    fetch('/api/gmail?action=status').then(r => r.json()).then(j => setGmailConn(!!j.connected)).catch(() => setGmailConn(false))
  }, [])

  async function load() {
    setLoading(true)
    const [ob, segRes, obraRes, leadRes, facts] = await Promise.all([
      loadObrasPorCobrar(18),
      supabase.from('cobranza_seguimiento')
        .select('id, lead_id, cliente_nombre, estado, contenido, proximo_paso, proxima_fecha, fecha_promesa_pago, monto_prometido, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('cobranza_obra').select('lead_id, contactos'),
      supabase.from('leads').select('id, contact_email'),
      loadFacturasEmitidas().catch(() => [] as FacturaRow[]),
    ])
    const segs = (segRes.data || []) as Seg[]
    const map: Record<string, Seg> = {}
    for (const s of segs) { if (s.lead_id && !map[s.lead_id]) map[s.lead_id] = s }
    const cmap: Record<string, string> = {}
    for (const o of (obraRes.data || []) as any[]) { if (o.lead_id) cmap[o.lead_id] = o.contactos || '' }
    const emap: Record<string, string> = {}
    for (const l of (leadRes.data || []) as any[]) { if (l.id && l.contact_email) emap[l.id] = l.contact_email }
    setObras(ob)
    setSegByLead(map)
    setSinAsignar(segs.filter(s => !s.lead_id))
    setContactos(cmap)
    setCorreos(emap)
    setFacturas(facts as FacturaRow[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function saveContactos(leadId: string, val: string) {
    setContactos(prev => ({ ...prev, [leadId]: val }))
    await supabase.from('cobranza_obra').upsert([{ lead_id: leadId, contactos: val, updated_at: new Date().toISOString() }], { onConflict: 'lead_id' })
  }
  async function asignar(segId: string, leadId: string) {
    if (!leadId) return
    await supabase.from('cobranza_seguimiento').update({ lead_id: leadId }).eq('id', segId)
    load()
  }
  async function saveCorreo(leadId: string, val: string) {
    setCorreos(prev => ({ ...prev, [leadId]: val }))
    await supabase.from('leads').update({ contact_email: val || null }).eq('id', leadId)
  }

  // ── Acciones: dejar el borrador listo en Gmail ──
  async function borradorEstadoCuenta(o: ObraPorCobrar) {
    const key = 'ec:' + o.leadId
    setBusy(key); setMsg(null)
    try {
      const adj = await adjuntoEstadoCuenta(o.leadId, o.lead)
      const t = textoEstadoCuenta(o)
      const j = await crearBorrador({ to: (correos[o.leadId] || '').trim(), subject: t.subject, body: t.body, attachments: [adj] })
      if (j.ok) { setMsg({ leadId: o.leadId, ok: true, text: 'Borrador listo con el estado de cuenta adjunto' + (j.email ? ` (${j.email})` : '') + '. Revísalo y tú lo envías.', url: j.url }); setGmailConn(true) }
      else { setMsg({ leadId: o.leadId, ok: false, text: j.error || 'No se pudo crear el borrador' }); if (String(j.error || '').toLowerCase().includes('conect')) setGmailConn(false) }
    } catch (e: any) { setMsg({ leadId: o.leadId, ok: false, text: String((e && e.message) || e) }) }
    finally { setBusy('') }
  }

  async function borradorFactura(o: ObraPorCobrar, f: FacturaRow) {
    const key = 'f:' + f.id
    setBusy(key); setMsg(null)
    try {
      const adj = await adjuntoFactura(f, conXml)
      const t = textoFactura(f, o)
      const j = await crearBorrador({ to: (correos[o.leadId] || '').trim(), subject: t.subject, body: t.body, attachments: adj })
      if (j.ok) {
        if (!f.lead_id) { await ligarFacturaAObra(f.id, o.leadId); setFacturas(prev => prev.map(x => x.id === f.id ? { ...x, lead_id: o.leadId } : x)) }
        setMsg({ leadId: o.leadId, ok: true, text: `Borrador listo con la factura adjunta${adj.length > 1 ? ' (PDF + XML)' : ''}. Revísalo y tú lo envías.`, url: j.url }); setGmailConn(true)
      } else { setMsg({ leadId: o.leadId, ok: false, text: j.error || 'No se pudo crear el borrador' }); if (String(j.error || '').toLowerCase().includes('conect')) setGmailConn(false) }
    } catch (e: any) { setMsg({ leadId: o.leadId, ok: false, text: String((e && e.message) || e) }) }
    finally { setBusy('') }
  }

  async function ligar(f: FacturaRow, leadId: string | null) {
    await ligarFacturaAObra(f.id, leadId)
    setFacturas(prev => prev.map(x => x.id === f.id ? { ...x, lead_id: leadId } : x))
  }

  const totalPorCobrar = useMemo(() => obras.reduce((a, o) => a + o.porCobrar, 0), [obras])
  const visibles = verTodas ? obras : obras.slice(0, 12)
  const hoy = new Date().toISOString().slice(0, 10)

  // Filas de factura reutilizables (ligadas / sugeridas / buscadas)
  const filaFactura = (o: ObraPorCobrar, f: FacturaRow, modo: 'ligada' | 'sugerida' | 'buscada') => (
    <div key={modo + f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', background: '#0a0a0a', border: '1px solid #1c1c1c', borderRadius: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <b>{[f.serie, f.folio].filter(Boolean).join('') || '(sin folio)'}</b> · {money(Number(f.total) || 0)}{f.moneda && f.moneda !== 'MXN' ? ' ' + f.moneda : ''} · {String(f.fecha_emision || '').slice(0, 10)}
        </div>
        <div style={{ fontSize: 10, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.receptor_nombre || '—'}</div>
      </div>
      {modo !== 'ligada' && (
        <button onClick={() => ligar(f, o.leadId)} title="Ligar esta factura a la obra para que salga sola la próxima vez" style={{ ...btn('#888'), padding: '5px 9px' }}>
          <Link2 size={11} style={{ verticalAlign: -1 }} /> Ligar
        </button>
      )}
      {modo === 'ligada' && (
        <button onClick={() => ligar(f, null)} title="Quitar de esta obra" style={{ ...btn('#555'), padding: '5px 9px' }}>Quitar</button>
      )}
      <button disabled={busy === 'f:' + f.id || !f.facturapi_id} onClick={() => borradorFactura(o, f)}
        title={f.facturapi_id ? 'Deja el borrador en Gmail con esta factura adjunta' : 'Esta factura no tiene PDF en FacturAPI'}
        style={{ ...btn('#A78BFA'), opacity: f.facturapi_id ? 1 : 0.4, padding: '5px 10px' }}>
        {busy === 'f:' + f.id ? 'Preparando…' : '✉︎ Mandar esta factura'}
      </button>
    </div>
  )

  return (
    <div style={{ ...card, borderTop: '2px solid #D97706', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DollarSign size={16} color="#D97706" />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Cobranza — por cobrar</div>
          <span style={{ fontSize: 11, color: '#666', background: '#1a1a1a', borderRadius: 20, padding: '2px 8px' }}>{obras.length}</span>
        </div>
        <div style={{ fontSize: 13, color: '#D97706', fontWeight: 700 }}>{money(totalPorCobrar)}</div>
      </div>
      <div style={{ fontSize: 11, color: '#777', marginBottom: 12 }}>
        Hablar al cliente y enviar estado de cuenta. Manda el screenshot de su respuesta al atajo "Cobranza a OMM" y aquí ves el seguimiento.
        {gmailConn === false && <> · <a onClick={() => window.open('/api/gmail?action=connect', '_blank')} style={{ color: '#10B981', cursor: 'pointer' }}>Conectar Gmail</a> para dejar borradores en un clic.</>}
      </div>

      {/* ── Sin asignar (seguimientos que la IA no logró ligar) ── */}
      {sinAsignar.length > 0 && (
        <div style={{ background: '#1a1206', border: '1px solid #3a2a10', borderRadius: 10, padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#D97706', marginBottom: 8 }}>⚠ Seguimientos sin asignar ({sinAsignar.length}) — dime de qué obra son</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sinAsignar.map(s => (
              <div key={s.id} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: 12, color: '#fff' }}><b>{s.cliente_nombre || 'Cliente'}</b> — {s.contenido || '(sin resumen)'}</div>
                  {s.proximo_paso && <div style={{ fontSize: 11, color: '#999' }}>↳ {s.proximo_paso}</div>}
                </div>
                <select defaultValue="" onChange={e => asignar(s.id, e.target.value)} style={{ ...input, width: 'auto', flex: '0 0 auto', maxWidth: 220 }}>
                  <option value="">Asignar a obra…</option>
                  {obras.map(o => <option key={o.leadId} value={o.leadId}>{o.lead}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading && <div style={{ color: '#666', fontSize: 12, padding: '10px 4px' }}>Cargando obras por cobrar…</div>}
      {!loading && obras.length === 0 && <div style={{ color: '#555', fontSize: 12, padding: '10px 4px' }}>No hay obras con saldo por cobrar. 🎉</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibles.map(o => {
          const seg = segByLead[o.leadId]
          const est = seg && seg.estado ? (EST_CFG[seg.estado] || EST_CFG.otro) : null
          const prox = seg && (seg.proxima_fecha || seg.fecha_promesa_pago)
          const proxVencida = prox && prox < hoy
          const abierto = expand === o.leadId
          const ligadas = facturas.filter(f => f.lead_id === o.leadId)
          const sugeridas = abierto ? sugerirFacturas(facturas, o.lead, contactos[o.leadId]).filter(f => f.lead_id !== o.leadId) : []
          const q = buscar[o.leadId] || ''
          const encontradas = q.trim().length >= 2 ? buscarFacturas(facturas, q).filter(f => f.lead_id !== o.leadId) : []
          const m = msg && msg.leadId === o.leadId ? msg : null
          return (
            <div key={o.leadId} style={{ borderRadius: 10, background: '#0d0d0d', border: '1px solid #1a1a1a' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', cursor: 'pointer' }} onClick={() => setExpand(abierto ? null : o.leadId)}>
                <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: '#D97706', flex: '0 0 auto' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {o.lead} <span style={{ color: '#888', fontWeight: 400 }}>— Hablar al cliente y enviar estado de cuenta</span>
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: '#D97706', fontWeight: 700 }}>{money(o.porCobrar)}</span>
                    <span style={{ fontSize: 11, color: '#666' }}>{Math.round(o.avance * 100)}% cobrado</span>
                    {est && <span style={{ fontSize: 11, color: est.color, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}><MessageCircle size={10} />{est.label}</span>}
                    {prox && <span style={{ fontSize: 11, color: proxVencida ? '#DC2626' : '#777', display: 'inline-flex', alignItems: 'center', gap: 3 }}><Clock size={10} />{proxVencida ? '⚠ ' : ''}seguir {prox}</span>}
                    {ligadas.length > 0 && <span style={{ fontSize: 11, color: '#A78BFA', display: 'inline-flex', alignItems: 'center', gap: 3 }}><FileText size={10} />{ligadas.length} factura{ligadas.length > 1 ? 's' : ''}</span>}
                    {!contactos[o.leadId] && <span style={{ fontSize: 10, color: '#8a6d3b' }}>· falta poner nombres del cliente</span>}
                  </div>
                </div>
                {abierto ? <ChevronDown size={16} color="#666" /> : <ChevronRight size={16} color="#666" />}
              </div>

              {abierto && (
                <div style={{ padding: '4px 12px 12px', borderTop: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {/* seguimiento */}
                  {seg ? (
                    <div style={{ fontSize: 12, color: '#bbb', marginTop: 8 }}>
                      <div><b style={{ color: est?.color }}>{est?.label}</b> · {seg.created_at?.slice(0, 10)}{seg.cliente_nombre ? ` · ${seg.cliente_nombre}` : ''}</div>
                      {seg.contenido && <div style={{ color: '#999', marginTop: 2 }}>"{seg.contenido}"</div>}
                      {seg.proximo_paso && <div style={{ color: '#57FF9A', marginTop: 2 }}>↳ {seg.proximo_paso}{seg.proxima_fecha ? ` (${seg.proxima_fecha})` : ''}</div>}
                      {seg.monto_prometido ? <div style={{ color: '#10B981', marginTop: 2 }}>Prometió: {money(seg.monto_prometido)}{seg.fecha_promesa_pago ? ` el ${seg.fecha_promesa_pago}` : ''}</div> : null}
                    </div>
                  ) : <div style={{ fontSize: 12, color: '#666', marginTop: 8 }}>Sin seguimiento aún. Manda el screenshot de la respuesta del cliente al atajo "Cobranza a OMM".</div>}

                  {/* ── RESOLVER: dejar el borrador listo en Gmail ── */}
                  <div style={{ background: '#0a0a0a', border: '1px solid #1c1c1c', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#10B981', letterSpacing: '0.03em' }}>RESOLVER — deja el borrador listo en tu Gmail</div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <label style={{ fontSize: 10, color: '#777', display: 'block', marginBottom: 3 }}>Correo del cliente (se guarda en el lead)</label>
                        <input defaultValue={correos[o.leadId] || ''} placeholder="cliente@correo.com (opcional)"
                          onBlur={e => { if (e.target.value !== (correos[o.leadId] || '')) saveCorreo(o.leadId, e.target.value.trim()) }}
                          style={input} />
                      </div>
                      <button disabled={busy === 'ec:' + o.leadId} onClick={() => borradorEstadoCuenta(o)} style={{ ...btn('#10B981'), alignSelf: 'flex-end', padding: '8px 12px' }}>
                        <Mail size={12} style={{ verticalAlign: -2 }} /> {busy === 'ec:' + o.leadId ? 'Preparando…' : 'Estado de cuenta → borrador'}
                      </button>
                    </div>

                    {/* facturas */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 11, color: '#888', display: 'inline-flex', alignItems: 'center', gap: 4 }}><FileText size={12} /> Facturas ya emitidas</span>
                        <label style={{ fontSize: 10, color: '#666', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                          <input type="checkbox" checked={conXml} onChange={e => setConXml(e.target.checked)} /> adjuntar también el XML
                        </label>
                      </div>

                      {ligadas.map(f => filaFactura(o, f, 'ligada'))}

                      {sugeridas.length > 0 && (
                        <>
                          <div style={{ fontSize: 10, color: '#666' }}>Posibles de esta obra (por nombre del receptor):</div>
                          {sugeridas.map(f => filaFactura(o, f, 'sugerida'))}
                        </>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Search size={12} color="#666" />
                        <input value={q} onChange={e => setBuscar(prev => ({ ...prev, [o.leadId]: e.target.value }))}
                          placeholder="Buscar factura por cliente, folio, UUID o monto…" style={{ ...input, fontSize: 12 }} />
                      </div>
                      {encontradas.map(f => filaFactura(o, f, 'buscada'))}
                      {q.trim().length >= 2 && encontradas.length === 0 && <div style={{ fontSize: 11, color: '#666' }}>Sin resultados. Ojo: solo se buscan facturas de ingreso emitidas por OMM y no canceladas.</div>}
                      {ligadas.length === 0 && sugeridas.length === 0 && q.trim().length < 2 && (
                        <div style={{ fontSize: 11, color: '#666' }}>Busca la factura y dale "Ligar" — desde entonces esta obra ya la muestra sola.</div>
                      )}
                    </div>

                    {m && (
                      <div style={{ fontSize: 12, color: m.ok ? '#10B981' : '#EF4444', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>{m.ok ? '✓' : '⚠'} {m.text}</span>
                        {m.ok && m.url && <a href={m.url} target="_blank" rel="noreferrer" style={{ color: '#60A5FA' }}>Abrir borradores de Gmail</a>}
                      </div>
                    )}
                    {gmailConn === false && (
                      <button onClick={() => window.open('/api/gmail?action=connect', '_blank')} style={{ ...btn('#10B981'), alignSelf: 'flex-start' }}>Conectar Gmail (una sola vez)</button>
                    )}
                  </div>

                  {/* nombres del cliente para el match */}
                  <div>
                    <label style={{ fontSize: 11, color: '#888', display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 4 }}><Users size={12} /> Nombres del cliente (como salen en WhatsApp, separados por coma)</label>
                    <input
                      defaultValue={contactos[o.leadId] || ''}
                      onBlur={e => { if (e.target.value !== (contactos[o.leadId] || '')) saveContactos(o.leadId, e.target.value) }}
                      placeholder="ej. Dafne Romero, Arq. Juan Pérez, Despacho X"
                      style={input}
                    />
                    <div style={{ fontSize: 10, color: '#666', marginTop: 3 }}>Sirve para dos cosas: ligar el seguimiento por screenshot y sugerir las facturas de esta obra.</div>
                  </div>

                  <button onClick={() => navigate('/cobranza')} style={{ ...btn('#D97706'), alignSelf: 'flex-start' }}>
                    Abrir en Cobranza
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!loading && obras.length > 12 && (
        <button onClick={() => setVerTodas(v => !v)} style={{ marginTop: 10, background: 'transparent', border: '1px solid #333', color: '#aaa', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
          {verTodas ? 'Ver menos' : `Ver todas (${obras.length})`}
        </button>
      )}
    </div>
  )
}
