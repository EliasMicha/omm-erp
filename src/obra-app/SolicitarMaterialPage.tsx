// ═══════════════════════════════════════════════════════════════════════════
// SolicitarMaterialPage — el instalador pide material desde la obra.
//
// Le sale el catálogo COMPLETO de la obra (la suma de todas las áreas, como
// pidió Elias: no hace falta que escoja por área) con lo que ya se le entregó
// y lo que le queda por pedir, para que pueda pedir parcialidades sin pasarse.
//
// Lo que no está en el catálogo se pide en "Solicitar extra": ese texto lo
// procesa la IA (/api/extract?action=extra_material) y aterriza en obra_extras,
// que es de donde Compras arma el adendum.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, Loader2, Search, Plus, Minus, Check, Package2, Sparkles, Trash2, Clock, Truck,
} from 'lucide-react'
import {
  cargarMaterialesObra, folioSolicitud, STATUS_SOLICITUD,
  type RenglonMaterial,
} from '../lib/materialesObra'

interface LineaExtra { id: string; texto: string; cantidad: number }

export default function SolicitarMaterialPage({ employeeId }: { employeeId: string }) {
  const { obraId = '' } = useParams()
  const navigate = useNavigate()

  const [cargando, setCargando] = useState(true)
  const [obra, setObra] = useState<any>(null)
  const [renglones, setRenglones] = useState<RenglonMaterial[]>([])
  const [cant, setCant] = useState<Record<string, number>>({})
  const [busqueda, setBusqueda] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(true)
  const [extras, setExtras] = useState<LineaExtra[]>([])
  const [requeridoPara, setRequeridoPara] = useState('')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [aviso, setAviso] = useState('')
  const [misSolicitudes, setMisSolicitudes] = useState<any[]>([])
  const [entregas, setEntregas] = useState<any[]>([])
  const [nombre, setNombre] = useState('')

  useEffect(() => {
    let cancel = false
    async function load() {
      setCargando(true)
      const { data: o } = await supabase.from('obras')
        .select('id,nombre,quotation_id,quotation_ids,project_id').eq('id', obraId).maybeSingle()
      if (cancel) return
      setObra(o)
      const [mat, sols, dels, emp] = await Promise.all([
        o ? cargarMaterialesObra({ id: o.id, cotizacion_id: o.quotation_id, quotation_ids: o.quotation_ids, project_id: o.project_id })
          : Promise.resolve({ renglones: [] } as any),
        supabase.from('obra_material_solicitudes')
          .select('id,folio,fecha,status,requerido_para,obra_material_solicitud_items(id,descripcion,cantidad,cantidad_surtida,unidad,es_extra)')
          .eq('obra_id', obraId).order('created_at', { ascending: false }).limit(8),
        supabase.from('deliveries')
          .select('id,delivery_date,scheduled_time,status,notes,folio,delivery_items(id,description,qty,unit)')
          .eq('obra_id', obraId).in('status', ['pendiente', 'en_ruta']).order('delivery_date').limit(5),
        supabase.from('employees').select('name,nombre').eq('id', employeeId).maybeSingle(),
      ])
      if (cancel) return
      setRenglones((mat as any).renglones || [])
      setMisSolicitudes(((sols as any).data || []) as any[])
      setEntregas(((dels as any).data || []) as any[])
      const e: any = (emp as any).data || {}
      setNombre(e.name || e.nombre || '')
      setCargando(false)
    }
    load()
    return () => { cancel = true }
  }, [obraId, employeeId])

  const catalogo = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return renglones
      .filter(r => !r.fueraDeCatalogo)
      .filter(r => !soloPendientes || r.porSolicitar > 0 || (cant[r.clave] || 0) > 0)
      .filter(r => !q || `${r.descripcion} ${r.marca} ${r.modelo} ${r.sistema}`.toLowerCase().includes(q))
  }, [renglones, busqueda, soloPendientes, cant])

  const seleccionados = renglones.filter(r => (cant[r.clave] || 0) > 0)
  const totalLineas = seleccionados.length + extras.filter(e => e.texto.trim()).length

  const set = (r: RenglonMaterial, n: number) => {
    const tope = r.porSolicitar > 0 ? r.porSolicitar : r.cotizado || 9999
    const v = Math.max(0, Math.min(Math.round(n), tope))
    setCant(c => ({ ...c, [r.clave]: v }))
  }

  async function enviar() {
    if (totalLineas === 0) { setAviso('Selecciona al menos un material.'); return }
    setEnviando(true); setAviso('')
    try {
      const folio = await folioSolicitud()
      const { data: sol, error: e1 } = await supabase.from('obra_material_solicitudes').insert({
        obra_id: obraId,
        solicitante_id: employeeId,
        solicitante_nombre: nombre || null,
        requerido_para: requeridoPara || null,
        notas: notas.trim() || null,
        status: 'solicitada',
        folio,
      }).select().single()
      if (e1) throw e1

      const filas = seleccionados.map(r => ({
        solicitud_id: sol.id,
        obra_id: obraId,
        quotation_item_id: r.quotation_item_id,
        catalog_product_id: r.catalog_product_id,
        clave: r.clave,
        descripcion: r.descripcion,
        marca: r.marca || null,
        modelo: r.modelo || null,
        unidad: r.unidad,
        sistema: r.sistema,
        cantidad: cant[r.clave],
        es_extra: false,
      }))

      // Los extras se procesan con IA para separar producto y cantidad, y se
      // registran en obra_extras (la bandeja que alimenta el adendum de Compras).
      const textosExtra = extras.filter(e => e.texto.trim())
      let extrasProcesados: any[] = []
      if (textosExtra.length > 0) {
        try {
          const r = await fetch('/api/extract?action=extra_material', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              obra_id: obraId,
              obra_nombre: obra?.nombre || '',
              solicitante: nombre,
              lineas: textosExtra.map(e => ({ texto: e.texto.trim(), cantidad: e.cantidad })),
              catalogo: renglones.filter(r2 => !r2.fueraDeCatalogo).slice(0, 300)
                .map(r2 => ({ d: r2.descripcion, s: r2.sistema })),
            }),
          })
          if (r.ok) {
            const j = await r.json()
            if (j.ok) extrasProcesados = j.extras || []
          }
        } catch { /* si la IA falla, guardamos el texto tal cual */ }
      }
      if (extrasProcesados.length === 0 && textosExtra.length > 0) {
        extrasProcesados = textosExtra.map(e => ({
          descripcion: e.texto.trim(), cantidad: e.cantidad, unidad: 'pza', sistema: null, obra_extra_id: null,
        }))
      }
      extrasProcesados.forEach((ex: any) => {
        filas.push({
          solicitud_id: sol.id,
          obra_id: obraId,
          quotation_item_id: null,
          catalog_product_id: ex.catalog_product_id || null,
          clave: 'x:' + String(ex.descripcion || '').toLowerCase().trim(),
          descripcion: ex.descripcion || 'Extra sin descripción',
          marca: ex.marca || null,
          modelo: ex.modelo || null,
          unidad: ex.unidad || 'pza',
          sistema: ex.sistema || null,
          cantidad: Number(ex.cantidad) || 1,
          es_extra: true,
          obra_extra_id: ex.obra_extra_id || null,
        } as any)
      })

      const { error: e2 } = await supabase.from('obra_material_solicitud_items').insert(filas)
      if (e2) throw e2

      setAviso(`✓ Solicitud ${folio} enviada con ${filas.length} renglones. La oficina ya la ve.`)
      setCant({}); setExtras([]); setNotas(''); setRequeridoPara('')
      const { data: sols } = await supabase.from('obra_material_solicitudes')
        .select('id,folio,fecha,status,requerido_para,obra_material_solicitud_items(id,descripcion,cantidad,cantidad_surtida,unidad,es_extra)')
        .eq('obra_id', obraId).order('created_at', { ascending: false }).limit(8)
      setMisSolicitudes((sols || []) as any[])
    } catch (err: any) {
      setAviso('No se pudo enviar: ' + (err?.message || String(err)))
    }
    setEnviando(false)
  }

  const box: React.CSSProperties = {
    background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, padding: 14, marginBottom: 12,
  }
  const input: React.CSSProperties = {
    width: '100%', padding: '10px 12px', background: '#0a0a0a', border: '1px solid #262626',
    borderRadius: 10, color: '#fff', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box',
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1a12 40%, #0a0a0a 100%)',
      color: '#fff', paddingTop: 'max(env(safe-area-inset-top), 20px)', paddingBottom: 120,
      paddingLeft: 16, paddingRight: 16, maxWidth: 480, margin: '0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={() => navigate(`/obra-app/mis-obras/${obraId}`)}
          style={{ background: 'transparent', border: '1px solid #1f1f1f', borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff' }}>
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Pedir material</div>
          <div style={{ fontSize: 11, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {obra?.nombre || '…'}
          </div>
        </div>
      </div>

      {cargando ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={24} className="spin" /></div>
      ) : (
        <>
          {/* Entrega en camino */}
          {entregas.length > 0 && (
            <div style={{ ...box, borderColor: '#2563EB55', background: '#0d1420' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#93c5fd', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Truck size={14} /> Te va a llegar material
              </div>
              {entregas.map(d => (
                <div key={d.id} style={{ borderTop: '1px solid #1a2432', paddingTop: 8, marginTop: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 700 }}>
                    <Clock size={13} color="#60A5FA" />
                    {new Date(d.delivery_date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })}
                    {d.scheduled_time && <span style={{ color: '#60A5FA' }}>· {String(d.scheduled_time).substring(0, 5)}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                    {d.status === 'en_ruta' ? 'Ya viene en camino' : 'Programada'}{d.folio ? ` · ${d.folio}` : ''}
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {(d.delivery_items || []).length === 0
                      ? <div style={{ fontSize: 12, color: '#aaa' }}>{d.notes || 'Sin desglose todavía'}</div>
                      : (d.delivery_items || []).map((i: any) => (
                        <div key={i.id} style={{ fontSize: 12, color: '#ddd' }}>
                          <span style={{ color: '#60A5FA', fontWeight: 700 }}>{i.qty} {i.unit || 'pza'}</span> · {i.description}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Solicitudes previas */}
          {misSolicitudes.length > 0 && (
            <div style={box}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#aaa', marginBottom: 8 }}>Lo que ya pediste</div>
              {misSolicitudes.map(s => {
                const st = STATUS_SOLICITUD[s.status] || { label: s.status, color: '#666' }
                const its = s.obra_material_solicitud_items || []
                const surtido = its.reduce((a: number, i: any) => a + Number(i.cantidad_surtida || 0), 0)
                const pedido = its.reduce((a: number, i: any) => a + Number(i.cantidad || 0), 0)
                return (
                  <div key={s.id} style={{ borderTop: '1px solid #1a1a1a', padding: '7px 0', fontSize: 12 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700 }}>{s.folio}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.color + '18', padding: '2px 7px', borderRadius: 6 }}>{st.label}</span>
                      <span style={{ color: '#666', fontSize: 11 }}>{s.fecha}</span>
                    </div>
                    <div style={{ color: '#777', fontSize: 11, marginTop: 2 }}>
                      {its.length} renglones · {surtido} de {pedido} surtidas
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Buscador */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <Search size={15} color="#555" style={{ position: 'absolute', left: 12, top: 12 }} />
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar material de esta obra"
              style={{ ...input, paddingLeft: 36 }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#888', marginBottom: 12 }}>
            <input type="checkbox" checked={soloPendientes} onChange={e => setSoloPendientes(e.target.checked)} style={{ accentColor: '#10B981', width: 16, height: 16 }} />
            Ocultar lo que ya pedí completo
          </label>

          {/* Catálogo */}
          {catalogo.length === 0 ? (
            <div style={{ ...box, textAlign: 'center', color: '#777', fontSize: 13, padding: 28 }}>
              <Package2 size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
              <div>{renglones.length === 0 ? 'Esta obra todavía no tiene catálogo de materiales cargado.' : 'Nada que mostrar con ese filtro.'}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {catalogo.map(r => {
                const n = cant[r.clave] || 0
                const tope = r.porSolicitar > 0 ? r.porSolicitar : r.cotizado
                return (
                  <div key={r.clave} style={{
                    ...box, marginBottom: 0, padding: 12,
                    borderColor: n > 0 ? '#10B98155' : '#1a1a1a',
                    background: n > 0 ? '#0d1a12' : '#0f0f0f',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3, lineHeight: 1.3 }}>{r.descripcion}</div>
                    <div style={{ fontSize: 10, color: '#666', marginBottom: 8 }}>
                      {[r.marca, r.modelo].filter(Boolean).join(' · ') || r.sistema}
                      {' · '}cotizado {r.cotizado} · en obra {r.recibido} · te faltan por pedir {tope}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button onClick={() => set(r, n - 1)} disabled={n === 0} style={{
                        width: 38, height: 38, borderRadius: 10, border: '1px solid #262626',
                        background: '#141414', color: n === 0 ? '#333' : '#fff', cursor: n === 0 ? 'default' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}><Minus size={16} /></button>
                      <input type="number" inputMode="numeric" value={n || ''} placeholder="0"
                        onChange={e => set(r, Number(e.target.value))}
                        style={{ ...input, width: 74, textAlign: 'center', padding: '9px 4px', fontWeight: 700 }} />
                      <button onClick={() => set(r, n + 1)} style={{
                        width: 38, height: 38, borderRadius: 10, border: '1px solid #10B98155',
                        background: '#10B98118', color: '#4ADE80', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}><Plus size={16} /></button>
                      <span style={{ fontSize: 11, color: '#666' }}>{r.unidad}</span>
                      {tope > 0 && (
                        <button onClick={() => set(r, tope)} style={{
                          marginLeft: 'auto', fontSize: 11, color: '#4ADE80', background: 'transparent',
                          border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
                        }}>Todo ({tope})</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Extras */}
          <div style={{ ...box, borderColor: '#D9770655' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#FBBF24', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={14} /> Solicitar extra
            </div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 10, lineHeight: 1.4 }}>
              ¿Necesitas algo que no está en la lista? Escríbelo como lo dirías. Se manda a la oficina como extra para cotizar.
            </div>
            {extras.map((e, i) => (
              <div key={e.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                <input value={e.cantidad} type="number" inputMode="numeric"
                  onChange={ev => setExtras(x => x.map(y => y.id === e.id ? { ...y, cantidad: Math.max(1, Number(ev.target.value) || 1) } : y))}
                  style={{ ...input, width: 62, textAlign: 'center', padding: '9px 4px' }} />
                <textarea value={e.texto} rows={2}
                  onChange={ev => setExtras(x => x.map(y => y.id === e.id ? { ...y, texto: ev.target.value } : y))}
                  placeholder={i === 0 ? 'Ej: 2 rollos de cable cat6 blindado, se acabó el que había' : 'Otro extra'}
                  style={{ ...input, flex: 1, resize: 'vertical' }} />
                <button onClick={() => setExtras(x => x.filter(y => y.id !== e.id))}
                  style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: 8 }}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button onClick={() => setExtras(x => [...x, { id: Math.random().toString(36).slice(2), texto: '', cantidad: 1 }])}
              style={{
                width: '100%', padding: 10, borderRadius: 10, border: '1px dashed #D9770655',
                background: 'transparent', color: '#FBBF24', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              }}>
              <Plus size={13} style={{ verticalAlign: 'middle' }} /> Agregar extra
            </button>
          </div>

          {/* Cuándo y notas */}
          <div style={box}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>¿Para cuándo lo necesitas?</div>
            <input type="date" value={requeridoPara} onChange={e => setRequeridoPara(e.target.value)} style={{ ...input, marginBottom: 10 }} />
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>Notas para la oficina (opcional)</div>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
              placeholder="Ej: mandarlo con el chofer de la mañana, hay acceso hasta las 6" style={{ ...input, resize: 'vertical' }} />
          </div>

          {aviso && (
            <div style={{
              ...box, borderColor: aviso.startsWith('✓') ? '#10B98155' : '#DC262655',
              color: aviso.startsWith('✓') ? '#4ADE80' : '#f87171', fontSize: 12,
            }}>{aviso}</div>
          )}
        </>
      )}

      {/* Barra fija de envío */}
      {!cargando && totalLineas > 0 && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
          background: 'linear-gradient(180deg, rgba(10,10,10,0) 0%, #0a0a0a 40%)',
        }}>
          <div style={{ maxWidth: 480, margin: '0 auto' }}>
            <button onClick={enviar} disabled={enviando} style={{
              width: '100%', padding: 16, borderRadius: 14, border: 'none',
              background: '#10B981', color: '#04120a', fontSize: 15, fontWeight: 800,
              fontFamily: 'inherit', cursor: enviando ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {enviando ? <Loader2 size={17} className="spin" /> : <Check size={17} />}
              {enviando ? 'Enviando…' : `Enviar solicitud (${totalLineas})`}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
