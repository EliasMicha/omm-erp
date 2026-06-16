import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { OMNIIOUS_LOGO } from '../assets/logo'
import { Download, Loader2, ArrowLeft, FileText, RefreshCw, CheckCircle } from 'lucide-react'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

interface MemoriaData {
  alcance: {
    titulo_proyecto: string
    descripcion_general: string
    cliente: string
    sistemas_incluidos: string[]
    resumen_ejecutivo: string
  }
  fichas_tecnicas: {
    system: string
    system_description: string
    productos: {
      nombre: string
      marca: string
      modelo: string
      descripcion_tecnica: string
      specs: Record<string, string>
      funcion_en_proyecto: string
      cantidad_total: number
      areas: string[]
      imagen_url: string | null
      notas_instalacion: string
    }[]
  }[]
  topologia: {
    system: string
    titulo: string
    descripcion: string
    mermaid_diagram: string
    notas_topologia: string[]
  }[]
  consideraciones: {
    system: string
    titulo: string
    requerimientos_electricos: string
    canalizacion: string
    puntos_datos: string
    montaje: string
    integracion: string
    notas_adicionales: string[]
  }[]
  notas_generales: string[]
  _meta: {
    quotation_id: string
    quotation_name: string
    client_name: string
    architect: string
    specialty: string
    total: number
    currency: string
    generated_at: string
  }
}

// ═══════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' })
  } catch { return iso }
}

const SYSTEM_COLORS: Record<string, string> = {
  'Audio': '#8B5CF6',
  'Redes': '#06B6D4',
  'CCTV': '#2563EB',
  'Control de acceso': '#D97706',
  'Control de Acceso': '#D97706',
  'Control de iluminacion': '#A78BFA',
  'Control de Iluminación': '#A78BFA',
  'Humo': '#DC2626',
  'Detección de Incendio': '#DC2626',
  'BMS': '#10B981',
  'Telefonia': '#F97316',
  'Telefonía': '#F97316',
  'Celular': '#EC4899',
  'Señal Celular': '#EC4899',
  'Lutron': '#7C3AED',
  'Somfy': '#14B8A6',
  'Electrico': '#EAB308',
  'Eléctrico': '#EAB308',
  'Cortinas': '#6366F1',
  'General': '#64748B',
  'Iluminación': '#FBBF24',
}

function sysColor(sys: string): string {
  return SYSTEM_COLORS[sys] || '#64748B'
}

// ═══════════════════════════════════════════════════
// MERMAID RENDERER (uses mermaid CDN)
// ═══════════════════════════════════════════════════

let mermaidLoaded = false
let mermaidLoadPromise: Promise<void> | null = null

function loadMermaid(): Promise<void> {
  if (mermaidLoaded) return Promise.resolve()
  if (mermaidLoadPromise) return mermaidLoadPromise

  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js'
    script.onload = () => {
      ;(window as any).mermaid?.initialize({
        startOnLoad: false,
        theme: 'default',
        flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
        securityLevel: 'loose',
      })
      mermaidLoaded = true
      resolve()
    }
    script.onerror = reject
    document.head.appendChild(script)
  })
  return mermaidLoadPromise
}

function MermaidDiagram({ code, id }: { code: string; id: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function render() {
      try {
        await loadMermaid()
        const mermaid = (window as any).mermaid
        if (!mermaid || cancelled) return
        const { svg: rendered } = await mermaid.render(`mermaid-${id}`, code)
        if (!cancelled) setSvg(rendered)
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Error rendering diagram')
      }
    }
    render()
    return () => { cancelled = true }
  }, [code, id])

  if (error) return (
    <div style={{ padding: 16, background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, fontSize: 11, color: '#991B1B' }}>
      Error en diagrama: {error}
      <pre style={{ fontSize: 9, marginTop: 8, whiteSpace: 'pre-wrap', color: '#666' }}>{code}</pre>
    </div>
  )

  if (!svg) return (
    <div style={{ padding: 20, textAlign: 'center', color: '#999' }}>
      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Renderizando diagrama...
    </div>
  )

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: svg }} style={{ textAlign: 'center', overflow: 'auto' }} />
}

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════

