// ═══════════════════════════════════════════════════════════════════════════
// SugerirActividades — la IA leyendo el levantamiento donde de verdad está.
//
// Antes esto solo vivía en "Nuevo encargo", lo cual obliga a copiar y pegar el
// mismo scope dos veces. Aquí se usa desde el levantamiento: el texto que ya
// pegaste, las indicaciones que ya escribiste y los documentos que ya
// registraste son el contexto — no hay que volver a teclear nada.
//
// Las tres reglas siguen siendo las mismas y no cambian por estar aquí:
// la IA propone ROLES (no personas), solo puede usar entregables que existen,
// y no crea nada hasta que una persona lo aprueba.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Sparkles, Play, Save, X } from 'lucide-react'
import { TipoEntregable, cargarTipos } from '../lib/entregables'
import { EmpleadoRol, conRol } from '../lib/roles'
import { ActividadPlantilla, crearActividades, guardarPlantilla, ContextoEncargo } from '../lib/plantillas'
import { sugerirPlan, PlanPropuesto, sinDuenoDe } from '../lib/actividadesIA'
import PlanEditable from './PlanEditable'

const btn: React.CSSProperties = { border: '1px solid #333', background: '#161616', color: '#ccc', borderRadius: 8, padding: '6px 11px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }

export interface PeticionSugerencia {
  /** Todo lo que se sabe del encargo, ya concatenado. */
  texto: string
  tipo: string
  specialty: string
  fechaObjetivo?: string | null
  titulo?: string | null
  /** Nombres de los documentos que ya tenemos. */
  documentos?: string[]
  /** A qué se cuelgan las actividades creadas. */
  ctx: Omit<ContextoEncargo, 'specialty' | 'fechaObjetivo'>
}

export default function SugerirActividades({ peticion, onCreado, onCerrar }: {
  peticion: PeticionSugerencia
  onCreado: (r: { creadas: number; sinDueno: number; enElPasado: number }) => void
  onCerrar: () => void
}) {
  const [tipos, setTipos] = useState<TipoEntregable[]>([])
  const [emps, setEmps] = useState<EmpleadoRol[]>([])
  const [plan, setPlan] = useState<PlanPropuesto | null>(null)
  const [pensando, setPensando] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    cargarTipos().then(setTipos)
    supabase.from('employees').select('id,name,area,puesto,roles_extra').eq('is_active', true).order('name')
      .then(({ data }) => setEmps(((data as any[]) || []).map(conRol)))
  }, [])

  async function pensar() {
    setErr(''); setPensando(true)
    const r = await sugerirPlan({
      texto: peticion.texto, tipo: peticion.tipo, specialty: peticion.specialty,
      fechaObjetivo: peticion.fechaObjetivo, titulo: peticion.titulo, documentos: peticion.documentos,
    })
    setPensando(false)
    if (r.error) return setErr(r.error)
    setPlan(r.plan!)
  }
  useEffect(() => { pensar() }, [])

  function editar(i: number, campo: keyof ActividadPlantilla, valor: any) {
    setPlan(p => p ? { ...p, actividades: p.actividades.map((a, j) => j === i ? { ...a, [campo]: valor } : a) } : p)
  }
  function quitar(i: number) {
    setPlan(p => p ? { ...p, actividades: p.actividades.filter((_, j) => j !== i).map((a, k) => ({ ...a, orden: k, depende_de: null })) } : p)
  }

  async function crear(tambienPlantilla: boolean) {
    if (!plan) return
    setBusy(true); setErr('')
    let plantillaId: string | undefined
    if (tambienPlantilla) {
      const g = await guardarPlantilla(
        { nombre: plan.nombre, tipo: peticion.tipo, specialty: peticion.specialty, descripcion: plan.resumen, origen: 'ia' },
        plan.actividades, peticion.ctx.solicitadaPorId)
      if (g.error) { setBusy(false); return setErr(g.error) }
      plantillaId = g.id
    }
    const r = await crearActividades(plan.actividades, {
      ...peticion.ctx,
      specialty: peticion.specialty,
      fechaObjetivo: peticion.fechaObjetivo || null,
    }, emps, plantillaId)
    setBusy(false)
    if (r.error) return setErr(r.error)
    onCreado(r)
  }

  const sinDueno = plan ? sinDuenoDe(plan.actividades, emps, peticion.specialty) : 0

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid #1f1f1f', paddingTop: 12 }}>
      {pensando && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#93c5fd', fontSize: 12.5, padding: '10px 0' }}>
          <Sparkles size={14} /> Leyendo el levantamiento y armando el plan…
        </div>
      )}

      {err && (
        <div style={{ background: '#1a1210', border: '1px solid #3a1a1a', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#e08a80', marginBottom: 10, lineHeight: 1.6 }}>
          {err}
          <button onClick={pensar} style={{ ...btn, marginLeft: 10, padding: '3px 9px', fontSize: 11 }}>Reintentar</button>
        </div>
      )}

      {plan && (
        <PlanEditable
          plan={plan} tipos={tipos} sp={peticion.specialty} objetivo={peticion.fechaObjetivo || ''}
          sinDueno={sinDueno} busy={busy}
          onEditar={editar} onQuitar={quitar}
          onNombre={v => setPlan(p => p ? { ...p, nombre: v } : p)}
          acciones={
            <>
              <button onClick={() => crear(false)} disabled={busy} style={{ ...btn, borderColor: '#10B981', color: '#10B981' }}>
                <Play size={13} /> {busy ? 'Creando…' : 'Crear estas actividades'}
              </button>
              <button onClick={() => crear(true)} disabled={busy} style={{ ...btn, borderColor: '#A78BFA', color: '#A78BFA' }}>
                <Save size={13} /> Crear y guardar como plantilla
              </button>
              <button onClick={onCerrar} style={btn}><X size={12} /> Descartar</button>
            </>
          }
        />
      )}
    </div>
  )
}
