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

  // Helper: agrega timeout a una promesa (si no resuelve en N ms, rechaza)
  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} tardó más de ${ms}ms — verifica tu conexión o limpia el cache`)), ms)
      ),
    ])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    try {
      if (mode === 'login') {
        const { error: err, needsSignup } = await withTimeout(signIn(email, password), 10000, 'signIn')
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
          // Sesión OK — redirigir. setLoading(false) para evitar "Entrando..." pegado
          setLoading(false)
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
        const { error: err } = await withTimeout(signUpExisting(email, password), 10000, 'signUp')
        if (err) {
          setError(err)
          setLoading(false)
        } else {
          setLoading(false)
          navigate('/')
        }
      }
    } catch (e: any) {
      console.error('[login] handleSubmit error:', e)
      setError(e?.message || 'Error inesperado. Intenta de nuevo o limpia el cache.')
      setLoading(false)
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

        {/* Botón de "Reset" — útil cuando Safari/PWA tienen SW viejo cacheado */}
        <button
          type="button"
          onClick={async () => {
            setError('')
            setInfo('Limpiando cache...')
            // Cada paso tolera errores; un timeout global garantiza la recarga aunque algo se cuelgue.
            const withTimeout = <T,>(p: Promise<T>, ms: number) =>
              Promise.race([p, new Promise<void>(res => setTimeout(res, ms))])
            const limpiar = async () => {
              try {
                if ('serviceWorker' in navigator) {
                  const regs = await navigator.serviceWorker.getRegistrations().catch(() => [] as any[])
                  await Promise.allSettled(regs.map((r: any) => r.unregister()))
                }
              } catch { /* noop */ }
              try {
                if ('caches' in window) {
                  const names = await caches.keys().catch(() => [] as string[])
                  await Promise.allSettled(names.map(n => caches.delete(n)))
                }
              } catch { /* noop */ }
              try { localStorage.clear() } catch { /* noop */ }
              try { sessionStorage.clear() } catch { /* noop */ }
              try {
                if ((indexedDB as any).databases) {
                  const dbs = await (indexedDB as any).databases().catch(() => [] as any[])
                  for (const db of dbs) if (db?.name) { try { indexedDB.deleteDatabase(db.name) } catch { /* noop */ } }
                }
              } catch { /* noop */ }
            }
            // Máximo 3s limpiando; pase lo que pase, recargamos con cache-busting.
            await withTimeout(limpiar(), 3000)
            setInfo('Cache limpio. Recargando...')
            window.location.href = '/login?clean=' + Date.now()
          }}
          style={{
            background: 'transparent', color: '#666', border: '1px solid #333',
            borderRadius: 6, padding: '8px 12px', fontSize: 11, cursor: 'pointer',
            marginTop: 4,
          }}
        >
          ¿Problemas para entrar? Limpia el cache
        </button>
      </form>
    </div>
  )
}
