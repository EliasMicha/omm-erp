import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { X, FileText, Check, Loader2 } from 'lucide-react'

// ── Catálogos de factores (de la hoja "Listas" del generador Excel) ──
const TIPO_PROYECTO = [
  { label: 'Casa Habitacion (300-500m)', pct: 0 },
  { label: 'Casa Habitacion (500-1000m)', pct: 0.005 },
  { label: 'Casa Habitacion (1000-2500m)', pct: 0.01 },
  { label: 'Hotel', pct: 0.01 },
  { label: 'Oficina Comercial', pct: 0.01 },
  { label: 'Centro Comercial', pct: 0.01 },
  { label: 'Restaurante', pct: 0.01 },
]
const SISTEMAS = [
  { label: 'N/A', pct: 0 },
  { label: 'Bajo (1–2)', pct: 0.005 },
  { label: 'Medio (3–4)', pct: 0.01 },
  { label: 'Alto (5+)', pct: 0.015 },
]
const ANTIGUEDAD = [
  { label: 'Nueva (1 Año)', pct: 0 },
  { label: 'Moderada (3–5 años)', pct: 0.005 },
  { label: 'Alta (>5 años)', pct: 0.01 },
  { label: 'Crítica (>8 años)', pct: 0.015 },
]
const VOLUMEN = [
  { label: 'N/A', pct: 0 },
  { label: 'Portafolio pequeño', pct: -0.005 },
  { label: 'Múltiples sedes', pct: -0.01 },
  { label: 'Contrato marco', pct: -0.015 },
]

interface PlanDef {
  key: string; label: string; basePct: number; preventivas: number; emergencias: number
  soporte: string; arribo: string; backups: string; reportes: string; cobertura: string
}
const PLANES_BASE: PlanDef[] = [
  { key: 'bronce', label: 'Bronce', basePct: 0.0175, preventivas: 1, emergencias: 2, soporte: 'Horario laboral', arribo: '48 h', backups: 'Semestral', reportes: 'Semestral', cobertura: 'L–V 9–18' },
  { key: 'plata', label: 'Plata', basePct: 0.0275, preventivas: 2, emergencias: 3, soporte: 'Prioritario', arribo: '36 h', backups: 'Trimestral', reportes: 'Trimestrales', cobertura: 'L–S 8–19' },
  { key: 'oro', label: 'Oro', basePct: 0.04, preventivas: 4, emergencias: 4, soporte: '24 h hábil', arribo: '24 h', backups: 'Trimestral', reportes: 'Mensuales', cobertura: '6 días 7–20' },
  { key: 'platino', label: 'Platino', basePct: 0.055, preventivas: 6, emergencias: 6, soporte: '24/7', arribo: '12–16 h', backups: 'Mensual', reportes: 'Mensuales', cobertura: '24/7' },
]

const TIER_COLOR: Record<string, string> = { bronce: '#b87333', plata: '#9ca3af', oro: '#f5b301', platino: '#a78bfa' }

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')
const pct = (n: number) => (n * 100).toFixed(2) + '%'

interface PropOpt { id: string; name: string; client_name: string | null; address: string | null; city: string | null }

