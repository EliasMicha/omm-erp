// ════════════════════════════════════════════════════════════════════════════
// FASE 2 — AuthContext basado en Supabase Auth (reemplazo del login casero).
//
// CÓMO ACTIVARLO (solo DESPUÉS de correr supabase_auth_fase1_migracion.sql en
// producción, para que los 8 usuarios de oficina ya existan en auth.users):
//   1. Reemplazar el contenido de  src/contexts/AuthContext.tsx  por este archivo.
//   2. Borrar este archivo .supabase.tsx.
//   3. Desplegar.
//
// Mantiene EXACTAMENTE la misma interfaz pública que el AuthContext actual
// (UserProfile, AuthProvider, useAuth, signIn(email,password)=>{error}, signOut),
// así que NINGÚN otro archivo necesita cambios (App, ProtectedRoute, Sidebar,
// Login, Usuarios, dashboards, etc.).
//
// Diferencias clave vs. el login casero:
//   - Usa supabase.auth.signInWithPassword → sesión JWT real, auth.uid() poblado.
//   - La sesión la maneja supabase-js (no localStorage manual).
//   - El perfil (área, nivel, etc.) se lee de app_users ligado por auth_user_id.
// ════════════════════════════════════════════════════════════════════════════
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '../lib/supabase'

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
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

// Carga el perfil de oficina (app_users) ligado a la identidad de Auth.
async function loadProfile(authUserId: string, email: string | undefined): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id, email, nombre, permission_area, nivel, employee_id, activo')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (error) {
    console.error('Error cargando perfil:', error)
    return null
  }
  if (!data) {
    // Hay sesión de Auth pero no es un usuario de oficina (p. ej. un instalador).
    return null
  }
  return {
    id: data.id,
    email: data.email || email || '',
    nombre: data.nombre || '',
    permission_area: data.permission_area as PermissionArea,
    nivel: (data.nivel as UserNivel) || 'ejecutor',
    employee_id: data.employee_id || null,
    activo: !!data.activo,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // Restaurar sesión existente al cargar
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!active) return
      if (session?.user) {
        const profile = await loadProfile(session.user.id, session.user.email)
        if (active) setUser(profile)
      }
      if (active) setLoading(false)
    })

    // Reaccionar a login/logout
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!active) return
      if (session?.user) {
        const profile = await loadProfile(session.user.id, session.user.email)
        if (active) setUser(profile)
      } else {
        if (active) setUser(null)
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    })

    if (error) {
      // Mensaje genérico para no filtrar si el correo existe o no
      return { error: 'Email o contraseña incorrectos' }
    }
    if (!data.user) {
      return { error: 'Email o contraseña incorrectos' }
    }

    const profile = await loadProfile(data.user.id, data.user.email)
    if (!profile) {
      await supabase.auth.signOut()
      return { error: 'Tu cuenta no tiene acceso al sistema' }
    }
    if (!profile.activo) {
      await supabase.auth.signOut()
      return { error: 'Tu cuenta está desactivada' }
    }

    setUser(profile)
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
