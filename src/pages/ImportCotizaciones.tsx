import { useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { ANTHROPIC_API_KEY } from '../lib/config'
import { SPECIALTY_CONFIG, calcItemPrice, calcItemTotal, F } from '../lib/utils'
import { Btn } from '../components/layout/UI'
import { X, Upload, Loader2, Check, AlertTriangle, FileText, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'

// ─── TYPES ─────────────────────────────────────────────────────────────
interface ParsedQuotation {
  name: string
  client_name: string
  specialty: string
  currency: string
  stage: string
  date?: string
  source_system?: string
  areas: ParsedArea[]
}

interface ParsedArea {
  name: string
  items: ParsedItem[]
}

interface ParsedItem {
  name: string
  description?: string
  marca?: string
  modelo?: string
  system?: string
  unit?: string
  quantity: number
  cost: number
  markup: number
  price: number
  total: number
  type?: string
}

interface Props {
  onClose: () => void
  onImported: (id: string, specialty: string) => void
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────
export default function ImportCotizaciones({ onClose, onImported }: Props) {
  const [step, setStep] = useState<'upload' | 'parsing' | 'preview' | 'importing' | 'done'>('upload')
  const [files, setFiles] = useState<File[]>([])
  const [parsedQuotes, setParsedQuotes] = useState<ParsedQuotation[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 })
  const [importedIds, setImportedIds] = useState<{ id: string; specialty: string; name: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  // ─── FILE HANDLING ──────────────────────────────────────────────────
  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(e.target.files || [])
    setFiles(prev => [...prev, ...newFiles])
    e.target.value = ''
  }

  function removeFile(idx: number) {
    setFiles(prev => prev.filter((_, i) => i !== idx))
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        resolve(result.split(',')[1] || '')
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // ─── PARSE FILES WITH AI ───────────────────────────────────────────
  async function parseFiles() {
    if (files.length === 0) return
    setStep('parsing')
    setParseError(null)
    const allParsed: ParsedQuotation[] = []

    for (const file of files) {
      try {
        const parsed = await parseSingleFile(file)
        if (parsed) allParsed.push(...parsed)
      } catch (err: any) {
        console.error('Parse error for', file.name, err)
        setParseError(`Error en ${file.name}: ${err.message || 'Error desconocido'}`)
        setStep('upload')
        return
      }
    }

    if (allParsed.length === 0) {
      setParseError('No se encontraron cotizaciones en los archivos proporcionados.')
      setStep('upload')
      return
    }

    setParsedQuotes(allParsed)
    setExpandedIdx(0)
    setStep('preview')
  }

  async function parseSingleFile(file: File): Promise<ParsedQuotation[]> {
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    let content: any[] = []

    const systemPrompt = `Eres un experto en parsear cotizaciones de sistemas AV, eléctricos, iluminación y proyectos de construcción. Extraes datos financieros con precisión.

REGLAS IMPORTANTES:
- Extrae TODOS los items con sus precios EXACTOS del documento — no redondees ni ajustes
- Si hay áreas/zonas/secciones, agrúpalas. Si no, usa "General" como área
- El "cost" es el costo que pagamos (si lo muestra). Si solo hay precio de venta, pon cost = price / 1.35 (estimando 35% markup)
- El "price" es el precio de venta unitario al cliente
- El "total" es price × quantity
- Detecta la moneda (USD o MXN) del documento
- Detecta la especialidad: "esp" (especiales/AV/CCTV/redes/control), "elec" (eléctrico), "ilum" (iluminación), "proy" (proyecto/ingeniería), "cort" (cortinas)
- Si el archivo tiene múltiples cotizaciones, devuelve cada una por separado
- El stage debe ser uno de: oportunidad, estimacion, propuesta, contrato
- source_system: "jetbuilt", "odoo", "excel", "otro"

Devuelve SOLO un JSON array válido sin markdown ni explicaciones:`

    const jsonFormat = `[{
  "name": "Nombre de la cotización",
  "client_name": "Nombre del cliente",
  "specialty": "esp|elec|ilum|proy|cort",
  "currency": "USD|MXN",
  "stage": "contrato|propuesta|estimacion|oportunidad",
  "date": "2025-01-15",
  "source_system": "jetbuilt|odoo|excel|otro",
  "areas": [{
    "name": "Nombre del area",
    "items": [{
      "name": "Nombre del producto",
      "description": "Descripcion técnica",
      "marca": "Marca",
      "modelo": "Modelo",
      "system": "Audio|CCTV|Redes|Lutron|Control|Electrico|Iluminacion",
      "unit": "pza|m|m2|lote|servicio",
      "quantity": 1,
      "cost": 100,
      "markup": 35,
      "price": 135,
      "total": 135,
      "type": "material|labor"
    }]
  }]
}]`

    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
      const b64 = await fileToBase64(file)
      content = [
        { type: 'image', source: { type: 'base64', media_type: file.type, data: b64 } },
        { type: 'text', text: `Parsea esta cotización/presupuesto y extrae los datos financieros.\n\nFormato de respuesta:\n${jsonFormat}` }
      ]
    } else if (ext === 'pdf') {
      const b64 = await fileToBase64(file)
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
        { type: 'text', text: `Parsea esta cotización/presupuesto y extrae los datos financieros.\n\nFormato de respuesta:\n${jsonFormat}` }
      ]
    } else {
      // CSV, Excel text, etc.
      const text = await file.text()
      content = [
        { type: 'text', text: `Parsea esta cotización/presupuesto y extrae los datos financieros.\n\nArchivo (${file.name}):\n${text.substring(0, 50000)}\n\nFormato de respuesta:\n${jsonFormat}` }
      ]
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2025-01-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content }]
      })
    })

    const data = await res.json()
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))

    const textBlocks = (data.content || [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('\n')

    let cleaned = textBlocks.replace(/```json|```/g, '').trim()
    const start = cleaned.indexOf('[')
    if (start === -1) throw new Error('No se encontró JSON en la respuesta')
    let jsonStr = cleaned.slice(start)

    // Fix truncation
    if (!jsonStr.trimEnd().endsWith(']')) {
      const lastBrace = jsonStr.lastIndexOf('}')
      if (lastBrace > 0) {
        // Close any open arrays
        let depth = 0
        for (let i = 0; i < lastBrace; i++) {
          if (jsonStr[i] === '[') depth++
          if (jsonStr[i] === ']') depth--
        }
        jsonStr = jsonStr.slice(0, lastBrace + 1)
        for (let i = 0; i < depth; i++) jsonStr += ']'
      }
    }

    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) throw new Error('Respuesta no es un array')
    return parsed as ParsedQuotation[]
  }

  // ─── EDIT PARSED DATA ──────────────────────────────────────────────
  function updateQuote(idx: number, field: string, value: any) {
    setParsedQuotes(prev => prev.map((q, i) => i === idx ? { ...q, [field]: value } : q))
  }

  function removeQuote(idx: number) {
    setParsedQuotes(prev => prev.filter((_, i) => i !== idx))
    if (expandedIdx === idx) setExpandedIdx(null)
  }

  function updateItem(qIdx: number, aIdx: number, iIdx: number, field: string, value: any) {
    setParsedQuotes(prev => prev.map((q, qi) => {
      if (qi !== qIdx) return q
      return {
        ...q,
        areas: q.areas.map((a, ai) => {
          if (ai !== aIdx) return a
          return {
            ...a,
            items: a.items.map((item, ii) => {
              if (ii !== iIdx) return item
              const updated = { ...item, [field]: value }
              // Recalc totals if price fields change
              if (['cost', 'markup', 'quantity', 'price'].includes(field)) {
                if (field === 'price') {
                  updated.total = updated.price * updated.quantity
                } else {
                  updated.price = calcItemPrice(updated.cost, updated.markup)
                  updated.total = calcItemTotal(updated.cost, updated.markup, updated.quantity)
                }
              }
              return updated
            })
          }
        })
      }
    }))
  }

  function removeItem(qIdx: number, aIdx: number, iIdx: number) {
    setParsedQuotes(prev => prev.map((q, qi) => {
      if (qi !== qIdx) return q
      return {
        ...q,
        areas: q.areas.map((a, ai) => {
          if (ai !== aIdx) return a
          return { ...a, items: a.items.filter((_, ii) => ii !== iIdx) }
        })
      }
    }))
  }

  // ─── IMPORT TO DB ──────────────────────────────────────────────────
  async function importAll() {
    setStep('importing')
    setImportProgress({ current: 0, total: parsedQuotes.length })
    const created: { id: string; specialty: string; name: string }[] = []

    for (let qi = 0; qi < parsedQuotes.length; qi++) {
      const q = parsedQuotes[qi]
      setImportProgress({ current: qi + 1, total: parsedQuotes.length })

      const notesObj: any = {
        currency: q.currency || 'USD',
        imported: true,
        source_system: q.source_system || 'otro',
        import_date: new Date().toISOString(),
      }

      // Calculate total
      const allItems = q.areas.flatMap(a => a.items)
      const total = allItems.reduce((s, i) => s + (i.total || 0), 0)

      // Create quotation
      const { data: cotData, error: cotErr } = await supabase.from('quotations').insert({
        name: q.name,
        specialty: q.specialty || 'esp',
        client_name: q.client_name || '',
        stage: q.stage || 'contrato',
        total,
        notes: JSON.stringify(notesObj),
      }).select().single()

      if (cotErr || !cotData) {
        console.error('Error creating quotation:', cotErr)
        continue
      }

      // Create areas and items
      for (let ai = 0; ai < q.areas.length; ai++) {
        const area = q.areas[ai]
        const { data: areaData } = await supabase.from('quotation_areas').insert({
          quotation_id: cotData.id,
          name: area.name || 'General',
          order_index: ai,
        }).select().single()

        if (!areaData) continue

        // Insert items — use historical prices, no catalog reference
        const itemInserts = area.items.map((item, ii) => ({
          area_id: areaData.id,
          quotation_id: cotData.id,
          name: item.name,
          description: item.description || null,
          system: item.system || null,
          type: item.type || 'material',
          provider: item.marca || null,
          quantity: item.quantity || 1,
          cost: item.cost || 0,
          markup: item.markup || 35,
          price: item.price || calcItemPrice(item.cost || 0, item.markup || 35),
          total: item.total || calcItemTotal(item.cost || 0, item.markup || 35, item.quantity || 1),
          installation_cost: 0,
          order_index: ii,
          marca: item.marca || null,
          modelo: item.modelo || null,
          // NO catalog_product_id — historical import keeps its own prices
        }))

        if (itemInserts.length > 0) {
          await supabase.from('quotation_items').insert(itemInserts)
        }
      }

      // Update quotation total
      await supabase.from('quotations').update({ total }).eq('id', cotData.id)

      created.push({ id: cotData.id, specialty: q.specialty || 'esp', name: q.name })
    }

    setImportedIds(created)
    setStep('done')
  }

  // ─── STYLES ─────────────────────────────────────────────────────────
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '7px 10px', background: '#0e0e0e', border: '1px solid #333',
    borderRadius: 6, color: '#fff', fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box'
  }
  const labelStyle: React.CSSProperties = { fontSize: 10, color: '#555', marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: '0.06em' }

  // ─── RENDER ─────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 920, maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Importar Cotizaciones Históricas</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>
              {step === 'upload' && 'Sube archivos CSV (Jetbuilt), PDF (Odoo) o Excel'}
              {step === 'parsing' && 'Analizando archivos con IA...'}
              {step === 'preview' && `${parsedQuotes.length} cotización${parsedQuotes.length !== 1 ? 'es' : ''} detectada${parsedQuotes.length !== 1 ? 's' : ''} — revisa antes de importar`}
              {step === 'importing' && `Importando ${importProgress.current} de ${importProgress.total}...`}
              {step === 'done' && `${importedIds.length} cotización${importedIds.length !== 1 ? 'es' : ''} importada${importedIds.length !== 1 ? 's' : ''}`}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {/* ─── STEP: UPLOAD ──────────────────────────────────────────── */}
        {step === 'upload' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {parseError && (
              <div style={{ background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, padding: 12, color: '#f87171', fontSize: 12, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{parseError}</span>
              </div>
            )}

            {/* Drop zone */}
            <div
              onClick={() => fileRef.current?.click()}
              style={{ border: '2px dashed #333', borderRadius: 12, padding: '40px 20px', textAlign: 'center', cursor: 'pointer', marginBottom: 16, transition: 'border-color 0.2s' }}
              onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#57FF9A' }}
              onDragLeave={e => { e.currentTarget.style.borderColor = '#333' }}
              onDrop={e => {
                e.preventDefault()
                e.currentTarget.style.borderColor = '#333'
                const newFiles = Array.from(e.dataTransfer.files)
                setFiles(prev => [...prev, ...newFiles])
              }}
            >
              <Upload size={28} style={{ color: '#444', marginBottom: 8 }} />
              <div style={{ fontSize: 14, color: '#888', fontWeight: 500 }}>Arrastra archivos aquí o haz click para seleccionar</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 6 }}>CSV · PDF · Excel · Imágenes</div>
            </div>
            <input ref={fileRef} type="file" multiple accept=".csv,.pdf,.xlsx,.xls,.png,.jpg,.jpeg,.webp,.gif" style={{ display: 'none' }} onChange={handleFiles} />

            {/* File list */}
            {files.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#888', marginBottom: 8 }}>{files.length} archivo{files.length !== 1 ? 's' : ''}</div>
                {files.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#1a1a1a', borderRadius: 8, marginBottom: 4 }}>
                    <FileText size={14} style={{ color: '#666' }} />
                    <span style={{ fontSize: 12, color: '#ccc', flex: 1 }}>{f.name}</span>
                    <span style={{ fontSize: 10, color: '#555' }}>{(f.size / 1024).toFixed(0)} KB</span>
                    <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            {/* Info box */}
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: 8, padding: 14, fontSize: 12, color: '#777', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: '#aaa', marginBottom: 6 }}>Como funciona:</div>
              1. Sube uno o varios archivos con cotizaciones<br />
              2. La IA analiza cada archivo y extrae los datos financieros<br />
              3. Revisas y ajustas el preview antes de confirmar<br />
              4. Se importan con los precios históricos originales — sin tocar tu catálogo actual
            </div>
          </div>
        )}

        {/* ─── STEP: PARSING ─────────────────────────────────────────── */}
        {step === 'parsing' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 0' }}>
            <Loader2 size={32} style={{ color: '#57FF9A', animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 14, color: '#888' }}>Analizando {files.length} archivo{files.length !== 1 ? 's' : ''} con IA...</div>
            <div style={{ fontSize: 11, color: '#555' }}>Esto puede tomar unos segundos por archivo</div>
          </div>
        )}

        {/* ─── STEP: PREVIEW ─────────────────────────────────────────── */}
        {step === 'preview' && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {parsedQuotes.map((q, qi) => {
              const expanded = expandedIdx === qi
              const totalItems = q.areas.reduce((s, a) => s + a.items.length, 0)
              const totalMonto = q.areas.flatMap(a => a.items).reduce((s, i) => s + (i.total || 0), 0)
              const spCfg = SPECIALTY_CONFIG[q.specialty as keyof typeof SPECIALTY_CONFIG] || SPECIALTY_CONFIG.esp

              return (
                <div key={qi} style={{ border: '1px solid #222', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
                  {/* Quote header */}
                  <div
                    onClick={() => setExpandedIdx(expanded ? null : qi)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: expanded ? '#1a1a1a' : '#111' }}
                  >
                    {expanded ? <ChevronUp size={14} style={{ color: '#555' }} /> : <ChevronDown size={14} style={{ color: '#555' }} />}
                    <span style={{ fontSize: 11, color: spCfg.color, fontWeight: 600 }}>{spCfg.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#ddd', flex: 1 }}>{q.name}</span>
                    <span style={{ fontSize: 11, color: '#666' }}>{q.client_name}</span>
                    <span style={{ fontSize: 10, color: '#555', padding: '2px 8px', background: '#222', borderRadius: 4 }}>{q.currency}</span>
                    <span style={{ fontSize: 11, color: '#888' }}>{totalItems} items</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#57FF9A' }}>{q.currency === 'MXN' ? 'MX$' : '$'}{F(totalMonto)}</span>
                    <button onClick={e => { e.stopPropagation(); removeQuote(qi) }} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}><Trash2 size={14} /></button>
                  </div>

                  {/* Expanded edit */}
                  {expanded && (
                    <div style={{ padding: '12px 16px', borderTop: '1px solid #222' }}>
                      {/* Metadata row */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto auto auto', gap: 10, marginBottom: 14 }}>
                        <div>
                          <label style={labelStyle}>Nombre</label>
                          <input value={q.name} onChange={e => updateQuote(qi, 'name', e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>Cliente</label>
                          <input value={q.client_name} onChange={e => updateQuote(qi, 'client_name', e.target.value)} style={inputStyle} />
                        </div>
                        <div>
                          <label style={labelStyle}>Especialidad</label>
                          <select value={q.specialty} onChange={e => updateQuote(qi, 'specialty', e.target.value)} style={{ ...inputStyle, width: 100 }}>
                            {Object.entries(SPECIALTY_CONFIG).map(([k, v]) => (
                              <option key={k} value={k}>{v.icon} {v.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Moneda</label>
                          <select value={q.currency} onChange={e => updateQuote(qi, 'currency', e.target.value)} style={{ ...inputStyle, width: 80 }}>
                            <option value="USD">USD</option>
                            <option value="MXN">MXN</option>
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Etapa</label>
                          <select value={q.stage} onChange={e => updateQuote(qi, 'stage', e.target.value)} style={{ ...inputStyle, width: 110 }}>
                            <option value="contrato">Contrato</option>
                            <option value="propuesta">Propuesta</option>
                            <option value="estimacion">Estimación</option>
                            <option value="oportunidad">Oportunidad</option>
                          </select>
                        </div>
                      </div>

                      {/* Areas + items */}
                      {q.areas.map((area, ai) => (
                        <div key={ai} style={{ marginBottom: 12 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#888', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: spCfg.color }}>■</span> {area.name}
                            <span style={{ color: '#444', fontWeight: 400 }}>({area.items.length} items · {q.currency === 'MXN' ? 'MX$' : '$'}{F(area.items.reduce((s, i) => s + (i.total || 0), 0))})</span>
                          </div>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr style={{ background: '#0e0e0e' }}>
                                {['Producto', 'Marca', 'Cant.', 'Costo', 'Markup%', 'Precio', 'Total', ''].map(h => (
                                  <th key={h} style={{ padding: '5px 6px', fontSize: 9, fontWeight: 600, color: '#444', textAlign: h === 'Producto' || h === 'Marca' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #1a1a1a' }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {area.items.map((item, ii) => (
                                <tr key={ii} style={{ borderBottom: '1px solid #1a1a1a' }}>
                                  <td style={{ padding: '4px 6px' }}>
                                    <input value={item.name} onChange={e => updateItem(qi, ai, ii, 'name', e.target.value)}
                                      style={{ background: 'transparent', border: 'none', color: '#ccc', fontSize: 11, fontFamily: 'inherit', width: '100%', outline: 'none' }} />
                                  </td>
                                  <td style={{ padding: '4px 6px' }}>
                                    <input value={item.marca || ''} onChange={e => updateItem(qi, ai, ii, 'marca', e.target.value)}
                                      style={{ background: 'transparent', border: 'none', color: '#888', fontSize: 11, fontFamily: 'inherit', width: 80, outline: 'none' }} />
                                  </td>
                                  {['quantity', 'cost', 'markup', 'price'].map(campo => (
                                    <td key={campo} style={{ padding: '4px 4px' }}>
                                      <input type="number" value={item[campo as keyof ParsedItem] as number}
                                        onChange={e => updateItem(qi, ai, ii, campo, parseFloat(e.target.value) || 0)}
                                        style={{ background: 'transparent', border: 'none', color: '#aaa', fontSize: 11, fontFamily: 'inherit', width: campo === 'cost' || campo === 'price' ? 65 : 45, textAlign: 'right', outline: 'none' }} />
                                    </td>
                                  ))}
                                  <td style={{ padding: '4px 6px', fontSize: 11, textAlign: 'right', fontWeight: 600, color: '#fff' }}>{F(item.total)}</td>
                                  <td style={{ padding: '4px 4px' }}>
                                    <button onClick={() => removeItem(qi, ai, ii)} style={{ background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 12 }}>×</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ─── STEP: IMPORTING ───────────────────────────────────────── */}
        {step === 'importing' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 0' }}>
            <Loader2 size={32} style={{ color: '#57FF9A', animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: 14, color: '#888' }}>Importando cotización {importProgress.current} de {importProgress.total}...</div>
            <div style={{ width: 300, height: 4, background: '#222', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${(importProgress.current / importProgress.total) * 100}%`, height: '100%', background: '#57FF9A', borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* ─── STEP: DONE ────────────────────────────────────────────── */}
        {step === 'done' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '40px 0' }}>
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#22c55e22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Check size={24} style={{ color: '#22c55e' }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{importedIds.length} cotización{importedIds.length !== 1 ? 'es' : ''} importada{importedIds.length !== 1 ? 's' : ''}</div>
            <div style={{ maxWidth: 400 }}>
              {importedIds.map((q, i) => {
                const spCfg = SPECIALTY_CONFIG[q.specialty as keyof typeof SPECIALTY_CONFIG] || SPECIALTY_CONFIG.esp
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: '#1a1a1a', borderRadius: 6, marginBottom: 4, cursor: 'pointer' }}
                    onClick={() => onImported(q.id, q.specialty)}>
                    <span style={{ color: spCfg.color, fontSize: 11 }}>{spCfg.icon}</span>
                    <span style={{ fontSize: 12, color: '#ccc' }}>{q.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: '#57FF9A' }}>Abrir →</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ borderTop: '1px solid #222', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, marginTop: 16 }}>
          <div style={{ fontSize: 11, color: '#555' }}>
            {step === 'preview' && `${parsedQuotes.reduce((s, q) => s + q.areas.flatMap(a => a.items).length, 0)} items totales · ${parsedQuotes.map(q => q.currency === 'MXN' ? 'MX$' : '$').join('/')}${F(parsedQuotes.reduce((s, q) => s + q.areas.flatMap(a => a.items).reduce((s2, i) => s2 + (i.total || 0), 0), 0))}`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'upload' && (
              <>
                <Btn size="sm" onClick={onClose}>Cancelar</Btn>
                <Btn size="sm" variant="primary" onClick={parseFiles} disabled={files.length === 0}>
                  <Upload size={12} /> Analizar {files.length} archivo{files.length !== 1 ? 's' : ''}
                </Btn>
              </>
            )}
            {step === 'preview' && (
              <>
                <Btn size="sm" onClick={() => { setStep('upload'); setParsedQuotes([]) }}>Volver</Btn>
                <Btn size="sm" variant="primary" onClick={importAll} disabled={parsedQuotes.length === 0}>
                  <Check size={12} /> Importar {parsedQuotes.length} cotización{parsedQuotes.length !== 1 ? 'es' : ''}
                </Btn>
              </>
            )}
            {step === 'done' && (
              <Btn size="sm" variant="primary" onClick={onClose}>Cerrar</Btn>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
