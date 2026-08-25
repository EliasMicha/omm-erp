import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { LogIn, Loader2 } from 'lucide-react'

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Construye los posibles emails a partir de lo que el usuario escribe.
  // Las cuentas de campo se crean como <digitos>@obra.omm.app (a veces con 52, a veces sin).
  const buildCandidates = (raw: string): string[] => {
    const v = raw.trim()
    if (v.includes('@')) return [v.toLowerCase()]
    const d = v.replace(/\D/g, '')
    const set = new Set<string>()
    if (d) {
      set.add(`${d}@obra.omm.app`)
      if (d.length === 10) set.add(`52${d}@obra.omm.app`)
      if (d.length === 12 && d.startsWith('52')) set.add(`${d.slice(2)}@obra.omm.app`)
      if (d.length === 13 && d.startsWith('521')) {
        set.add(`52${d.slice(3)}@obra.omm.app`)
        set.add(`${d.slice(3)}@obra.omm.app`)
      }
    }
    return Array.from(set)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Completa email o teléfono y contraseña')
      return
    }
    setError('')
    setLoading(true)

    const candidates = buildCandidates(email)
    let data: any = null
    let authErr: any = null
    for (const cand of candidates) {
      const res = await supabase.auth.signInWithPassword({ email: cand, password })
      if (!res.error && res.data.session) { data = res.data; authErr = null; break }
      authErr = res.error
    }
    setLoading(false)
    if (authErr || !data) {
      setError(
        !authErr || authErr.message === 'Invalid login credentials'
          ? 'Usuario o contraseña incorrectos'
          : authErr.message
      )
      return
    }
    if (!data.session) {
      setError('No se pudo iniciar sesión')
      return
    }
    // El empleado tiene que existir, seguir dado de alta y tener la app
    // habilitada. Antes solo se miraba `app_activo`, así que alguien dado de
    // baja seguía entrando mientras nadie se acordara de apagar esa casilla.
    const { data: emp } = await supabase
      .from('employees')
      .select('id, nombre, app_activo, app_role, is_active')
      .eq('auth_user_id', data.user!.id)
      .single()
    if (!emp) {
      await supabase.auth.signOut()
      setError('Este usuario no está vinculado a un empleado. Contacta al administrador.')
      return
    }
    if (emp.is_active === false) {
      await supabase.auth.signOut()
      setError('Tu cuenta está dada de baja. Contacta al administrador.')
      return
    }
    if (!emp.app_activo) {
      await supabase.auth.signOut()
      setError('Tu acceso a la app móvil está deshabilitado. Contacta al administrador.')
      return
    }
    onLogin()
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1a12 100%)',
      display: 'flex',
      flexDirection: 'column',
      padding: '40px 24px',
      color: '#fff',
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 400, margin: '0 auto', width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <div style={{
            width: 80, height: 80, margin: '0 auto 16px',
            borderRadius: 20,
            background: '#10B981',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 36, fontWeight: 800, color: '#0a0a0a',
          }}>
            🔧
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, marginBottom: 4 }}>OMM Obra</h1>
          <div style={{ color: '#888', fontSize: 14 }}>App para instaladores</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>Email o teléfono</label>
            <input
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@correo.com o tu teléfono"
              style={{
                width: '100%', padding: '14px 16px',
                background: '#0f0f0f', border: '1px solid #1f1f1f',
                borderRadius: 10, color: '#fff', fontSize: 16,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: 'block', fontSize: 12, color: '#888', marginBottom: 6 }}>Contraseña</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%', padding: '14px 16px',
                background: '#0f0f0f', border: '1px solid #1f1f1f',
                borderRadius: 10, color: '#fff', fontSize: 16,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{
              padding: 12, marginBottom: 16,
              background: '#3a1a1a', border: '1px solid #5a2a2a',
              borderRadius: 8, color: '#fca5a5', fontSize: 13,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '16px 20px',
              background: loading ? '#3a5f48' : '#10B981',
              color: '#0a0a0a', border: 'none',
              borderRadius: 12, fontSize: 16, fontWeight: 700,
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
          >
            {loading ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />}
            {loading ? 'Entrando...' : 'Iniciar sesión'}
          </button>
        </form>
      </div>

      <div style={{ textAlign: 'center', fontSize: 11, color: '#444' }}>
        OMM Technologies · v1.0
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
