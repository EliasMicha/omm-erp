// ═══════════════════════════════════════════════════════════════════════════
// PaymentPlanModal — define el plan de cobranza al cerrar una cotización.
//   - 9 templates predefinidos (incluyendo Custom)
//   - Cada hito: nombre, % del total, mes de cobro esperado (offset desde hoy)
//   - Genera registros en payment_milestones con due_date = primer día del mes
//   - Mismo modal sirve para crear desde cero o ver/editar plan existente
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { F } from '../lib/utils'
import { X, Plus, Trash2, CheckCircle, AlertCircle } from 'lucide-react'

type Hito = {
  id?: string  // si tiene id, es uno existente
  name: string
  percentage: number      // % del total
  monthsOffset: number    // meses desde el cierre (0 = mes actual, 1 = siguiente mes)
  notes?: string
}

type Template = {
  id: string
  name: string
  description: string
  hitos: Hito[]
}

// Catálogo de templates. El user elige uno y los edita si quiere.
const TEMPLATES: Template[] = [
  { id: '50-30-20', name: '50 / 30 / 20', description: 'Estándar OMM (3 hitos)', hitos: [
    { name: 'Anticipo', percentage: 50, monthsOffset: 0 },
    { name: 'Avance de obra', percentage: 30, monthsOffset: 2 },
    { name: 'Entrega final', percentage: 20, monthsOffset: 4 },
  ]},
  { id: '40-40-20', name: '40 / 40 / 20', description: 'Balanceado (3 hitos)', hitos: [
    { name: 'Anticipo', percentage: 40, monthsOffset: 0 },
    { name: 'Avance de obra', percentage: 40, monthsOffset: 2 },
    { name: 'Entrega final', percentage: 20, monthsOffset: 4 },
  ]},
  { id: '30-30-30-10', name: '30 / 30 / 30 / 10', description: 'Largo (4 hitos)', hitos: [
    { name: 'Anticipo', percentage: 30, monthsOffset: 0 },
    { name: 'Avance 1', percentage: 30, monthsOffset: 2 },
    { name: 'Avance 2', percentage: 30, monthsOffset: 4 },
    { name: 'Entrega final', percentage: 10, monthsOffset: 6 },
  ]},
  { id: '25-25-25-25', name: '25 / 25 / 25 / 25', description: 'Cuatro pagos iguales', hitos: [
    { name: 'Anticipo', percentage: 25, monthsOffset: 0 },
    { name: 'Pago 2', percentage: 25, monthsOffset: 1 },
    { name: 'Pago 3', percentage: 25, monthsOffset: 2 },
    { name: 'Pago 4', percentage: 25, monthsOffset: 3 },
  ]},
  { id: '50-50', name: '50 / 50', description: 'Anticipo + entrega (2 hitos)', hitos: [
    { name: 'Anticipo', percentage: 50, monthsOffset: 0 },
    { name: 'Entrega final', percentage: 50, monthsOffset: 3 },
  ]},
  { id: '30-70', name: '30 / 70', description: 'Anticipo bajo + entrega', hitos: [
    { name: 'Anticipo', percentage: 30, monthsOffset: 0 },
    { name: 'Entrega final', percentage: 70, monthsOffset: 3 },
  ]},
  { id: '70-30', name: '70 / 30', description: 'Anticipo alto + entrega', hitos: [
    { name: 'Anticipo', percentage: 70, monthsOffset: 0 },
    { name: 'Entrega final', percentage: 30, monthsOffset: 3 },
  ]},
  { id: '100', name: '100%', description: 'Pago único al cerrar contrato', hitos: [
    { name: 'Pago total', percentage: 100, monthsOffset: 0 },
  ]},
  { id: 'custom', name: 'Custom', description: 'Define tu propio plan', hitos: [
    { name: 'Hito 1', percentage: 100, monthsOffset: 0 },
  ]},
]

// Calcula la fecha (primer día del mes) dado un offset en meses desde hoy
function calcDueDate(monthsOffset: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() + monthsOffset)
  d.setDate(1)
  return d.toISOString().substring(0, 10)
}

// Formatea una fecha YYYY-MM-DD a "Junio 2026"
function fmtMonth(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' }).replace(/^./, c => c.toUpperCase())
}

interface Props {
  quotationId: string
  quotationName: string
  totalFinal: number  // monto total c/IVA y descuento aplicado, en su moneda
  currency?: string   // 'MXN' | 'USD'
  projectId?: string | null
  onClose: () => void
  onSaved?: () => void
}

