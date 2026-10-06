// El access_token de la sesion actual, para hablarle a las funciones de /api.
//
// Por que hace falta: /api corre en Vercel, fuera de Supabase, asi que RLS no lo
// cubre. Las funciones que tocan algo serio (hoy /api/facturapi) piden este
// token y lo validan contra Supabase antes de hacer nada.
//
// Por que no basta con supabase.auth.getSession(): AuthContext documenta que en
// algunos entornos getSession() se cuelga o entra en loop, y por eso hidrata la
// sesion a mano desde localStorage. Si aqui se usara nada mas getSession(), un
// cuelgue dejaria al usuario sin poder timbrar y sin saber por que. Entonces:
// se intenta getSession() con un limite de tiempo y, si no contesta, se lee la
// misma llave de localStorage que ya usa AuthContext.

import { supabase } from './supabase'

const LLAVE_LS = 'sb-ubbumxommqjcpdozpunf-auth-token'
const LIMITE_MS = 2500

function deLocalStorage(): string | null {
  try {
    const crudo = typeof window !== 'undefined' ? window.localStorage.getItem(LLAVE_LS) : null
    if (!crudo) return null
    return JSON.parse(crudo)?.access_token || null
  } catch {
    return null
  }
}

/** Devuelve el token, o null si no hay sesion. Nunca lanza: quien llama decide
 *  que hacer sin token, y un throw aqui tumbaria la pantalla. */
export async function tokenDeSesion(): Promise<string | null> {
  try {
    const conLimite = await Promise.race([
      supabase.auth.getSession().then(r => r.data.session?.access_token || null),
      new Promise<undefined>(r => setTimeout(() => r(undefined), LIMITE_MS)),
    ])
    // undefined = se acabo el tiempo (cae a localStorage).
    // null      = getSession contesto y de verdad no hay sesion.
    if (conLimite !== undefined) return conLimite
  } catch {
    /* cae a localStorage */
  }
  return deLocalStorage()
}

/** Headers listos para fetch contra /api. Si no hay sesion no inventa nada: el
 *  servidor contesta 401 y eso es lo correcto, mejor que un error raro. */
export async function headersApi(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await tokenDeSesion()
  return {
    ...(extra || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}
