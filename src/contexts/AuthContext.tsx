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

export type PermissionArea = 'DG' | 'Administracion' | 'Ventas_Ingenieria' | 'Operaciones'
export type UserNivel = 'director' | 'ejecutor'

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

  // Inicialización: usar onAuthStateChange como fuente principal.
  // Esto dispara INITIAL_SESSION inmediatamente al suscribirse, con la sesión
  // hidratada del localStorage. Es más confiable que getSession() que puede
  // colgarse esperando network en algunos entornos (Safari/PWA/SW).
  useEffect(() => {
    let isMounted = true
    let initialResolved = false

    // Safety timeout extendido: 8s para dar margen al network refresh
    const safetyTimeout = setTimeout(() => {
      if (isMounted && !initialResolved) {
        console.warn('[auth] safety timeout — onAuthStateChange no disparó INITIAL_SESSION en 8s, forzando loading=false')
        initialResolved = true
        setLoading(false)
      }
    }, 8000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!isMounted) return
      console.log('[auth] event:', event, '— session:', s ? 'present' : 'null')
      setSession(s)

      if (event === 'SIGNED_OUT') {
        setUser(null)
      } else if (s) {
        // INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED, USER_UPDATED
        try { await loadProfile() } catch (e) { console.error('[auth] loadProfile error:', e) }
      } else {
        // INITIAL_SESSION sin sesión guardada
        setUser(null)
      }

      // Marcar loading=false en el primer evento (INITIAL_SESSION típicamente)
      if (!initialResolved) {
        initialResolved = true
        clearTimeout(safetyTimeout)
        setLoading(false)
      }
    })

    return () => {
      isMounted = false
      clearTimeout(safetyTimeout)
      subscription.unsubscribe()
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

    // El profile se carga via onAuthStateChange → SIGNED_IN → loadProfile
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
    const { error: signinErr } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password,
    })
    if (signinErr) {
      return { error: 'Cuenta creada pero no se pudo iniciar sesión: ' + signinErr.message }
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