export default function PaymentPlanModal({ quotationId, quotationName, totalFinal, currency = 'MXN', projectId, onClose, onSaved }: Props) {
  const [selectedTemplate, setSelectedTemplate] = useState<string>('50-30-20')
  const [hitos, setHitos] = useState<Hito[]>(TEMPLATES[0].hitos.map(h => ({ ...h })))
  const [existing, setExisting] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>('')

  // Cargar milestones existentes (si los hay) para mostrar modo "edición"
  useEffect(() => {
    supabase.from('payment_milestones').select('*').eq('quotation_id', quotationId).order('due_date').then(({ data }) => {
      const existing = data || []
      setExisting(existing)
      // Si ya hay plan, pre-cargar los hitos para edición
      if (existing.length > 0) {
        const today = new Date()
        const hitosFromDB = existing.map((m: any) => {
          const due = new Date(m.due_date + 'T00:00:00')
          const monthsOffset = (due.getFullYear() - today.getFullYear()) * 12 + (due.getMonth() - today.getMonth())
          return {
            id: m.id,
            name: m.name || '',
            percentage: Number(m.percentage) || 0,
            monthsOffset,
            notes: m.notes || '',
          }
        })
        setHitos(hitosFromDB)
        setSelectedTemplate('custom')
      }
      setLoading(false)
    })
  }, [quotationId])

  function applyTemplate(templateId: string) {
    const t = TEMPLATES.find(x => x.id === templateId)
    if (!t) return
    setSelectedTemplate(templateId)
    setHitos(t.hitos.map(h => ({ ...h })))
  }

  function updateHito(idx: number, field: keyof Hito, value: any) {
    setHitos(prev => prev.map((h, i) => i === idx ? { ...h, [field]: value } : h))
  }

  function addHito() {
    setHitos(prev => [...prev, { name: `Hito ${prev.length + 1}`, percentage: 0, monthsOffset: prev.length }])
    setSelectedTemplate('custom')
  }

  function removeHito(idx: number) {
    setHitos(prev => prev.filter((_, i) => i !== idx))
    setSelectedTemplate('custom')
  }

  // Validación
  const sumPct = hitos.reduce((s, h) => s + (Number(h.percentage) || 0), 0)
  const isValid = sumPct === 100 && hitos.every(h => h.name.trim() && h.percentage > 0)

  async function guardar() {
    if (!isValid) { setError('La suma de porcentajes debe ser 100% y todos los hitos deben tener nombre + monto.'); return }
    setSaving(true); setError('')
    try {
      // Si hay existentes, borrarlos primero (replazo simple)
      if (existing.length > 0) {
        const { error: delErr } = await supabase.from('payment_milestones').delete().eq('quotation_id', quotationId)
        if (delErr) throw delErr
      }
      // Insertar los nuevos — siempre quotation_id Y project_id (cuando exista)
      // para que la vista de ProyeccionCobranza pueda asociar contexto sin importar
      // desde dónde se haya creado el hito (CotEditor o LeadDashboard).
      const rows = hitos.map(h => ({
        quotation_id: quotationId,
        project_id: projectId || null,
        name: h.name.trim(),
        percentage: Number(h.percentage),
        amount: Math.round((totalFinal * Number(h.percentage) / 100) * 100) / 100,
        due_date: calcDueDate(Number(h.monthsOffset)),
        status: 'pendiente',
        currency,
        notes: h.notes?.trim() || null,
      }))
      const { error: insErr } = await supabase.from('payment_milestones').insert(rows)
      if (insErr) throw insErr
      onSaved?.()
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div style={{ color: '#888' }}>Cargando...</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 16, padding: 24, width: '100%', maxWidth: 880, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 4 }}>
              {existing.length > 0 ? 'Editar plan de pagos' : 'Definir plan de pagos'}
            </div>
            <div style={{ fontSize: 11, color: '#888' }}>{quotationName}</div>
            <div style={{ fontSize: 12, color: '#10B981', fontWeight: 600, marginTop: 4 }}>
              Total: {F(totalFinal)} {currency}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Selector de template */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Plantilla (después puedes editar cada hito)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
            {TEMPLATES.map(t => {
              const active = selectedTemplate === t.id
              return (
                <button key={t.id} onClick={() => applyTemplate(t.id)} style={{
                  background: active ? 'rgba(168,85,247,0.15)' : '#0a0a0a',
                  border: '1px solid ' + (active ? '#7C3AED' : '#222'),
                  borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                  color: active ? '#A78BFA' : '#888', textAlign: 'left' as const, fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: active ? '#A78BFA' : '#ccc' }}>{t.name}</div>
                  <div style={{ fontSize: 9, marginTop: 3, color: active ? '#7C3AED' : '#666' }}>{t.description}</div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Tabla de hitos editables */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Hitos ({hitos.length})
            </div>
            <button onClick={addHito} style={{
              background: 'transparent', border: '1px solid #333', borderRadius: 6,
              padding: '4px 10px', color: '#888', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Plus size={11} /> Agregar hito
            </button>
          </div>
          <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 110px 1.2fr 30px', gap: 8, padding: '6px 10px', borderBottom: '1px solid #1f1f1f', background: '#0d0d0d' }}>
              <div style={{ fontSize: 9, color: '#666' }}>Concepto</div>
              <div style={{ fontSize: 9, color: '#666', textAlign: 'right' as const }}>%</div>
              <div style={{ fontSize: 9, color: '#666' }}>Mes esperado</div>
              <div style={{ fontSize: 9, color: '#666', textAlign: 'right' as const }}>Monto calculado</div>
              <div></div>
            </div>
            {hitos.map((h, idx) => {
              const monto = totalFinal * (Number(h.percentage) || 0) / 100
              return (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 110px 1.2fr 30px', gap: 8, padding: '8px 10px', borderBottom: idx < hitos.length - 1 ? '1px solid #1a1a1a' : 'none', alignItems: 'center' }}>
                  <input
                    value={h.name}
                    onChange={e => updateHito(idx, 'name', e.target.value)}
                    placeholder="Concepto del hito"
                    style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '5px 8px', color: '#fff', fontSize: 11, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const }}
                  />
                  <input
                    type="number" min="0" max="100" step="1"
                    value={h.percentage}
                    onChange={e => updateHito(idx, 'percentage', Number(e.target.value))}
                    style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '5px 8px', color: '#fff', fontSize: 11, fontFamily: 'inherit', textAlign: 'right' as const, width: '100%', boxSizing: 'border-box' as const }}
                  />
                  <select
                    value={h.monthsOffset}
                    onChange={e => updateHito(idx, 'monthsOffset', Number(e.target.value))}
                    style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 4, padding: '5px 8px', color: '#fff', fontSize: 10, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' as const }}
                  >
                    {Array.from({ length: 24 }, (_, i) => i).map(i => (
                      <option key={i} value={i}>{fmtMonth(calcDueDate(i))}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: 11, color: '#10B981', fontWeight: 600, textAlign: 'right' as const }}>
                    {F(monto)} {currency}
                  </div>
                  <button onClick={() => removeHito(idx)} disabled={hitos.length === 1} style={{
                    background: 'transparent', border: 'none', color: hitos.length === 1 ? '#333' : '#DC2626',
                    cursor: hitos.length === 1 ? 'not-allowed' : 'pointer', padding: 2,
                  }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              )
            })}
          </div>
          {/* Suma de porcentajes */}
          <div style={{ marginTop: 8, padding: '6px 10px', background: sumPct === 100 ? 'rgba(87,255,154,0.06)' : 'rgba(245,158,11,0.06)', border: '1px solid ' + (sumPct === 100 ? 'rgba(87,255,154,0.3)' : 'rgba(245,158,11,0.3)'), borderRadius: 6, fontSize: 11, color: sumPct === 100 ? '#10B981' : '#D97706', display: 'flex', alignItems: 'center', gap: 6 }}>
            {sumPct === 100 ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
            Suma: <strong>{sumPct}%</strong>
            {sumPct === 100 ? ' ✓ Listo' : ` (faltan ${100 - sumPct}% para completar)`}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid #DC2626', borderRadius: 6, color: '#fca5a5', fontSize: 11, marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 12, borderTop: '1px solid #2a2a2a' }}>
          <button onClick={onClose} style={{
            background: 'transparent', border: '1px solid #333', borderRadius: 6,
            padding: '8px 16px', color: '#888', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
          }}>Cancelar</button>
          <button onClick={guardar} disabled={!isValid || saving} style={{
            background: isValid ? '#A78BFA22' : '#222',
            border: '1px solid ' + (isValid ? '#7C3AED' : '#333'),
            borderRadius: 6, padding: '8px 18px',
            color: isValid ? '#A78BFA' : '#555', fontSize: 12, fontWeight: 600,
            cursor: isValid && !saving ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
          }}>
            {saving ? 'Guardando...' : existing.length > 0 ? 'Actualizar plan' : 'Crear plan de pagos'}
          </button>
        </div>
      </div>
    </div>
  )
}
