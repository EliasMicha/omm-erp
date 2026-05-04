import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '../lib/supabase'

export type PermissionArea = 'DG' | 'Administracion' | 'Ventas_Ingenieria' | 'Operaciones'

export interface UserProfile {
  id: string
  email: string
  nombre: string
  permission_area: PermissionArea
  activo: boolean
}

interface AuthContextType {
  user: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => void
}

const AUTH_KEY = 'omm_user'
const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  // Restore session from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTH_KEY)
      if (stored) {
        setUser(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Error restoring session:', e)
    }
    setLoading(false)
  }, [])

  async function signIn(email: string, password: string) {
    // Query using pgcrypto crypt() to verify password
    const { data, error } = await supabase.rpc('verify_login', {
      p_email: email.toLowerCase().trim(),
      p_password: password,
    })

    if (error) {
      console.error('Login RPC error:', error)
      return { error: 'Error al iniciar sesión' }
    }

    if (!data || data.length === 0) {
      return { error: 'Email o contraseña incorrectos' }
    }

    const profile: UserProfile = {
      id: data[0].id,
      email: data[0].email,
      nombre: data[0].nombre,
      permission_area: data[0].permission_area,
      activo: data[0].activo,
    }

    if (!profile.activo) {
      return { error: 'Tu cuenta está desactivada' }
    }

    setUser(profile)
    localStorage.setItem(AUTH_KEY, JSON.stringify(profile))
    return { error: null }
  }

  function signOut() {
    setUser(null)
    localStorage.removeItem(AUTH_KEY)
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
