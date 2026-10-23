// ═══════════════════════════════════════════════════════════════════════════
//  Editor de plantillas de trabajo (plantillas_encargo + plantilla_actividades).
//
//  Vivía dentro de Actividades. Se sacó a su propio archivo (oct-2026) porque
//  ahora también se abre desde Proyectos: con el sistema de trabajo por áreas,
//  la plantilla de cada área es lo que arma el proyecto al firmar el contrato.
// ═══════════════════════════════════════════════════════════════════════════
import React, { useEffect, useState } from 'react'
import { Play, Trash2 } from 'lucide-react'
import { TipoEntregable } from '../lib/entregables'
import { EmpleadoRol, ROL_CFG, ROLES_GABINETE, ALCANCE_ROL } from '../lib/roles'
import { AREAS_TRABAJO } from '../lib/tareas'
import {
  PlantillaEncargo, ActividadPlantilla, cargarPlantillas, actividadesDe,
  borrarPlantilla, aplicarPlantilla,
} from '../lib/plantillas'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { background: '#141414', color: '#ddd', border: '1px solid #242424', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }
const btn: React.CSSProperties = { border: '1px solid #333', background: '#161616', color: '#ccc', borderRadius: 8, padding: '6px 11px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }
const h2: React.CSSProperties = { fontSize: 13, color: '#ddd', fontWeight: 600, margin: '0 0 8px' }
const sub: React.CSSProperties = { fontSize: 11.5, color: '#777', margin: '0 0 10px', lineHeight: 1.6 }

// ═══ PLANTILLAS ════════════════════════════════════════════════════════════

export default function EditorPlantillas({ emps, tipos, miSpecialty, employeeId, nombre, onAplicada }: {
  emps: EmpleadoRol[]; tipos: TipoEntregable[]; miSpecialty: string
  employeeId: string; nombre?: string; onAplicada: () => void
}) {
  const [lista, setLista] = useState<PlantillaEncargo[]>([])
  const [abierta, setAbierta] = useState('')
  const [acts, setActs] = useState<Record<string, ActividadPlantilla[]>>({})
  const [aplicar, setAplicar] = useState('')
  const [form, setForm] = useState({ titulo: '', objetivo: '' })
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function cargar() { setLista(await cargarPlantillas()) }
  useEffect(() => { cargar() }, [])

  async function abrir(p: PlantillaEncargo) {
    if (abierta === p.id) { setAbierta(''); return }
    setAbierta(p.id)
    if (!acts[p.id]) setActs(a => ({ ...a, [p.id]: [] }))
    const list = await actividadesDe(p.id)
    setActs(a => ({ ...a, [p.id]: list }))
  }

  async function correr(p: PlantillaEncargo) {
    setBusy(true); setMsg('')
    const r = await aplicarPlantilla(p.id, {
      specialty: p.specialty || miSpecialty || 'elec',
      fechaObjetivo: form.objetivo || null,
      tituloCliente: form.titulo || null,
      prefijo: form.titulo || null,
      solicitadaPor: nombre || null,
      solicitadaPorId: employeeId,
    }, emps)
    setBusy(false)
    if (r.error) return setMsg('Error: ' + r.error)
    setMsg(`${r.creadas} actividad(es) creadas.` +
      (r.sinDueno ? ` ${r.sinDueno} sin dueño, repártelas en "Mi equipo".` : '') +
      (r.enElPasado ? ` ${r.enElPasado} con fecha ya vencida: el encargo llegó tarde.` : ''))
    setAplicar(''); setForm({ titulo: '', objetivo: '' })
    cargar(); onAplicada()
  }

  return (
    <>
      <h2 style={h2}>Plantillas de encargo</h2>
      <p style={sub}>
        El cascadeo escrito una vez. La IA propone la primera versión; ustedes la corrigen y a partir de ahí manda
        el estándar de la casa, no el criterio del modelo. Dos proyectos iguales deben llevar el mismo plan —
        si cada uno se improvisa, no hay nada que comparar.
      </p>
      {msg && <div style={{ ...card, marginBottom: 12, fontSize: 12, color: msg.startsWith('Error') ? '#DC2626' : '#10B981' }}>{msg}</div>}

      {/* Quién responde de qué. Es la frontera que usa el sistema para
          repartir y la que lee la IA antes de proponer un plan. Lo que dice
          "no hace" pesa tanto como lo de arriba: un rol definido solo por lo
          que hace se expande hasta comerse el de al lado. */}
      <details style={{ ...card, marginBottom: 14 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12.5, color: '#93c5fd', fontWeight: 500 }}>
          Quién es responsable de qué
        </summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12, marginTop: 12 }}>
          {ROLES_GABINETE.map(r => {
            const al = ALCANCE_ROL[r]
            return (
              <div key={r} style={{ background: '#0e0e0e', border: '1px solid #1f1f1f', borderRadius: 9, padding: 12 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: ROL_CFG[r].color }}>{ROL_CFG[r].label}</div>
                <div style={{ fontSize: 11.5, color: '#999', margin: '4px 0 8px', lineHeight: 1.55 }}>{al.resumen}</div>
                <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: '#bbb', lineHeight: 1.6 }}>
                  {al.hace.map((h, i) => <li key={i}>{h}</li>)}
                </ul>
                <div style={{ fontSize: 10.5, color: '#a06a6a', marginTop: 7, lineHeight: 1.6 }}>
                  <b>No hace:</b> {al.noHace.join(' · ')}
                </div>
              </div>
            )
          })}
        </div>
      </details>

      {lista.length === 0 && (
        <div style={{ ...card, color: '#666', fontSize: 12.5, lineHeight: 1.7 }}>
          Todavía no hay plantillas. Ve a <b style={{ color: '#93c5fd' }}>Nuevo encargo</b>, pega un scope real,
          deja que la IA proponga el plan, corrígelo y guárdalo. La segunda vez que llegue un encargo así, ya no
          necesitas la IA.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {lista.map(p => (
          <div key={p.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200, cursor: 'pointer' }} onClick={() => abrir(p)}>
                <div style={{ fontSize: 14, color: '#eee', fontWeight: 500 }}>
                  {p.nombre}
                  {p.origen === 'ia' && <span style={{ fontSize: 9.5, color: '#A78BFA', border: '1px solid #A78BFA44', borderRadius: 5, padding: '1px 5px', marginLeft: 7 }}>propuesta por IA</span>}
                </div>
                {p.descripcion && <p style={{ fontSize: 12, color: '#888', margin: '4px 0 0', lineHeight: 1.55 }}>{p.descripcion}</p>}
                <div style={{ fontSize: 10.5, color: '#666', marginTop: 5 }}>
                  {p.tipo}{p.specialty ? ` · ${AREAS_TRABAJO.find(a => a.specialty === p.specialty)?.label || p.specialty}` : ''}
                  {p.recurrencia ? ` · se repite ${p.recurrencia}` : ''} · usada {p.veces_usada} vez(ces)
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setAplicar(v => v === p.id ? '' : p.id)} style={{ ...btn, borderColor: '#10B98155', color: '#10B981' }}>
                  <Play size={12} /> Aplicar
                </button>
                <button onClick={async () => { if (confirm(`¿Archivar la plantilla "${p.nombre}"? Las actividades ya creadas no se tocan.`)) { await borrarPlantilla(p.id); cargar() } }}
                  style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', display: 'flex', alignSelf: 'center' }}><Trash2 size={13} /></button>
              </div>
            </div>

            {aplicar === p.id && (
              <div style={{ marginTop: 11, borderTop: '1px solid #1c1c1c', paddingTop: 11, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>Proyecto o cliente</div>
                  <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Casa Cúspide" style={{ ...inp, width: 190 }} />
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>Fecha comprometida</div>
                  <input type="date" value={form.objetivo} onChange={e => setForm(f => ({ ...f, objetivo: e.target.value }))} style={{ ...inp, width: 150 }} />
                </div>
                <button onClick={() => correr(p)} disabled={busy} style={{ ...btn, borderColor: '#10B981', color: '#10B981' }}>
                  {busy ? 'Creando…' : 'Crear las actividades'}
                </button>
              </div>
            )}

            {abierta === p.id && (
              <div style={{ marginTop: 11, borderTop: '1px solid #1c1c1c', paddingTop: 11 }}>
                {(acts[p.id] || []).map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '5px 0', fontSize: 12 }}>
                    <span style={{ color: '#555', width: 16, flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <span style={{ color: '#ddd' }}>{a.nombre}</span>
                      <span style={{ color: ROL_CFG[a.rol]?.color, fontSize: 11, marginLeft: 8 }}>{ROL_CFG[a.rol]?.label}</span>
                      {a.tipo_entregable_id && <span style={{ color: '#67E8F9', fontSize: 11, marginLeft: 8 }}>· {tipos.find(t => t.id === a.tipo_entregable_id)?.nombre}</span>}
                      <span style={{ color: '#666', fontSize: 11, marginLeft: 8 }}>
                        {a.dias_antes_entrega != null ? `· ${a.dias_antes_entrega}d antes de entregar` : a.dias_desde_inicio != null ? `· día ${a.dias_desde_inicio}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
                {(acts[p.id] || []).length === 0 && <div style={{ fontSize: 11.5, color: '#666' }}>Cargando actividades…</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
