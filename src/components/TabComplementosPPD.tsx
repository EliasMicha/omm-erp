import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { KpiCard, Badge, Btn, EmptyState } from './layout/UI'
import { Upload, Search, Link2, Unlink, ChevronRight, ChevronDown, AlertTriangle, RefreshCw, FileText } from 'lucide-react'
import {
  cargarPPD, parsearComplemento, guardarComplemento, vincularManual, desvincularManual,
  ESTATUS_CFG, type EstatusPPD, type FacturaPPD, type PagoHuerfano, type ResultadoImport,
} from '../lib/complementosPago'

// ─────────────────────────────────────────────────────────────────────────────
//  Facturas PPD contra sus complementos de pago.
//  El amarre es el IdDocumento del complemento contra el folio fiscal de la
//  factura. Lo que el XML no resuelva se liga a mano, sin borrar lo que dice
//  el XML.
// ─────────────────────────────────────────────────────────────────────────────

const RFC_OMM = 'OTE210910PW5'
const M = (n: number) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = (d?: string | null) => (d ? String(d).slice(0, 10) : '—')

const input: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13, background: '#0e0e0e', border: '1px solid #2a2a2a',
  borderRadius: 8, color: '#eee', fontFamily: 'inherit', boxSizing: 'border-box',
}

