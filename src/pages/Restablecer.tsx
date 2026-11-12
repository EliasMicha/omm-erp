// Pantalla de la liga "crear contraseña nueva" (2026-11-11).
//
// La liga la arma la Edge Function recuperar-acceso y llega por correo:
//   /restablecer?token_hash=…&type=recovery
// El token se canjea (verifyOtp) hasta que la persona escribe su contraseña, no
// al abrir la página: así un antivirus de correo que "visita" la liga no la gasta.
// Luego updateUser({password}) y se entra con la contraseña nueva por el mismo
// signIn del AuthContext, que es el que carga el perfil.
import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'

export default function Restablecer() {
  const location = useLocation()
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const qs = new URLSearchParams(location.search)
  const tokenHash = qs.get('token_hash') || ''
  const [password, setPassword] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  async function guardar(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return }
    if (password !== confirmar) { setError('Las contraseñas no coinciden.'); return }
    setLoading(true)
    try {
      const { data, error: eOtp } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
      if (eOtp || !data?.user?.email) {
        setError('La liga ya se usó o venció. Pide una nueva desde "¿Olvidaste tu contraseña?".')
        setLoading(false)
        return
      }
      const email = data.user.email
      const { error: eUpd } = await supabase.auth.updateUser({ password })
      if (eUpd) {
        setError(eUpd.message.toLowerCase().includes('different')
          ? 'La contraseña nueva tiene que ser distinta a la anterior.'
          : 'No se pudo guardar la contraseña: ' + eUpd.message)
        setLoading(false)
        return
      }
      setInfo('Contraseña guardada. Entrando…')
      const r = await signIn(email, password)
      setLoading(false)
      if (r.error) { navigate('/login', { replace: true }); return }
      navigate('/', { replace: true })
    } catch (e: any) {
      setError(e?.message || 'Error inesperado. Intenta de nuevo.')
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
    padding: '10px 14px', color: '#fff', fontSize: 16, outline: 'none',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a', fontFamily: "'Inter', system-ui, sans-serif", padding: 16, boxSizing: 'border-box',
    }}>
      <form onSubmit={guardar} style={{
        background: '#111', border: '1px solid #222', borderRadius: 12,
        padding: 32, width: '100%', maxWidth: 380, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 18,
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>
            <span style={{ color: '#10B981' }}>OMM</span> Tech
          </div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 4, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Contraseña nueva
          </div>
        </div>

        {!tokenHash ? (
          <div style={{ fontSize: 13, color: '#f87171' }}>
            Esta liga está incompleta. Pide una nueva desde "¿Olvidaste tu contraseña?" en la pantalla de entrada.
          </div>
        ) : (
          <>
            {info && <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#10B981' }}>{info}</div>}
            {error && <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f87171' }}>{error}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Nueva contraseña</label>
              <input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Confirma contraseña</label>
              <input type="password" autoComplete="new-password" value={confirmar} onChange={e => setConfirmar(e.target.value)} required minLength={6} style={inputStyle} />
            </div>
            <button type="submit" disabled={loading} style={{
              background: loading ? '#333' : '#10B981', color: '#000', border: 'none',
              borderRadius: 8, padding: '12px 0', fontSize: 14, fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}>
              {loading ? 'Guardando…' : 'Guardar contraseña y entrar'}
            </button>
          </>
        )}

        <button type="button" onClick={() => navigate('/login')} style={{
          background: 'transparent', color: '#888', border: 'none', fontSize: 11, cursor: 'pointer', textDecoration: 'underline',
        }}>
          ← Volver al login
        </button>
      </form>
    </div>
  )
}
