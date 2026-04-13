import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { todayCDMX } from './lib/workDate'
import {
  ArrowLeft, Plus, Receipt, Camera, X, Send,
  Loader2, CheckCircle2, AlertCircle, AlertTriangle, Sparkles
} from 'lucide-react'

interface Obra { id: string; nombre: string }
interface Ticket {
  id: string
  fecha: string
  monto: number
  categoria: string | null
  concepto: string | null
  foto_storage_path: string | null
  estatus: string
  created_at: string
  obras: { id: string; nombre: string } | null
}

const CATEGORIAS = [
  { value: 'gasolina', label: 'Gasolina', emoji: '⛽' },
  { value: 'comida', label: 'Comida', emoji: '🍽️' },
  { value: 'material', label: 'Material', emoji: '🔧' },
  { value: 'peaje', label: 'Peaje', emoji: '🛣️' },
  { value: 'transporte', label: 'Transporte', emoji: '🚕' },
  { value: 'herramienta', label: 'Herramienta', emoji: '🔨' },
  { value: 'otro', label: 'Otro', emoji: '📝' },
]

export default function CajaChicaPage({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [obras, setObras] = useState<Obra[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Form state
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [monto, setMonto] = useState('')
  const [categoria, setCategoria] = useState('gasolina')
  const [concepto, setConcepto] = useState('')
  const [obraId, setObraId] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const photoRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    const { data: tks } = await supabase
      .from('caja_chica_tickets')
      .select('id, fecha, monto, categoria, concepto, foto_storage_path, estatus, created_at, obras(id, nombre)')
      .eq('employee_id', employeeId)
      .order('created_at', { ascending: false })
      .limit(50)
    setTickets((tks as any) || [])

    // Load obras via weekly_plan_assignments + installer_daily_assignment (derived)
    const { data: plan } = await supabase
      .from('weekly_plan_assignments')
      .select('obras(id, nombre)')
      .eq('employee_id', employeeId)
    const { data: daily } = await supabase
      .from('installer_daily_assignment')
      .select('obras(id, nombre)')
      .eq('employee_id', employeeId)
    const map = new Map<string, Obra>()
    for (const p of (plan || [])) if (p.obras) map.set((p.obras as any).id, p.obras as any)
    for (const d of (daily || [])) if (d.obras) map.set((d.obras as any).id, d.obras as any)
    setObras(Array.from(map.values()))
    setLoading(false)
  }

  useEffect(() => { load() }, [employeeId])


  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setPhotoFile(f)
    setPhotoUrl(URL.createObjectURL(f))
    if (photoRef.current) photoRef.current.value = ''

    // Auto-extract with Claude
    setExtracting(true)
    try {
      const tempPath = `${employeeId}/temp_${Date.now()}.${(f.name.split('.').pop() || 'jpg').toLowerCase()}`
      await supabase.storage.from('caja-chica').upload(tempPath, f)

      const apiKey = (supabase as any).supabaseKey
      const r = await fetch(`${(supabase as any).supabaseUrl}/functions/v1/extract-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'apikey': apiKey,
        },
        body: JSON.stringify({ storage_path: tempPath }),
      })
      const json = await r.json()
      if (json.extracted) {
        const ex = json.extracted
        if (ex.total) setMonto(String(ex.total))
        if (ex.categoria_sugerida) setCategoria(ex.categoria_sugerida)
        if (ex.concepto) setConcepto(ex.concepto)
      }
      // Store the path so we reuse it
      ;(f as any).__storage_path = tempPath
    } catch (e) {
      // silently fail, user fills manually
    } finally {
      setExtracting(false)
    }
  }

  const removePhoto = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setPhotoFile(null)
    setPhotoUrl(null)
  }

  const resetForm = () => {
    removePhoto()
    setMonto('')
    setCategoria('gasolina')
    setConcepto('')
    setObraId('')
    setShowForm(false)
    setResult(null)
  }

  const handleSubmit = async () => {
    if (!monto || isNaN(parseFloat(monto))) {
      alert('Ingresa un monto válido')
      return
    }
    setSubmitting(true)
    setResult(null)

    try {
      // Upload photo if not already uploaded during extract
      let storagePath: string | null = (photoFile as any)?.__storage_path || null
      if (photoFile && !storagePath) {
        const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase()
        storagePath = `${employeeId}/${Date.now()}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('caja-chica')
          .upload(storagePath, photoFile)
        if (upErr) throw new Error('Error subiendo foto: ' + upErr.message)
      }

      const { data: { session } } = await supabase.auth.getSession()
      const { error: insErr } = await supabase
        .from('caja_chica_tickets')
        .insert({
          employee_id: employeeId,
          auth_user_id: session?.user.id,
          fecha: todayCDMX(),
          monto: parseFloat(monto),
          concepto: concepto.trim() || null,
          categoria,
          obra_id: obraId || null,
          foto_storage_path: storagePath,
          comprobante_url: storagePath
            ? supabase.storage.from('caja-chica').getPublicUrl(storagePath).data.publicUrl
            : null,
          estatus: 'pendiente',
        })
      if (insErr) throw new Error(insErr.message)

      setResult({ ok: true, msg: 'Ticket registrado. Se pagará en la próxima quincena.' })
      setTimeout(() => { resetForm(); load() }, 1800)
    } catch (e: any) {
      setResult({ ok: false, msg: e.message })
      setSubmitting(false)
    }
  }

  const totalPendiente = tickets.filter(t => t.estatus === 'pendiente').reduce((a, t) => a + Number(t.monto), 0)
  const countPendiente = tickets.filter(t => t.estatus === 'pendiente').length

  const fmtMoney = (n: number) => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`


  if (showForm) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1a12 40%, #0a0a0a 100%)',
        color: '#fff',
        paddingTop: 'max(env(safe-area-inset-top), 20px)',
        paddingBottom: 40,
        paddingLeft: 16,
        paddingRight: 16,
        maxWidth: 480,
        margin: '0 auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <button
            onClick={resetForm}
            style={{ background: 'transparent', border: '1px solid #1f1f1f', borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff' }}
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Nuevo ticket</div>
            <div style={{ fontSize: 11, color: '#666' }}>Caja chica</div>
          </div>
        </div>

        {/* Photo */}
        <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Foto del ticket
        </label>
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhotoChange}
          style={{ display: 'none' }}
        />
        {!photoFile ? (
          <>
            <button
              onClick={() => photoRef.current?.click()}
              style={{
                width: '100%', padding: '16px', marginBottom: 6,
                background: '#0f0f0f', border: '1px dashed #1f3a2a',
                borderRadius: 12, color: '#57FF9A', fontSize: 14, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <Camera size={18} /> Tomar foto del ticket
            </button>
            <div style={{
              padding: 10, marginBottom: 16,
              background: '#2a1f0f', border: '1px solid #5a3a1f',
              borderRadius: 8, display: 'flex', gap: 6, alignItems: 'flex-start',
            }}>
              <AlertTriangle size={13} color="#f59e0b" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 11, color: '#fcd34d', lineHeight: 1.4 }}>
                Sin foto no hay comprobante. Mejor tómala.
              </div>
            </div>
          </>
        ) : (
          <div style={{
            position: 'relative', marginBottom: 16,
            background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 12, overflow: 'hidden',
          }}>
            <img src={photoUrl!} style={{ width: '100%', maxHeight: 220, objectFit: 'cover', display: 'block' }} alt="" />
            <button
              onClick={removePhoto}
              style={{
                position: 'absolute', top: 8, right: 8,
                width: 28, height: 28, borderRadius: 14,
                background: 'rgba(0,0,0,0.7)', border: 'none',
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <X size={14} />
            </button>
            {extracting && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 8,
              }}>
                <Loader2 size={22} className="spin" color="#a78bfa" />
                <div style={{ fontSize: 12, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={12} /> Leyendo ticket...
                </div>
              </div>
            )}
          </div>
        )}

        {/* Monto */}
        <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Monto (MXN)
        </label>
        <input
          type="number"
          inputMode="decimal"
          value={monto}
          onChange={e => setMonto(e.target.value)}
          placeholder="0.00"
          style={{
            width: '100%', padding: '14px 16px', marginBottom: 16,
            background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 10, color: '#fff', fontSize: 18, fontWeight: 700,
            boxSizing: 'border-box',
          }}
        />

        {/* Categoria */}
        <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Categoría
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 16 }}>
          {CATEGORIAS.map(c => (
            <button
              key={c.value}
              onClick={() => setCategoria(c.value)}
              style={{
                padding: '10px 6px',
                background: categoria === c.value ? '#0f2a1a' : '#0f0f0f',
                border: `1px solid ${categoria === c.value ? '#57FF9A' : '#1f1f1f'}`,
                borderRadius: 10,
                color: categoria === c.value ? '#57FF9A' : '#888',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              }}
            >
              <span style={{ fontSize: 16 }}>{c.emoji}</span>
              {c.label}
            </button>
          ))}
        </div>

        {/* Obra (optional) */}
        <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Obra (opcional)
        </label>
        <select
          value={obraId}
          onChange={e => setObraId(e.target.value)}
          style={{
            width: '100%', padding: '14px 16px', marginBottom: 16,
            background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 10, color: '#fff', fontSize: 15,
            boxSizing: 'border-box',
          }}
        >
          <option value="">Sin obra (personal)</option>
          {obras.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>

        {/* Concepto */}
        <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Concepto
        </label>
        <input
          type="text"
          value={concepto}
          onChange={e => setConcepto(e.target.value)}
          placeholder="Descripción breve"
          style={{
            width: '100%', padding: '14px 16px', marginBottom: 20,
            background: '#0f0f0f', border: '1px solid #1f1f1f',
            borderRadius: 10, color: '#fff', fontSize: 14,
            boxSizing: 'border-box',
          }}
        />

        {result && (
          <div style={{
            padding: 12, marginBottom: 16, borderRadius: 10,
            background: result.ok ? '#0f2a1a' : '#3a1a1a',
            border: `1px solid ${result.ok ? '#2a5a3a' : '#5a2a2a'}`,
            color: result.ok ? '#57FF9A' : '#fca5a5',
            fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
          }}>
            {result.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            {result.msg}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting || extracting}
          style={{
            width: '100%', padding: '18px',
            background: submitting ? '#3a5f48' : '#57FF9A',
            color: '#0a0a0a', border: 'none',
            borderRadius: 14, fontSize: 16, fontWeight: 700,
            cursor: submitting ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          }}
        >
          {submitting ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          {submitting ? 'Guardando...' : 'Guardar ticket'}
        </button>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          .spin { animation: spin 1s linear infinite; }
        `}</style>
      </div>
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1a12 40%, #0a0a0a 100%)',
      color: '#fff',
      paddingTop: 'max(env(safe-area-inset-top), 20px)',
      paddingBottom: 40,
      paddingLeft: 16,
      paddingRight: 16,
      maxWidth: 480,
      margin: '0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate('/obra-app')}
          style={{ background: 'transparent', border: '1px solid #1f1f1f', borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Caja chica</div>
          <div style={{ fontSize: 11, color: '#666' }}>{tickets.length} tickets</div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{
            background: '#57FF9A', border: 'none',
            borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
            color: '#0a0a0a', fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <Plus size={16} /> Nuevo
        </button>
      </div>

      {/* Pending KPI */}
      <div style={{
        padding: 16, marginBottom: 16,
        background: 'linear-gradient(135deg, #0f1a12 0%, #0a1a15 100%)',
        border: '1px solid #1f3a2a', borderRadius: 14,
      }}>
        <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
          Por pagar en quincena
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#57FF9A' }}>
          {fmtMoney(totalPendiente)}
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
          {countPendiente} {countPendiente === 1 ? 'ticket' : 'tickets'} pendiente{countPendiente !== 1 ? 's' : ''}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Loader2 size={24} className="spin" />
        </div>
      ) : tickets.length === 0 ? (
        <div style={{
          padding: 32, textAlign: 'center',
          background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 16, color: '#888', fontSize: 13,
        }}>
          <Receipt size={32} style={{ marginBottom: 10, opacity: 0.3 }} />
          <div style={{ marginBottom: 16 }}>Sin tickets todavía</div>
          <button
            onClick={() => setShowForm(true)}
            style={{
              background: '#57FF9A', border: 'none',
              borderRadius: 10, padding: '12px 18px', cursor: 'pointer',
              color: '#0a0a0a', fontSize: 13, fontWeight: 700,
            }}
          >
            Subir mi primer ticket
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tickets.map(t => {
            const cat = CATEGORIAS.find(c => c.value === t.categoria)
            return (
              <div key={t.id} style={{
                background: '#0f0f0f', border: '1px solid #1a1a1a',
                borderRadius: 12, padding: 14,
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: '#1a1a1a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20,
                }}>
                  {cat?.emoji || '📝'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                    {fmtMoney(Number(t.monto))}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {cat?.label || 'Otro'}{t.obras ? ' · ' + t.obras.nombre : ''}
                  </div>
                  {t.concepto && (
                    <div style={{ fontSize: 10, color: '#555', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.concepto}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: 9, color: t.estatus === 'pagado' ? '#57FF9A' : '#f59e0b',
                    textTransform: 'uppercase', fontWeight: 700,
                  }}>
                    {t.estatus}
                  </div>
                  <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>
                    {new Date(t.created_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
