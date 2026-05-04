import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await signIn(email, password)
    if (err) {
      setError(err)
      setLoading(false)
    } else {
      navigate('/')
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a', fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#111', border: '1px solid #222', borderRadius: 12,
        padding: 40, width: 360, display: 'flex', flexDirection: 'column', gap: 20,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>
            <span style={{ color: '#57FF9A' }}>OMM</span> Tech
          </div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            ERP Sistema
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f66' }}>
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
            style={{
              background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
              padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none',
            }}
            onFocus={e => e.currentTarget.style.borderColor = '#57FF9A'}
            onBlur={e => e.currentTarget.style.borderColor = '#333'}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 12, color: '#888' }}>Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={{
              background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
              padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none',
            }}
            onFocus={e => e.currentTarget.style.borderColor = '#57FF9A'}
            onBlur={e => e.currentTarget.style.borderColor = '#333'}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            background: loading ? '#333' : '#57FF9A', color: '#000', border: 'none',
            borderRadius: 8, padding: '12px 0', fontSize: 14, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer', marginTop: 8,
            transition: 'opacity 0.15s',
          }}
        >
          {loading ? 'Entrando...' : 'Iniciar sesión'}
        </button>
      </form>
    </div>
  )
}
