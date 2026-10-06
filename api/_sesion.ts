// Identifica a QUIEN llama a una funcion de /api, usando la sesion real del ERP.
//
// Por que existe: las funciones de /api corren en Vercel, fuera de Supabase, asi
// que ninguna politica de RLS las protege. /api/facturapi quedo abierto a
// internet con Access-Control-Allow-Origin:* y sin autenticar a nadie: cualquiera
// que conociera la URL podia timbrar o cancelar un CFDI contra el RFC de OMM,
// porque las llaves de FacturAPI las pone el proxy.
//
// Como funciona: el navegador manda su access_token de Supabase Auth (el mismo
// con el que entro al ERP) y aqui se valida CONTRA Supabase, no se decodifica a
// mano. Un JWT se puede fabricar; lo que no se puede fabricar es que Supabase lo
// reconozca.
//
// Nota sobre la llave: la anon key no es un secreto — ya viaja en el bundle del
// navegador, es publica por diseno. Lo que autoriza es el token de la persona.
// Deliberadamente NO se usa la service_role key: con ella la consulta se saltaria
// RLS, y aqui la gracia es justamente que RLS siga mandando. La politica
// "app_users leer propio o dg" hace que cada quien solo vea su propio renglon.

const SUPABASE_URL = 'https://ubbumxommqjcpdozpunf.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViYnVteG9tbXFqY3Bkb3pwdW5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODA3MzAsImV4cCI6MjA5MDY1NjczMH0.GPKeRgjzjZ96Qo6lYMHKF68YK4y6ZmexvORsNT8VGns'

export interface SesionErp {
  authUserId: string
  appUserId: string
  nombre: string
  email: string
  permissionArea: string
  nivel: string
  esBot: boolean
}

/** Saca el Bearer del header. El token NUNCA se acepta por query string: los
 *  parametros de URL se quedan escritos en logs, historiales y referers. */
function bearerDe(req: any): string {
  const h = req.headers?.authorization || req.headers?.Authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim())
  return m ? m[1].trim() : ''
}

/**
 * Devuelve la sesion del ERP, o null si no hay una valida.
 * Null cubre todos los casos a proposito —sin token, token vencido, firma
 * invalida, cuenta borrada o inactiva— porque al de afuera no se le dice cual
 * de los cinco fue.
 */
export async function sesionDelErp(req: any): Promise<SesionErp | null> {
  const token = bearerDe(req)
  if (!token) return null

  try {
    // 1. ¿Supabase reconoce este token? Esto valida firma, emisor y vencimiento.
    const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    })
    if (!u.ok) return null
    const authUser = await u.json().catch(() => null)
    if (!authUser?.id) return null

    // 2. ¿A que cuenta del ERP corresponde? Va con el token de la persona, no
    //    con service_role: RLS le entrega su propio renglon y nada mas.
    const q = new URLSearchParams({
      auth_user_id: `eq.${authUser.id}`,
      select: 'id,nombre,email,permission_area,nivel,activo,es_bot',
      limit: '1',
    })
    const r = await fetch(`${SUPABASE_URL}/rest/v1/app_users?${q}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    })
    if (!r.ok) return null
    const filas = await r.json().catch(() => [])
    const row = Array.isArray(filas) ? filas[0] : null
    if (!row || row.activo !== true) return null

    return {
      authUserId: authUser.id,
      appUserId: row.id,
      nombre: row.nombre || '',
      email: row.email || authUser.email || '',
      permissionArea: row.permission_area || '',
      nivel: row.nivel || 'ejecutor',
      esBot: !!row.es_bot,
    }
  } catch {
    // Si no se puede comprobar la identidad, NO se asume que es valida.
    return null
  }
}

/**
 * ¿Esta persona puede mover documentos fiscales (timbrar, cancelar, tocar el
 * cliente fiscal)?
 *
 * Es a proposito la MISMA regla que ya aplica RLS sobre `facturas`: activo, no
 * bot, y DG o Administracion (ver es_area() y usuario_real() en la base). Si un
 * dia cambia alla, tiene que cambiar aqui — y al reves. Dos puertas a la misma
 * bodega con cerraduras distintas es como se cuelan las cosas.
 *
 * Los bots quedan fuera a proposito: una cuenta de bot puede leer y preparar,
 * pero timbrar compromete el RFC de OMM ante el SAT y eso lo hace una persona.
 */
export function puedeOperarFiscal(s: SesionErp | null): boolean {
  if (!s || s.esBot) return false
  return s.permissionArea === 'DG' || s.permissionArea === 'Administracion'
}
