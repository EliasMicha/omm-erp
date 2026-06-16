import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

type Mode = 'login' | 'first-time-setup'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const { signIn, signUpExisting } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    if (mode === 'login') {
      const { error: err, needsSignup } = await signIn(email, password)
      if (needsSignup) {
        setMode('first-time-setup')
        setPassword('')
        setInfo('Es tu primer ingreso. Configura una contraseña nueva (mínimo 6 caracteres).')
        setLoading(false)
        return
      }
      if (err) {
        setError(err)
        setLoading(false)
      } else {
        navigate('/')
      }
    } else {
      // first-time-setup mode
      if (password.length < 6) {
        setError('La contraseña debe tener al menos 6 caracteres')
        setLoading(false)
        return
      }
      if (password !== confirmPassword) {
        setError('Las contraseñas no coinciden')
        setLoading(false)
        return
      }
      const { error: err } = await signUpExisting(email, password)
      if (err) {
        setError(err)
        setLoading(false)
      } else {
        navigate('/')
      }
    }
  }

  const inputStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a', fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#111', border: '1px solid #222', borderRadius: 12,
        padding: 40, width: 380, display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>
            <span style={{ color: '#10B981' }}>OMM</span> Tech
          </div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {mode === 'login' ? 'ERP Sistema' : 'Primer ingreso'}
          </div>
        </div>

        {info && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#10B981' }}>
            {info}
          </div>
        )}

        {error && (
          <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f87171' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#888' }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            disabled={mode === 'first-time-setup'}
            style={{ ...inputStyle, opacity: mode === 'first-time-setup' ? 0.6 : 1 }}
            onFocus={e => e.currentTarget.style.borderColor = '#10B981'}
            onBlur={e => e.currentTarget.style.borderColor = '#333'}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#888' }}>
            {mode === 'login' ? 'Contraseña' : 'Nueva contraseña'}
          </label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={mode === 'first-time-setup' ? 6 : undefined}
            style={inputStyle}
            onFocus={e => e.currentTarget.style.borderColor = '#10B981'}
            onBlur={e => e.currentTarget.style.borderColor = '#333'}
          />
        </div>

        {mode === 'first-time-setup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Confirma contraseña</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              style={inputStyle}
              onFocus={e => e.currentTarget.style.borderColor = '#10B981'}
              onBlur={e => e.currentTarget.style.borderColor = '#333'}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? '#333' : '#10B981', color: '#000', border: 'none',
            borderRadius: 8, padding: '12px 0', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer', marginTop: 8,
          }}
        >
          {loading
            ? (mode === 'login' ? 'Entrando...' : 'Creando cuenta...')
            : (mode === 'login' ? 'Iniciar sesión' : 'Configurar contraseña y entrar')
          }
        </button>

        {mode === 'first-time-setup' && (
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); setInfo(''); setPassword(''); setConfirmPassword('') }}
            style={{
              background: 'transparent', color: '#888', border: 'none',
              fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
            }}
          >
            ← Volver al login
          </button>
        )}
      </form>
    </div>
  )
}
