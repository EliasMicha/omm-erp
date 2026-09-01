/**
 * LA PLANTILLA — una sola lista de gente para todo el ERP
 * ════════════════════════════════════════════════════════════════════════════
 *
 * La gente se administra en NÓMINA. Todo lo demás —entregas, actividades,
 * proyectos, obra, documentación, capacitaciones— sólo la consulta. Así que
 * quien pregunte "¿quiénes trabajan aquí?" tiene que obtener exactamente la
 * misma respuesta que da Nómina, o los listados se desincronizan y nadie
 * entiende por qué en una pantalla aparece alguien y en otra no.
 *
 * ── Por qué existe este archivo ─────────────────────────────────────────────
 *
 * Había ~20 consultas sueltas a `employees`, cada una con su propio criterio:
 *
 *   • Tres filtros distintos de "activo": `is_active`, `activo`, y una que
 *     mezclaba los dos. La tabla arrastra las dos columnas para el mismo
 *     hecho.
 *   • Dos columnas de nombre: `name` y `nombre`. Unas pantallas leían una y
 *     otras la otra.
 *   • Y una que leía `nombre_completo`, que NO EXISTE en la tabla: esa
 *     consulta fallaba en silencio y dejaba el selector vacío. Era el
 *     selector de empleado de Ausencias, en Nómina.
 *
 * Mientras las dos columnas coincidan nadie nota nada. En cuanto una se mueve
 * sin la otra, la mitad del ERP ve una plantilla y la otra mitad ve otra.
 *
 * Cualquier pantalla que necesite gente debe usar `cargarPlantilla()` y no
 * volver a consultar `employees` a mano.
 */

import { supabase } from './supabase'
import { rolDe, type Rol } from './roles'

export interface Persona {
  id: string
  /** El nombre que se muestra. Sale de `nombre` (el de Nómina) y cae a `name`. */
  nombre: string
  puesto: string
  area: string
  rol: Rol
  rolesExtra: Rol[]
  /**
   * Igual que `rolesExtra`, con el nombre de la columna. `rolesDe()` y
   * `conRol()` de roles.ts leen `roles_extra`, y sin esto el director de
   * eléctricas —que además es ingeniero— perdía su segundo rol en silencio.
   */
  roles_extra: Rol[]
  activo: boolean
  /**
   * Alias de `nombre`. Existe sólo para las pantallas que todavía leen `.name`
   * (la columna vieja). Es el mismo texto; no se captura por separado.
   * Al tocar una de esas pantallas, cámbiala a `nombre` y borra el alias.
   */
  name: string
  numeroExcel: number | null
  fotoUrl: string | null
  tipoTrabajo: string | null
}

const txt = (v: any) => String(v ?? '').trim()

function aPersona(r: any): Persona {
  const puesto = txt(r.puesto)
  return {
    id: r.id,
    // Nómina escribe `nombre`; las pantallas viejas escribían `name`. Se
    // prefiere el de Nómina porque es donde se administra la gente.
    nombre: txt(r.nombre) || txt(r.name) || 'Sin nombre',
    name: txt(r.nombre) || txt(r.name) || 'Sin nombre',
    puesto,
    area: txt(r.area),
    rol: rolDe(puesto),
    rolesExtra: Array.isArray(r.roles_extra) ? (r.roles_extra as Rol[]) : [],
    roles_extra: Array.isArray(r.roles_extra) ? (r.roles_extra as Rol[]) : [],
    activo: r.activo !== false && r.is_active !== false,
    numeroExcel: r.numero_excel ?? null,
    fotoUrl: r.foto_url || null,
    tipoTrabajo: r.tipo_trabajo || null,
  }
}

/** Las columnas que necesita `aPersona`. Un solo lugar que las declare. */
const COLUMNAS = 'id,nombre,name,puesto,area,roles_extra,activo,is_active,numero_excel,foto_url,tipo_trabajo'

/**
 * La plantilla, igual que la ve Nómina.
 *
 * Se filtra por las DOS columnas de activo a propósito: mientras la tabla
 * arrastre `activo` e `is_active` para el mismo hecho, basta con que una diga
 * que ya no está para no listarlo. Es el lado seguro del error: preferimos
 * omitir a alguien que ya se fue que asignarle trabajo.
 */
export async function cargarPlantilla(opts: { incluirBajas?: boolean } = {}): Promise<Persona[]> {
  let q = supabase.from('employees').select(COLUMNAS)
  if (!opts.incluirBajas) q = q.neq('activo', false).neq('is_active', false)
  const { data, error } = await q
  if (error) { console.error('[plantilla] no se pudo cargar:', error.message); return [] }
  return ((data as any[]) || []).map(aPersona).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** Una sola persona por id. */
export async function cargarPersona(id?: string | null): Promise<Persona | null> {
  if (!id) return null
  const { data } = await supabase.from('employees').select(COLUMNAS).eq('id', id).maybeSingle()
  return data ? aPersona(data) : null
}

/** Para los `<select>`: [{ value, label }] ya ordenado. */
export const opcionesDePersonas = (p: Persona[]) =>
  p.map(x => ({ value: x.id, label: x.puesto ? `${x.nombre} · ${x.puesto}` : x.nombre }))

/** Mapa id → nombre, para pintar nombres en listados. */
export const mapaDeNombres = (p: Persona[]) => {
  const m: Record<string, string> = {}
  for (const x of p) m[x.id] = x.nombre
  return m
}

export const soloDelArea = (p: Persona[], area?: string | null) => {
  const a = txt(area).toUpperCase()
  return a ? p.filter(x => x.area.toUpperCase() === a) : p
}

export const soloConRol = (p: Persona[], rol: Rol) =>
  p.filter(x => x.rol === rol || x.rolesExtra.includes(rol))
