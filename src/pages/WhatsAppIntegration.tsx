import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, Loader2, MessageCircle, ShieldCheck, TriangleAlert } from 'lucide-react'
import { authenticatedFetch } from '../lib/apiFetch'

type Connection = {
  waba_id: string
  phone_number_id: string
  business_id?: string | null
  display_phone_number?: string | null
  verified_name?: string | null
  platform_type?: string | null
  is_on_biz_app?: boolean | null
  token_expires_at?: string | null
  subscribed_at?: string | null
  connected_at?: string | null
}

type WhatsAppConfig = {
  ok: boolean
  configured: boolean
  appId: string
  configId: string
  graphApiVersion: string
  callbackUrl: string
  connection: Connection | null
  error?: string
}

type SessionInfo = {
  waba_id?: string
  phone_number_id?: string
  business_id?: string
  [key: string]: unknown
}

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void
      login: (
        callback: (response: { authResponse?: { code?: string }; status?: string }) => void,
        options: Record<string, unknown>,
      ) => void
    }
  }
}

const card: React.CSSProperties = {
  background: '#141414', border: '1px solid #252525', borderRadius: 14, padding: 20,
}

function formatDate(value?: string | null) {
  if (!value) return 'No disponible'
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function loadFacebookSdk(appId: string, version: string) {
  if (window.FB) {
    window.FB.init({ appId, cookie: true, xfbml: false, version })
    return
  }
  await new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null
    const script = existing || document.createElement('script')
    const onLoad = () => window.FB ? resolve() : reject(new Error('El SDK de Meta no quedó disponible'))
    script.addEventListener('load', onLoad, { once: true })
    script.addEventListener('error', () => reject(new Error('No se pudo cargar el SDK de Meta')), { once: true })
    if (!existing) {
      script.id = 'facebook-jssdk'
      script.src = 'https://connect.facebook.net/es_LA/sdk.js'
      script.async = true
      script.defer = true
      document.body.appendChild(script)
    }
  })
  window.FB!.init({ appId, cookie: true, xfbml: false, version })
}

