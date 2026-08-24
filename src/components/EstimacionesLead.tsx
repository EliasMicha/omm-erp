// ═══════════════════════════════════════════════════════════════════════════
// EstimacionesLead — panel de estimaciones de los contratos eléctricos de un
// lead. Vive en el dashboard del lead porque ahí es donde se decide qué se
// cobra este mes.
//
// Muestra, por contrato: contratado → estimado en firme → por estimar, más los
// extras acumulados. Ese último número es el que nadie tiene hoy y el que
// explica por qué una obra eléctrica se come el margen.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Badge, Btn } from './layout/UI'
import { Plus, FileSpreadsheet } from 'lucide-react'
import { ESTADO_CFG, crearEstimacion, resumenDeContrato, ResumenContrato } from '../lib/estimaciones'

const n = (v: any) => Number(v) || 0
const F = (v: number, mon = 'MXN') => (mon === 'USD' ? 'US$' : '$') + n(v).toLocaleString('es-MX', { maximumFractionDigits: 0 })

interface Cot { id: string; name: string; specialty?: string | null; total_final?: any; total?: any; notes?: string | null }

export default function EstimacionesLead({ cotizaciones }: { cotizaciones: Cot[] }) {
  const navigate = useNavigate()
  // Por ahora solo eléctrico: es donde el cobro es por avance y no por hitos.
  const contratos = cotizaciones.filter(q => q.specialty === 'elec')
  const [ests, setEsts] = useState<Record<string, any[]>>({})
  const [resumen, setResumen] = useState<Record<string, ResumenContrato>>({})
  const [creando, setCreando] = useState('')

  async function cargar() {
    if (contratos.length === 0) return
    const ids = contratos.map(c => c.id)
    const { data } = await supabase.from('estimaciones')
      .select('id,quotation_id,numero,estado,fecha,periodo_inicio,periodo_fin,total,moneda')
      .in('quotation_id', ids).order('numero', { ascending: false })
    const porCot: Record<string, any[]> = {}
    for (const e of ((data as any[]) || [])) (porCot[e.quotation_id] ||= []).push(e)
    setEsts(porCot)
    const res: Record<string, ResumenContrato> = {}
    for (const c of contratos) res[c.id] = await resumenDeContrato(c.id)
    setResumen(res)
  }
  useEffect(() => { cargar() }, [contratos.map(c => c.id).join(',')])

  if (contratos.length === 0) return null

  const monedaDe = (q: Cot): string => {
    try { return JSON.parse(q.notes || '{}').currency === 'USD' ? 'USD' : 'MXN' } catch { return 'MXN' }
  }

  async function nueva(q: Cot) {
    setCreando(q.id)
    try {
      const { id, error } = await crearEstimacion(q.id, { moneda: monedaDe(q) })
      if (error || !id) { alert('No se pudo crear la estimación: ' + (error || '')); return }
      navigate(`/estimacion/${id}`)
    } finally { setCreando('') }
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <FileSpreadsheet size={15} style={{ color: '#D9A441' }} />
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Estimaciones de obra eléctrica</div>
        <div style={{ fontSize: 10, color: '#666' }}>Se cobra lo ejecutado en el periodo, no por hitos.</div>
      </div>

      {contratos.map(q => {
        const r = resumen[q.id]
        const lista = ests[q.id] || []
        const mon = monedaDe(q)
        const contratado = n(q.total_final ?? q.total)
        const pctEstimado = contratado > 0 && r ? r.estimadoEnFirme / contratado : 0
        return (
          <div key={q.id} style={{ marginBottom: 12, border: '1px solid #222', borderRadius: 8, background: '#0f0f0f' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: lista.length ? '1px solid #1a1a1a' : 'none', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{q.name}</div>
              <Badge label="ELEC" color="#D9A441" />
              <Btn size="sm" variant="primary" onClick={() => nueva(q)} disabled={creando === q.id} style={{ marginLeft: 'auto' }}>
                <Plus size={12} /> {creando === q.id ? 'Creando…' : 'Nueva estimación'}
              </Btn>
            </div>

            {r && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, padding: '10px 12px' }}>
                {([
                  ['Contratado', contratado, '#60A5FA', ''],
                  ['Estimado en firme', r.estimadoEnFirme, '#10B981', `${Math.round(pctEstimado * 100)}% del contrato`],
                  ['En borrador', r.estimadoBorrador, '#6B7280', ''],
                  ['Por estimar', r.porEstimar, '#D97706', ''],
                  ['Extras acumulados', r.extrasAcumulados, r.extrasAcumulados > 0 ? '#D9A441' : '#666', 'fuera de contrato'],
                  ['Deductivas', r.deductivasAcumuladas, r.deductivasAcumuladas < 0 ? '#DC2626' : '#666', ''],
                ] as const).map(([l, v, c, nota], i) => (
                  <div key={i}>
                    <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '.05em' }}>{l}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: c as string }}>{F(v as number, mon)}</div>
                    {nota ? <div style={{ fontSize: 9, color: '#555' }}>{nota}</div> : null}
                  </div>
                ))}
              </div>
            )}

            {lista.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {lista.map(e => {
                    const cfg = ESTADO_CFG[e.estado as keyof typeof ESTADO_CFG] || ESTADO_CFG.borrador
                    return (
                      <tr key={e.id} onClick={() => navigate(`/estimacion/${e.id}`)} style={{ cursor: 'pointer', borderTop: '1px solid #161616' }}>
                        <td style={{ padding: '7px 12px', fontSize: 12, color: '#fff', fontWeight: 600 }}>Estimación {e.numero}</td>
                        <td style={{ padding: '7px 8px', fontSize: 10, color: '#888' }}>
                          {e.periodo_inicio || e.periodo_fin ? `${e.periodo_inicio || '…'} → ${e.periodo_fin || '…'}` : e.fecha}
                        </td>
                        <td style={{ padding: '7px 8px' }}><Badge label={cfg.label} color={cfg.color} /></td>
                        <td style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, color: '#10B981', textAlign: 'right' }}>{F(n(e.total), e.moneda || mon)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
    </div>
  )
}
