// ═══════════════════════════════════════════════════════════════════════════
// AuthContext — Supabase Auth + app_users metadata
// ═══════════════════════════════════════════════════════════════════════════
// Flow:
//   1. Login con supabase.auth.signInWithPassword (email + password)
//   2. Después del login, llamamos RPC get_my_app_user() que devuelve el
//      app_users vinculado por auth_user_id = auth.uid()
//   3. Esa info (permission_area, nivel, employee_id) se mantiene en el state
//   4. La sesión la maneja Supabase Auth (JWT con refresh automático)
//
// Para usuarios pre-existentes que NO tienen auth.users todavía:
//   El componente Login detecta el caso (vía check_email_status RPC) y los
//   redirige a un flow de "configurar password" con supabase.auth.signUp.
// ═══════════════════════════════════════════════════════════════════════════
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

export type PermissionArea = 'DG' | 'Administracion' | 'Ventas_Ingenieria' | 'Operaciones' | 'Mantenimiento' | 'Coordinador_Obra'
export type UserNivel = 'director' | 'ejecutor'

// Roles "restringidos": solo pueden ver/entrar a las rutas listadas (whitelist).
// El resto de rutas se ocultan del menú y se bloquean por URL directa.
// (DG siempre ve todo; las áreas que NO aparecen aquí usan la lógica de allowedAreas por ruta.)
export const RESTRICTED_AREA_ROUTES: Partial<Record<PermissionArea, string[]>> = {
  // Rol Mantenimiento: solo ve estas 3 secciones (menú + bloqueo por URL directa)
  Mantenimiento: ['/mantenimiento', '/catalogo', '/obra'],
  // Coordinador de instalaciones especiales: solo el módulo de Obra (obras, equipo
  // de instalación / asignación de instaladores y planeación semanal — todo vive en /obra).
  Coordinador_Obra: ['/obra'],
}
// Ruta "home" a la que se redirige un rol restringido si intenta abrir algo fuera de su whitelist
export const RESTRICTED_AREA_HOME: Partial<Record<PermissionArea, string>> = {
  Mantenimiento: '/mantenimiento',
  Coordinador_Obra: '/obra',
}

export interface UserProfile {
  id: string
  email: string
  nombre: string
  permission_area: PermissionArea
  nivel: UserNivel
  employee_id: string | null
  activo: boolean
}

interface AuthContextType {
  user: UserProfile | null
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null; needsSignup?: boolean }>
  signUpExisting: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  // Cargar el app_user vinculado al auth.uid() actual
  async function loadProfile() {
    const { data, error } = await supabase.rpc('get_my_app_user')
    if (error) {
      console.error('[auth] get_my_app_user error:', error)
      setUser(null)
      return null
    }
    // El RPC devuelve TABLE → es un array. Tomamos el primer row.
    const row = Array.isArray(data) ? data[0] : data
    if (!row || !row.id) {
      console.warn('[auth] get_my_app_user devolvió vacío — usuario no vinculado a app_users')
      setUser(null)
      return null
    }
    if (!row.activo) {
      // Usuario desactivado: cerrar sesión inmediatamente
      await supabase.auth.signOut()
      setUser(null)
      return null
    }
    const profile: UserProfile = {
      id: row.id,
      email: row.email,
      nombre: row.nombre,
      permission_area: row.permission_area,
      nivel: row.nivel || 'ejecutor',
      employee_id: row.employee_id || null,
      activo: row.activo,
    }
    setUser(profile)
    return profile
  }

  // Inicialización: hidratar manualmente desde localStorage.
  // Bypasseamos getSession()/onAuthStateChange (que se cuelgan o entran en loop
  // en algunos entornos). signIn/signOut se manejan explícitamente por el código
  // de la UI, no por el listener — eso evita re-renders innecesarios.
  useEffect(() => {
    let isMounted = true

    async function init() {
      try {
        const storageKey = 'sb-ubbumxommqjcpdozpunf-auth-token'
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null

        if (!stored) {
          console.log('[auth] no hay sesión en LS')
          return
        }

        const parsed = JSON.parse(stored)
        const accessToken = parsed?.access_token
        const refreshToken = parsed?.refresh_token

        if (!accessToken || !refreshToken) {
          console.warn('[auth] token en LS incompleto, limpiando')
          window.localStorage.removeItem(storageKey)
          return
        }

        console.log('[auth] hidratando sesión desde LS')
        const { data, error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (error) {
          console.error('[auth] setSession error:', error)
          window.localStorage.removeItem(storageKey)
          return
        }

        if (data.session && isMounted) {
          setSession(data.session)
          await loadProfile()
        }
      } catch (e) {
        console.error('[auth] init error:', e)
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    init()

    return () => {
      isMounted = false
    }
  }, [])

  async function signIn(email: string, password: string) {
    const emailNorm = email.toLowerCase().trim()
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password,
    })

    if (error) {
      // Si las credenciales son inválidas, verificar si el email existe en app_users
      // pero no tiene auth.users → necesita "primer ingreso"
      if (error.message.toLowerCase().includes('invalid')) {
        const { data: status } = await supabase.rpc('check_email_status', { p_email: emailNorm })
        if (status && status[0]?.needs_signup) {
          return { error: 'PRIMER_INGRESO', needsSignup: true }
        }
      }
      return { error: 'Email o contraseña incorrectos' }
    }

    if (!data.session) {
      return { error: 'No se pudo establecer sesión' }
    }

    // Cargar profile explícitamente (ya no usamos onAuthStateChange para esto)
    setSession(data.session)
    await loadProfile()
    return { error: null }
  }

  async function signUpExisting(email: string, password: string) {
    const emailNorm = email.toLowerCase().trim()

    // Verificar primero que el email exista en app_users
    const { data: status } = await supabase.rpc('check_email_status', { p_email: emailNorm })
    if (!status || !status[0]?.in_app_users) {
      return { error: 'Email no autorizado. Pide al administrador que te dé de alta primero.' }
    }
    if (status[0]?.in_auth) {
      return { error: 'Ya tienes cuenta, intenta iniciar sesión normalmente.' }
    }

    // SignUp creará auth.users; el trigger handle_new_auth_user (server-side):
    //   1. Vincula auth.users.id con app_users.auth_user_id (match por email)
    //   2. Auto-confirma email_confirmed_at = NOW() porque el user es pre-aprobado
    const { error: signupErr } = await supabase.auth.signUp({
      email: emailNorm,
      password,
    })
    if (signupErr) {
      return { error: signupErr.message }
    }
    // Aunque el signUp devuelva session=null (si la org tiene email confirm
    // habilitado), el trigger ya confirmó el email server-side. Forzamos un
    // signIn explícito para arrancar la sesión.
    const { data: signinData, error: signinErr } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password,
    })
    if (signinErr) {
      return { error: 'Cuenta creada pero no se pudo iniciar sesión: ' + signinErr.message }
    }
    if (signinData.session) {
      setSession(signinData.session)
      await loadProfile()
    }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
  }

  async function refreshProfile() {
    await loadProfile()
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUpExisting, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