export default function MemoriaTecnica() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const contentRef = useRef<HTMLDivElement>(null)

  const [step, setStep] = useState<'loading' | 'generating' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [memoria, setMemoria] = useState<MemoriaData | null>(null)
  const [generating, setGenerating] = useState(false)
  const [cotName, setCotName] = useState('')
  const [progress, setProgress] = useState('')

  // Load quotation info first
  useEffect(() => {
    if (!id) return
    async function load() {
      const { data } = await supabase.from('quotations').select('name,specialty,stage').eq('id', id).single()
      if (data) setCotName(data.name || 'Cotización')
    }
    load()
  }, [id])

  const generate = useCallback(async () => {
    if (!id) return
    setStep('generating')
    setProgress('Cargando datos de la cotización...')

    try {
      setProgress('Enviando a IA para análisis técnico...')

      const res = await fetch('/api/memoria-tecnica', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quotationId: id }),
      })

      const data = await res.json()

      if (!data.ok) {
        throw new Error(data.error || 'Error generando memoria técnica')
      }

      setProgress('Renderizando documento...')
      setMemoria(data.memoria)
      setStep('ready')
    } catch (err: any) {
      setError(err.message || 'Error desconocido')
      setStep('error')
    }
  }, [id])

  // Auto-generate on mount
  useEffect(() => {
    if (step === 'loading') {
      // Small delay so the UI renders first
      const t = setTimeout(() => generate(), 500)
      return () => clearTimeout(t)
    }
  }, [step, generate])

  async function exportPdf() {
    if (!contentRef.current || !memoria) return
    setGenerating(true)

    try {
      const noPrintEls = contentRef.current.querySelectorAll('.no-print') as NodeListOf<HTMLElement>
      noPrintEls.forEach(el => el.style.display = 'none')

      const canvas = await html2canvas(contentRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: 860,
      })

      noPrintEls.forEach(el => el.style.display = '')

      const pageW = 210
      const pageH = 297
      const contentW = pageW
      const imgW = canvas.width
      const imgH = canvas.height
      const ratio = contentW / imgW
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

      let yOffset = 0
      let page = 0
      const pageHeightPx = pageH / ratio

      while (yOffset < imgH) {
        if (page > 0) doc.addPage()
        const sliceH = Math.min(pageHeightPx, imgH - yOffset)
        const pageCanvas = document.createElement('canvas')
        pageCanvas.width = imgW
        pageCanvas.height = sliceH
        const ctx = pageCanvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, imgW, sliceH)
        ctx.drawImage(canvas, 0, yOffset, imgW, sliceH, 0, 0, imgW, sliceH)
        const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.95)
        const sliceHmm = sliceH * ratio
        doc.addImage(pageImgData, 'JPEG', 0, 0, contentW, sliceHmm)
        yOffset += sliceH
        page++
      }

      const fileName = `Memoria_Tecnica_${(memoria._meta.quotation_name || 'Doc').replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ .-]/g, '')}.pdf`
      doc.save(fileName)
    } catch (err: any) {
      alert('Error generando PDF: ' + err.message)
    } finally {
      setGenerating(false)
    }
  }

  // ── Render states ──────────────────────────────────────
  if (step === 'loading' || step === 'generating') return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#ddd' }}>
        <div style={{ marginBottom: 20 }}>
          <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', color: '#10B981' }} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Generando Memoria Técnica</div>
        <div style={{ fontSize: 12, color: '#888' }}>{progress}</div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 16 }}>
          {cotName && <span>{cotName}</span>}
        </div>
        <div style={{ fontSize: 10, color: '#444', marginTop: 8 }}>
          Este proceso puede tomar 30-60 segundos...
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  )

  if (step === 'error') return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, sans-serif' }}>
      <div style={{ textAlign: 'center', color: '#ddd', maxWidth: 500, padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#DC2626', marginBottom: 12 }}>Error</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 20 }}>{error}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button onClick={() => { setStep('loading'); setError('') }} style={{ padding: '10px 20px', background: '#10B981', color: '#000', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} /> Reintentar
          </button>
          <button onClick={() => window.close()} style={{ padding: '10px 20px', background: '#222', color: '#888', border: '1px solid #333', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )

  if (!memoria) return null

  const m = memoria
  const meta = m._meta

  // ── Styles ──────────────────────────────────────────
  const pageStyle: React.CSSProperties = {
    background: '#fff', color: '#111',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: '32px 48px',
    maxWidth: 860, margin: '0 auto',
    fontSize: 11, lineHeight: 1.6,
  }

  const sectionTitle: React.CSSProperties = {
    fontSize: 15, fontWeight: 700, color: '#111',
    marginBottom: 12, paddingBottom: 6,
    borderBottom: '2px solid #111',
    marginTop: 28,
  }

  const subSectionTitle: React.CSSProperties = {
    fontSize: 12, fontWeight: 600, color: '#333',
    marginBottom: 8, marginTop: 16,
  }

  return (
    <div id="memoria-root">
      <style>{`
        @page { size: A4; margin: 15mm 12mm; }
        #memoria-root { min-height: 100vh; background: #eee; }
        @media print {
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          #memoria-root { min-height: auto !important; background: none !important; }
        }
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>

      {/* ── Top bar ── */}
      <div className="no-print" style={{
        position: 'sticky', top: 0, zIndex: 100, background: '#141414', borderBottom: '1px solid #333',
        padding: '12px 20px', display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle size={16} color="#10B981" />
          <span style={{ color: '#888', fontSize: 12, fontFamily: 'Inter, sans-serif' }}>
            Memoria Técnica · {meta.quotation_name}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { setStep('loading'); setMemoria(null); setError('') }} style={{
            padding: '8px 14px', background: '#1e1e1e', border: '1px solid #333', color: '#ccc',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}><RefreshCw size={14} /> Regenerar</button>
          <button onClick={exportPdf} disabled={generating} style={{
            padding: '8px 16px', background: generating ? '#888' : '#10B981', border: 'none', color: '#000',
            borderRadius: 8, cursor: generating ? 'wait' : 'pointer', fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 600,
            display: 'inline-flex', alignItems: 'center', gap: 6, opacity: generating ? 0.7 : 1,
          }}>{generating ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generando...</> : <><Download size={14} /> Descargar PDF</>}</button>
        </div>
      </div>

      {/* ═══════════ DOCUMENT ═══════════ */}
      <div ref={contentRef} style={pageStyle}>

        {/* COVER / HEADER */}
        <div style={{ borderBottom: '2px solid #111', paddingBottom: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <img src={OMNIIOUS_LOGO} alt="OMM" style={{ height: 72, width: 'auto', objectFit: 'contain' }} />
            <div style={{ textAlign: 'right', fontSize: 9, color: '#555', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: '#111', fontSize: 11 }}>OMM Technologies SA de CV</div>
              <div>Memoria Técnica Descriptiva</div>
              <div>{formatDate(meta.generated_at)}</div>
            </div>
          </div>
        </div>

        {/* TITLE */}
        <div style={{ marginBottom: 24, textAlign: 'center', padding: '20px 0' }}>
          <div style={{ fontSize: 9, color: '#999', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 6 }}>
            Memoria Técnica Descriptiva
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', margin: '0 0 8px 0' }}>
            {m.alcance.titulo_proyecto}
          </h1>
          <div style={{ fontSize: 11, color: '#666' }}>
            {meta.client_name}{meta.architect ? ` · ${meta.architect}` : ''}
          </div>
        </div>

        {/* PROJECT INFO TABLE */}
        <table style={{ width: '100%', fontSize: 10, marginBottom: 20, borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={{ padding: '4px 8px', color: '#888', width: 130, borderBottom: '1px solid #eee' }}>Proyecto</td>
              <td style={{ padding: '4px 8px', fontWeight: 600, borderBottom: '1px solid #eee' }}>{meta.quotation_name}</td>
              <td style={{ padding: '4px 8px', color: '#888', width: 130, borderBottom: '1px solid #eee' }}>Cliente</td>
              <td style={{ padding: '4px 8px', fontWeight: 600, borderBottom: '1px solid #eee' }}>{meta.client_name || '—'}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', color: '#888', borderBottom: '1px solid #eee' }}>Especialidad</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>
                {meta.specialty === 'esp' ? 'Instalaciones Especiales' : meta.specialty === 'ilum' ? 'Iluminación' : meta.specialty === 'elec' ? 'Eléctrico' : meta.specialty === 'proy' ? 'Proyecto Integral' : meta.specialty}
              </td>
              <td style={{ padding: '4px 8px', color: '#888', borderBottom: '1px solid #eee' }}>Fecha</td>
              <td style={{ padding: '4px 8px', borderBottom: '1px solid #eee' }}>{formatDate(meta.generated_at)}</td>
            </tr>
            <tr>
              <td style={{ padding: '4px 8px', color: '#888' }}>Sistemas</td>
              <td colSpan={3} style={{ padding: '4px 8px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {m.alcance.sistemas_incluidos.map(sys => (
                    <span key={sys} style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 9, fontWeight: 600,
                      background: sysColor(sys) + '22', color: sysColor(sys), border: `1px solid ${sysColor(sys)}44`,
                    }}>{sys}</span>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ════════ SECTION 1: ALCANCE ════════ */}
        <h2 style={sectionTitle}>1. Alcance del Proyecto</h2>
        <div style={{ fontSize: 11, color: '#333', lineHeight: 1.7, marginBottom: 12 }}>
          {m.alcance.descripcion_general}
        </div>
        <div style={{ fontSize: 11, color: '#333', lineHeight: 1.7 }}>
          {m.alcance.resumen_ejecutivo}
        </div>

        {/* ════════ SECTION 2: FICHAS TÉCNICAS ════════ */}
        <div className="page-break" />
        <h2 style={sectionTitle}>2. Fichas Técnicas por Sistema</h2>

        {m.fichas_tecnicas.map((ft, sysIdx) => (
          <div key={ft.system} style={{ marginBottom: 24 }}>
            <div style={{
              background: sysColor(ft.system) + '11',
              borderLeft: `4px solid ${sysColor(ft.system)}`,
              padding: '10px 14px', marginBottom: 10, borderRadius: '0 6px 6px 0',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#111', margin: 0 }}>
                2.{sysIdx + 1} {ft.system}
              </h3>
              <div style={{ fontSize: 10, color: '#555', marginTop: 4, lineHeight: 1.5 }}>{ft.system_description}</div>
            </div>

            {ft.productos.map((prod, pIdx) => (
              <div key={pIdx} style={{
                border: '1px solid #e5e5e5', borderRadius: 8, padding: 14, marginBottom: 10,
                display: 'flex', gap: 14, breakInside: 'avoid' as any,
              }}>
                {/* Product image */}
                <div style={{ width: 70, height: 70, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: '#f5f5f5', border: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {prod.imagen_url ? (
                    <img src={prod.imagen_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <FileText size={24} color="#ccc" />
                  )}
                </div>

                {/* Product info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#111' }}>{prod.marca} {prod.modelo}</div>
                      <div style={{ fontSize: 10, color: '#666' }}>{prod.nombre}</div>
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: sysColor(ft.system), background: sysColor(ft.system) + '15', padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                      {prod.cantidad_total}x
                    </div>
                  </div>

                  <div style={{ fontSize: 10, color: '#444', lineHeight: 1.5, marginBottom: 6 }}>
                    {prod.descripcion_tecnica}
                  </div>

                  {/* Specs grid */}
                  {prod.specs && Object.keys(prod.specs).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {Object.entries(prod.specs).map(([key, val]) => (
                        <span key={key} style={{
                          fontSize: 9, padding: '2px 6px', background: '#f0f0f0', borderRadius: 4,
                          color: '#555',
                        }}>
                          <strong>{key}:</strong> {val}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Function + areas */}
                  <div style={{ fontSize: 9, color: '#888', lineHeight: 1.5 }}>
                    <strong>Función:</strong> {prod.funcion_en_proyecto}
                  </div>
                  {prod.areas && prod.areas.length > 0 && (
                    <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>
                      <strong>Ubicación:</strong> {prod.areas.join(', ')}
                    </div>
                  )}
                  {prod.notas_instalacion && (
                    <div style={{ fontSize: 9, color: '#D97706', marginTop: 2 }}>
                      <strong>Nota:</strong> {prod.notas_instalacion}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* ════════ SECTION 3: TOPOLOGÍA ════════ */}
        <div className="page-break" />
        <h2 style={sectionTitle}>3. Topología y Diagramas de Conexión</h2>

        {m.topologia.map((topo, tIdx) => (
          <div key={tIdx} style={{ marginBottom: 28, breakInside: 'avoid' as any }}>
            <div style={{
              background: sysColor(topo.system) + '11',
              borderLeft: `4px solid ${sysColor(topo.system)}`,
              padding: '10px 14px', marginBottom: 10, borderRadius: '0 6px 6px 0',
            }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: '#111', margin: 0 }}>{topo.titulo}</h3>
            </div>

            <div style={{ fontSize: 10, color: '#444', lineHeight: 1.6, marginBottom: 12 }}>
              {topo.descripcion}
            </div>

            {/* Mermaid diagram */}
            <div style={{ border: '1px solid #e5e5e5', borderRadius: 8, padding: 16, background: '#fafafa', marginBottom: 10 }}>
              <MermaidDiagram code={topo.mermaid_diagram} id={`topo-${tIdx}`} />
            </div>

            {/* Notes */}
            {topo.notas_topologia && topo.notas_topologia.length > 0 && (
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.5, padding: '8px 12px', background: '#f5f5f5', borderRadius: 6 }}>
                <strong>Notas:</strong>
                {topo.notas_topologia.map((nota, nIdx) => (
                  <div key={nIdx} style={{ marginTop: 2 }}>• {nota}</div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* ════════ SECTION 4: CONSIDERACIONES ════════ */}
        <div className="page-break" />
        <h2 style={sectionTitle}>4. Consideraciones de Instalación</h2>

        {m.consideraciones.map((cons, cIdx) => (
          <div key={cIdx} style={{ marginBottom: 24, breakInside: 'avoid' as any }}>
            <div style={{
              background: sysColor(cons.system) + '11',
              borderLeft: `4px solid ${sysColor(cons.system)}`,
              padding: '10px 14px', marginBottom: 10, borderRadius: '0 6px 6px 0',
            }}>
              <h3 style={{ fontSize: 12, fontWeight: 700, color: '#111', margin: 0 }}>{cons.titulo}</h3>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
              <tbody>
                {cons.requerimientos_electricos && (
                  <tr>
                    <td style={{ padding: '6px 10px', width: 160, fontWeight: 600, color: '#555', verticalAlign: 'top', borderBottom: '1px solid #eee' }}>Requerimientos eléctricos</td>
                    <td style={{ padding: '6px 10px', color: '#333', lineHeight: 1.5, borderBottom: '1px solid #eee' }}>{cons.requerimientos_electricos}</td>
                  </tr>
                )}
                {cons.canalizacion && (
                  <tr>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: '#555', verticalAlign: 'top', borderBottom: '1px solid #eee' }}>Canalización</td>
                    <td style={{ padding: '6px 10px', color: '#333', lineHeight: 1.5, borderBottom: '1px solid #eee' }}>{cons.canalizacion}</td>
                  </tr>
                )}
                {cons.puntos_datos && (
                  <tr>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: '#555', verticalAlign: 'top', borderBottom: '1px solid #eee' }}>Puntos de datos</td>
                    <td style={{ padding: '6px 10px', color: '#333', lineHeight: 1.5, borderBottom: '1px solid #eee' }}>{cons.puntos_datos}</td>
                  </tr>
                )}
                {cons.montaje && (
                  <tr>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: '#555', verticalAlign: 'top', borderBottom: '1px solid #eee' }}>Montaje</td>
                    <td style={{ padding: '6px 10px', color: '#333', lineHeight: 1.5, borderBottom: '1px solid #eee' }}>{cons.montaje}</td>
                  </tr>
                )}
                {cons.integracion && (
                  <tr>
                    <td style={{ padding: '6px 10px', fontWeight: 600, color: '#555', verticalAlign: 'top', borderBottom: '1px solid #eee' }}>Integración</td>
                    <td style={{ padding: '6px 10px', color: '#333', lineHeight: 1.5, borderBottom: '1px solid #eee' }}>{cons.integracion}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {cons.notas_adicionales && cons.notas_adicionales.length > 0 && (
              <div style={{ fontSize: 9, color: '#666', lineHeight: 1.5, padding: '8px 12px', background: '#FFFBEB', borderRadius: 6, marginTop: 8, borderLeft: '3px solid #D97706' }}>
                {cons.notas_adicionales.map((nota, nIdx) => (
                  <div key={nIdx} style={{ marginTop: nIdx > 0 ? 4 : 0 }}>• {nota}</div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* ════════ SECTION 5: NOTAS GENERALES ════════ */}
        {m.notas_generales && m.notas_generales.length > 0 && (
          <>
            <h2 style={sectionTitle}>5. Notas Generales</h2>
            <div style={{ fontSize: 10, color: '#444', lineHeight: 1.7 }}>
              {m.notas_generales.map((nota, nIdx) => (
                <div key={nIdx} style={{ marginBottom: 6, paddingLeft: 12, borderLeft: '2px solid #ddd' }}>
                  {nota}
                </div>
              ))}
            </div>
          </>
        )}

        {/* FOOTER */}
        <div style={{ marginTop: 40, paddingTop: 10, borderTop: '1px solid #ddd', fontSize: 8, color: '#999', textAlign: 'center' }}>
          OMM Technologies SA de CV · Memoria Técnica · {meta.quotation_name} · Generado {formatDate(meta.generated_at)}
        </div>
      </div>
    </div>
  )
}