export default function GeneradorPoliza({ properties, onClose, onCreated }: {
  properties: PropOpt[]; onClose: () => void; onCreated: () => void
}) {
  // Inputs del proyecto
  const [propertyId, setPropertyId] = useState('')
  const [valor, setValor] = useState('800000')
  const [foranea, setForanea] = useState(false)
  const [tecnicos, setTecnicos] = useState('2')
  const [dias, setDias] = useState('4')
  const [viaticoDia, setViaticoDia] = useState('1200')
  const [traslado, setTraslado] = useState('10000')
  const [visitaSuelta, setVisitaSuelta] = useState('3000')
  // Factores
  const [fTipo, setFTipo] = useState(TIPO_PROYECTO[0].label)
  const [fSistemas, setFSistemas] = useState(SISTEMAS[2].label)
  const [fAntiguedad, setFAntiguedad] = useState(ANTIGUEDAD[1].label)
  const [fVolumen, setFVolumen] = useState(VOLUMEN[0].label)
  const [fOtros, setFOtros] = useState('0')
  // Planes editables (preventivas/emergencias por plan)
  const [planes, setPlanes] = useState<PlanDef[]>(PLANES_BASE)
  // Selección
  const [selected, setSelected] = useState('oro')
  const [paymentPlan, setPaymentPlan] = useState('Anual')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const adjPct = useMemo(() => {
    const t = TIPO_PROYECTO.find(o => o.label === fTipo)?.pct || 0
    const s = SISTEMAS.find(o => o.label === fSistemas)?.pct || 0
    const a = ANTIGUEDAD.find(o => o.label === fAntiguedad)?.pct || 0
    const v = VOLUMEN.find(o => o.label === fVolumen)?.pct || 0
    const o = (parseFloat(fOtros) || 0) / 100
    return t + s + a + v + o
  }, [fTipo, fSistemas, fAntiguedad, fVolumen, fOtros])

  const valorNum = parseFloat(valor) || 0
  const viaticoPorVisita = foranea ? (parseFloat(tecnicos) || 0) * (parseFloat(dias) || 0) * (parseFloat(viaticoDia) || 0) + (parseFloat(traslado) || 0) : 0

  const calc = (p: PlanDef) => {
    const finalPct = p.basePct + adjPct
    const annual = valorNum * finalPct
    const monthly = annual / 12
    const visitas = p.preventivas + p.emergencias
    const viaticosAnual = viaticoPorVisita * visitas
    const totalAnual = annual + viaticosAnual
    const iva = totalAnual * 0.16
    const totalConIva = totalAnual + iva
    return { finalPct, annual, monthly, visitas, viaticosAnual, totalAnual, iva, totalConIva, mensual12: totalConIva / 12 }
  }

  const sel = planes.find(p => p.key === selected)!
  const selCalc = calc(sel)
  const selProp = properties.find(p => p.id === propertyId)

  function updatePlan(key: string, field: 'preventivas' | 'emergencias' | 'basePct', value: number) {
    setPlanes(ps => ps.map(p => p.key === key ? { ...p, [field]: value } : p))
  }

  function buildSnapshot() {
    return {
      project_value: valorNum, foranea, tecnicos: parseFloat(tecnicos) || 0, dias_sitio: parseFloat(dias) || 0,
      viatico_dia: parseFloat(viaticoDia) || 0, traslado: parseFloat(traslado) || 0,
      costo_visita_suelta: parseFloat(visitaSuelta) || 0,
      factores: { tipo: fTipo, sistemas: fSistemas, antiguedad: fAntiguedad, volumen: fVolumen, otros_pct: (parseFloat(fOtros) || 0) / 100, adj_pct: adjPct },
      plan: { tier: sel.key, base_pct: sel.basePct, final_pct: selCalc.finalPct, annual: selCalc.annual, monthly: selCalc.monthly,
        preventivas: sel.preventivas, emergencias: sel.emergencias, viaticos_por_visita: viaticoPorVisita,
        viaticos_anual: selCalc.viaticosAnual, total_anual: selCalc.totalAnual, iva: selCalc.iva, total_con_iva: selCalc.totalConIva, mensual_12: selCalc.mensual12 },
      payment_plan: paymentPlan,
    }
  }
  function buildServiceLevels(p: PlanDef) {
    return { soporte_remoto: p.soporte, arribo: p.arribo, backups: p.backups, reportes: p.reportes, cobertura: p.cobertura }
  }

  async function crearPoliza() {
    if (!propertyId) { setError('Selecciona la propiedad para ligar la póliza'); return }
    if (valorNum <= 0) { setError('Captura el valor del proyecto'); return }
    setSaving(true); setError('')
    const today = new Date()
    const end = new Date(today); end.setFullYear(end.getFullYear() + 1)
    const { error: err } = await supabase.from('maintenance_contracts').insert({
      property_id: propertyId,
      name: `Póliza ${sel.label} — ${selProp?.name || ''}`.trim(),
      contract_type: 'poliza',
      start_date: today.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      monthly_fee: selCalc.monthly,
      annual_fee: selCalc.annual,
      currency: 'MXN',
      plan_tier: sel.key,
      preventive_visits_included: sel.preventivas,
      emergency_visits_included: sel.emergencias,
      preventive_visits_used: 0,
      emergency_visits_used: 0,
      visits_included: sel.preventivas + sel.emergencias,
      visits_used: 0,
      project_value: valorNum,
      payment_plan: paymentPlan,
      pricing_snapshot: buildSnapshot(),
      service_levels: buildServiceLevels(sel),
      is_active: true,
      notes: `Generada con calculadora de pólizas. Ajustes ${pct(adjPct)}.`,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  function descargarPropuesta() {
    const html = buildProposalHtml({
      property: selProp, planes, calc, sel, selCalc, paymentPlan, valorNum,
      foranea, viaticoPorVisita, visitaSuelta: parseFloat(visitaSuelta) || 0, adjPct,
      factores: { fTipo, fSistemas, fAntiguedad, fVolumen },
    })
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #222', position: 'sticky', top: 0, background: '#0d0d0d', zIndex: 2 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Generador de pólizas</div>
          <button onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Datos del proyecto */}
          <Section title="Datos del proyecto">
            <div style={grid3}>
              <Lbl t="Propiedad *">
                <select value={propertyId} onChange={e => setPropertyId(e.target.value)} style={inp}>
                  <option value="">Selecciona...</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}{p.client_name ? ` — ${p.client_name}` : ''}</option>)}
                </select>
              </Lbl>
              <Lbl t="Valor del proyecto (MXN)"><input value={valor} onChange={e => setValor(e.target.value)} type="number" style={inp} /></Lbl>
              <Lbl t="Costo visita suelta / bomberazo"><input value={visitaSuelta} onChange={e => setVisitaSuelta(e.target.value)} type="number" style={inp} /></Lbl>
            </div>
            <div style={grid4}>
              <Lbl t="Ubicación foránea">
                <select value={foranea ? 'Si' : 'No'} onChange={e => setForanea(e.target.value === 'Si')} style={inp}>
                  <option>No</option><option>Si</option>
                </select>
              </Lbl>
              <Lbl t="Técnicos (viáticos)"><input value={tecnicos} onChange={e => setTecnicos(e.target.value)} type="number" disabled={!foranea} style={inp} /></Lbl>
              <Lbl t="Días en sitio / visita"><input value={dias} onChange={e => setDias(e.target.value)} type="number" disabled={!foranea} style={inp} /></Lbl>
              <Lbl t="Viático técnico/día"><input value={viaticoDia} onChange={e => setViaticoDia(e.target.value)} type="number" disabled={!foranea} style={inp} /></Lbl>
            </div>
            {foranea && (
              <div style={grid3}>
                <Lbl t="Traslado por visita (MXN)"><input value={traslado} onChange={e => setTraslado(e.target.value)} type="number" style={inp} /></Lbl>
                <div style={{ alignSelf: 'end', fontSize: 12, color: '#10B981', paddingBottom: 8 }}>Viático por visita: {fmt(viaticoPorVisita)}</div>
              </div>
            )}
          </Section>

          {/* Factores */}
          <Section title={`Factores de ajuste · total ${pct(adjPct)}`}>
            <div style={grid3}>
              <Lbl t="Tipo de proyecto"><select value={fTipo} onChange={e => setFTipo(e.target.value)} style={inp}>{TIPO_PROYECTO.map(o => <option key={o.label}>{o.label}</option>)}</select></Lbl>
              <Lbl t="N° de sistemas integrados"><select value={fSistemas} onChange={e => setFSistemas(e.target.value)} style={inp}>{SISTEMAS.map(o => <option key={o.label}>{o.label}</option>)}</select></Lbl>
              <Lbl t="Antigüedad de equipos"><select value={fAntiguedad} onChange={e => setFAntiguedad(e.target.value)} style={inp}>{ANTIGUEDAD.map(o => <option key={o.label}>{o.label}</option>)}</select></Lbl>
            </div>
            <div style={grid3}>
              <Lbl t="Descuento por volumen"><select value={fVolumen} onChange={e => setFVolumen(e.target.value)} style={inp}>{VOLUMEN.map(o => <option key={o.label}>{o.label}</option>)}</select></Lbl>
              <Lbl t="Otros (%)"><input value={fOtros} onChange={e => setFOtros(e.target.value)} type="number" step="0.1" style={inp} /></Lbl>
            </div>
          </Section>

          {/* Comparativo de planes */}
          <Section title="Comparativo de planes">
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={thLeft}></th>
                    {planes.map(p => (
                      <th key={p.key} onClick={() => setSelected(p.key)} style={{
                        ...thCol, cursor: 'pointer',
                        background: selected === p.key ? TIER_COLOR[p.key] + '22' : 'transparent',
                        color: TIER_COLOR[p.key], borderBottom: `2px solid ${selected === p.key ? TIER_COLOR[p.key] : '#222'}`,
                      }}>{p.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label="% final ajustado" cells={planes.map(p => pct(calc(p).finalPct))} sel={selected} planes={planes} />
                  <Row label="Costo anual" cells={planes.map(p => fmt(calc(p).annual))} sel={selected} planes={planes} strong />
                  <Row label="Costo mensual" cells={planes.map(p => fmt(calc(p).monthly))} sel={selected} planes={planes} />
                  <tr>
                    <td style={tdLeft}>Visitas preventivas/año</td>
                    {planes.map(p => (
                      <td key={p.key} style={{ ...tdCol, background: selected === p.key ? TIER_COLOR[p.key] + '12' : 'transparent' }}>
                        <input value={p.preventivas} onChange={e => updatePlan(p.key, 'preventivas', parseInt(e.target.value) || 0)} type="number" style={cellInp} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td style={tdLeft}>Bomberazos incluidos/año</td>
                    {planes.map(p => (
                      <td key={p.key} style={{ ...tdCol, background: selected === p.key ? TIER_COLOR[p.key] + '12' : 'transparent' }}>
                        <input value={p.emergencias} onChange={e => updatePlan(p.key, 'emergencias', parseInt(e.target.value) || 0)} type="number" style={cellInp} />
                      </td>
                    ))}
                  </tr>
                  <Row label="Soporte remoto" cells={planes.map(p => p.soporte)} sel={selected} planes={planes} />
                  <Row label="Arribo on-site máx." cells={planes.map(p => p.arribo)} sel={selected} planes={planes} />
                  <Row label="Reportes técnicos" cells={planes.map(p => p.reportes)} sel={selected} planes={planes} />
                  <Row label="Cobertura horaria" cells={planes.map(p => p.cobertura)} sel={selected} planes={planes} />
                  {foranea && <Row label="Viáticos anuales est." cells={planes.map(p => fmt(calc(p).viaticosAnual))} sel={selected} planes={planes} />}
                  <Row label="Total anual (s/IVA)" cells={planes.map(p => fmt(calc(p).totalAnual))} sel={selected} planes={planes} strong />
                </tbody>
              </table>
            </div>
          </Section>

          {/* Selección */}
          <Section title="Plan seleccionado">
            <div style={grid3}>
              <Lbl t="Plan">
                <select value={selected} onChange={e => setSelected(e.target.value)} style={inp}>
                  {planes.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
              </Lbl>
              <Lbl t="Plan de pago">
                <select value={paymentPlan} onChange={e => setPaymentPlan(e.target.value)} style={inp}>
                  <option>Anual</option><option>Semestral</option><option>Trimestral</option><option>Mensual</option>
                </select>
              </Lbl>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <Stat label="Costo anual" value={fmt(selCalc.totalAnual)} />
              <Stat label="IVA 16%" value={fmt(selCalc.iva)} />
              <Stat label="Total con IVA" value={fmt(selCalc.totalConIva)} color={TIER_COLOR[sel.key]} />
              <Stat label="Mensual (12 pagos)" value={fmt(selCalc.mensual12)} />
              <Stat label="Visitas/año" value={`${sel.preventivas} prev · ${sel.emergencias} bomb.`} />
            </div>
          </Section>

          {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid #222', position: 'sticky', bottom: 0, background: '#0d0d0d' }}>
          <button onClick={descargarPropuesta} style={btnGhost}><FileText size={15} /> Propuesta PDF</button>
          <button onClick={crearPoliza} disabled={saving} style={btnPrimary}>
            {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Crear póliza
          </button>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      </div>
    </div>
  )
}

// ── Subcomponentes ──
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#10B981', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  )
}
function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <label style={{ display: 'flex', flexDirection: 'column', fontSize: 11, color: '#888', gap: 4 }}>{t}{children}</label>
}
function Stat({ label, value, color = '#fff' }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '10px 14px', minWidth: 120 }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}
function Row({ label, cells, sel, planes, strong }: { label: string; cells: string[]; sel: string; planes: PlanDef[]; strong?: boolean }) {
  return (
    <tr>
      <td style={tdLeft}>{label}</td>
      {cells.map((c, i) => (
        <td key={i} style={{ ...tdCol, fontWeight: strong ? 700 : 400, color: strong ? '#fff' : '#ccc', background: sel === planes[i].key ? TIER_COLOR[planes[i].key] + '12' : 'transparent' }}>{c}</td>
      ))}
    </tr>
  )
}

// ── Estilos ──
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }
const panel: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #222', borderRadius: 16, width: '100%', maxWidth: 980, marginTop: 20, marginBottom: 40 }
const iconBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #222', borderRadius: 8, padding: 8, cursor: 'pointer', color: '#888' }
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }
const inp: React.CSSProperties = { padding: '10px 12px', background: '#141414', border: '1px solid #222', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }
const thLeft: React.CSSProperties = { textAlign: 'left', padding: '8px 10px' }
const thCol: React.CSSProperties = { textAlign: 'center', padding: '8px 10px', fontWeight: 700, fontSize: 13 }
const tdLeft: React.CSSProperties = { textAlign: 'left', padding: '7px 10px', color: '#888', borderBottom: '1px solid #1a1a1a' }
const tdCol: React.CSSProperties = { textAlign: 'center', padding: '7px 10px', borderBottom: '1px solid #1a1a1a' }
const cellInp: React.CSSProperties = { width: 52, padding: '4px', background: '#0d0d0d', border: '1px solid #2a2a2a', borderRadius: 6, color: '#fff', fontSize: 12, textAlign: 'center', fontFamily: 'inherit' }
const btnGhost: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px', background: 'transparent', border: '1px solid #2a2a2a', borderRadius: 10, color: '#ccc', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }
const btnPrimary: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#10B981', border: 'none', borderRadius: 10, color: '#0a0a0a', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }

// ── Propuesta comercial (PDF en ventana nueva) ──
const TYC = `<b>TÉRMINOS Y CONDICIONES GENERALES DE LA PÓLIZA DE MANTENIMIENTO</b>
<b>1. Vigencia.</b> La presente póliza tiene una vigencia de doce (12) meses a partir de la fecha de contratación, y podrá renovarse previo acuerdo entre las partes. Cualquier modificación en el alcance o nivel de servicio deberá formalizarse por escrito.
<b>2. Alcance del servicio.</b> La póliza cubre los servicios de mantenimiento preventivo y correctivo de los sistemas instalados por OMM Technologies S.A. de C.V. de acuerdo con el plan contratado (Bronce, Plata, Oro o Platino). Incluye inspección, calibración, limpieza, respaldo de configuraciones, pruebas funcionales, asesoría técnica y atención a reportes de falla conforme al nivel de servicio establecido.
<b>3. Garantías y responsabilidad sobre equipos.</b> OMM Technologies no otorga garantía sobre ningún equipo, dispositivo o componente electrónico, ya que la garantía es exclusiva del fabricante o proveedor. En caso de equipos en garantía, OMM coordina traslado y gestión con el proveedor, sin costo de mano de obra dentro de la cobertura, pero sin incluir transporte, paquetería, viáticos ni refacciones que el fabricante no cubra. Equipos fuera de garantía o intervenidos por terceros: el costo del servicio y refacciones corren por cuenta del cliente.
<b>4. Refacciones y materiales.</b> La póliza no incluye refacciones, materiales ni equipos de reemplazo. Cualquier componente que deba sustituirse será cotizado por separado y requerirá autorización previa del cliente.
<b>5. Atención a fallas y tiempos de respuesta.</b> Se rigen por el nivel de servicio (SLA) contratado. Atención remota según nivel (Bronce 48 h, Plata 36 h, Oro 24 h, Platino 12 h). Atención on-site conforme a condiciones acordadas y disponibilidad de acceso.
<b>6. Condiciones del sitio y acceso.</b> El cliente deberá garantizar acceso oportuno y seguro, energía eléctrica estable y avisar de modificaciones de infraestructura. Los retrasos por falta de acceso no son incumplimiento de OMM.
<b>7. Viáticos y traslados.</b> Los servicios dentro del área metropolitana están incluidos. Para sitios foráneos aplican viáticos y traslados adicionales según la póliza.
<b>8. Pagos y servicios adicionales.</b> El costo podrá pagarse mensual, trimestral o anualmente. Cualquier servicio no contemplado se cotiza por separado.
<b>9. Terminación anticipada.</b> Por incumplimiento de pago, incumplimiento reiterado, o por mutuo acuerdo con aviso escrito de al menos 30 días naturales.
<b>10. Limitación de responsabilidad.</b> OMM ejecuta con personal calificado conforme a normas vigentes (NOM, NEC, NFPA). No garantiza funcionamiento ininterrumpido (depende de red eléctrica, datos, uso, terceros). La responsabilidad máxima de OMM no excederá el monto total pagado por la póliza en curso.`

function buildProposalHtml(d: any): string {
  const { property, planes, calc, sel, selCalc, paymentPlan, valorNum, foranea, factores } = d
  const fmtL = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')
  const pctL = (n: number) => (n * 100).toFixed(2) + '%'
  const hoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })
  const planCols = planes.map((p: PlanDef) => `<th>${p.label}</th>`).join('')
  const rowF = (label: string, vals: string[]) => `<tr><td class="l">${label}</td>${vals.map(v => `<td>${v}</td>`).join('')}</tr>`
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Póliza de Mantenimiento — ${property?.name || ''}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:32px;font-size:12px}
    h1{font-size:18px;text-align:center;letter-spacing:1px;border-bottom:3px solid #10B981;padding-bottom:10px}
    .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin:16px 0;font-size:12px}
    .meta b{color:#555}
    table{width:100%;border-collapse:collapse;margin:14px 0}
    th,td{border:1px solid #ccc;padding:6px 8px;text-align:center}
    th{background:#10B981;color:#fff} td.l{text-align:left;background:#f5f5f5;font-weight:600}
    .sel{background:#eafff4}
    .totals{margin-top:16px;width:60%;margin-left:auto}
    .totals td{text-align:right} .totals td.k{text-align:left;font-weight:600;background:#f5f5f5}
    .tyc{font-size:9.5px;line-height:1.5;white-space:pre-line;margin-top:18px;border-top:1px solid #ccc;padding-top:12px;color:#333}
    .sign{display:flex;justify-content:space-around;margin-top:48px;text-align:center}
    .sign div{border-top:1px solid #333;padding-top:6px;width:40%;font-size:11px}
    @media print{button{display:none}}
  </style></head><body>
  <button onclick="window.print()" style="float:right;padding:8px 14px;background:#10B981;color:#fff;border:none;border-radius:6px;cursor:pointer">Imprimir / PDF</button>
  <h1>PÓLIZA DE MANTENIMIENTO ANUAL</h1>
  <div class="meta">
    <div><b>PROYECTO:</b> ${property?.name || '—'}</div><div><b>FECHA:</b> ${hoy}</div>
    <div><b>CLIENTE:</b> ${property?.client_name || '—'}</div><div><b>DIRECCIÓN:</b> ${property?.address || '—'}${property?.city ? ', ' + property.city : ''}</div>
    <div><b>VALOR DEL PROYECTO:</b> ${fmtL(valorNum)}</div><div><b>UBICACIÓN FORÁNEA:</b> ${foranea ? 'Sí' : 'No'}</div>
    <div><b>TIPO DE OBRA:</b> ${factores.fTipo}</div><div><b>SISTEMAS:</b> ${factores.fSistemas}</div>
    <div><b>ANTIGÜEDAD:</b> ${factores.fAntiguedad}</div><div><b>VENDEDOR:</b> Elias Gabriel Micha Cohen</div>
  </div>
  <table>
    <thead><tr><th class="l">RESUMEN DE PLANES</th>${planCols}</tr></thead>
    <tbody>
      ${rowF('Visitas preventivas/año', planes.map((p: PlanDef) => String(p.preventivas)))}
      ${rowF('Bomberazos incluidos/año', planes.map((p: PlanDef) => String(p.emergencias)))}
      ${rowF('Soporte remoto', planes.map((p: PlanDef) => p.soporte))}
      ${rowF('Arribo on-site máx.', planes.map((p: PlanDef) => p.arribo))}
      ${rowF('Backups / programación', planes.map((p: PlanDef) => p.backups))}
      ${rowF('Reportes técnicos', planes.map((p: PlanDef) => p.reportes))}
      ${rowF('Cobertura horaria', planes.map((p: PlanDef) => p.cobertura))}
      ${rowF('% final ajustado', planes.map((p: PlanDef) => pctL(calc(p).finalPct)))}
      ${rowF('Costo anual (s/IVA)', planes.map((p: PlanDef) => fmtL(calc(p).totalAnual)))}
      ${rowF('Costo mensual', planes.map((p: PlanDef) => fmtL(calc(p).monthly)))}
    </tbody>
  </table>
  <table class="totals">
    <tr><td class="k">PLAN SELECCIONADO</td><td>${sel.label}</td></tr>
    <tr><td class="k">PLAN DE PAGO</td><td>${paymentPlan}</td></tr>
    <tr><td class="k">COSTO ANUAL (s/IVA)</td><td>${fmtL(selCalc.totalAnual)}</td></tr>
    <tr><td class="k">IVA (16%)</td><td>${fmtL(selCalc.iva)}</td></tr>
    <tr><td class="k">TOTAL CON IVA</td><td><b>${fmtL(selCalc.totalConIva)}</b></td></tr>
    <tr><td class="k">PLAN MENSUAL (12 pagos)</td><td>${fmtL(selCalc.mensual12)}</td></tr>
  </table>
  <div class="tyc">${TYC}</div>
  <div class="sign"><div>Cliente</div><div>Elias Gabriel Micha Cohen<br/>OMM Technologies S.A. de C.V.</div></div>
  </body></html>`
}