export default function WhatsAppIntegration() {
  const [config, setConfig] = useState<WhatsAppConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const sessionResolver = useRef<((data: SessionInfo) => void) | null>(null)
  const sessionRejecter = useRef<((error: Error) => void) | null>(null)

  async function loadConfig() {
    setLoading(true)
    try {
      const response = await authenticatedFetch('/api/chatbot?action=whatsapp_config')
      const body = await response.json() as WhatsAppConfig
      if (!response.ok || !body.ok) throw new Error(body.error || 'No se pudo cargar la configuración')
      setConfig(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la configuración')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadConfig() }, [])

  useEffect(() => {
    function receiveSessionInfo(event: MessageEvent) {
      if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return
      let message = event.data
      if (typeof message === 'string') {
        try { message = JSON.parse(message) } catch { return }
      }
      if (message?.type !== 'WA_EMBEDDED_SIGNUP') return

      if (['CANCEL', 'ERROR'].includes(message.event)) {
        sessionRejecter.current?.(new Error(
          message.event === 'CANCEL' ? 'Se canceló el registro en Meta' : 'Meta reportó un error durante el registro',
        ))
        return
      }
      if (['FINISH', 'FINISH_ONLY_WABA', 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'].includes(message.event)) {
        sessionResolver.current?.(message.data || {})
      }
    }
    window.addEventListener('message', receiveSessionInfo)
    return () => window.removeEventListener('message', receiveSessionInfo)
  }, [])

  async function connectWhatsApp() {
    if (!config?.configured || !config.appId || !window.isSecureContext) return
    setConnecting(true)
    setError('')
    setNotice('Abriendo el registro seguro de Meta…')

    try {
      await loadFacebookSdk(config.appId, config.graphApiVersion)
      const sessionInfoPromise = new Promise<SessionInfo>((resolve, reject) => {
        sessionResolver.current = resolve
        sessionRejecter.current = reject
        window.setTimeout(() => reject(new Error('Meta no devolvió los identificadores de WhatsApp a tiempo')), 120_000)
      })
      const codePromise = new Promise<string>((resolve, reject) => {
        window.FB!.login(response => {
          const code = response.authResponse?.code
          if (code) resolve(code)
          else reject(new Error('Meta no autorizó la conexión o el flujo fue cancelado'))
        }, {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: '3',
          },
        })
      })

      const [code, sessionInfo] = await Promise.all([codePromise, sessionInfoPromise])
      setNotice('Validando el número y suscribiendo los webhooks…')
      const response = await authenticatedFetch('/api/chatbot?action=whatsapp_connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, sessionInfo }),
      })
      const body = await response.json()
      if (!response.ok || !body.ok) throw new Error(body.error || 'No se pudo completar la conexión')
      setConfig(current => current ? { ...current, connection: body.connection } : current)
      setNotice('WhatsApp Business quedó conectado con el ERP.')
    } catch (e) {
      setNotice('')
      setError(e instanceof Error ? e.message : 'No se pudo completar la conexión')
    } finally {
      sessionResolver.current = null
      sessionRejecter.current = null
      setConnecting(false)
    }
  }

  async function copyCallback() {
    if (!config?.callbackUrl) return
    await navigator.clipboard.writeText(config.callbackUrl)
    setNotice('URL del webhook copiada.')
  }

  if (loading) return <div style={{ padding: 40, color: '#777' }}>Cargando integración de WhatsApp…</div>

  const connection = config?.connection
  return (
    <div style={{ padding: '32px 40px', maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 26 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, display: 'grid', placeItems: 'center', background: '#25D36620', color: '#25D366' }}>
          <MessageCircle size={26} />
        </div>
        <div>
          <h1 style={{ margin: 0, color: '#fff', fontSize: 23 }}>WhatsApp Business</h1>
          <div style={{ color: '#777', fontSize: 13, marginTop: 4 }}>Cloud API oficial de Meta · modo coexistencia</div>
        </div>
      </div>

      {error && <div style={{ padding: '11px 14px', borderRadius: 9, background: '#ef444416', border: '1px solid #ef444444', color: '#f87171', fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {notice && <div style={{ padding: '11px 14px', borderRadius: 9, background: '#10B98116', border: '1px solid #10B98144', color: '#6ee7b7', fontSize: 13, marginBottom: 16 }}>{notice}</div>}

      <div style={{ ...card, marginBottom: 16, display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: connection ? '#6ee7b7' : '#fff', fontWeight: 700, marginBottom: 8 }}>
            {connection ? <CheckCircle2 size={18} /> : <ShieldCheck size={18} color="#25D366" />}
            {connection ? 'Conexión activa' : 'Conecta el número actual de OMM'}
          </div>
          <div style={{ color: '#888', fontSize: 13, lineHeight: 1.55 }}>
            El registro de Meta conservará el número dentro de la app WhatsApp Business y habilitará Cloud API en paralelo.
          </div>
        </div>
        <button
          onClick={connectWhatsApp}
          disabled={connecting || !config?.configured || !window.isSecureContext}
          style={{ border: 0, borderRadius: 9, padding: '11px 18px', background: '#25D366', color: '#071b0e', fontWeight: 800, cursor: connecting ? 'wait' : 'pointer', opacity: connecting || !config?.configured ? .55 : 1, display: 'inline-flex', gap: 8, alignItems: 'center' }}
        >
          {connecting ? <Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> : <MessageCircle size={17} />}
          {connection ? 'Reconectar WhatsApp Business' : 'Conectar WhatsApp Business'}
        </button>
      </div>

      {!config?.configured && (
        <div style={{ ...card, borderColor: '#f59e0b55', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 9, color: '#fbbf24', fontWeight: 700, marginBottom: 8 }}><TriangleAlert size={18} /> Configuración del servidor pendiente</div>
          <div style={{ color: '#999', fontSize: 12.5, lineHeight: 1.65 }}>
            Antes de probar el flujo en un Preview de Vercel configura <code>META_APP_ID</code>, <code>META_APP_SECRET</code>, <code>WHATSAPP_VERIFY_TOKEN</code>, <code>WHATSAPP_TOKEN_ENCRYPTION_KEY</code> y <code>SUPABASE_SERVICE_ROLE_KEY</code>.
          </div>
        </div>
      )}

      {connection && (
        <div style={{ ...card, marginBottom: 16 }}>
          <div style={{ fontSize: 15, color: '#fff', fontWeight: 700, marginBottom: 15 }}>{connection.verified_name || 'Número conectado'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
            <Detail label="Número" value={connection.display_phone_number || 'No disponible'} />
            <Detail label="Phone number ID" value={connection.phone_number_id} mono />
            <Detail label="WABA ID" value={connection.waba_id} mono />
            <Detail label="Business ID" value={connection.business_id || 'No devuelto por Meta'} mono />
            <Detail label="Plataforma" value={connection.platform_type || 'Cloud API'} />
            <Detail label="Coexistencia" value={connection.is_on_biz_app === true ? 'Confirmada' : connection.is_on_biz_app === false ? 'No confirmada' : 'Pendiente de confirmar'} />
            <Detail label="Token válido hasta" value={formatDate(connection.token_expires_at)} />
            <Detail label="Webhooks suscritos" value={formatDate(connection.subscribed_at)} />
          </div>
        </div>
      )}

      <div style={card}>
        <div style={{ color: '#fff', fontSize: 15, fontWeight: 700, marginBottom: 14 }}>Webhook de Meta</div>
        <div style={{ color: '#777', fontSize: 12, marginBottom: 7 }}>Callback URL · acepta GET de verificación y POST de eventos</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <code style={{ flex: '1 1 500px', padding: '10px 12px', border: '1px solid #2b2b2b', background: '#0d0d0d', color: '#bbb', borderRadius: 8, overflowWrap: 'anywhere' }}>{config?.callbackUrl}</code>
          <button onClick={copyCallback} style={{ padding: '0 13px', minHeight: 38, borderRadius: 8, border: '1px solid #333', background: '#1d1d1d', color: '#aaa', cursor: 'pointer' }}><Copy size={16} /></button>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 15, color: '#777', fontSize: 12 }}>
          <span>Configuration ID: <code style={{ color: '#bbb' }}>{config?.configId}</code></span>
          <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'none', display: 'inline-flex', gap: 5, alignItems: 'center' }}>Abrir Meta Developers <ExternalLink size={13} /></a>
        </div>
      </div>
    </div>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><div style={{ color: '#666', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>{label}</div><div style={{ color: '#ccc', fontSize: 12.5, fontFamily: mono ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'inherit', overflowWrap: 'anywhere' }}>{value}</div></div>
}
