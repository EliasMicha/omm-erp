// ═══════════════════════════════════════════════════════════════════════════
//  "Cada área ve lo suyo" — regla 7 del sistema de trabajo por áreas (oct-2026).
//
//  Quien trabaja en un área de proyecto (permiso Ventas_Ingenieria u
//  Operaciones, con su ficha en INGENIERIAS ELECTRICAS / ESPECIALES /
//  ILUMINACION) abre Proyectos, Cotizaciones, Compras y Catálogo ya filtrados
//  a su especialidad. Es el filtro de inicio, no un candado: el botón "Todas"
//  sigue ahí para lo que una área le entrega a otra. Dirección, Administración
//  y Logística no se filtran.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from './supabase'
import { AREAS_TRABAJO } from './tareas'

const PERMISOS_CON_AREA = ['Ventas_Ingenieria', 'Operaciones']
const ESPECIALIDADES_DE_PROYECTO = ['esp', 'elec', 'ilum']

/** La especialidad del usuario ('esp' | 'elec' | 'ilum') o null si no se filtra. */
export function useMiEspecialidad(): string | null {
  const { user } = useAuth()
  const [specialty, setSpecialty] = useState<string | null>(null)
  const permiso = user?.permission_area || ''
  const employeeId = user?.employee_id || null
  useEffect(() => {
    let vivo = true
    if (!employeeId || !PERMISOS_CON_AREA.includes(permiso)) { setSpecialty(null); return }
    supabase.from('employees').select('area').eq('id', employeeId).maybeSingle()
      .then(({ data }) => {
        if (!vivo) return
        const area = String((data as any)?.area || '').trim().toUpperCase()
        const sp = AREAS_TRABAJO.find(a => a.area === area)?.specialty || null
        setSpecialty(sp && ESPECIALIDADES_DE_PROYECTO.includes(sp) ? sp : null)
      })
    return () => { vivo = false }
  }, [employeeId, permiso])
  return specialty
}

/**
 * Pone el filtro de la página en la especialidad del usuario UNA vez, al
 * llegar el dato. Si la persona ya movió el filtro antes, no se lo pisa.
 */
export function useFiltroInicialDeArea(aplicar: (sp: string) => void): string | null {
  const sp = useMiEspecialidad()
  const [hecho, setHecho] = useState(false)
  useEffect(() => {
    if (sp && !hecho) { aplicar(sp); setHecho(true) }
    // `aplicar` cambia en cada render del padre; sólo importa cuando llega sp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, hecho])
  return sp
}
