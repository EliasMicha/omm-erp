// ═══════════════════════════════════════════════════════════════════════════
// LevantamientoLead — el reenvío al grupo, pero que no se pierde.
//
// Tres pasos, los mismos que ya haces hoy:
//   1. Pegas lo que llegó por WhatsApp o correo.
//   2. Marcas qué áreas entran, con qué urgencia y tus indicaciones.
//   3. Canalizas: cada director recibe su parte con fecha límite para
//      contestar con actividades fechadas.
//
// Lo único nuevo es el paso 3, y es todo el punto: hoy el mensaje sale del
// grupo y ya nadie sabe si alguien lo tomó.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Badge, Btn } from './layout/UI'
import { ClipboardList, Plus, Send, Trash2, AlertTriangle, ArrowRight, Check } from 'lucide-react'
import {
  Levantamiento, LevantamientoArea, Urgencia, URGENCIA_CFG, ESTADO_AREA_CFG, ESPECIALIDADES,
  cargarLevantamientos, crearLevantamiento, canalizar, derivarArea,
  limiteRespuesta, respuestaVencida, diasSinResponder, avanceFechado, marcarFechada,
} from '../lib/levantamiento'

interface Emp { id: string; name: string; area?: string | null; puesto?: string | null }

export default function LevantamientoLead({ leadId, leadNombre, quien }: {
  leadId: string
  leadNombre: string
  quien: string
}) {
  const [lista, setLista] = useState<Levantamiento[]>([])
  const [empleados, setEmpleados] = useState<Emp[]>([])
  const [abierto, setAbierto] = useState<string>('')
  const [avances, setAvances] = useState<Record<string, { total: number; conFecha: number; conResponsable: number }>>({})
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    const [ls, { data: emps }] = await Promise.all([
      cargarLevantamientos(leadId),
      supabase.from('employees').select('id,name,area,puesto').eq('is_active', true).order('name'),
    ])
    setLista(ls)
    setEmpleados((emps as any[]) || [])
    // Avance de fechado de cada área ya derivada
    const av: Record<string, any> = {}
    for (const l of ls) for (const a of (l.areas || [])) {
      if (a.project_id) av[a.id] = await avanceFechado(a.project_id)
    }
    setAvances(av)
  }
  useEffect(() => { cargar() }, [leadId])

  const directorDe = (specialty: string): Emp | undefined => {
    const areaEmp = ESPECIALIDADES.find(e => e.key === specialty)?.area
    return empleados.find(e => e.area === areaEmp && /DIRECTOR|DIRECCION/i.test(e.puesto || ''))
  }

  async function nuevo() {
    setGuardando(true)
    const r = await crearLevantamiento(leadId, quien)
    setGuardando(false)
    if (r.error) { alert(r.error); return }
    await cargar()
    if (r.id) setAbierto(r.id)
  }

  const upd = async (id: string, patch: any) => {
    setLista(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
    await supabase.from('levantamientos').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id)
  }

  async function toggleArea(lev: Levantamiento, specialty: string) {
    const existe = (lev.areas || []).find(a => a.specialty === specialty)
    if (existe) {
      if (existe.project_id && !confirm('Esta área ya tiene proyecto derivado. ¿Quitarla del levantamiento? El proyecto no se borra.')) return
      await supabase.from('levantamiento_areas').delete().eq('id', existe.id)
    } else {
      const dir = directorDe(specialty)
      const urg = lev.urgencia
      await supabase.from('levantamiento_areas').insert({
        levantamiento_id: lev.id, specialty,
        director_id: dir?.id || null,
        urgencia: urg,
        fecha_respuesta_limite: limiteRespuesta(urg),
        fecha_compromiso: lev.fecha_compromiso_cliente || null,
      })
    }
    cargar()
  }

  const updArea = async (areaId: string, patch: any) => {
    setLista(prev => prev.map(l => ({ ...l, areas: (l.areas || []).map(a => a.id === areaId ? { ...a, ...patch } : a) })))
    await supabase.from('levantamiento_areas').update(patch).eq('id', areaId)
  }

  async function canalizarLev(lev: Levantamiento) {
    const r = await canalizar(lev)
    if (!r.ok) { alert(r.error); return }
    alert(`Canalizado a ${(lev.areas || []).length} área(s). Cada director tiene hasta su fecha límite para devolver las actividades con dueño y día.`)
    cargar()
  }

  async function derivar(lev: Levantamiento, area: LevantamientoArea) {
    setGuardando(true)
    const r = await derivarArea(lev, area, leadNombre)
    setGuardando(false)
    if (!r.ok) { alert(r.error); return }
    alert(`Proyecto creado con ${r.actividades} actividades.\n\nAhora el director las tiene que fechar y asignar — el área no cuenta como atendida hasta que no falte ninguna.`)
    cargar()
  }

  async function cerrarArea(area: LevantamientoArea) {
    const r = await marcarFechada(area)
    if (!r.ok) { alert(r.error); return }
    cargar()
  }

  async function borrar(lev: Levantamiento) {
    if (!confirm('¿Borrar este levantamiento? Los proyectos ya derivados no se borran.')) return
    await supabase.from('levantamientos').delete().eq('id', lev.id)
    cargar()
  }

  const inp: React.CSSProperties = { background: '#141414', color: '#ddd', border: '1px solid #242424', borderRadius: 6, padding: '6px 9px', fontSize: 11.5, fontFamily: 'inherit', outline: 'none', width: '100%' }
  const lbl: React.CSSProperties = { fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 3 }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <ClipboardList size={15} style={{ color: '#67E8F9' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Levantamiento / Scope</div>
        <div style={{ fontSize: 10, color: '#666' }}>lo que llegó, a quién se canaliza y para cuándo</div>
        <Btn size="sm" variant="primary" onClick={nuevo} disabled={guardando} style={{ marginLeft: 'auto' }}>
          <Plus size={12} /> Nuevo levantamiento
        </Btn>
      </div>

      {lista.length === 0 && (
        <div style={{ padding: '18px 16px', background: '#0f0f0f', border: '1px dashed #222', borderRadius: 10, fontSize: 11.5, color: '#666', lineHeight: 1.6 }}>
          Aquí se registra lo que llega por WhatsApp o correo antes de repartirlo. Se pega el mensaje tal cual, se marcan las áreas que entran
          con su urgencia, y cada director recibe su parte con una fecha límite para devolver sus actividades fechadas.
        </div>
      )}

      {lista.map(lev => {
        const est = abierto === lev.id
        const areas = lev.areas || []
        const vencidas = areas.filter(a => respuestaVencida(a))
        const urgCfg = URGENCIA_CFG[lev.urgencia] || URGENCIA_CFG.normal
        return (
          <div key={lev.id} style={{ marginBottom: 10, background: '#0f0f0f', border: '1px solid ' + (vencidas.length ? '#DC262655' : '#1f1f1f'), borderRadius: 10, overflow: 'hidden' }}>
            <div onClick={() => setAbierto(est ? '' : lev.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: '#666' }}>{est ? '▾' : '▸'}</span>
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#67E8F9' }}>{lev.folio}</span>
              <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{lev.inmueble || 'Sin inmueble'}</span>
              <Badge label={urgCfg.label} color={urgCfg.color} />
              {areas.map(a => {
                const e = ESPECIALIDADES.find(x => x.key === a.specialty)
                const cfg = ESTADO_AREA_CFG[a.estado] || ESTADO_AREA_CFG.canalizada
                return <span key={a.id} title={`${e?.label} · ${cfg.label}`}
                  style={{ fontSize: 9, padding: '1px 7px', borderRadius: 4, background: cfg.color + '22', color: cfg.color, whiteSpace: 'nowrap' }}>
                  {e?.label.split(' ').pop()} · {cfg.label}
                </span>
              })}
              {vencidas.length > 0 && (
                <span style={{ marginLeft: 'auto', fontSize: 10, color: '#DC2626', fontWeight: 700 }}>
                  <AlertTriangle size={10} style={{ verticalAlign: -1 }} /> {vencidas.length} área(s) sin contestar
                </span>
              )}
            </div>

            {est && (
              <div style={{ padding: '0 12px 12px' }}>
                {/* Lo que llegó */}
                <div style={{ marginBottom: 12 }}>
                  <div style={lbl}>Lo que llegó — pégalo tal cual</div>
                  <textarea value={lev.origen_texto || ''} rows={4}
                    onChange={e => upd(lev.id, { origen_texto: e.target.value })}
                    placeholder="Pega aquí el mensaje de WhatsApp o el correo. Sin resumir: el original es lo que después aclara las dudas."
                    style={{ ...inp, resize: 'vertical', lineHeight: 1.55 }} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    {(['whatsapp', 'correo', 'llamada', 'junta', 'otro'] as const).map(c => (
                      <button key={c} onClick={() => upd(lev.id, { origen_canal: c })}
                        style={{ padding: '2px 10px', fontSize: 10, borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                          border: '1px solid ' + (lev.origen_canal === c ? '#67E8F9' : '#2a2a2a'),
                          background: lev.origen_canal === c ? '#67E8F922' : 'transparent',
                          color: lev.origen_canal === c ? '#67E8F9' : '#666' }}>{c}</button>
                    ))}
                  </div>
                </div>

                {/* Datos del proyecto */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginBottom: 12 }}>
                  {([
                    ['inmueble', 'Inmueble / proyecto', 'text'],
                    ['direccion', 'Dirección', 'text'],
                    ['superficie_m2', 'Superficie m²', 'number'],
                    ['niveles', 'Niveles', 'text'],
                    ['fecha_compromiso_cliente', 'Cliente lo quiere para', 'date'],
                  ] as const).map(([k, l, t]) => (
                    <div key={k}>
                      <div style={lbl}>{l}</div>
                      <input type={t} value={(lev as any)[k] ?? ''}
                        onChange={e => upd(lev.id, { [k]: t === 'number' ? (Number(e.target.value) || null) : e.target.value })}
                        style={inp} />
                    </div>
                  ))}
                  <div>
                    <div style={lbl}>Urgencia</div>
                    <select value={lev.urgencia}
                      onChange={e => upd(lev.id, { urgencia: e.target.value as Urgencia })} style={inp}>
                      {(Object.keys(URGENCIA_CFG) as Urgencia[]).map(u => (
                        <option key={u} value={u}>{URGENCIA_CFG[u].label} — contestan en {URGENCIA_CFG[u].dias}d</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div style={lbl}>Indicaciones — lo que hoy escribes en el grupo</div>
                  <textarea value={lev.indicaciones || ''} rows={2}
                    onChange={e => upd(lev.id, { indicaciones: e.target.value })}
                    placeholder="ej. Prioridad al sembrado para poder cotizar esta semana. El cliente ya mandó arquitectónicos, faltan cortes."
                    style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
                </div>

                {/* A quién se le pregunta. Un ingeniero atorado con una duda
                    técnica no tiene por qué buscar en el CRM quién factura. */}
                <div style={{ marginBottom: 12 }}>
                  <div style={lbl}>Contacto para dudas técnicas (RFI)</div>
                  <input value={lev.contacto_rfi || ''}
                    onChange={e => upd(lev.id, { contacto_rfi: e.target.value })}
                    placeholder="Nombre y teléfono de a quién se le pregunta cuando el plano no dice algo"
                    style={inp} />
                </div>

                {/* Áreas */}
                <div style={lbl}>Qué áreas entran</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                  {ESPECIALIDADES.map(e => {
                    const on = areas.some(a => a.specialty === e.key)
                    return (
                      <button key={e.key} onClick={() => toggleArea(lev, e.key)}
                        style={{ padding: '4px 12px', fontSize: 11, fontWeight: on ? 700 : 400, borderRadius: 20, cursor: 'pointer', fontFamily: 'inherit',
                          border: '1px solid ' + (on ? e.color : '#2a2a2a'),
                          background: on ? e.color + '22' : 'transparent', color: on ? e.color : '#666' }}>
                        {on ? '✓ ' : ''}{e.label}
                      </button>
                    )
                  })}
                </div>

                {areas.map(a => {
                  const e = ESPECIALIDADES.find(x => x.key === a.specialty)
                  const cfg = ESTADO_AREA_CFG[a.estado] || ESTADO_AREA_CFG.canalizada
                  const dir = empleados.find(x => x.id === a.director_id)
                  const av = avances[a.id]
                  const vencida = respuestaVencida(a)
                  const dias = diasSinResponder(a)
                  return (
                    <div key={a.id} style={{ padding: '10px 12px', marginBottom: 8, background: vencida ? '#1c1212' : '#0c0c0c', border: '1px solid ' + (vencida ? '#DC262644' : '#1a1a1a'), borderRadius: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <div style={{ width: 7, height: 7, borderRadius: 2, background: e?.color }} />
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{e?.label}</div>
                        <Badge label={cfg.label} color={cfg.color} />
                        <span style={{ fontSize: 10, color: '#777' }}>Responde: {dir?.name || 'sin director'}</span>
                        {vencida && <span style={{ fontSize: 10, color: '#DC2626', fontWeight: 700 }}>{dias}d sin contestar</span>}
                        {av && (
                          <span style={{ marginLeft: 'auto', fontSize: 10, color: av.conFecha === av.total ? '#10B981' : '#D9A441' }}>
                            {av.conFecha}/{av.total} fechadas · {av.conResponsable}/{av.total} con dueño
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 8, marginBottom: 8 }}>
                        <div>
                          <div style={lbl}>Entrega esta área</div>
                          <input type="date" value={a.fecha_compromiso || ''}
                            onChange={ev => updArea(a.id, { fecha_compromiso: ev.target.value })} style={inp} />
                        </div>
                        <div>
                          <div style={lbl}>Contesta a más tardar</div>
                          <input type="date" value={a.fecha_respuesta_limite || ''}
                            onChange={ev => updArea(a.id, { fecha_respuesta_limite: ev.target.value })} style={inp} />
                        </div>
                        <div>
                          <div style={lbl}>Urgencia del área</div>
                          <select value={a.urgencia || lev.urgencia}
                            onChange={ev => updArea(a.id, { urgencia: ev.target.value })} style={inp}>
                            {(Object.keys(URGENCIA_CFG) as Urgencia[]).map(u => <option key={u} value={u}>{URGENCIA_CFG[u].label}</option>)}
                          </select>
                        </div>
                      </div>

                      <div style={{ marginBottom: 8 }}>
                        <div style={lbl}>Qué se espera de esta área</div>
                        <input value={a.alcance || ''} onChange={ev => updArea(a.id, { alcance: ev.target.value })}
                          placeholder="ej. Sembrado y memoria técnica para poder cotizar" style={inp} />
                      </div>

                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {!a.project_id && (
                          <Btn size="sm" variant="primary" onClick={() => derivar(lev, a)} disabled={guardando}>
                            <ArrowRight size={11} /> Derivar actividades
                          </Btn>
                        )}
                        {a.project_id && a.estado === 'canalizada' && (
                          <Btn size="sm" onClick={() => cerrarArea(a)}>
                            <Check size={11} /> Marcar como fechada
                          </Btn>
                        )}
                        {a.project_id && (
                          <span style={{ fontSize: 10, color: '#555', alignSelf: 'center' }}>
                            Proyecto creado · las actividades se fechan en Proyectos
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center' }}>
                  <Btn size="sm" variant="primary" onClick={() => canalizarLev(lev)}>
                    <Send size={11} /> Canalizar a las áreas
                  </Btn>
                  <button onClick={() => borrar(lev)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex', marginLeft: 'auto' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
