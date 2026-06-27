import { useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { X, FileText, Check, Loader2, Plus } from 'lucide-react'
import { OMNIIOUS_LOGO } from '../assets/logo'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

// Datos OMM compartidos con el PDF oficial de cotizaciones (localStorage 'omm_pdf_header')
const OMM_PDF_DEFAULTS = {
  razonSocial: 'OMM Technologies SA de CV', rfc: '[RFC PENDIENTE]', domicilio: '[Dirección fiscal pendiente]',
  codigoPostal: '[CP]', ciudad: 'Ciudad de México, México', telefono: '[Teléfono pendiente]',
  email: '[email pendiente]', web: 'www.ommtechnologies.mx',
}
function readOmmHeader() {
  try { const s = localStorage.getItem('omm_pdf_header'); return s ? { ...OMM_PDF_DEFAULTS, ...JSON.parse(s) } : OMM_PDF_DEFAULTS } catch { return OMM_PDF_DEFAULTS }
}
const POLIZA_BANCOS_MXN = [
  { banco: 'BBVA', cuenta: '0118270236', clabe: '' },
  { banco: 'Banorte', cuenta: '1263311182', clabe: '' },
]
function escP(s: any): string { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

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

export default function GeneradorPoliza({ properties, onClose, onCreated, editContract }: {
  properties: PropOpt[]; onClose: () => void; onCreated: () => void; editContract?: any
}) {
  // Si estamos editando, precargamos desde el snapshot de precios guardado (o de los campos del contrato)
  const snap: any = (() => {
    const s = editContract?.pricing_snapshot
    if (!s) return null
    try { return typeof s === 'string' ? JSON.parse(s) : s } catch { return null }
  })()
  const isEdit = !!editContract

  // Inputs del proyecto
  const [propertyId, setPropertyId] = useState(editContract?.property_id || '')
  const [valor, setValor] = useState(String(snap?.project_value ?? editContract?.project_value ?? '800000'))
  const [foranea, setForanea] = useState(!!snap?.foranea)
  const [tecnicos, setTecnicos] = useState(String(snap?.tecnicos ?? '2'))
  const [dias, setDias] = useState(String(snap?.dias_sitio ?? '4'))
  const [viaticoDia, setViaticoDia] = useState(String(snap?.viatico_dia ?? '1200'))
  const [traslado, setTraslado] = useState(String(snap?.traslado ?? '10000'))
  const [visitaSuelta, setVisitaSuelta] = useState(String(snap?.costo_visita_suelta ?? '3000'))
  // Factores
  const [fTipo, setFTipo] = useState(snap?.factores?.tipo ?? TIPO_PROYECTO[0].label)
  const [fSistemas, setFSistemas] = useState(snap?.factores?.sistemas ?? SISTEMAS[2].label)
  const [fAntiguedad, setFAntiguedad] = useState(snap?.factores?.antiguedad ?? ANTIGUEDAD[1].label)
  const [fVolumen, setFVolumen] = useState(snap?.factores?.volumen ?? VOLUMEN[0].label)
  const [fOtros, setFOtros] = useState(String(snap?.factores?.otros_pct != null ? Math.round(snap.factores.otros_pct * 1000) / 10 : '0'))
  // Planes editables (preventivas/emergencias por plan) — al editar, sobreescribe el plan elegido con lo guardado
  const [planes, setPlanes] = useState<PlanDef[]>(() => {
    // Si hay config completa guardada de los 4 planes, restáurala
    if (Array.isArray(snap?.planes_custom) && snap.planes_custom.length) {
      return PLANES_BASE.map(p => {
        const c = snap.planes_custom.find((x: any) => x.key === p.key)
        return c ? { ...p, preventivas: c.preventivas ?? p.preventivas, emergencias: c.emergencias ?? p.emergencias, basePct: c.base_pct ?? p.basePct } : p
      })
    }
    // Compatibilidad: pólizas viejas solo guardaron el plan seleccionado
    const tier = snap?.plan?.tier || editContract?.plan_tier
    if (!tier) return PLANES_BASE
    return PLANES_BASE.map(p => p.key === tier ? {
      ...p,
      preventivas: snap?.plan?.preventivas ?? editContract?.preventive_visits_included ?? p.preventivas,
      emergencias: snap?.plan?.emergencias ?? editContract?.emergency_visits_included ?? p.emergencias,
      basePct: snap?.plan?.base_pct ?? p.basePct,
    } : p)
  })
  // Selección
  const [selected, setSelected] = useState(snap?.plan?.tier ?? editContract?.plan_tier ?? 'oro')
  const [paymentPlan, setPaymentPlan] = useState(snap?.payment_plan ?? editContract?.payment_plan ?? 'Anual')
  const [extras, setExtras] = useState<{ id: string; desc: string; qty: string; precio: string }[]>(
    (snap?.plan?.extras || []).map((e: any) => ({ id: Math.random().toString(36).slice(2), desc: e.desc || '', qty: String(e.qty ?? 1), precio: String(e.precio ?? 0) }))
  )
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

  // Extras (productos / servicios adicionales) — suman al total de la póliza
  const extrasTotal = extras.reduce((s, e) => s + (parseFloat(e.qty) || 0) * (parseFloat(e.precio) || 0), 0)
  const finalAnualSinIva = selCalc.totalAnual + extrasTotal
  const finalIva = finalAnualSinIva * 0.16
  const finalTotalConIva = finalAnualSinIva + finalIva
  const finalMensual12 = finalTotalConIva / 12
  const addExtra = () => setExtras(x => [...x, { id: Math.random().toString(36).slice(2), desc: '', qty: '1', precio: '' }])
  const updateExtra = (id: string, f: 'desc' | 'qty' | 'precio', v: string) => setExtras(x => x.map(e => e.id === id ? { ...e, [f]: v } : e))
  const removeExtra = (id: string) => setExtras(x => x.filter(e => e.id !== id))
  const extrasClean = () => extras.filter(e => e.desc.trim() || (parseFloat(e.precio) || 0) > 0)
    .map(e => ({ desc: e.desc.trim(), qty: parseFloat(e.qty) || 0, precio: parseFloat(e.precio) || 0, subtotal: (parseFloat(e.qty) || 0) * (parseFloat(e.precio) || 0) }))

  function updatePlan(key: string, field: 'preventivas' | 'emergencias' | 'basePct', value: number) {
    setPlanes(ps => ps.map(p => p.key === key ? { ...p, [field]: value } : p))
  }

  function buildSnapshot() {
    return {
      project_value: valorNum, foranea, tecnicos: parseFloat(tecnicos) || 0, dias_sitio: parseFloat(dias) || 0,
      viatico_dia: parseFloat(viaticoDia) || 0, traslado: parseFloat(traslado) || 0,
      costo_visita_suelta: parseFloat(visitaSuelta) || 0,
      factores: { tipo: fTipo, sistemas: fSistemas, antiguedad: fAntiguedad, volumen: fVolumen, otros_pct: (parseFloat(fOtros) || 0) / 100, adj_pct: adjPct },
      // Config completa de los 4 planes (preventivas/emergencias/base_pct) para que al editar permanezcan
      planes_custom: planes.map(p => ({ key: p.key, preventivas: p.preventivas, emergencias: p.emergencias, base_pct: p.basePct })),
      plan: { tier: sel.key, base_pct: sel.basePct, final_pct: selCalc.finalPct, annual: selCalc.annual, monthly: selCalc.monthly,
        preventivas: sel.preventivas, emergencias: sel.emergencias, viaticos_por_visita: viaticoPorVisita,
        viaticos_anual: selCalc.viaticosAnual, poliza_anual: selCalc.totalAnual,
        extras: extrasClean(), extras_total: extrasTotal,
        total_anual: finalAnualSinIva, iva: finalIva, total_con_iva: finalTotalConIva, mensual_12: finalMensual12 },
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
    const baseNotes = `${isEdit ? 'Editada' : 'Generada'} con calculadora de pólizas. Ajustes ${pct(adjPct)}.` + (extrasTotal > 0 ? ` Extras: ${fmt(extrasTotal)} (${extrasClean().map(e => `${e.qty}× ${e.desc}`).join('; ')}).` : '')
    // Campos editables (no toca fechas ni visitas usadas al editar)
    const fields: any = {
      property_id: propertyId,
      name: `Póliza ${sel.label} — ${selProp?.name || ''}`.trim(),
      contract_type: 'poliza',
      monthly_fee: finalAnualSinIva / 12,
      annual_fee: finalAnualSinIva,
      currency: 'MXN',
      plan_tier: sel.key,
      preventive_visits_included: sel.preventivas,
      emergency_visits_included: sel.emergencias,
      visits_included: sel.preventivas + sel.emergencias,
      project_value: valorNum,
      payment_plan: paymentPlan,
      pricing_snapshot: buildSnapshot(),
      service_levels: buildServiceLevels(sel),
      notes: baseNotes,
    }
    let err
    if (isEdit) {
      ({ error: err } = await supabase.from('maintenance_contracts').update(fields).eq('id', editContract.id))
    } else {
      const today = new Date()
      const end = new Date(today); end.setFullYear(end.getFullYear() + 1)
      ;({ error: err } = await supabase.from('maintenance_contracts').insert({
        ...fields,
        start_date: today.toISOString().slice(0, 10),
        end_date: end.toISOString().slice(0, 10),
        preventive_visits_used: 0,
        emergency_visits_used: 0,
        visits_used: 0,
        is_active: true,
      }))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  const [pdfBusy, setPdfBusy] = useState(false)
  async function descargarPropuesta() {
    if (pdfBusy) return
    setPdfBusy(true)
    const html = buildProposalHtml({
      property: selProp, planes, calc, sel, selCalc, paymentPlan, valorNum,
      foranea, viaticoPorVisita, visitaSuelta: parseFloat(visitaSuelta) || 0, adjPct,
      tecnicos: parseFloat(tecnicos) || 0, dias: parseFloat(dias) || 0,
      diasTotales: (parseFloat(dias) || 0) * (sel.preventivas + sel.emergencias),
      factores: { fTipo, fSistemas, fAntiguedad, fVolumen },
      extras: extrasClean(), extrasTotal, finalAnualSinIva, finalIva, finalTotalConIva, finalMensual12,
    })
    const fileBase = `Poliza_${(selProp?.name || 'propuesta').replace(/\s+/g, '_')}`
    // Renderiza el HTML dentro del documento (oculto, con estilos aislados a #pzpdf-host)
    // y exporta un PDF REAL cortando por páginas. Más confiable que iframe/window.open.
    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const styleText = Array.from(parsed.querySelectorAll('style')).map(s => s.textContent || '').join('\n')
    const scopeCss = (css: string, scope: string) => css
      .replace(/@page[^}]*\}/g, '')
      .replace(/([^{}]+)\{/g, (_m, sel) => sel.split(',').map((s: string) => {
        s = s.trim(); if (!s) return s
        if (s === 'body' || s === 'html') return scope
        if (s === '*') return scope + ' *'
        return scope + ' ' + s
      }).join(', ') + ' {')
    const host = document.createElement('div')
    host.id = 'pzpdf-host'
    host.style.cssText = 'position:fixed;left:0;top:0;width:900px;background:#fff;z-index:-9999;opacity:0;pointer-events:none;overflow:visible'
    const styleEl = document.createElement('style')
    styleEl.textContent = scopeCss(styleText, '#pzpdf-host')
    const content = document.createElement('div')
    content.innerHTML = parsed.body.innerHTML
    host.appendChild(styleEl); host.appendChild(content)
    document.body.appendChild(host)
    try {
      await new Promise(res => setTimeout(res, 350))
      try { await (document as any).fonts?.ready } catch {}
      const full = await html2canvas(host, { scale: 2, backgroundColor: '#ffffff', useCORS: true, width: 900, windowWidth: 900 })
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const pageWmm = 210, pageHmm = 297
      const pxPerMm = full.width / pageWmm
      const pageHpx = Math.floor(pageHmm * pxPerMm)
      // Datos de píxeles para encontrar franjas en blanco y NO cortar contenido a la mitad
      const fctx = full.getContext('2d')!
      let pixels: Uint8ClampedArray | null = null
      try { pixels = fctx.getImageData(0, 0, full.width, full.height).data } catch { pixels = null }
      const rowBlank = (row: number) => {
        if (!pixels) return false
        for (let x = 0; x < full.width; x += 4) {
          const i = (row * full.width + x) * 4
          if (pixels[i] < 248 || pixels[i + 1] < 248 || pixels[i + 2] < 248) return false
        }
        return true
      }
      let y = 0, page = 0
      while (y < full.height) {
        let cut = Math.min(y + pageHpx, full.height)
        if (cut < full.height) {
          // busca una línea en blanco hacia arriba (hasta 38% de la página) para cortar en un hueco
          const limit = y + Math.floor(pageHpx * 0.62)
          let c = cut
          while (c > limit && !rowBlank(c)) c--
          if (c > limit) cut = c
        }
        const sliceH = cut - y
        const pc = document.createElement('canvas')
        pc.width = full.width; pc.height = sliceH
        const ctx = pc.getContext('2d')!
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pc.width, sliceH)
        ctx.drawImage(full, 0, y, full.width, sliceH, 0, 0, full.width, sliceH)
        if (page > 0) pdf.addPage()
        pdf.addImage(pc.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageWmm, sliceH / pxPerMm)
        y = cut; page++
      }
      pdf.save(`${fileBase}.pdf`)
    } catch (e) {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const w = window.open(url, '_blank')
      if (!w) { const a = document.createElement('a'); a.href = url; a.download = `${fileBase}.html`; document.body.appendChild(a); a.click(); a.remove() }
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } finally {
      document.body.removeChild(host)
      setPdfBusy(false)
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #222', position: 'sticky', top: 0, background: '#0d0d0d', zIndex: 2 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{isEdit ? 'Editar póliza' : 'Generador de pólizas'}</div>
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
                  <Row label="Cuota anual base (s/viáticos)" cells={planes.map(p => fmt(calc(p).annual))} sel={selected} planes={planes} />
                  <Row label="Costo anual (s/IVA)" cells={planes.map(p => fmt(calc(p).totalAnual))} sel={selected} planes={planes} strong />
                  <Row label="Costo mensual" cells={planes.map(p => fmt(calc(p).totalAnual / 12))} sel={selected} planes={planes} />
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
                </tbody>
              </table>
            </div>
          </Section>

          {/* Extras */}
          <Section title="Extras (productos / servicios adicionales)">
            {extras.length === 0 && (
              <div style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>
                Sin extras. Agrega productos, equipo o servicios que sumen al total de la póliza (ej. UPS, refacciones, visita adicional).
              </div>
            )}
            {extras.map(e => (
              <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 120px 110px 30px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <input value={e.desc} onChange={ev => updateExtra(e.id, 'desc', ev.target.value)} placeholder="Concepto (ej. UPS 1kVA / refacción / visita extra)" style={inp} />
                <input value={e.qty} onChange={ev => updateExtra(e.id, 'qty', ev.target.value)} type="number" placeholder="Cant." style={inp} />
                <input value={e.precio} onChange={ev => updateExtra(e.id, 'precio', ev.target.value)} type="number" placeholder="Precio unit." style={inp} />
                <div style={{ fontSize: 12, color: '#10B981', textAlign: 'right', fontWeight: 600 }}>{fmt((parseFloat(e.qty) || 0) * (parseFloat(e.precio) || 0))}</div>
                <button onClick={() => removeExtra(e.id)} style={iconBtn} title="Quitar extra"><X size={14} /></button>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <button onClick={addExtra} style={btnGhost}><Plus size={14} /> Agregar extra</button>
              {extrasTotal > 0 && <div style={{ fontSize: 12, color: '#ccc' }}>Subtotal extras: <b style={{ color: '#10B981' }}>{fmt(extrasTotal)}</b></div>}
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
              {extrasTotal > 0 && <Stat label="Póliza (s/extras)" value={fmt(selCalc.totalAnual)} />}
              {extrasTotal > 0 && <Stat label="Extras" value={fmt(extrasTotal)} />}
              <Stat label="Costo anual" value={fmt(finalAnualSinIva)} />
              <Stat label="IVA 16%" value={fmt(finalIva)} />
              <Stat label="Total con IVA" value={fmt(finalTotalConIva)} color={TIER_COLOR[sel.key]} />
              <Stat label="Mensual (12 pagos)" value={fmt(finalMensual12)} />
              <Stat label="Visitas/año" value={`${sel.preventivas} prev · ${sel.emergencias} bomb.`} />
            </div>
          </Section>

          {error && <div style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 20px', borderTop: '1px solid #222', position: 'sticky', bottom: 0, background: '#0d0d0d' }}>
          <button onClick={descargarPropuesta} disabled={pdfBusy} style={btnGhost}>{pdfBusy ? <Loader2 size={15} className="spin" /> : <FileText size={15} />} {pdfBusy ? 'Generando…' : 'Propuesta PDF'}</button>
          <button onClick={crearPoliza} disabled={saving} style={btnPrimary}>
            {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />} {isEdit ? 'Guardar cambios' : 'Crear póliza'}
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

<b>1. Vigencia</b>
La presente póliza tiene una vigencia de doce (12) meses a partir de la fecha de contratación, y podrá renovarse previo acuerdo entre las partes. Cualquier modificación en el alcance o nivel de servicio deberá formalizarse por escrito.

<b>2. Alcance del servicio</b>
La póliza cubre los servicios de mantenimiento preventivo y correctivo de los sistemas instalados por OMM Technologies S.A. de C.V. de acuerdo con el plan contratado (Bronce, Plata, Oro o Platino).
Estos servicios incluyen inspección, calibración, limpieza, respaldo de configuraciones, pruebas funcionales, asesoría técnica y atención a reportes de falla conforme al nivel de servicio establecido.

<b>3. Garantías y responsabilidad sobre equipos</b>
<b>3.1 Limitación de garantía de equipos</b>
OMM Technologies no otorga garantía sobre ningún equipo, dispositivo o componente electrónico, ya que la garantía es exclusiva del fabricante o proveedor.
La empresa no se compromete ni se hace responsable por fallas, defectos de fabricación, obsolescencia o pérdida de funcionamiento de los equipos más allá del periodo de garantía ofrecido por el fabricante.
<b>3.2 Gestión de garantías</b>
En caso de que un equipo se encuentre dentro del periodo de garantía del fabricante, OMM Technologies se compromete a:
• Coordinar el traslado, entrega y gestión del equipo con el proveedor o centro de servicio autorizado.
• Dar seguimiento al proceso de diagnóstico y reparación o reemplazo.
• Notificar al cliente del resultado del diagnóstico y del tiempo estimado de resolución informado por el fabricante.
Este proceso no tiene costo adicional de mano de obra dentro de la cobertura de la póliza, pero no incluye los costos de transporte, empaques, paquetería, viáticos ni refacciones que el fabricante no cubra.
<b>3.3 Equipos fuera de garantía</b>
Cuando un equipo esté fuera de garantía, presente daños físicos, o haya sido instalado por terceros, OMM podrá ofrecer asistencia técnica para su revisión y diagnóstico, pero el costo del servicio y las refacciones correrán por cuenta del cliente.
OMM no se hace responsable de fallas internas de componentes electrónicos, fluctuaciones eléctricas, o mal uso por parte de usuarios o terceros.
<b>3.4 Exclusión de responsabilidad</b>
OMM Technologies no será responsable por:
• Desgaste natural de piezas o componentes.
• Daños ocasionados por descargas eléctricas, picos de voltaje, fallas de suministro de CFE o UPS.
• Daños por humedad, polvo, manipulación indebida o condiciones ambientales inadecuadas.
• Intervenciones o modificaciones realizadas por personal ajeno a OMM.
• Fallas en software, firmware o licencias caducadas que dependan de terceros.
• Daños indirectos, pérdida de datos, lucro cesante o interrupción de actividades derivadas de fallas o retrasos.

<b>4. Refacciones y materiales</b>
La póliza no incluye refacciones, materiales ni equipos de reemplazo.
Cualquier componente que deba sustituirse será cotizado por separado y requerirá autorización previa del cliente.
OMM puede ofrecer, de forma opcional, servicio de "gestión de refacciones" o "stock crítico en consignación" bajo un acuerdo adicional, con costos definidos según disponibilidad y tipo de equipo.

<b>5. Atención a fallas y tiempos de respuesta</b>
Los tiempos de atención y servicio se regirán por el nivel de servicio (SLA) contratado.
Atención remota: según nivel (Bronce 48 h, Plata 36 h, Oro 24 h, Platino 12 h).
Atención on-site: conforme a las condiciones acordadas y a la disponibilidad de acceso al sitio.
Los tiempos de diagnóstico o reparación de equipos en garantía dependen del fabricante, y no pueden ser comprometidos por OMM.

<b>6. Condiciones del sitio y acceso</b>
El cliente deberá:
• Garantizar el acceso oportuno y seguro a las instalaciones en las fechas acordadas.
• Contar con energía eléctrica estable y condiciones adecuadas para el trabajo técnico.
• Avisar de cualquier modificación de infraestructura que pudiera afectar los sistemas.
Los retrasos causados por falta de acceso, permisos o condiciones no aptas no se considerarán incumplimiento por parte de OMM.

<b>7. Viáticos y traslados</b>
Los servicios dentro del área metropolitana están incluidos. Para sitios foráneos, se aplicarán viáticos y gastos de traslado adicionales, de acuerdo con los valores definidos en la póliza. El cliente podrá autorizar por escrito cada desplazamiento o visita extraordinaria.

<b>8. Pagos y servicios adicionales</b>
El costo de la póliza será el indicado en la propuesta comercial, y podrá pagarse mensualmente, trimestralmente o anualmente.
Cualquier servicio no contemplado en la póliza será cotizado por separado.
Los pagos deberán realizarse conforme a las condiciones establecidas en la factura correspondiente.

<b>9. Terminación anticipada</b>
La póliza podrá darse por terminada:
• Por incumplimiento de pago del cliente.
• Por incumplimiento reiterado de las obligaciones de cualquiera de las partes.
• Por mutuo acuerdo, con aviso escrito de al menos 30 días naturales.

<b>10. Limitación de responsabilidad</b>
OMM Technologies se compromete a ejecutar los trabajos con personal calificado y conforme a normas técnicas vigentes (NOM, NEC, NFPA u otras aplicables).
Sin embargo, la empresa no garantiza la continuidad o funcionamiento ininterrumpido de los sistemas electrónicos, ya que esto depende de múltiples factores externos (red eléctrica, red de datos, uso diario, otros proveedores, etc.).
La responsabilidad máxima de OMM por cualquier reclamación derivada de esta póliza no excederá el monto total pagado por la póliza en curso.`

function buildProposalHtml(d: any): string {
  const { property, planes, calc, sel, selCalc, paymentPlan, valorNum, foranea, factores } = d
  const omm = readOmmHeader()
  const fmtL = (n: number) => '$' + Math.round(n).toLocaleString('es-MX')
  const pctL = (n: number) => (n * 100).toFixed(2) + '%'
  const hoy = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
  const vig = new Date(Date.now() + 365 * 864e5).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
  const planCols = planes.map((p: PlanDef) => `<th style="text-align:right">${escP(p.label)}</th>`).join('')
  const rowF = (label: string, vals: string[]) => `<tr><td class="l">${label}</td>${vals.map((v, i) => `<td style="text-align:right${planes[i].key === sel.key ? ';background:#f3faf6;font-weight:600' : ''}">${v}</td>`).join('')}</tr>`
  const bancoRows = POLIZA_BANCOS_MXN.map(b => `<tr><td style="padding:4px 6px;border-bottom:1px solid #eee">${escP(b.banco)}</td><td style="padding:4px 6px;border-bottom:1px solid #eee">${escP(b.cuenta)}</td><td style="padding:4px 6px;border-bottom:1px solid #eee">${b.clabe ? escP(b.clabe) : '—'}</td></tr>`).join('')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Póliza de Mantenimiento — ${escP(property?.name || '')}</title>
  <style>
    @page { size: A4; margin: 14mm 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; color: #111; margin: 0 auto; padding: 28px 40px; max-width: 860px; font-size: 11px; line-height: 1.5; }
    .hdr { border-bottom: 2px solid #111; padding-bottom: 16px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
    .hdr img { height: 64px; width: auto; object-fit: contain; }
    .omm { text-align: right; font-size: 9px; color: #555; line-height: 1.6; }
    .omm b { color: #111; font-size: 11px; }
    .eyebrow { font-size: 9px; color: #999; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
    h1 { font-size: 18px; margin: 0 0 10px; font-weight: 600; }
    h2 { font-size: 13px; margin: 0 0 8px; font-weight: 600; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
    .data td { padding: 3px 12px 3px 0; font-size: 10px; }
    .data .k { color: #888; width: 130px; }
    .sec { margin-bottom: 18px; }
    .box { font-size: 11px; color: #333; }
    table.cmp { width: 100%; border-collapse: collapse; }
    table.cmp th { background: #f5f5f5; padding: 6px 8px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: #666; font-weight: 600; border-bottom: 1px solid #ddd; }
    table.cmp td { padding: 5px 8px; border-bottom: 1px solid #eee; font-size: 10px; }
    table.cmp td.l { text-align: left; color: #666; }
    .totals { width: 60%; margin-left: auto; margin-top: 6px; }
    .totals td { padding: 4px 8px; font-size: 11px; text-align: right; }
    .totals td.k { text-align: left; color: #888; }
    .totals tr.total td { border-top: 1px solid #111; font-weight: 700; font-size: 13px; color: #111; padding-top: 6px; }
    .tyc { font-size: 9px; line-height: 1.55; white-space: pre-line; color: #444; }
    .sign { display: flex; justify-content: space-around; margin-top: 44px; text-align: center; }
    .sign div { border-top: 1px solid #333; padding-top: 6px; width: 40%; font-size: 10px; color: #444; }
    .foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid #eee; font-size: 9px; color: #999; }
    @media print { button { display: none; } }
  </style></head><body>
  <button onclick="window.print()" style="position:fixed;top:14px;right:14px;padding:8px 14px;background:#10B981;color:#000;border:none;border-radius:6px;cursor:pointer;font-weight:600">Imprimir / PDF</button>

  <div class="hdr">
    <img src="${OMNIIOUS_LOGO}" alt="OMNIIOUS" />
    <div class="omm">
      <b>${escP(omm.razonSocial)}</b>
      <div>RFC: ${escP(omm.rfc)}</div>
      <div>${escP(omm.domicilio)}</div>
      <div>${escP(omm.codigoPostal)} · ${escP(omm.ciudad)}</div>
      <div>${escP(omm.telefono)} · ${escP(omm.email)}</div>
      <div>${escP(omm.web)}</div>
    </div>
  </div>

  <div class="sec">
    <div class="eyebrow">Póliza de mantenimiento anual</div>
    <h1>${escP(property?.name || 'Póliza de Mantenimiento')}</h1>
    <table class="data"><tbody>
      <tr><td class="k">Cliente</td><td style="font-weight:600">${escP(property?.client_name || '—')}</td><td class="k">Fecha</td><td>${hoy}</td></tr>
      <tr><td class="k">Dirección</td><td>${escP(property?.address || '—')}${property?.city ? ', ' + escP(property.city) : ''}</td><td class="k">Vigencia</td><td>12 meses (hasta ${vig})</td></tr>
      <tr><td class="k">Tipo de obra</td><td>${escP(factores.fTipo)}</td><td class="k">Ubicación foránea</td><td>${foranea ? 'Sí' : 'No'}</td></tr>
    </tbody></table>
  </div>

  <div class="sec">
    <h2>Comparativo de planes</h2>
    <table class="cmp">
      <thead><tr><th class="l" style="text-align:left">Concepto</th>${planCols}</tr></thead>
      <tbody>
        ${rowF('Visitas preventivas/año', planes.map((p: PlanDef) => String(p.preventivas)))}
        ${rowF('Bomberazos incluidos/año', planes.map((p: PlanDef) => String(p.emergencias)))}
        ${rowF('Soporte remoto', planes.map((p: PlanDef) => p.soporte))}
        ${rowF('Arribo on-site máx.', planes.map((p: PlanDef) => p.arribo))}
        ${rowF('Reportes técnicos', planes.map((p: PlanDef) => p.reportes))}
        ${rowF('Cobertura horaria', planes.map((p: PlanDef) => p.cobertura))}
        ${rowF('% final ajustado', planes.map((p: PlanDef) => pctL(calc(p).finalPct)))}
        ${rowF('Cuota anual base (s/viáticos)', planes.map((p: PlanDef) => fmtL(calc(p).annual)))}
        ${d.foranea ? rowF('Viáticos anuales est.', planes.map((p: PlanDef) => fmtL(calc(p).viaticosAnual))) : ''}
        ${rowF('Costo anual (s/IVA)', planes.map((p: PlanDef) => fmtL(calc(p).totalAnual)))}
        ${rowF('Costo mensual', planes.map((p: PlanDef) => fmtL(calc(p).totalAnual / 12)))}
      </tbody>
    </table>
  </div>

  ${(d.extras && d.extras.length > 0) ? `
  <div class="sec">
    <h2>Extras (productos / servicios adicionales)</h2>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;font-size:9px;color:#888;text-transform:uppercase;padding:4px 6px;border-bottom:1px solid #ddd">Concepto</th>
        <th style="text-align:right;font-size:9px;color:#888;text-transform:uppercase;padding:4px 6px;border-bottom:1px solid #ddd">Cant.</th>
        <th style="text-align:right;font-size:9px;color:#888;text-transform:uppercase;padding:4px 6px;border-bottom:1px solid #ddd">P. Unit.</th>
        <th style="text-align:right;font-size:9px;color:#888;text-transform:uppercase;padding:4px 6px;border-bottom:1px solid #ddd">Importe</th>
      </tr></thead>
      <tbody>
        ${d.extras.map((e: any) => `<tr><td style="padding:4px 6px;border-bottom:1px solid #f0f0f0">${escP(e.desc)}</td><td style="text-align:right;padding:4px 6px;border-bottom:1px solid #f0f0f0">${e.qty}</td><td style="text-align:right;padding:4px 6px;border-bottom:1px solid #f0f0f0">${fmtL(e.precio)}</td><td style="text-align:right;padding:4px 6px;border-bottom:1px solid #f0f0f0;font-weight:600">${fmtL(e.subtotal)}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <div class="sec">
    <h2>Plan seleccionado: ${escP(sel.label)}</h2>
    <table class="totals"><tbody>
      <tr><td class="k">Plan de pago</td><td>${escP(paymentPlan)}</td></tr>
      <tr><td class="k">Visitas incluidas</td><td>${sel.preventivas} preventivas · ${sel.emergencias} bomberazos / año</td></tr>
      <tr><td class="k">Cuota anual base (s/viáticos)</td><td>${fmtL(selCalc.annual)}</td></tr>
      ${d.foranea ? `<tr><td class="k">Técnicos por visita</td><td>${d.tecnicos}</td></tr><tr><td class="k">Días en sitio por visita</td><td>${d.dias}</td></tr><tr><td class="k">Días totales en sitio / año</td><td>${d.diasTotales}</td></tr><tr><td class="k">Viáticos por visita</td><td>${fmtL(d.viaticoPorVisita || 0)}</td></tr><tr><td class="k">Viáticos anuales est.</td><td>${fmtL(selCalc.viaticosAnual)}</td></tr>` : ''}
      ${(d.extras && d.extras.length > 0) ? `<tr><td class="k">Póliza anual (s/IVA)</td><td>${fmtL(selCalc.totalAnual)}</td></tr><tr><td class="k">Extras (s/IVA)</td><td>${fmtL(d.extrasTotal)}</td></tr>` : ''}
      <tr><td class="k">Costo anual (s/IVA)</td><td>${fmtL(d.finalAnualSinIva ?? selCalc.totalAnual)}</td></tr>
      <tr><td class="k">IVA 16%</td><td>${fmtL(d.finalIva ?? selCalc.iva)}</td></tr>
      <tr class="total"><td class="k">Total con IVA</td><td>${fmtL(d.finalTotalConIva ?? selCalc.totalConIva)}</td></tr>
      <tr><td class="k">Plan mensual (12 pagos)</td><td>${fmtL(d.finalMensual12 ?? selCalc.mensual12)}</td></tr>
    </tbody></table>
  </div>

  <div class="sec"><h2>Datos para pago (MXN)</h2>
    <div class="box">
      <div><b>Titular:</b> OMM Technologies SA de CV &nbsp;·&nbsp; <b>RFC:</b> OTE210910PW5</div>
      <table style="width:100%;border-collapse:collapse;margin-top:6px">
        <thead><tr>
          <th style="text-align:left;font-size:9px;color:#888;text-transform:uppercase;padding:3px 6px;border-bottom:1px solid #ddd">Banco</th>
          <th style="text-align:left;font-size:9px;color:#888;text-transform:uppercase;padding:3px 6px;border-bottom:1px solid #ddd">Cuenta</th>
          <th style="text-align:left;font-size:9px;color:#888;text-transform:uppercase;padding:3px 6px;border-bottom:1px solid #ddd">CLABE</th>
        </tr></thead>
        <tbody>${bancoRows}</tbody>
      </table>
    </div>
  </div>

  <div class="sec"><h2>Términos y condiciones</h2><div class="tyc">${TYC}</div></div>

  <div class="sign"><div>Cliente — Acepto las condiciones del plan</div><div>Elias Gabriel Micha Cohen<br/>OMM Technologies S.A. de C.V.</div></div>
  <div class="foot">${escP(omm.razonSocial)} · Propuesta de póliza de mantenimiento. Precios en MXN. Vigencia 12 meses a partir de la contratación.</div>
  </body></html>`
}
