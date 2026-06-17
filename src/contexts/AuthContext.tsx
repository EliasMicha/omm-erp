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
    if (!data || !data.id) {
      setUser(null)
      return null
    }
    if (!data.activo) {
      // Usuario desactivado: cerrar sesión inmediatamente
      await supabase.auth.signOut()
      setUser(null)
      return null
    }
    const profile: UserProfile = {
      id: data.id,
      email: data.email,
      nombre: data.nombre,
      permission_area: data.permission_area,
      nivel: data.nivel || 'ejecutor',
      employee_id: data.employee_id || null,
      activo: data.activo,
    }
    setUser(profile)
    return profile
  }

  // Inicialización: leer sesión + escuchar cambios
  useEffect(() => {
    let isMounted = true

    // Safety timeout: si después de 5s el auth no resolvió, marcar loading=false
    // (defensa contra getSession() colgada en Safari/PWA/service worker viejo)
    const safetyTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn('[auth] safety timeout — forzando loading=false')
        setLoading(false)
      }
    }, 5000)

    // 1. Get initial session
    supabase.auth.getSession()
      .then(async ({ data: { session: s } }) => {
        if (!isMounted) return
        setSession(s)
        if (s) {
          try { await loadProfile() } catch (e) { console.error('[auth] loadProfile error:', e) }
        }
      })
      .catch(e => {
        console.error('[auth] getSession error:', e)
      })
      .finally(() => {
        if (!isMounted) return
        clearTimeout(safetyTimeout)
        setLoading(false)
      })

    // 2. Escuchar cambios de auth (login, logout, refresh de token)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!isMounted) return
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        try { await loadProfile() } catch (e) { console.error('[auth] loadProfile error:', e) }
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
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
