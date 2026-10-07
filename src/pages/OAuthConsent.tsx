// Pantalla de consentimiento de OAuth — el unico lugar donde se le da acceso al
// ERP a una aplicacion de fuera.
//
// Supabase manda aqui al usuario cuando una app arranca el flujo de OAuth:
//   https://omm-erp.vercel.app/oauth/consent?authorization_id=<uuid>
// (la direccion la arma Supabase con el Site URL + el Authorization Path que se
// configuran en Authentication -> OAuth Server).
//
// ⚠️ LO QUE DE VERDAD SE ESTA AUTORIZANDO
//
// Los "scopes" de aqui (openid, email, profile, phone) describen que datos de
// IDENTIDAD se comparten, y es facil leerlos como si fueran el limite del
// permiso. NO LO SON. El token que Supabase emite es un JWT de usuario normal:
// lleva su user_id y su role, y contra la base manda RLS. O sea que la app
// autorizada puede hacer TODO lo que esa persona puede hacer en el ERP, no solo
// leer su correo.
//
// Por eso esta pantalla lo dice con todas sus letras en vez de enseñar una
// lista bonita de scopes. Una pantalla de consentimiento que hace sentir al
// usuario que autorizo menos de lo que autorizo es peor que no tenerla.
//
// Y por eso tambien se enseña el redirect_uri completo: es el unico dato que
// distingue a la app de verdad de una que se le parece. Si alguien monta un
// "ChatGPT" que apunta a otro dominio, ahi se ve.
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'

// Los scopes estandar que emite Supabase. Uno que no este aqui se enseña crudo:
// esconder lo que no se reconoce es justo al reves de lo que sirve.
const SCOPE_ES: Record<string, string> = {
  openid: 'Confirmar quién eres',
  email: 'Tu correo electrónico',
  profile: 'Tu nombre y datos de perfil',
  phone: 'Tu teléfono',
}

interface Detalle {
  authorization_id: string
  redirect_uri: string
  client: { client_id?: string; client_name?: string; client_uri?: string; logo_uri?: string }
  user: { id: string; email: string }
  scope: string
}