export default function TabComplementosPPD() {
  const { user } = useAuth()
  const [direccion, setDireccion] = useState<'emitida' | 'recibida'>('emitida')
  const [facturas, setFacturas] = useState<FacturaPPD[]>([])
  const [huerfanos, setHuerfanos] = useState<PagoHuerfano[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<EstatusPPD | 'todas'>('todas')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [ligando, setLigando] = useState<PagoHuerfano | null>(null)
  const [importando, setImportando] = useState(false)
  const [resultados, setResultados] = useState<ResultadoImport[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true); setError('')
    try {
      const r = await cargarPPD(direccion)
      setFacturas(r.facturas); setHuerfanos(r.huerfanos)
    } catch (e: any) { setError('No se pudo cargar: ' + (e?.message || String(e))) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [direccion])

  async function importarXmls(files: FileList) {
    setImportando(true); setError('')
    const res: ResultadoImport[] = []
    for (const file of Array.from(files)) {
      try {
        const c = parsearComplemento(await file.text())
        if (!c) { res.push({ archivo: file.name, ok: false, mensaje: 'No es un CFDI tipo P (complemento de pago).' }); continue }
        const n = await guardarComplemento(c, RFC_OMM)
        const aviso = c.advertencias.length ? ' · ' + c.advertencias.join(' ') : ''
        res.push({ archivo: file.name, ok: true, renglones: n, mensaje: `${n} pago(s) relacionados${aviso}` })
      } catch (e: any) {
        res.push({ archivo: file.name, ok: false, mensaje: e?.message || String(e) })
      }
    }
    setResultados(res); setImportando(false)
    if (fileRef.current) fileRef.current.value = ''
    load()
  }

  const resumen = useMemo(() => {
    const r: Record<EstatusPPD, { n: number; monto: number }> = {
      pendiente: { n: 0, monto: 0 }, parcial: { n: 0, monto: 0 },
      conciliada: { n: 0, monto: 0 }, revision: { n: 0, monto: 0 },
    }
    for (const f of facturas) { r[f.estatus].n++; r[f.estatus].monto += f.saldo > 0 ? f.saldo : 0 }
    return r
  }, [facturas])

  const lista = useMemo(() => {
    const s = q.toLowerCase().trim()
    return facturas.filter(f => {
      if (filtro !== 'todas' && f.estatus !== filtro) return false
      if (!s) return true
      return (f.contraparte || '').toLowerCase().includes(s)
        || `${f.serie || ''}${f.folio || ''}`.toLowerCase().includes(s)
        || (f.uuid_fiscal || '').toLowerCase().includes(s)
    })
  }, [facturas, q, filtro])

  const candidatas = useMemo(
    () => facturas.filter(f => f.estatus !== 'conciliada').slice(0, 400),
    [facturas])

  return (
    <div>
      {/* Emitidas / recibidas */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 2, background: '#141414', borderRadius: 8, padding: 2, border: '1px solid #222' }}>
          {([['emitida', 'Emitidas (nos deben)'], ['recibida', 'Recibidas (debemos)']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setDireccion(k)} style={{
              padding: '6px 12px', fontSize: 12, fontWeight: direccion === k ? 600 : 400,
              color: direccion === k ? '#fff' : '#777', background: direccion === k ? '#2a2a2a' : 'transparent',
              border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
            }}>{l}</button>
          ))}
        </div>
        <input ref={fileRef} type="file" accept=".xml" multiple style={{ display: 'none' }}
          onChange={e => e.target.files?.length && importarXmls(e.target.files)} />
        <Btn variant="primary" onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> {importando ? 'Importando…' : 'Importar XML de complementos'}
        </Btn>
        <Btn onClick={load}><RefreshCw size={13} /> Recargar</Btn>
      </div>

      {error && (
        <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 10, color: '#f87171', fontSize: 12, marginBottom: 12 }}>{error}</div>
      )}

      {/* Sin detalle cargado no hay nada que conciliar, y hay que decirlo de
          frente en vez de mostrar 253 facturas en cero como si no les hubieran
          pagado nunca. */}
      {!loading && facturas.length > 0 && facturas.every(f => f.pagos.length === 0) && huerfanos.length === 0 && (
        <div style={{ background: '#1a1608', border: '1px solid #6b4c14', borderRadius: 10, padding: 14, marginBottom: 14, fontSize: 12.5, color: '#D9A441', lineHeight: 1.6 }}>
          <b>Todavía no hay ningún complemento con detalle cargado.</b><br />
          En el sistema hay CFDI tipo P guardados, pero solo su encabezado: el <i>IdDocumento</i> que dice a qué
          factura corresponde cada pago vive únicamente dentro del XML, y esos XML no se guardaron al importarlos.
          Sube los XML de los complementos con el botón de arriba y el amarre se hace solo.
          Mientras tanto todas las facturas se ven como pendientes, que es lo que el sistema sabe hoy — no
          necesariamente lo que pasó.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
        {(['pendiente', 'parcial', 'conciliada', 'revision'] as EstatusPPD[]).map(k => (
          <div key={k} onClick={() => setFiltro(filtro === k ? 'todas' : k)} style={{ cursor: 'pointer', opacity: filtro === 'todas' || filtro === k ? 1 : 0.45 }}>
            <KpiCard label={ESTATUS_CFG[k].label} value={resumen[k].n} color={ESTATUS_CFG[k].color}
              icon={k === 'revision' ? <AlertTriangle size={16} /> : <FileText size={16} />} />
            <div style={{ fontSize: 10, color: '#555', marginTop: -6, paddingLeft: 14 }}>
              {k === 'conciliada' ? 'sin saldo' : `${M(resumen[k].monto)} por cobrar`}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por cliente, folio o UUID…" style={{ ...input, width: '100%', paddingLeft: 30 }} />
        </div>
        {filtro !== 'todas' && (
          <Btn size="sm" onClick={() => setFiltro('todas')}>Quitar filtro: {ESTATUS_CFG[filtro].label}</Btn>
        )}
        <span style={{ fontSize: 11, color: '#666' }}>{lista.length} de {facturas.length} facturas PPD</span>
      </div>

      {resultados && (
        <div style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <b style={{ fontSize: 12, color: '#eee' }}>Resultado de la importación</b>
            <button onClick={() => setResultados(null)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}>×</button>
          </div>
          {resultados.map((r, i) => (
            <div key={i} style={{ fontSize: 11, color: r.ok ? '#aaa' : '#f87171', padding: '2px 0' }}>
              {r.ok ? '✓' : '✗'} <b>{r.archivo}</b> — {r.mensaje}
            </div>
          ))}
        </div>
      )}

      {/* Pagos cuyo IdDocumento no encontro factura */}
      {huerfanos.length > 0 && (
        <div style={{ background: '#1a1010', border: '1px solid #5a2a2a', borderRadius: 10, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#f87171', marginBottom: 8 }}>
            {huerfanos.length} pago(s) sin factura que les corresponda
          </div>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
            El complemento dice que pagan un folio fiscal que no está en el sistema (o que no es PPD de esta vista).
            Ligalos a mano para que dejen de estar sueltos.
          </div>
          {huerfanos.map(h => (
            <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid #2a1a1a', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace' }}>{h.uuid_buscado.slice(0, 18)}…</span>
              <span style={{ fontSize: 11, color: '#888' }}>{fecha(h.fecha_pago)}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#10B981' }}>{M(h.importe_pagado)}</span>
              <span style={{ fontSize: 10, color: '#666' }}>parc. {h.parcialidad}</span>
              <Btn size="sm" onClick={() => setLigando(h)} style={{ marginLeft: 'auto' }}><Link2 size={12} /> Ligar a una factura</Btn>
            </div>
          ))}
        </div>
      )}

      {loading ? <div style={{ color: '#666', fontSize: 12, padding: 20 }}>Cargando…</div>
        : lista.length === 0 ? <EmptyState message="Ninguna factura PPD coincide." />
        : (
        <div style={{ border: '1px solid #1f1f1f', borderRadius: 10, overflow: 'hidden' }}>
          {lista.map(f => {
            const cfg = ESTATUS_CFG[f.estatus]
            const open = abierta === f.id
            return (
              <div key={f.id} style={{ borderBottom: '1px solid #161616' }}>
                <div onClick={() => setAbierta(open ? null : f.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', borderLeft: `3px solid ${cfg.color}`, flexWrap: 'wrap' }}>
                  {open ? <ChevronDown size={14} color="#666" /> : <ChevronRight size={14} color="#666" />}
                  <Badge label={cfg.label} color={cfg.color} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 60 }}>{[f.serie, f.folio].filter(Boolean).join('-') || '—'}</span>
                  <span style={{ fontSize: 12, color: '#ccc', flex: 1, minWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.contraparte || '—'}</span>
                  <span style={{ fontSize: 11, color: '#777' }}>{fecha(f.fecha_emision)}</span>
                  <span style={{ fontSize: 12, color: '#aaa', minWidth: 110, textAlign: 'right' }}>{M(f.total)}</span>
                  <span style={{ fontSize: 12, color: '#10B981', minWidth: 110, textAlign: 'right' }} title="Pagado">{M(f.pagado)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: f.saldo > 0.05 ? '#D97706' : '#555', minWidth: 110, textAlign: 'right' }} title="Saldo">
                    {f.saldo > 0.05 ? M(f.saldo) : '—'}
                  </span>
                </div>

                {open && (
                  <div style={{ padding: '4px 12px 14px 40px', background: '#0b0b0b' }}>
                    {f.motivos.length > 0 && (
                      <div style={{ background: '#2a1414', border: '1px solid #5a2a2a', borderRadius: 8, padding: 8, marginBottom: 10 }}>
                        {f.motivos.map((m, i) => <div key={i} style={{ fontSize: 11, color: '#f87171' }}>⚠ {m}</div>)}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', marginBottom: 8 }}>Folio fiscal: {f.uuid_fiscal || '— sin UUID —'}</div>
                    {f.pagos.length === 0 ? (
                      <div style={{ fontSize: 11, color: '#666' }}>Sin complementos de pago aplicados.</div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead><tr style={{ color: '#666', textAlign: 'left' }}>
                          <th style={{ padding: '4px 6px' }}>Complemento</th>
                          <th style={{ padding: '4px 6px' }}>Fecha de pago</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Parc.</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Saldo ant.</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Pagado</th>
                          <th style={{ padding: '4px 6px', textAlign: 'right' }}>Saldo insoluto</th>
                          <th style={{ padding: '4px 6px' }}></th>
                        </tr></thead>
                        <tbody>
                          {f.pagos.map(p => (
                            <tr key={p.id} style={{ borderTop: '1px solid #1a1a1a', color: '#bbb' }}>
                              <td style={{ padding: '5px 6px' }}>
                                {[p.complemento_serie, p.complemento_folio].filter(Boolean).join('-') || (p.complemento_uuid || '').slice(0, 8)}
                                {p.manual && <span title={p.nota_manual || 'Ligado a mano'} style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: '#A78BFA', border: '1px solid #A78BFA55', borderRadius: 4, padding: '1px 4px' }}>MANUAL</span>}
                              </td>
                              <td style={{ padding: '5px 6px' }}>{fecha(p.fecha_pago)}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right' }}>{p.parcialidad}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right', color: '#777' }}>{M(p.saldo_anterior)}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right', color: '#10B981', fontWeight: 600 }}>{M(p.importe_pagado)}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right', color: '#777' }}>{M(p.saldo_insoluto)}</td>
                              <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                                {p.manual && (
                                  <button title="Quitar el vínculo manual: el pago vuelve a donde lo manda el XML"
                                    onClick={async () => { try { await desvincularManual(p.id); load() } catch (e: any) { setError(e?.message || String(e)) } }}
                                    style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><Unlink size={12} /></button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {ligando && (
        <ModalLigar pago={ligando} candidatas={candidatas}
          quien={user?.nombre || user?.email || 'sistema'}
          onClose={() => setLigando(null)}
          onListo={() => { setLigando(null); load() }}
          onError={setError} />
      )}
    </div>
  )
}

function ModalLigar({ pago, candidatas, quien, onClose, onListo, onError }: {
  pago: PagoHuerfano; candidatas: FacturaPPD[]; quien: string
  onClose: () => void; onListo: () => void; onError: (s: string) => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<FacturaPPD | null>(null)
  const [nota, setNota] = useState('')
  const [guardando, setGuardando] = useState(false)

  const res = useMemo(() => {
    const s = q.toLowerCase().trim()
    if (!s) return candidatas.slice(0, 30)
    return candidatas.filter(f =>
      (f.contraparte || '').toLowerCase().includes(s)
      || `${f.serie || ''}${f.folio || ''}`.toLowerCase().includes(s)
      || (f.uuid_fiscal || '').toLowerCase().includes(s)).slice(0, 30)
  }, [candidatas, q])

  async function guardar() {
    if (!sel?.uuid_fiscal) return
    setGuardando(true)
    try { await vincularManual(pago.id, sel.uuid_fiscal, quien, nota); onListo() }
    catch (e: any) { onError('No se pudo ligar: ' + (e?.message || String(e))); setGuardando(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: 14, width: 'min(720px,100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #1f1f1f' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Ligar pago a una factura</div>
          <div style={{ fontSize: 11, color: '#777', marginTop: 4 }}>
            Pago de <b style={{ color: '#10B981' }}>{M(pago.importe_pagado)}</b> del {fecha(pago.fecha_pago)}.
            El complemento dice que corresponde a <span style={{ fontFamily: 'monospace' }}>{pago.uuid_buscado}</span>, que no está en el sistema.
          </div>
          <div style={{ fontSize: 10.5, color: '#D9A441', marginTop: 6 }}>
            Lo que dice el XML no se borra: se guarda aparte quién hizo el cambio y se puede revertir.
          </div>
        </div>
        <div style={{ padding: '12px 20px', borderBottom: '1px solid #1f1f1f' }}>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar factura por cliente, folio o UUID…" style={{ ...input, width: '100%' }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
          {res.length === 0 ? <div style={{ padding: 20, color: '#666', fontSize: 12 }}>Sin resultados.</div> : res.map(f => (
            <div key={f.id} onClick={() => setSel(f)}
              style={{ padding: '8px 10px', borderBottom: '1px solid #191919', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center',
                       background: sel?.id === f.id ? '#10B98118' : 'transparent', borderRadius: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', minWidth: 56 }}>{[f.serie, f.folio].filter(Boolean).join('-') || '—'}</span>
              <span style={{ fontSize: 12, color: '#ccc', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.contraparte}</span>
              <span style={{ fontSize: 11, color: '#777' }}>{fecha(f.fecha_emision)}</span>
              <span style={{ fontSize: 12, color: '#aaa' }}>{M(f.total)}</span>
              <span style={{ fontSize: 11, color: '#D97706' }}>saldo {M(f.saldo)}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: '14px 20px', borderTop: '1px solid #1f1f1f' }}>
          <input value={nota} onChange={e => setNota(e.target.value)} placeholder="Por qué se liga a mano (queda registrado)" style={{ ...input, width: '100%', marginBottom: 10 }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Btn onClick={onClose}>Cancelar</Btn>
            <Btn variant="primary" onClick={guardar} disabled={!sel || guardando}>
              <Link2 size={13} /> {guardando ? 'Ligando…' : 'Ligar a esta factura'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}
