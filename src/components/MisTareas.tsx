// ═══════════════════════════════════════════════════════════════════════════
// MisTareas — la bandeja de cada quien, en el dashboard principal.
//
// Todo lo que una persona tiene en la mano, en un solo lugar: las actividades
// de un proyecto y los encargos sueltos —una cotización, un levantamiento—
// que hasta ahora no cabían en el sistema porque exigían un proyecto.
//
// El orden no es por fecha: es por lo que se está perdiendo. Primero lo
// vencido, después lo que NO TIENE FECHA (que es lo que de verdad se va), y
// hasta abajo lo que va bien. Un director además ve lo de toda su área y
// puede delegar sin salir de aquí.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Badge } from './layout/UI'
import { Check, AlertTriangle, Plus, Users } from 'lucide-react'
import {
  Tarea, TipoTarea, UrgenciaTarea, TIPO_CFG, URGENCIA_TAREA_CFG, AREAS_TRABAJO,
  tareasDe, tareasDeArea, delegar, actualizarTarea, crearTarea,
  estadoFecha, ordenarTareas, resumir,
} from '../lib/tareas'

interface Emp { id: string; name: string; area?: string | null; puesto?: string | null }

export default function MisTareas({ employeeId, nombre, esDG, isMobile }: {
  employeeId?: string | null
  nombre?: string
  esDG?: boolean
  isMobile?: boolean
}) {
  const [mias, setMias] = useState<Tarea[]>([])
  const [area, setArea] = useState<Tarea[]>([])
  const [empleados, setEmpleados] = useState<Emp[]>([])
  const [vista, setVista] = useState<'mias' | 'area'>('mias')
  const [cargando, setCargando] = useState(true)
  const [nueva, setNueva] = useState(false)
  const [form, setForm] = useState({ name: '', tipo: 'cotizacion' as TipoTarea, specialty: '', urgencia: 'normal' as UrgenciaTarea, due_date: '', assignee_id: '' })

  const yo = useMemo(() => empleados.find(e => e.id === employeeId), [empleados, employeeId])
  const miSpecialty = useMemo(
    () => AREAS_TRABAJO.find(a => a.area === yo?.area)?.specialty || '',
    [yo])
  const soyDirector = !!yo && /DIRECTOR|DIRECCION/i.test(yo.puesto || '')

  async function cargar() {
    setCargando(true)
    const { data: emps } = await supabase.from('employees').select('id,name,area,puesto').eq('is_active', true).order('name')
    setEmpleados((emps as any[]) || [])
    if (employeeId) setMias(await tareasDe(employeeId))
    setCargando(false)
  }
  useEffect(() => { cargar() }, [employeeId])

  useEffect(() => {
    if (vista === 'area' && miSpecialty) tareasDeArea(miSpecialty).then(setArea)
  }, [vista, miSpecialty])

  const lista = ordenarTareas(vista === 'mias' ? mias : area)
  const res = resumir(lista)
  const nombreDe = (id?: string | null) => empleados.find(e => e.id === id)?.name || '—'
  const equipo = empleados.filter(e => e.area === yo?.area)

  async function completar(t: Tarea) {
    await actualizarTarea(t.id, { status: 'completada', progress: 100 })
    cargar(); if (vista === 'area' && miSpecialty) tareasDeArea(miSpecialty).then(setArea)
  }

  async function ponerFecha(t: Tarea, f: string) {
    await actualizarTarea(t.id, { due_date: f })
    setMias(p => p.map(x => x.id === t.id ? { ...x, due_date: f } : x))
    setArea(p => p.map(x => x.id === t.id ? { ...x, due_date: f } : x))
  }

  async function reasignar(t: Tarea, aQuien: string) {
    await delegar(t.id, aQuien, employeeId || null)
    if (vista === 'area' && miSpecialty) tareasDeArea(miSpecialty).then(setArea)
    if (employeeId) tareasDe(employeeId).then(setMias)
  }

  async function guardarNueva() {
    const r = await crearTarea({
      ...form,
      specialty: form.specialty || miSpecialty,
      due_date: form.due_date || null,
      assignee_id: form.assignee_id || null,
      solicitada_por: nombre || null,
      solicitada_por_id: employeeId || null,
    })
    if (r.error) { alert(r.error); return }
    setNueva(false)
    setForm({ name: '', tipo: 'cotizacion', specialty: '', urgencia: 'normal', due_date: '', assignee_id: '' })
    cargar(); if (vista === 'area' && miSpecialty) tareasDeArea(miSpecialty).then(setArea)
  }

  const inp: React.CSSProperties = { background: '#141414', color: '#ddd', border: '1px solid #242424', borderRadius: 6, padding: '5px 8px', fontSize: 11, fontFamily: 'inherit', outline: 'none' }

  if (!employeeId) {
    return (
      <div style={{ marginBottom: 24, padding: '14px 16px', background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 10, fontSize: 11.5, color: '#D9A441' }}>
        Tu usuario no está ligado a una ficha de empleado, así que no puedo saber qué tareas son tuyas. Se liga en Usuarios.
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Mis tareas</div>
        {res.vencidas > 0 && (
          <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 700 }}>
            <AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {res.vencidas} vencida(s)
          </span>
        )}
        {res.sinFecha > 0 && (
          <span style={{ fontSize: 11, color: '#D9A441', fontWeight: 600 }}>{res.sinFecha} sin fecha</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(soyDirector || esDG) && miSpecialty && (
            <button onClick={() => setVista(vista === 'mias' ? 'area' : 'mias')}
              style={{ padding: '4px 11px', fontSize: 11, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 6,
                border: '1px solid ' + (vista === 'area' ? '#3B82F6' : '#2a2a2a'),
                background: vista === 'area' ? '#3B82F622' : 'transparent', color: vista === 'area' ? '#60A5FA' : '#888' }}>
              <Users size={11} style={{ verticalAlign: -1 }} /> {vista === 'area' ? 'Ver solo lo mío' : 'Ver toda mi área'}
            </button>
          )}
          <button onClick={() => setNueva(n => !n)}
            style={{ padding: '4px 11px', fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 6, border: '1px solid #10B98155', background: '#10B98122', color: '#10B981' }}>
            <Plus size={11} style={{ verticalAlign: -1 }} /> Nueva tarea
          </button>
        </div>
      </div>

      {nueva && (
        <div style={{ padding: '10px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 10, marginBottom: 10, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 130px 140px 120px 110px 90px', gap: 7 }}>
          <input value={form.name} placeholder="Qué hay que hacer" onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} />
          <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoTarea }))} style={inp}>
            {(Object.keys(TIPO_CFG) as TipoTarea[]).filter(t => t !== 'proyecto').map(t => <option key={t} value={t}>{TIPO_CFG[t].label}</option>)}
          </select>
          <select value={form.specialty || miSpecialty} onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))} style={inp}>
            <option value="">Área…</option>
            {AREAS_TRABAJO.map(a => <option key={a.specialty} value={a.specialty}>{a.label}</option>)}
          </select>
          <select value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))} style={inp}>
            <option value="">Sin asignar</option>
            {empleados.filter(e => {
              const sp = form.specialty || miSpecialty
              const ar = AREAS_TRABAJO.find(a => a.specialty === sp)?.area
              return !ar || e.area === ar
            }).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} style={inp} />
          <button onClick={guardarNueva} style={{ ...inp, cursor: 'pointer', background: '#10B98122', color: '#10B981', border: '1px solid #10B98155', fontWeight: 700 }}>Crear</button>
        </div>
      )}

      <div style={{ background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 10, overflow: 'hidden' }}>
        {cargando && <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: '#555' }}>Cargando…</div>}
        {!cargando && lista.length === 0 && (
          <div style={{ padding: 22, textAlign: 'center', fontSize: 11.5, color: '#555' }}>
            {vista === 'mias' ? 'No tienes tareas abiertas.' : 'Tu área no tiene tareas abiertas.'}
          </div>
        )}
        {lista.map(t => {
          const ef = estadoFecha(t)
          const tcfg = TIPO_CFG[t.tipo] || TIPO_CFG.otro
          const ucfg = URGENCIA_TAREA_CFG[t.urgencia] || URGENCIA_TAREA_CFG.normal
          const proyecto = (t as any).project?.name
          return (
            <div key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 12px', borderBottom: '1px solid #161616', background: ef.estado === 'vencida' ? '#1c1212' : ef.estado === 'sin_fecha' ? '#1a1710' : 'transparent' }}>
              <button onClick={() => completar(t)} title="Marcar terminada"
                style={{ marginTop: 2, width: 16, height: 16, borderRadius: 4, border: '1px solid #333', background: 'transparent', cursor: 'pointer', color: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Check size={10} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#fff' }}>{t.name}</div>
                <div style={{ fontSize: 10, color: '#777', marginTop: 2, display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ color: tcfg.color }}>{tcfg.icono} {tcfg.label}</span>
                  {proyecto && <span>· {proyecto}</span>}
                  {t.titulo_cliente && <span>· {t.titulo_cliente}</span>}
                  {t.urgencia !== 'normal' && <span style={{ color: ucfg.color, fontWeight: 700 }}>· {ucfg.label}</span>}
                  {vista === 'area' && <span>· {nombreDe(t.assignee_id)}</span>}
                  {t.solicitada_por && <span style={{ color: '#555' }}>· pidió {t.solicitada_por}</span>}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {vista === 'area' && (
                  <select value={t.assignee_id || ''} onChange={e => reasignar(t, e.target.value)}
                    title="Delegar a alguien del equipo" style={{ ...inp, width: 130, fontSize: 10 }}>
                    <option value="">Sin asignar</option>
                    {equipo.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                )}
                <input type="date" value={t.due_date || ''} onChange={e => ponerFecha(t, e.target.value)}
                  title="Fecha de entrega" style={{ ...inp, width: 122, fontSize: 10, borderColor: ef.estado === 'sin_fecha' ? '#DC262666' : '#242424' }} />
                <Badge label={ef.label} color={ef.color} />
              </div>
            </div>
          )
        })}
      </div>

      {res.sinFecha > 0 && (
        <div style={{ marginTop: 8, fontSize: 10, color: '#666', lineHeight: 1.6 }}>
          Las {res.sinFecha} tareas sin fecha están arriba a propósito: una tarea sin día es la que se pierde,
          y hoy hay 646 actividades de proyecto en esa condición. Ponerles fecha aquí las saca del limbo.
        </div>
      )}
    </div>
  )
}