export default function OAuthConsent() {
  const { user, loading: cargandoSesion } = useAuth()
  const location = useLocation()
  const authorizationId = new URLSearchParams(location.search).get('authorization_id')

  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [resolviendo, setResolviendo] = useState<'' | 'aprobar' | 'rechazar'>('')

  useEffect(() => {
    if (cargandoSesion || !user || !authorizationId) return
    let vivo = true
    ;(async () => {
      try {
        const { data, error: err } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
        if (!vivo) return
        if (err) { setError(err.message); setCargando(false); return }
        // Dos formas de respuesta. Si ya habia consentido antes, Supabase no
        // devuelve authorization_id sino la URL de regreso: ahi no hay nada que
        // preguntar y se sigue de largo.
        if (data && !('authorization_id' in data) && (data as any).redirect_url) {
          window.location.href = (data as any).redirect_url
          return
        }
        setDetalle(data as unknown as Detalle)
        setCargando(false)
      } catch (e: any) {
        if (vivo) { setError(e?.message || 'No se pudo leer la solicitud'); setCargando(false) }
      }
    })()
    return () => { vivo = false }
  }, [cargandoSesion, user, authorizationId])

  async function resolver(decision: 'aprobar' | 'rechazar') {
    if (!authorizationId || resolviendo) return
    setResolviendo(decision)
    setError('')
    try {
      const api = supabase.auth.oauth
      const { data, error: err } = decision === 'aprobar'
        ? await api.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await api.denyAuthorization(authorizationId, { skipBrowserRedirect: true })
      if (err) { setError(err.message); setResolviendo(''); return }
      const destino = (data as any)?.redirect_url
      if (!destino) { setError('Supabase no devolvió a dónde regresar.'); setResolviendo(''); return }
      // skipBrowserRedirect + redireccion a mano: asi un fallo se ve aqui, con
      // su motivo, en vez de dejar al usuario en una pagina en blanco.
      window.location.href = destino
    } catch (e: any) {
      setError(e?.message || 'No se pudo registrar tu decisión')
      setResolviendo('')
    }
  }

  // ── Casos de borde, antes de pintar nada ──────────────────────────────────
  if (cargandoSesion) return <Pantalla><div style={{ color: '#666' }}>Cargando...</div></Pantalla>

  // Sin sesion se manda al login CONSERVANDO la direccion completa. Esta ruta
  // vive fuera de ProtectedRoute justo por esto: ProtectedRoute manda a /login
  // con replace y tira la URL, y con ella el authorization_id — el flujo se
  // moriria sin que nadie sepa por que.
  if (!user) {
    const regreso = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(regreso)}`} replace />
  }

  if (!authorizationId) {
    return (
      <Pantalla>
        <Titulo>Esta página no se abre sola</Titulo>
        <p style={pTexto}>
          Aquí se autoriza a una aplicación externa a entrar al ERP, y solo se llega
          desde esa aplicación. No falta nada de tu lado.
        </p>
      </Pantalla>
    )
  }

  if (cargando) return <Pantalla><div style={{ color: '#666' }}>Leyendo la solicitud...</div></Pantalla>

  if (error && !detalle) {
    return (
      <Pantalla>
        <Titulo>No se pudo leer la solicitud</Titulo>
        <p style={pTexto}>{error}</p>
        <p style={{ ...pTexto, color: '#555', fontSize: 12 }}>
          Las solicitudes caducan. Si pasó un rato, vuelve a intentar la conexión
          desde la aplicación.
        </p>
      </Pantalla>
    )
  }

  if (!detalle) return <Pantalla><div style={{ color: '#666' }}>Sin datos de la solicitud.</div></Pantalla>

  const nombreApp = detalle.client?.client_name || 'Una aplicación sin nombre'
  const scopes = (detalle.scope || '').split(/\s+/).filter(Boolean)
  const host = (() => { try { return new URL(detalle.redirect_uri).host } catch { return detalle.redirect_uri } })()

  return (
    <Pantalla>
      <Titulo>{nombreApp} quiere entrar al ERP</Titulo>

      <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>
        Como <span style={{ color: '#fff' }}>{detalle.user?.email || user.email}</span>
      </div>

      {/* Lo importante arriba, no en letra chica abajo. */}
      <div style={{
        background: '#1a1206', border: '1px solid #4a3410', borderRadius: 8,
        padding: 14, marginBottom: 18, fontSize: 13, color: '#e8c07a', lineHeight: 1.55,
      }}>
        Si autorizas, esta aplicación podrá <strong>ver y modificar en el ERP todo
        lo que tú puedes</strong>, actuando con tu nombre. No queda limitada a los
        datos de abajo.
      </div>

      <Etiqueta>Datos de identidad que se comparten</Etiqueta>
      <ul style={{ margin: '0 0 18px', padding: '0 0 0 18px', color: '#bbb', fontSize: 13, lineHeight: 1.7 }}>
        {scopes.length === 0 && <li style={{ color: '#666' }}>Ninguno</li>}
        {scopes.map(s => <li key={s}>{SCOPE_ES[s] || s}</li>)}
      </ul>

      <Etiqueta>Te va a regresar a</Etiqueta>
      <div style={{
        fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, color: '#9ad', marginBottom: 6,
        wordBreak: 'break-all',
      }}>{detalle.redirect_uri}</div>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 22, lineHeight: 1.5 }}>
        Si <strong style={{ color: '#888' }}>{host}</strong> no es de quien dice ser
        la aplicación, rechaza.
      </div>

      {error && (
        <div style={{ color: '#f66', fontSize: 13, marginBottom: 14 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={() => resolver('rechazar')}
          disabled={!!resolviendo}
          style={{
            flex: 1, padding: '11px 0', borderRadius: 8, cursor: resolviendo ? 'default' : 'pointer',
            background: 'transparent', border: '1px solid #3a3a3a', color: '#bbb',
            fontSize: 14, fontFamily: 'inherit',
          }}>
          {resolviendo === 'rechazar' ? 'Rechazando...' : 'Rechazar'}
        </button>
        <button
          onClick={() => resolver('aprobar')}
          disabled={!!resolviendo}
          style={{
            flex: 1, padding: '11px 0', borderRadius: 8, cursor: resolviendo ? 'default' : 'pointer',
            background: '#10B981', border: 'none', color: '#04231a',
            fontSize: 14, fontWeight: 600, fontFamily: 'inherit',
            opacity: resolviendo ? 0.6 : 1,
          }}>
          {resolviendo === 'aprobar' ? 'Autorizando...' : 'Autorizar'}
        </button>
      </div>

      <div style={{ fontSize: 11, color: '#555', marginTop: 16, lineHeight: 1.5 }}>
        Puedes retirar este acceso después sin pedírselo a la aplicación.
      </div>
    </Pantalla>
  )
}

// ── Pedacitos de presentacion ───────────────────────────────────────────────
const pTexto: React.CSSProperties = { color: '#aaa', fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }

function Pantalla({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#0a0a0a', fontFamily: "'Inter', system-ui, sans-serif", padding: 20,
    }}>
      <div style={{
        background: '#111', border: '1px solid #222', borderRadius: 12,
        padding: 32, width: '100%', maxWidth: 440,
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 22 }}>
          <span style={{ color: '#10B981' }}>OMM</span> Tech
        </div>
        {children}
      </div>
    </div>
  )
}

function Titulo({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 17, fontWeight: 600, color: '#fff', marginBottom: 6 }}>{children}</div>
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, color: '#555', textTransform: 'uppercase',
      letterSpacing: '0.08em', marginBottom: 7,
    }}>{children}</div>
  )
}
