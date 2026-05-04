import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { User, Session } from '@supabase/supabase-js'

export type PermissionArea = 'DG' | 'Administracion' | 'Ventas_Ingenieria' | 'Operaciones'

export interface UserProfile {
  id: string
  email: string
  nombre: string
  permission_area: PermissionArea
  activo: boolean
}

interface AuthContextType {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

/** Build profile from user_metadata — no DB query needed */
function profileFromUser(u: User): UserProfile {
  const meta = u.user_metadata || {}
  return {
    id: u.id,
    email: u.email || '',
    nombre: meta.nombre || u.email?.split('@')[0] || '',
    permission_area: meta.permission_area || 'Operaciones',
    activo: meta.activo !== false,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return
      setSession(s)
      setUser(s?.user ?? null)
      if (s?.user) {
        setProfile(profileFromUser(s.user))
      } else {
        setProfile(null)
      }
      setLoading(false)
    })

    // Safety timeout
    const timeout = setTimeout(() => {
      if (mounted) setLoading(false)
    }, 3000)

    return () => {
      mounted = false
      subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }
    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
