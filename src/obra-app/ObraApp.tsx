import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'
import LoginPage from './LoginPage'
import HomePage from './HomePage'
import { Loader2 } from 'lucide-react'

interface Employee {
  id: string
  nombre: string
  puesto: string | null
  area: string | null
  foto_url: string | null
  app_activo: boolean | null
}

export default function ObraApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)

  const loadEmployee = async (userId: string) => {
    const { data } = await supabase
      .from('employees')
      .select('id, nombre, puesto, area, foto_url, app_activo')
      .eq('auth_user_id', userId)
      .maybeSingle()
    setEmployee(data as Employee | null)
  }

  const refreshSession = async () => {
    setLoading(true)
    const { data: { session: s } } = await supabase.auth.getSession()
    setSession(s)
    if (s?.user?.id) {
      await loadEmployee(s.user.id)
    } else {
      setEmployee(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    refreshSession()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s?.user?.id) {
        loadEmployee(s.user.id)
      } else {
        setEmployee(null)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setSession(null)
    setEmployee(null)
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', background: '#0a0a0a', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Loader2 size={32} className="spin" />
        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .spin { animation: spin 1s linear infinite; }
        `}</style>
      </div>
    )
  }

  if (!session || !employee) {
    return <LoginPage onLogin={refreshSession} />
  }

  return <HomePage employee={employee} onLogout={handleLogout} />
}
