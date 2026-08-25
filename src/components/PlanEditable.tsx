// ═══════════════════════════════════════════════════════════════════════════
// PlanEditable — el plan que propuso la IA, antes de existir.
//
// Vive aparte porque se usa en dos lugares: al dar de alta un encargo suelto
// y al canalizar un levantamiento. Que sea el mismo componente importa: el
// plan se revisa igual venga de donde venga, y nadie aprende dos formas de
// leer lo mismo.
//
// Todo es editable y nada se guarda hasta que alguien lo crea. Las
// advertencias y lo descartado se muestran arriba, no se esconden: si la IA
// invento un entregable que no existe, quien firma el plan tiene que verlo.
// ═══════════════════════════════════════════════════════════════════════════
import { AlertTriangle, Trash2, ChevronRight } from 'lucide-react'
import { TipoEntregable } from '../lib/entregables'
import { ROL_CFG, ROLES_GABINETE } from '../lib/roles'
import { ActividadPlantilla, fechaDe } from '../lib/plantillas'
import { PlanPropuesto } from '../lib/actividadesIA'

const card: React.CSSProperties = { background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }
const inp: React.CSSProperties = { background: '#141414', color: '#ddd', border: '1px solid #242424', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }
const hoyISO = () => new Date().toISOString().slice(0, 10)
const fFecha = (s?: string | null) => s ? new Date(s + 'T12:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : '—'

export default function PlanEditable({ plan, tipos, sp, objetivo, sinDueno, onEditar, onQuitar, onNombre, acciones }: {
  plan: PlanPropuesto; tipos: TipoEntregable[]; sp: string; objetivo: string
  sinDueno: number; busy: boolean
  onEditar: (i: number, c: keyof ActividadPlantilla, v: any) => void
  onQuitar: (i: number) => void
  onNombre: (v: string) => void
  acciones: React.ReactNode
}) {
  const inicio = hoyISO()
  return (
    <div style={card}>
      <input value={plan.nombre} onChange={e => onNombre(e.target.value)}
        style={{ ...inp, fontSize: 15, fontWeight: 600, width: '100%', marginBottom: 6 }} />
      {plan.resumen && <p style={{ fontSize: 12, color: '#999', margin: '0 0 10px', lineHeight: 1.6 }}>{plan.resumen}</p>}

      {(plan.advertencias.length > 0 || plan.descartadas.length > 0) && (
        <div style={{ background: '#141109', border: '1px solid #2a2416', borderRadius: 8, padding: '9px 11px', marginBottom: 11 }}>
          {plan.advertencias.map((a, i) => (
            <div key={i} style={{ fontSize: 11.5, color: '#c9b78a', lineHeight: 1.6, display: 'flex', gap: 6 }}>
              <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {a}
            </div>
          ))}
          {plan.descartadas.map((a, i) => (
            <div key={'d' + i} style={{ fontSize: 11.5, color: '#a08c5e', lineHeight: 1.6, marginTop: 3 }}>Descartado: {a}</div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {plan.actividades.map((a, i) => {
          const { fecha, enElPasado } = fechaDe(a, inicio, objetivo || null)
          const opciones = tipos.filter(t => !t.specialty || t.specialty === (a.specialty || sp))
          return (
            <div key={i} style={{ background: '#0e0e0e', border: `1px solid ${enElPasado ? '#3a2a15' : '#1f1f1f'}`, borderRadius: 9, padding: 11 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: '#555', width: 16 }}>{i + 1}</span>
                <input value={a.nombre} onChange={e => onEditar(i, 'nombre', e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }} />
                <select value={a.rol} onChange={e => onEditar(i, 'rol', e.target.value)}
                  style={{ ...inp, width: 130, color: ROL_CFG[a.rol]?.color }}>
                  {ROLES_GABINETE.map(r => <option key={r} value={r}>{ROL_CFG[r].label}</option>)}
                </select>
                <button onClick={() => onQuitar(i)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', display: 'flex' }}><Trash2 size={13} /></button>
              </div>
              {a.descripcion && <div style={{ fontSize: 11.5, color: '#888', margin: '0 0 7px 24px', lineHeight: 1.55 }}>{a.descripcion}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginLeft: 24 }}>
                <select value={a.tipo_entregable_id || ''} onChange={e => onEditar(i, 'tipo_entregable_id', e.target.value || null)} style={{ ...inp, minWidth: 190, fontSize: 11 }}>
                  <option value="">Sin entregable formal</option>
                  {opciones.map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
                {objetivo ? (
                  <label style={{ fontSize: 10.5, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input type="number" value={a.dias_antes_entrega ?? 0} min={0}
                      onChange={e => onEditar(i, 'dias_antes_entrega', Number(e.target.value))}
                      style={{ ...inp, width: 58, fontSize: 11 }} />
                    días antes de la entrega
                  </label>
                ) : (
                  <label style={{ fontSize: 10.5, color: '#888', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <input type="number" value={a.dias_desde_inicio ?? 0} min={0}
                      onChange={e => onEditar(i, 'dias_desde_inicio', Number(e.target.value))}
                      style={{ ...inp, width: 58, fontSize: 11 }} />
                    días desde hoy
                  </label>
                )}
                <span style={{ fontSize: 11, color: enElPasado ? '#D9A441' : '#777' }}>
                  {fecha ? `→ ${fFecha(fecha)}` : 'sin fecha'}{enElPasado ? ' (ya pasó)' : ''}
                </span>
                {a.depende_de != null && (
                  <span style={{ fontSize: 10.5, color: '#A78BFA', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <ChevronRight size={11} /> después de la {a.depende_de + 1}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {sinDueno > 0 && (
        <div style={{ fontSize: 11.5, color: '#997', marginTop: 11, lineHeight: 1.6 }}>
          {sinDueno} actividad(es) van a nacer sin dueño porque hay más de una persona con ese rol en el área.
          Es a propósito: adivinar a quién le toca es lo que rompe la cadena de responsabilidad. Se reparten en «Mi equipo».
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, marginTop: 13, flexWrap: 'wrap' }}>{acciones}</div>
    </div>
  )
}
