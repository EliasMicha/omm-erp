import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Badge, Btn, KpiCard, Table, Th, Td, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import {
  Plus, ChevronLeft, X, Trash2, Save, Truck, Calendar, Camera, FileText,
  PenTool, Upload, CheckCircle2, Clock, Package, ArrowRight, Warehouse, MapPin, Sparkles,
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type DeliveryType = 'entrega' | 'recoleccion' | 'recoleccion_directa'
type DeliveryStatus = 'pendiente' | 'en_ruta' | 'entregado' | 'cancelado'
type LogisticsMode = 'pending' | 'pickup_to_bodega' | 'pickup_to_obra' | 'supplier_to_bodega' | 'supplier_to_obra'
type ItemDirection = 'in_bodega' | 'in_obra' | 'out_bodega_to_obra'

interface DeliveryItemRow {
  id: string
  delivery_id?: string
  po_id?: string | null
  po_item_id?: string | null
  product_id?: string | null
  description: string
  qty: number
  unit?: string | null
  direction: ItemDirection
  obra_id?: string | null
  notes?: string | null
}

interface Delivery {
  id: string
  folio?: string
  created_at?: string
  updated_at?: string
  delivery_date: string
  scheduled_time?: string | null
  type: DeliveryType
  status: DeliveryStatus
  origin?: string | null
  destination?: string | null
  material_description?: string | null
  notes?: string | null

  project_id?: string | null
  obra_id?: string | null
  po_id?: string | null
  driver_id?: string | null
  installer_id?: string | null

  signature_driver_url?: string | null
  signature_receiver_url?: string | null
  photo_evidence?: string[] | null

  // Relacionadas (embed)
  project?: { id: string; name: string; client_name?: string } | null
  obra?: { id: string; nombre: string; direccion?: string } | null
  po?: { id: string; po_number: string; supplier_id?: string; logistics_mode?: LogisticsMode; logistics_target_obra_id?: string | null } | null
  driver?: { id: string; name: string } | null
  installer?: { id: string; name: string } | null
}

interface Employee { id: string; name: string; role?: string; tipo_trabajo?: string | null }
interface Obra { id: string; nombre: string; direccion?: string; project_id?: string }
interface Project { id: string; name: string; client_name?: string }
interface Supplier { id: string; name: string }
interface PurchaseOrder {
  id: string; po_number: string; project_id?: string; supplier_id?: string
  status?: string; currency?: 'MXN' | 'USD'
  logistics_mode?: LogisticsMode
  logistics_target_obra_id?: string | null
  supplier?: Supplier | null
  project?: Project | null
  target_obra?: Obra | null
}
interface POItem {
  id: string; purchase_order_id: string; name: string; description?: string
  quantity: number; unit?: string; unit_cost?: number
  product_id?: string | null
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

const STATUS_CFG: Record<DeliveryStatus, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: '#F59E0B' },
  en_ruta:   { label: 'En ruta',   color: '#3B82F6' },
  entregado: { label: 'Entregado', color: '#57FF9A' },
  cancelado: { label: 'Cancelado', color: '#EF4444' },
}

const TYPE_CFG: Record<DeliveryType, { label: string; color: string; icon: string }> = {
  entrega:             { label: 'Entrega a obra',        color: '#57FF9A', icon: '📦' },
  recoleccion:         { label: 'Recolección → bodega',  color: '#C084FC', icon: '🚚' },
  recoleccion_directa: { label: 'Recolección → obra',    color: '#F59E0B', icon: '⚡' },
}

const LOGISTICS_CFG: Record<LogisticsMode, { label: string; short: string; color: string; needsObra: boolean }> = {
  pending:             { label: 'Pendiente de definir',   short: 'Pendiente',  color: '#888',    needsObra: false },
  pickup_to_bodega:    { label: 'OMM recoge → bodega',    short: 'Rec→bodega', color: '#C084FC', needsObra: false },
  pickup_to_obra:      { label: 'OMM recoge → obra',      short: 'Rec→obra',   color: '#F59E0B', needsObra: true  },
  supplier_to_bodega:  { label: 'Proveedor → bodega',     short: 'Prov→bodega',color: '#60A5FA', needsObra: false },
  supplier_to_obra:    { label: 'Proveedor → obra',       short: 'Prov→obra',  color: '#34D399', needsObra: true  },
}

const STORAGE_BUCKET = 'entregas'

// ═══════════════════════════════════════════════════════════════════════════════
//  SHARED INPUTS
// ═══════════════════════════════════════════════════════════════════════════════

function Field({ label, value, onChange, placeholder = '', type = 'text', disabled = false, style }: {
  label: string; value: string; onChange?: (v: string) => void
  placeholder?: string; type?: string; disabled?: boolean
  style?: React.CSSProperties
}) {
  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', ...style }}>
      {label}
      <input type={type} value={value} onChange={e => onChange?.(e.target.value)} placeholder={placeholder} disabled={disabled}
        style={{
          display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
          background: disabled ? '#111' : '#1e1e1e', border: '1px solid #333', borderRadius: 8,
          color: disabled ? '#555' : '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const,
        }} />
    </label>
  )
}

function SelectField({ label, value, onChange, options, placeholder, disabled }: {
  label: string; value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]; placeholder?: string; disabled?: boolean
}) {
  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
      {label}
      <select value={value} onChange={e => onChange(e.target.value)} disabled={disabled}
        style={{
          display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
          background: disabled ? '#111' : '#1e1e1e', border: '1px solid #333', borderRadius: 8,
          color: disabled ? '#555' : '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const,
        }}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

function TextArea({ label, value, onChange, rows = 3 }: {
  label: string; value: string; onChange: (v: string) => void; rows?: number
}) {
  return (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
      {label}
      <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows}
        style={{
          display: 'block', width: '100%', marginTop: 4, padding: '8px 10px',
          background: '#1e1e1e', border: '1px solid #333', borderRadius: 8,
          color: '#fff', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' as const,
          resize: 'vertical' as const,
        }} />
    </label>
  )
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')) : d
  return date.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' })
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20, background: '#111', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function Grid({ cols, children }: { cols: number; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
      {children}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SIGNATURE PAD
// ═══════════════════════════════════════════════════════════════════════════════

function SignaturePad({ value, onChange, label }: {
  value?: string | null
  onChange: (dataUrl: string | null) => void
  label: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const [hasDrawing, setHasDrawing] = useState(!!value)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fafafa'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    if (value) {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); setHasDrawing(true) }
      img.src = value
    } else setHasDrawing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    let clientX = 0, clientY = 0
    if ('touches' in e) { clientX = e.touches[0]?.clientX ?? 0; clientY = e.touches[0]?.clientY ?? 0 }
    else { clientX = e.clientX; clientY = e.clientY }
    return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }
  }

  const start = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault(); drawingRef.current = true; lastRef.current = getPos(e)
  }
  const move = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    e.preventDefault()
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const p = getPos(e)
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    ctx.beginPath()
    if (lastRef.current) ctx.moveTo(lastRef.current.x, lastRef.current.y)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    lastRef.current = p; setHasDrawing(true)
  }
  const end = () => {
    if (!drawingRef.current) return
    drawingRef.current = false; lastRef.current = null
    const canvas = canvasRef.current
    if (canvas) onChange(canvas.toDataURL('image/png'))
  }
  const clear = () => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    ctx.fillStyle = '#fafafa'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasDrawing(false); onChange(null)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ fontSize: 11, color: hasDrawing ? '#57FF9A' : '#555', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
          <PenTool size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {label} {hasDrawing && '✓'}
        </div>
        {hasDrawing && (
          <button onClick={clear} type="button" style={{ background: 'transparent', color: '#666', border: 'none', fontSize: 10, cursor: 'pointer', padding: 2 }}>Borrar</button>
        )}
      </div>
      <canvas ref={canvasRef} width={400} height={120}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        style={{
          display: 'block', width: '100%', height: 120,
          background: '#fafafa', border: '1px solid #333', borderRadius: 8, cursor: 'crosshair',
          touchAction: 'none' as const,
        }} />
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PHOTO UPLOADER
// ═══════════════════════════════════════════════════════════════════════════════

function PhotoUploader({ urls, onChange, deliveryId }: {
  urls: string[]; onChange: (urls: string[]) => void; deliveryId: string
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    const newUrls: string[] = []
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const ext = file.name.split('.').pop() || 'jpg'
        const path = `${deliveryId}/photos/${Date.now()}_${i}.${ext}`
        const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
        if (error) { console.error('upload error', error); continue }
        const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
        if (pub?.publicUrl) newUrls.push(pub.publicUrl)
      }
      onChange([...urls, ...newUrls])
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removeUrl = async (url: string) => {
    try {
      const match = url.match(/\/storage\/v1\/object\/public\/entregas\/(.+)$/)
      if (match) await supabase.storage.from(STORAGE_BUCKET).remove([match[1]])
    } catch (err) { console.error(err) }
    onChange(urls.filter(u => u !== url))
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
          <Camera size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Evidencia fotográfica ({urls.length})
        </div>
        <Btn size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          <Upload size={12} /> {uploading ? 'Subiendo...' : 'Subir fotos'}
        </Btn>
        <input ref={fileInputRef} type="file" accept="image/*" multiple capture="environment"
          onChange={e => uploadFiles(e.target.files)} style={{ display: 'none' }} />
      </div>
      {urls.length === 0 ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#444', fontSize: 12, border: '1px dashed #333', borderRadius: 8 }}>
          Sin fotos. Toma foto del material / punto de entrega.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 8 }}>
          {urls.map(url => (
            <div key={url} style={{ position: 'relative' as const, aspectRatio: '1', background: '#1a1a1a', borderRadius: 6, overflow: 'hidden' }}>
              <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' as const, cursor: 'pointer' }} onClick={() => window.open(url, '_blank')} />
              <button onClick={() => removeUrl(url)} type="button"
                style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: '50%', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN COMPONENT — 4 TABS
// ═══════════════════════════════════════════════════════════════════════════════

type TabKey = 'dashboard' | 'recolecciones' | 'entregas' | 'historial'

export default function Entregas() {
  const [view, setView] = useState<TabKey>('dashboard')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editorPrefill, setEditorPrefill] = useState<Partial<Delivery> | null>(null)

  if (editingId) return (
    <EntregaEditor
      deliveryId={editingId}
      prefill={editorPrefill}
      onBack={() => { setEditingId(null); setEditorPrefill(null) }}
    />
  )

  const newFromPO = (po: PurchaseOrder, type: DeliveryType) => {
    const mode = po.logistics_mode || 'pending'
    const prefill: Partial<Delivery> = {
      po_id: po.id,
      project_id: po.project_id || null,
      obra_id: (mode === 'pickup_to_obra' || mode === 'supplier_to_obra') ? (po.logistics_target_obra_id || null) : null,
      type,
      status: 'pendiente',
    }
    setEditorPrefill(prefill)
    setEditingId('new')
  }

  const newBlank = () => { setEditorPrefill(null); setEditingId('new') }

  const tabs: { key: TabKey; label: string; icon: React.ElementType }[] = [
    { key: 'dashboard',     label: 'Dashboard',               icon: Truck },
    { key: 'recolecciones', label: 'Recolecciones pendientes', icon: Package },
    { key: 'entregas',      label: 'Entregas a obra',          icon: MapPin },
    { key: 'historial',     label: 'Historial',                icon: FileText },
  ]

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #222', paddingBottom: 8 }}>
        {tabs.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setView(key)}
            style={{
              padding: '8px 16px', borderRadius: '8px 8px 0 0', fontSize: 12, cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: view === key ? 600 : 400, border: 'none',
              background: view === key ? '#1e1e1e' : 'transparent',
              color: view === key ? '#57FF9A' : '#666',
              borderBottom: view === key ? '2px solid #57FF9A' : '2px solid transparent',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {view === 'dashboard'     && <EntregasDashboard onOpen={setEditingId} onNew={newBlank} onGoTo={setView} />}
      {view === 'recolecciones' && <RecoleccionesPendientes onOpen={setEditingId} onFromPO={(po, t) => newFromPO(po, t)} />}
      {view === 'entregas'      && <EntregasAObra onOpen={setEditingId} onFromPO={(po, t) => newFromPO(po, t)} onNew={newBlank} />}
      {view === 'historial'     && <Historial onOpen={setEditingId} onNew={newBlank} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLACEHOLDER — will be replaced in next chunks
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Dashboard ───
function EntregasDashboard({ onOpen, onNew, onGoTo }: { onOpen: (id: string) => void; onNew: () => void; onGoTo: (v: TabKey) => void }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Delivery[]>([])
  const [pendingPOsCount, setPendingPOsCount] = useState(0)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [dRes, poRes] = await Promise.all([
      supabase.from('deliveries')
        .select('*, project:projects(id,name,client_name), obra:obras(id,nombre,direccion), po:purchase_orders(id,po_number,logistics_mode), driver:employees!deliveries_driver_id_fkey(id,name), installer:employees!deliveries_installer_id_fkey(id,name)')
        .order('delivery_date', { ascending: false }).limit(100),
      // POs compradas que necesitan logística (no pending, no supplier_to_bodega que no requiere acción)
      supabase.from('purchase_orders')
        .select('id,logistics_mode,status', { count: 'exact', head: true })
        .eq('status', 'comprada')
        .in('logistics_mode', ['pickup_to_bodega', 'pickup_to_obra', 'supplier_to_obra']),
    ])
    if (dRes.error) console.error(dRes.error)
    setRows((dRes.data || []) as Delivery[])
    setPendingPOsCount(poRes.count || 0)
    setLoading(false)
  }

  const today = new Date().toISOString().slice(0, 10)
  const stats = useMemo(() => {
    const pendientes    = rows.filter(r => r.status === 'pendiente').length
    const enRuta        = rows.filter(r => r.status === 'en_ruta').length
    const hoy           = rows.filter(r => r.delivery_date === today).length
    const entregadasMes = rows.filter(r => {
      if (r.status !== 'entregado') return false
      const d = new Date(r.delivery_date + 'T00:00:00'), now = new Date()
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    }).length
    return { pendientes, enRuta, hoy, entregadasMes }
  }, [rows, today])

  const upcoming = useMemo(() => rows.filter(r => r.status === 'pendiente' || r.status === 'en_ruta').slice(0, 10), [rows])

  if (loading) return <Loading />

  return (
    <div>
      <SectionHeader title="Entregas y Recolecciones" subtitle="Logística de material de proveedor a bodega o directo a obra"
        action={<Btn variant="primary" onClick={onNew}><Plus size={14} /> Nueva manual</Btn>} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        <KpiCard label="Hoy"              value={stats.hoy}           color="#57FF9A" icon={<Calendar size={16} />} />
        <KpiCard label="Pendientes"       value={stats.pendientes}    color="#F59E0B" icon={<Clock size={16} />} />
        <KpiCard label="En ruta"          value={stats.enRuta}        color="#3B82F6" icon={<Truck size={16} />} />
        <KpiCard label="Entregadas (mes)" value={stats.entregadasMes} color="#C084FC" icon={<CheckCircle2 size={16} />} />
        <KpiCard label="POs por atender"  value={pendingPOsCount}     color="#EC4899" icon={<Package size={16} />} />
      </div>

      {pendingPOsCount > 0 && (
        <div style={{ marginBottom: 20, padding: 14, background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, color: '#fff', fontWeight: 600 }}>
              <Sparkles size={12} style={{ verticalAlign: 'middle', marginRight: 6, color: '#EC4899' }} />
              {pendingPOsCount} orden{pendingPOsCount === 1 ? '' : 'es'} de compra comprada{pendingPOsCount === 1 ? '' : 's'} esperando logística
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
              Ve a <span style={{ color: '#57FF9A' }}>Recolecciones pendientes</span> o <span style={{ color: '#57FF9A' }}>Entregas a obra</span> para programarlas.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" onClick={() => onGoTo('recolecciones')}>Recolecciones</Btn>
            <Btn size="sm" onClick={() => onGoTo('entregas')}>Entregas a obra</Btn>
          </div>
        </div>
      )}

      <SectionHeader title="Próximas entregas" action={<Btn size="sm" onClick={() => onGoTo('historial')}>Ver todas</Btn>} />
      {upcoming.length === 0 ? (
        <EmptyState message="No hay entregas pendientes ni en ruta." />
      ) : (
        <Table>
          <thead>
            <tr><Th>Folio</Th><Th>Fecha</Th><Th>Tipo</Th><Th>Obra / PO</Th><Th>Chofer</Th><Th>Recibe</Th><Th>Firmas</Th><Th>Status</Th></tr>
          </thead>
          <tbody>{upcoming.map(r => <DeliveryRow key={r.id} row={r} onOpen={onOpen} />)}</tbody>
        </Table>
      )}
    </div>
  )
}
// ─── Recolecciones pendientes ───
// POs compradas donde OMM va por el material (pickup_*), sin delivery cerrado.
function RecoleccionesPendientes({ onOpen, onFromPO }: { onOpen: (id: string) => void; onFromPO: (po: PurchaseOrder, t: DeliveryType) => void }) {
  const [loading, setLoading] = useState(true)
  const [pendingPOs, setPendingPOs] = useState<PurchaseOrder[]>([])
  const [inProgress, setInProgress] = useState<Delivery[]>([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    // 1. POs compradas con logística de recolección
    const { data: posData, error: posErr } = await supabase.from('purchase_orders')
      .select('id,po_number,project_id,supplier_id,status,currency,logistics_mode,logistics_target_obra_id,supplier:suppliers(id,name),project:projects!purchase_orders_project_id_fkey(id,name,client_name),target_obra:obras!purchase_orders_logistics_target_obra_id_fkey(id,nombre,direccion)')
      .eq('status', 'comprada')
      .in('logistics_mode', ['pickup_to_bodega', 'pickup_to_obra'])
      .order('po_number', { ascending: false })
    if (posErr) console.error(posErr)

    // 2. Deliveries entregados ya ligados a estas POs (para filtrar fuera las cerradas)
    const poIds = (posData || []).map(p => p.id)
    let deliveredPoIds = new Set<string>()
    let inProgressRows: Delivery[] = []
    if (poIds.length) {
      const { data: delData } = await supabase.from('deliveries')
        .select('*, project:projects(id,name,client_name), obra:obras(id,nombre,direccion), po:purchase_orders(id,po_number,logistics_mode), driver:employees!deliveries_driver_id_fkey(id,name), installer:employees!deliveries_installer_id_fkey(id,name)')
        .in('po_id', poIds)
      for (const d of (delData || []) as Delivery[]) {
        if (d.status === 'entregado') deliveredPoIds.add(d.po_id!)
        else if (d.status === 'pendiente' || d.status === 'en_ruta') inProgressRows.push(d)
      }
    }
    setPendingPOs(((posData || []) as unknown as PurchaseOrder[]).filter(p => !deliveredPoIds.has(p.id)))
    setInProgress(inProgressRows)
    setLoading(false)
  }

  if (loading) return <Loading />

  return (
    <div>
      <SectionHeader title={`Recolecciones pendientes (${pendingPOs.length})`} subtitle="Órdenes de compra compradas que requieren que vayamos por el material." />

      {pendingPOs.length === 0 ? (
        <EmptyState message="No hay recolecciones por programar. Las POs compradas con logística 'OMM recoge' aparecerán aquí." />
      ) : (
        <Table>
          <thead>
            <tr><Th>PO</Th><Th>Proveedor</Th><Th>Proyecto</Th><Th>Modo</Th><Th>Destino</Th><Th></Th></tr>
          </thead>
          <tbody>
            {pendingPOs.map(po => {
              const mode = po.logistics_mode || 'pending'
              const cfg = LOGISTICS_CFG[mode]
              const isToBodega = mode === 'pickup_to_bodega'
              const deliveryType: DeliveryType = isToBodega ? 'recoleccion' : 'recoleccion_directa'
              return (
                <tr key={po.id}>
                  <Td><span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>{po.po_number}</span></Td>
                  <Td muted>{po.supplier?.name || '—'}</Td>
                  <Td muted>{po.project?.name || '—'}</Td>
                  <Td><Badge label={cfg.short} color={cfg.color} /></Td>
                  <Td muted>{isToBodega ? 'Bodega OMM' : (po.target_obra?.nombre || 'Obra sin definir')}</Td>
                  <Td>
                    <Btn size="sm" variant="primary" onClick={() => onFromPO(po, deliveryType)}>
                      <Plus size={12} /> Programar
                    </Btn>
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {inProgress.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <SectionHeader title={`En progreso (${inProgress.length})`} subtitle="Recolecciones ya programadas o en ruta." />
          <Table>
            <thead>
              <tr><Th>Folio</Th><Th>Fecha</Th><Th>PO</Th><Th>Destino</Th><Th>Chofer</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {inProgress.map(r => (
                <tr key={r.id} onClick={() => onOpen(r.id)} style={{ cursor: 'pointer' }}>
                  <Td><span style={{ color: '#fff', fontWeight: 600 }}>{r.folio || '—'}</span></Td>
                  <Td>{formatDate(r.delivery_date)}{r.scheduled_time ? ` ${r.scheduled_time.slice(0,5)}` : ''}</Td>
                  <Td muted>{r.po?.po_number || '—'}</Td>
                  <Td muted>{r.obra?.nombre || 'Bodega'}</Td>
                  <Td muted>{r.driver?.name || '—'}</Td>
                  <Td><Badge label={STATUS_CFG[r.status].label} color={STATUS_CFG[r.status].color} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </div>
  )
}
// ─── Entregas a obra ───
// (a) POs supplier_to_obra pendientes — solo confirmar recepción
// (b) Entregas bodega→obra en progreso
// (c) Botón para crear entrega manual bodega→obra sin PO (movimiento de inventario)
function EntregasAObra({ onOpen, onFromPO, onNew }: { onOpen: (id: string) => void; onFromPO: (po: PurchaseOrder, t: DeliveryType) => void; onNew: () => void }) {
  const [loading, setLoading] = useState(true)
  const [pendingSupplierToObra, setPendingSupplierToObra] = useState<PurchaseOrder[]>([])
  const [inProgress, setInProgress] = useState<Delivery[]>([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data: posData, error: posErr } = await supabase.from('purchase_orders')
      .select('id,po_number,project_id,supplier_id,status,currency,logistics_mode,logistics_target_obra_id,supplier:suppliers(id,name),project:projects!purchase_orders_project_id_fkey(id,name,client_name),target_obra:obras!purchase_orders_logistics_target_obra_id_fkey(id,nombre,direccion)')
      .eq('status', 'comprada')
      .eq('logistics_mode', 'supplier_to_obra')
      .order('po_number', { ascending: false })
    if (posErr) console.error(posErr)

    const poIds = (posData || []).map(p => p.id)
    let confirmedPoIds = new Set<string>()
    if (poIds.length) {
      const { data } = await supabase.from('deliveries')
        .select('po_id,status').in('po_id', poIds).eq('status', 'entregado')
      for (const d of (data || [])) confirmedPoIds.add(d.po_id)
    }

    // Entregas bodega→obra en progreso (type=entrega & status in pendiente/en_ruta)
    const { data: delData } = await supabase.from('deliveries')
      .select('*, project:projects(id,name,client_name), obra:obras(id,nombre,direccion), po:purchase_orders(id,po_number,logistics_mode), driver:employees!deliveries_driver_id_fkey(id,name), installer:employees!deliveries_installer_id_fkey(id,name)')
      .eq('type', 'entrega')
      .in('status', ['pendiente', 'en_ruta'])
      .order('delivery_date', { ascending: true })

    setPendingSupplierToObra(((posData || []) as unknown as PurchaseOrder[]).filter(p => !confirmedPoIds.has(p.id)))
    setInProgress((delData || []) as Delivery[])
    setLoading(false)
  }

  if (loading) return <Loading />

  return (
    <div>
      <SectionHeader title="Entregas a obra"
        subtitle="Material saliendo a obra: desde bodega OMM o directo del proveedor."
        action={<Btn variant="primary" onClick={onNew}><Plus size={14} /> Entrega bodega → obra</Btn>} />

      {pendingSupplierToObra.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            <Warehouse size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Proveedor → obra · por confirmar recepción ({pendingSupplierToObra.length})
          </div>
          <Table>
            <thead>
              <tr><Th>PO</Th><Th>Proveedor</Th><Th>Proyecto</Th><Th>Obra</Th><Th></Th></tr>
            </thead>
            <tbody>
              {pendingSupplierToObra.map(po => (
                <tr key={po.id}>
                  <Td><span style={{ color: '#fff', fontWeight: 600, fontFamily: 'monospace' }}>{po.po_number}</span></Td>
                  <Td muted>{po.supplier?.name || '—'}</Td>
                  <Td muted>{po.project?.name || '—'}</Td>
                  <Td muted>{po.target_obra?.nombre || '—'}</Td>
                  <Td>
                    <Btn size="sm" variant="primary" onClick={() => onFromPO(po, 'entrega')}>
                      <CheckCircle2 size={12} /> Registrar recepción
                    </Btn>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
        <Truck size={12} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        En progreso ({inProgress.length})
      </div>
      {inProgress.length === 0 ? (
        <EmptyState message="Sin entregas pendientes ni en ruta." />
      ) : (
        <Table>
          <thead>
            <tr><Th>Folio</Th><Th>Fecha</Th><Th>Obra</Th><Th>PO</Th><Th>Chofer</Th><Th>Recibe</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {inProgress.map(r => (
              <tr key={r.id} onClick={() => onOpen(r.id)} style={{ cursor: 'pointer' }}>
                <Td><span style={{ color: '#fff', fontWeight: 600 }}>{r.folio || '—'}</span></Td>
                <Td>{formatDate(r.delivery_date)}{r.scheduled_time ? ` ${r.scheduled_time.slice(0,5)}` : ''}</Td>
                <Td muted>{r.obra?.nombre || '—'}</Td>
                <Td muted>{r.po?.po_number || '—'}</Td>
                <Td muted>{r.driver?.name || '—'}</Td>
                <Td muted>{r.installer?.name || '—'}</Td>
                <Td><Badge label={STATUS_CFG[r.status].label} color={STATUS_CFG[r.status].color} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
// ─── Historial ───
function Historial({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Delivery[]>([])
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [filterType, setFilterType] = useState<string>('')
  const [search, setSearch] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase.from('deliveries')
      .select('*, project:projects(id,name,client_name), obra:obras(id,nombre,direccion), po:purchase_orders(id,po_number,logistics_mode,logistics_target_obra_id), driver:employees!deliveries_driver_id_fkey(id,name), installer:employees!deliveries_installer_id_fkey(id,name)')
      .order('delivery_date', { ascending: false })
      .limit(500)
    if (error) console.error(error)
    setRows((data || []) as Delivery[])
    setLoading(false)
  }

  const filtered = useMemo(() => rows.filter(r => {
    if (filterStatus && r.status !== filterStatus) return false
    if (filterType && r.type !== filterType) return false
    if (search) {
      const s = search.toLowerCase()
      const hit = [r.folio, r.origin, r.destination, r.material_description, r.project?.name, r.obra?.nombre, r.po?.po_number, r.driver?.name, r.installer?.name]
        .some(v => v && v.toLowerCase().includes(s))
      if (!hit) return false
    }
    return true
  }), [rows, filterStatus, filterType, search])

  if (loading) return <Loading />

  return (
    <div>
      <SectionHeader title={`Historial (${filtered.length})`} action={<Btn variant="primary" onClick={onNew}><Plus size={14} /> Nueva</Btn>} />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <Field label="Buscar" value={search} onChange={setSearch} placeholder="Folio, destino, proyecto, chofer..." />
        <SelectField label="Status" value={filterStatus} onChange={setFilterStatus} placeholder="Todos"
          options={(Object.keys(STATUS_CFG) as DeliveryStatus[]).map(k => ({ value: k, label: STATUS_CFG[k].label }))} />
        <SelectField label="Tipo" value={filterType} onChange={setFilterType} placeholder="Todos"
          options={(Object.keys(TYPE_CFG) as DeliveryType[]).map(k => ({ value: k, label: TYPE_CFG[k].label }))} />
      </div>
      {filtered.length === 0 ? <EmptyState message="Sin entregas que coincidan." /> : (
        <Table>
          <thead>
            <tr><Th>Folio</Th><Th>Fecha</Th><Th>Tipo</Th><Th>Obra / PO</Th><Th>Chofer</Th><Th>Recibe</Th><Th>Firmas</Th><Th>Status</Th></tr>
          </thead>
          <tbody>{filtered.map(r => <DeliveryRow key={r.id} row={r} onOpen={onOpen} />)}</tbody>
        </Table>
      )}
    </div>
  )
}

// ─── Helper row ───
function DeliveryRow({ row, onOpen }: { row: Delivery; onOpen: (id: string) => void }) {
  const statusCfg = STATUS_CFG[row.status] || STATUS_CFG.pendiente
  const typeCfg = TYPE_CFG[row.type] || TYPE_CFG.entrega
  const firmas = (row.signature_driver_url ? 1 : 0) + (row.signature_receiver_url ? 1 : 0)
  return (
    <tr onClick={() => onOpen(row.id)} style={{ cursor: 'pointer' }}>
      <Td><span style={{ color: '#fff', fontWeight: 600 }}>{row.folio || '—'}</span></Td>
      <Td>{formatDate(row.delivery_date)}{row.scheduled_time ? ` ${row.scheduled_time.slice(0,5)}` : ''}</Td>
      <Td><Badge label={typeCfg.label} color={typeCfg.color} /></Td>
      <Td muted>
        <div>{row.obra?.nombre || '—'}</div>
        {row.po?.po_number && <div style={{ fontSize: 10, color: '#555' }}>{row.po.po_number}</div>}
      </Td>
      <Td muted>{row.driver?.name || '—'}</Td>
      <Td muted>{row.installer?.name || '—'}</Td>
      <Td><span style={{ fontSize: 11, color: firmas === 2 ? '#57FF9A' : firmas > 0 ? '#F59E0B' : '#444' }}>{firmas}/2</span></Td>
      <Td><Badge label={statusCfg.label} color={statusCfg.color} /></Td>
    </tr>
  )
}
// ═══════════════════════════════════════════════════════════════════════════════
//  EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

const EMPTY_DELIVERY: Delivery = {
  id: '', delivery_date: new Date().toISOString().slice(0, 10),
  type: 'entrega', status: 'pendiente',
  origin: '', destination: '', photo_evidence: [],
}

function EntregaEditor({ deliveryId, prefill, onBack }: {
  deliveryId: string; prefill: Partial<Delivery> | null; onBack: () => void
}) {
  const isNew = deliveryId === 'new'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [d, setD] = useState<Delivery>({ ...EMPTY_DELIVERY, ...(prefill || {}) })
  const [items, setItems] = useState<DeliveryItemRow[]>([])
  const [autoInstallerHint, setAutoInstallerHint] = useState<string | null>(null)

  // Catalogs
  const [employees, setEmployees] = useState<Employee[]>([])
  const [obras, setObras] = useState<Obra[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [pos, setPos] = useState<PurchaseOrder[]>([])
  const [poItems, setPoItems] = useState<POItem[]>([])

  useEffect(() => { loadAll() /* eslint-disable-next-line */ }, [deliveryId])

  async function loadAll() {
    setLoading(true)
    const [empRes, obrasRes, projRes, posRes] = await Promise.all([
      supabase.from('employees').select('id,name,role,tipo_trabajo').eq('is_active', true).order('name'),
      supabase.from('obras').select('id,nombre,direccion,project_id').order('nombre'),
      supabase.from('projects').select('id,name,client_name').order('name'),
      supabase.from('purchase_orders').select('id,po_number,project_id,supplier_id,status,currency,logistics_mode,logistics_target_obra_id').order('po_number', { ascending: false }).limit(300),
    ])
    setEmployees((empRes.data || []) as Employee[])
    setObras((obrasRes.data || []) as Obra[])
    setProjects((projRes.data || []) as Project[])
    setPos((posRes.data || []) as PurchaseOrder[])

    if (isNew) {
      const seed: Delivery = { ...EMPTY_DELIVERY, ...(prefill || {}) }
      // If prefill has po_id, load its po_items
      if (seed.po_id) {
        const poRec = (posRes.data || []).find((p: PurchaseOrder) => p.id === seed.po_id)
        const mode = poRec?.logistics_mode
        if (!seed.origin) seed.origin = mode?.startsWith('supplier_') ? 'Proveedor' : 'Proveedor (OMM recoge)'
        const obraId = seed.obra_id || poRec?.logistics_target_obra_id || null
        if (obraId && !seed.destination) {
          const obra = (obrasRes.data || []).find((o: Obra) => o.id === obraId)
          seed.destination = obra?.direccion || obra?.nombre || ''
          seed.obra_id = obraId
        } else if (mode === 'pickup_to_bodega' || mode === 'supplier_to_bodega') {
          if (!seed.destination) seed.destination = 'Bodega OMM'
        }
        await loadPOItems(seed.po_id)
      }
      setD(seed)
    } else {
      const { data, error } = await supabase.from('deliveries')
        .select('*, project:projects(id,name,client_name), obra:obras(id,nombre,direccion), po:purchase_orders(id,po_number,logistics_mode,logistics_target_obra_id,supplier_id), driver:employees!deliveries_driver_id_fkey(id,name), installer:employees!deliveries_installer_id_fkey(id,name)')
        .eq('id', deliveryId).single()
      if (error) { console.error(error); onBack(); return }
      const loaded = data as Delivery
      setD({ ...loaded, photo_evidence: Array.isArray(loaded.photo_evidence) ? loaded.photo_evidence : [] })
      if (loaded.po_id) await loadPOItems(loaded.po_id)
      // Load delivery_items
      const { data: itemsData } = await supabase.from('delivery_items').select('*').eq('delivery_id', loaded.id).order('created_at', { ascending: true })
      setItems(((itemsData || []) as unknown as DeliveryItemRow[]).map(r => ({ ...r, id: r.id || 'db_' + Math.random() })))
    }
    setLoading(false)
  }

  async function loadPOItems(poId: string) {
    const { data } = await supabase.from('po_items').select('id,purchase_order_id,name,description,quantity,unit,unit_cost,product_id').eq('purchase_order_id', poId).order('order_index')
    setPoItems((data || []) as POItem[])
  }

  const update = (patch: Partial<Delivery>) => setD(prev => ({ ...prev, ...patch }))

  // ─── Auto-selección del líder instalador ───
  // Cuando cambia obra_id + delivery_date, buscar en installer_daily_assignment
  useEffect(() => {
    if (!d.obra_id || !d.delivery_date) return
    if (d.installer_id) return  // no sobrescribir si ya hay uno
    let canceled = false
    ;(async () => {
      const { data } = await supabase.from('installer_daily_assignment')
        .select('employee_id, employees:employees!installer_daily_assignment_employee_id_fkey(id,name)')
        .eq('obra_id', d.obra_id)
        .eq('fecha', d.delivery_date)
        .order('created_at', { ascending: true })
        .limit(1)
      if (canceled) return
      const row = (data || [])[0] as unknown as { employee_id: string; employees: { id: string; name: string } } | undefined
      if (row?.employee_id) {
        update({ installer_id: row.employee_id, installer: row.employees as { id: string; name: string } | null })
        setAutoInstallerHint(row.employees?.name || null)
      } else {
        setAutoInstallerHint(null)
      }
    })()
    return () => { canceled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.obra_id, d.delivery_date])

  // ─── Save ───
  async function save(): Promise<string | null> {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        delivery_date: d.delivery_date,
        scheduled_time: d.scheduled_time || null,
        type: d.type,
        status: d.status,
        origin: d.origin || null,
        destination: d.destination || null,
        material_description: d.material_description || null,
        notes: d.notes || null,
        project_id: d.project_id || null,
        obra_id: d.obra_id || null,
        po_id: d.po_id || null,
        driver_id: d.driver_id || null,
        installer_id: d.installer_id || null,
        signature_driver_url: d.signature_driver_url || null,
        signature_receiver_url: d.signature_receiver_url || null,
        photo_evidence: d.photo_evidence || [],
      }

      let savedId = d.id
      if (!d.id) {
        const { data, error } = await supabase.from('deliveries').insert(payload).select('id,folio').single()
        if (error) { alert('Error al crear: ' + error.message); return null }
        savedId = data.id
        setD(prev => ({ ...prev, id: data.id, folio: data.folio }))
      } else {
        const { error } = await supabase.from('deliveries').update(payload).eq('id', d.id)
        if (error) { alert('Error al guardar: ' + error.message); return null }
      }

      // Items: borrar existentes y reinsertar (simple, 0-row safe)
      await supabase.from('delivery_items').delete().eq('delivery_id', savedId)
      if (items.length > 0) {
        const rowsPayload = items.map(it => ({
          delivery_id: savedId,
          po_id: it.po_id || d.po_id || null,
          po_item_id: it.po_item_id || null,
          product_id: it.product_id || null,
          description: it.description,
          qty: it.qty,
          unit: it.unit || null,
          direction: it.direction,
          obra_id: it.obra_id || (it.direction === 'in_bodega' ? null : d.obra_id),
          notes: it.notes || null,
        }))
        const { error: itemsErr } = await supabase.from('delivery_items').insert(rowsPayload)
        if (itemsErr) { alert('Error al guardar items: ' + itemsErr.message); return null }
      }

      return savedId
    } finally {
      setSaving(false)
    }
  }

  async function uploadSignature(dataUrl: string | null, who: 'driver' | 'receiver'): Promise<string | null> {
    if (!dataUrl) return null
    const blob = await (await fetch(dataUrl)).blob()
    const id = d.id || 'tmp-' + Date.now()
    const path = `${id}/signatures/${who}_${Date.now()}.png`
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, { contentType: 'image/png', upsert: true })
    if (error) { console.error(error); return null }
    const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path)
    return pub?.publicUrl || null
  }

  async function handleSignature(dataUrl: string | null, who: 'driver' | 'receiver') {
    const key = who === 'driver' ? 'signature_driver_url' : 'signature_receiver_url'
    if (!dataUrl) { update({ [key]: null } as Partial<Delivery>); return }
    update({ [key]: dataUrl } as Partial<Delivery>)
  }

  async function saveAndUpload(): Promise<string | null> {
    const patches: Partial<Delivery> = {}
    for (const who of ['driver', 'receiver'] as const) {
      const key = who === 'driver' ? 'signature_driver_url' : 'signature_receiver_url'
      const cur = (d as unknown as Record<string, string | null | undefined>)[key]
      if (cur && cur.startsWith('data:image')) {
        const up = await uploadSignature(cur, who)
        if (up) (patches as Record<string, unknown>)[key] = up
      }
    }
    if (Object.keys(patches).length) setD(prev => ({ ...prev, ...patches }))
    // merge patches before save
    if (Object.keys(patches).length) {
      const merged = { ...d, ...patches }
      setD(merged)
      // single tick delay to let React update; but save uses closure — use direct approach:
      return saveWithState(merged)
    }
    return save()
  }

  async function saveWithState(override: Delivery): Promise<string | null> {
    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        delivery_date: override.delivery_date,
        scheduled_time: override.scheduled_time || null,
        type: override.type,
        status: override.status,
        origin: override.origin || null,
        destination: override.destination || null,
        material_description: override.material_description || null,
        notes: override.notes || null,
        project_id: override.project_id || null,
        obra_id: override.obra_id || null,
        po_id: override.po_id || null,
        driver_id: override.driver_id || null,
        installer_id: override.installer_id || null,
        signature_driver_url: override.signature_driver_url || null,
        signature_receiver_url: override.signature_receiver_url || null,
        photo_evidence: override.photo_evidence || [],
      }
      let savedId = override.id
      if (!override.id) {
        const { data, error } = await supabase.from('deliveries').insert(payload).select('id,folio').single()
        if (error) { alert('Error: ' + error.message); return null }
        savedId = data.id
        setD(prev => ({ ...prev, id: data.id, folio: data.folio }))
      } else {
        const { error } = await supabase.from('deliveries').update(payload).eq('id', override.id)
        if (error) { alert('Error: ' + error.message); return null }
      }
      await supabase.from('delivery_items').delete().eq('delivery_id', savedId)
      if (items.length > 0) {
        const rowsPayload = items.map(it => ({
          delivery_id: savedId,
          po_id: it.po_id || override.po_id || null,
          po_item_id: it.po_item_id || null,
          product_id: it.product_id || null,
          description: it.description,
          qty: it.qty,
          unit: it.unit || null,
          direction: it.direction,
          obra_id: it.obra_id || (it.direction === 'in_bodega' ? null : override.obra_id),
          notes: it.notes || null,
        }))
        const { error: itemsErr } = await supabase.from('delivery_items').insert(rowsPayload)
        if (itemsErr) { alert('Error items: ' + itemsErr.message); return null }
      }
      return savedId
    } finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!d.id) { onBack(); return }
    if (!confirm(`¿Eliminar entrega ${d.folio || ''}?`)) return
    await supabase.from('delivery_items').delete().eq('delivery_id', d.id)
    const { error } = await supabase.from('deliveries').delete().eq('id', d.id)
    if (error) { alert('Error: ' + error.message); return }
    onBack()
  }

  async function handlePrintRemision() {
    const id = await saveAndUpload()
    if (!id) return
    const { data } = await supabase.from('deliveries')
      .select('*, project:projects(id,name,client_name), obra:obras(id,nombre,direccion), po:purchase_orders(id,po_number,logistics_mode), driver:employees!deliveries_driver_id_fkey(id,name), installer:employees!deliveries_installer_id_fkey(id,name)')
      .eq('id', id).single()
    const { data: its } = await supabase.from('delivery_items').select('*').eq('delivery_id', id).order('created_at')
    if (data) openRemisionPdf(data as Delivery, (its || []) as unknown as DeliveryItemRow[])
  }

  if (loading) return <div style={{ padding: 24 }}><Loading /></div>

  const obraOptions = obras.map(o => ({ value: o.id, label: o.nombre }))
  const projectOptions = projects.map(p => ({ value: p.id, label: p.name }))
  const poOptions = pos.map(p => ({ value: p.id, label: `${p.po_number} — ${LOGISTICS_CFG[p.logistics_mode || 'pending'].short}` }))
  const driverOptions = employees.map(e => ({ value: e.id, label: e.name }))
  const installerOptions = employees.map(e => ({ value: e.id, label: e.name }))

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <Btn onClick={onBack}><ChevronLeft size={14} /> Volver</Btn>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase' }}>Folio</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>{d.folio || 'NUEVO'}</div>
          <Badge label={STATUS_CFG[d.status].label} color={STATUS_CFG[d.status].color} />
          <Badge label={TYPE_CFG[d.type].label} color={TYPE_CFG[d.type].color} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {d.id && <Btn variant="danger" size="sm" onClick={handleDelete}><Trash2 size={12} /> Eliminar</Btn>}
          <Btn size="sm" onClick={handlePrintRemision}><FileText size={12} /> Imprimir remisión</Btn>
          <Btn variant="primary" size="sm" onClick={saveAndUpload} disabled={saving}>
            <Save size={12} /> {saving ? 'Guardando...' : 'Guardar'}
          </Btn>
        </div>
      </div>

      <Section title="Datos de la entrega">
        <Grid cols={4}>
          <Field label="Fecha" type="date" value={d.delivery_date} onChange={v => update({ delivery_date: v })} />
          <Field label="Hora" type="time" value={d.scheduled_time || ''} onChange={v => update({ scheduled_time: v })} />
          <SelectField label="Tipo" value={d.type} onChange={v => update({ type: v as DeliveryType })}
            options={(Object.keys(TYPE_CFG) as DeliveryType[]).map(k => ({ value: k, label: TYPE_CFG[k].label }))} />
          <SelectField label="Status" value={d.status} onChange={v => update({ status: v as DeliveryStatus })}
            options={(Object.keys(STATUS_CFG) as DeliveryStatus[]).map(k => ({ value: k, label: STATUS_CFG[k].label }))} />
        </Grid>
      </Section>

      <Section title="Vínculos — PO / Proyecto / Obra">
        <Grid cols={3}>
          <SelectField label="Orden de compra" value={d.po_id || ''}
            onChange={v => {
              update({ po_id: v || null })
              if (v) {
                loadPOItems(v)
                const po = pos.find(p => p.id === v)
                if (po) {
                  const mode = po.logistics_mode
                  const patch: Partial<Delivery> = {
                    project_id: po.project_id || d.project_id,
                    obra_id: (mode === 'pickup_to_obra' || mode === 'supplier_to_obra') ? (po.logistics_target_obra_id || d.obra_id) : d.obra_id,
                  }
                  setD(prev => ({ ...prev, ...patch }))
                }
              } else setPoItems([])
            }}
            placeholder="Sin PO (movimiento manual)" options={poOptions} />
          <SelectField label="Proyecto" value={d.project_id || ''} onChange={v => update({ project_id: v || null })}
            placeholder="Sin proyecto" options={projectOptions} />
          <SelectField label="Obra destino" value={d.obra_id || ''}
            onChange={v => {
              const obra = obras.find(o => o.id === v)
              update({ obra_id: v || null, destination: obra?.direccion || obra?.nombre || d.destination, installer_id: null })
              setAutoInstallerHint(null)
            }}
            placeholder={d.type === 'recoleccion' ? 'N/A (a bodega)' : 'Seleccionar obra'} options={obraOptions} />
        </Grid>
      </Section>

      <Section title="Logística">
        <Grid cols={2}>
          <Field label="Origen" value={d.origin || ''} onChange={v => update({ origin: v })} placeholder="Proveedor, bodega OMM, etc." />
          <Field label="Destino" value={d.destination || ''} onChange={v => update({ destination: v })} placeholder="Dirección de obra, bodega OMM..." />
        </Grid>
        <div style={{ height: 12 }} />
        <Grid cols={2}>
          <SelectField label="Chofer" value={d.driver_id || ''} onChange={v => update({ driver_id: v || null })}
            placeholder="Seleccionar empleado" options={driverOptions} />
          <div>
            <SelectField label="Recibe (líder instalador)" value={d.installer_id || ''}
              onChange={v => { update({ installer_id: v || null }); setAutoInstallerHint(null) }}
              placeholder="Seleccionar" options={installerOptions} disabled={d.type === 'recoleccion'} />
            {autoInstallerHint && (
              <div style={{ fontSize: 10, color: '#57FF9A', marginTop: 4 }}>
                <Sparkles size={9} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                Auto-asignado del plan del día: {autoInstallerHint}
              </div>
            )}
          </div>
        </Grid>
      </Section>

      <Section title={`Items (${items.length})`}>
        <ItemsEditor items={items} onChange={setItems} poItems={poItems} deliveryType={d.type} obraId={d.obra_id || null} />
        <div style={{ height: 12 }} />
        <TextArea label="Descripción general (opcional)" value={d.material_description || ''} onChange={v => update({ material_description: v })} />
      </Section>

      <Section title="Firmas">
        <Grid cols={2}>
          <SignaturePad label="Chofer (entrega)" value={d.signature_driver_url} onChange={dataUrl => handleSignature(dataUrl, 'driver')} />
          <SignaturePad label={`Recibe${d.installer?.name ? ` — ${d.installer.name}` : ''}`} value={d.signature_receiver_url} onChange={dataUrl => handleSignature(dataUrl, 'receiver')} />
        </Grid>
      </Section>

      <Section title="Evidencia fotográfica">
        <PhotoUploader urls={d.photo_evidence || []} onChange={urls => update({ photo_evidence: urls })} deliveryId={d.id || 'tmp'} />
      </Section>

      <Section title="Notas">
        <TextArea label="Observaciones" value={d.notes || ''} onChange={v => update({ notes: v })} rows={3} />
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 24, paddingTop: 16, borderTop: '1px solid #222' }}>
        <Btn onClick={onBack}>Cancelar</Btn>
        <Btn variant="primary" onClick={async () => { const id = await saveAndUpload(); if (id) onBack() }} disabled={saving}>
          <Save size={12} /> {saving ? 'Guardando...' : 'Guardar y cerrar'}
        </Btn>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ITEMS EDITOR
// ═══════════════════════════════════════════════════════════════════════════════

function defaultDirection(deliveryType: DeliveryType): ItemDirection {
  if (deliveryType === 'recoleccion')         return 'in_bodega'
  if (deliveryType === 'recoleccion_directa') return 'in_obra'
  return 'out_bodega_to_obra'  // entrega bodega → obra
}

function ItemsEditor({ items, onChange, poItems, deliveryType, obraId }: {
  items: DeliveryItemRow[]
  onChange: (items: DeliveryItemRow[]) => void
  poItems: POItem[]
  deliveryType: DeliveryType
  obraId: string | null
}) {
  const [showPicker, setShowPicker] = useState(false)
  const dir = defaultDirection(deliveryType)

  const addRow = () => onChange([...items, {
    id: 'itm_' + Date.now(), description: '', qty: 1, unit: 'pza',
    direction: dir, obra_id: dir === 'in_bodega' ? null : obraId,
  }])

  const updateRow = (id: string, patch: Partial<DeliveryItemRow>) =>
    onChange(items.map(it => it.id === id ? { ...it, ...patch } : it))

  const removeRow = (id: string) => onChange(items.filter(it => it.id !== id))

  const addFromPO = (selected: POItem[]) => {
    const existing = new Set(items.filter(i => i.po_item_id).map(i => i.po_item_id))
    const toAdd: DeliveryItemRow[] = selected.filter(p => !existing.has(p.id)).map(p => ({
      id: 'itm_po_' + p.id,
      po_item_id: p.id,
      product_id: p.product_id || null,
      description: p.name + (p.description ? ' — ' + p.description : ''),
      qty: p.quantity,
      unit: p.unit || 'pza',
      direction: dir,
      obra_id: dir === 'in_bodega' ? null : obraId,
    }))
    onChange([...items, ...toAdd])
    setShowPicker(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <Btn size="sm" onClick={addRow}><Plus size={12} /> Item manual</Btn>
        <Btn size="sm" onClick={() => setShowPicker(true)} disabled={poItems.length === 0}>
          <Package size={12} /> Agregar de PO ({poItems.length})
        </Btn>
      </div>

      {items.length === 0 ? (
        <EmptyState message="Sin items. Agrega manualmente o desde la PO." />
      ) : (
        <Table>
          <thead>
            <tr><Th>#</Th><Th>Descripción</Th><Th right>Cant.</Th><Th>Unidad</Th><Th>Dirección</Th><Th>Origen</Th><Th></Th></tr>
          </thead>
          <tbody>
            {items.map((it, idx) => (
              <tr key={it.id}>
                <Td muted>{idx + 1}</Td>
                <Td>
                  <input value={it.description} onChange={e => updateRow(it.id, { description: e.target.value })}
                    style={inlineInput} placeholder="Descripción" />
                </Td>
                <Td right>
                  <input type="number" value={it.qty}
                    onChange={e => updateRow(it.id, { qty: parseFloat(e.target.value) || 0 })}
                    style={{ ...inlineInput, textAlign: 'right', width: 70 }} />
                </Td>
                <Td>
                  <input value={it.unit || ''} onChange={e => updateRow(it.id, { unit: e.target.value })}
                    style={{ ...inlineInput, width: 60 }} placeholder="pza" />
                </Td>
                <Td>
                  <select value={it.direction} onChange={e => updateRow(it.id, { direction: e.target.value as ItemDirection })}
                    style={{ ...inlineInput, width: 120 }}>
                    <option value="in_bodega">→ bodega</option>
                    <option value="in_obra">→ obra (directo)</option>
                    <option value="out_bodega_to_obra">bodega → obra</option>
                  </select>
                </Td>
                <Td muted style={{ fontSize: 10 }}>{it.po_item_id ? 'PO' : 'manual'}</Td>
                <Td>
                  <button onClick={() => removeRow(it.id)} type="button"
                    style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', padding: 4 }}>
                    <X size={12} />
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {showPicker && (
        <POItemsPicker poItems={poItems}
          alreadyAdded={items.filter(i => i.po_item_id).map(i => i.po_item_id!)}
          onPick={addFromPO} onClose={() => setShowPicker(false)} />
      )}
    </div>
  )
}

const inlineInput: React.CSSProperties = {
  width: '100%', padding: '4px 6px', background: '#1a1a1a', border: '1px solid #2a2a2a',
  borderRadius: 4, color: '#ccc', fontSize: 12, fontFamily: 'inherit',
}

function POItemsPicker({ poItems, alreadyAdded, onPick, onClose }: {
  poItems: POItem[]; alreadyAdded: string[]; onPick: (selected: POItem[]) => void; onClose: () => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggle = (id: string) => {
    const s = new Set(checked)
    if (s.has(id)) s.delete(id); else s.add(id)
    setChecked(s)
  }
  const available = poItems.filter(p => !alreadyAdded.includes(p.id))

  return (
    <div style={modalBackdrop} onClick={onClose}>
      <div style={modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>Items de la PO</div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
        {available.length === 0 ? (
          <EmptyState message="Ya se agregaron todos los items de esta PO." />
        ) : (
          <div style={{ maxHeight: '60vh', overflowY: 'auto' as const }}>
            {available.map(p => (
              <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderBottom: '1px solid #1a1a1a', cursor: 'pointer' }}>
                <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: '#fff' }}>{p.name}</div>
                  {p.description && <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{p.description}</div>}
                </div>
                <div style={{ fontSize: 11, color: '#888', minWidth: 80, textAlign: 'right' as const }}>
                  {p.quantity} {p.unit || ''}
                </div>
              </label>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={() => onPick(available.filter(p => checked.has(p.id)))} disabled={checked.size === 0}>
            Agregar {checked.size > 0 ? `(${checked.size})` : ''}
          </Btn>
        </div>
      </div>
    </div>
  )
}

const modalBackdrop: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const modalCard: React.CSSProperties = {
  background: '#111', border: '1px solid #222', borderRadius: 12, padding: 20,
  width: 'min(720px, 92vw)', maxHeight: '90vh', overflowY: 'auto' as const,
}

// ═══════════════════════════════════════════════════════════════════════════════
//  REMISIÓN PDF — ventana nueva
// ═══════════════════════════════════════════════════════════════════════════════

function openRemisionPdf(d: Delivery, items: DeliveryItemRow[]) {
  const w = window.open('', '_blank')
  if (!w) { alert('El navegador bloqueó la ventana. Habilita popups.'); return }

  const fmtDate = (s?: string | null) => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: '2-digit' }) : ''
  const fmtTime = (s?: string | null) => s ? s.slice(0,5) : ''

  const itemsHTML = items.map((it, i) => `
    <tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${escapeHtml(it.description || '')}</td>
      <td style="text-align:right;">${it.qty}</td>
      <td style="text-align:center;">${escapeHtml(it.unit || '')}</td>
      <td style="text-align:center;font-size:9px;color:#666;">${it.direction === 'in_bodega' ? '→ bodega' : it.direction === 'in_obra' ? '→ obra' : 'bodega→obra'}</td>
    </tr>
  `).join('')

  const photosHTML = (d.photo_evidence || []).map(url => `
    <img src="${url}" style="width:160px;height:160px;object-fit:cover;border:1px solid #ccc;border-radius:4px;margin:4px;" />
  `).join('')

  const sigBlock = (label: string, name: string | null | undefined, url: string | null | undefined) => `
    <div style="text-align:center;">
      <div style="height:100px;border-bottom:1px solid #333;display:flex;align-items:flex-end;justify-content:center;padding-bottom:4px;">
        ${url ? `<img src="${url}" style="max-height:90px;max-width:180px;object-fit:contain;" />` : '<span style="color:#999;font-size:10px;">(sin firma)</span>'}
      </div>
      <div style="font-size:11px;font-weight:600;margin-top:6px;">${escapeHtml(label)}</div>
      ${name ? `<div style="font-size:10px;color:#666;">${escapeHtml(name)}</div>` : ''}
    </div>
  `

  const typeLabel = TYPE_CFG[d.type].label.toUpperCase()

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"/><title>Remisión ${d.folio || ''}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color: #111; padding: 24px; max-width: 780px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0; letter-spacing: 0.05em; }
  .muted { color: #666; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f4f4f4; text-align: left; padding: 6px 8px; border: 1px solid #ddd; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 6px 8px; border: 1px solid #eee; font-size: 11px; }
  .kv { display: grid; grid-template-columns: 120px 1fr; gap: 4px 12px; font-size: 11px; }
  .kv .k { color: #666; text-transform: uppercase; font-size: 9px; letter-spacing: 0.05em; padding-top: 3px; }
  .section { margin-top: 18px; }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
  .footer { margin-top: 24px; font-size: 10px; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 12px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
  .badge { display: inline-block; padding: 2px 8px; background: #f0f0f0; border-radius: 12px; font-size: 10px; }
  @media print {
    body { padding: 10mm; max-width: none; }
    .no-print { display: none; }
    @page { size: letter; margin: 10mm; }
  }
</style></head><body>
  <div class="no-print" style="text-align:right;margin-bottom:12px;">
    <button onclick="window.print()" style="padding:8px 16px;background:#57FF9A;border:none;border-radius:6px;font-weight:600;cursor:pointer;">Imprimir / Guardar PDF</button>
  </div>
  <div class="header">
    <div>
      <h1>REMISIÓN · ${typeLabel}</h1>
      <div class="muted" style="margin-top:4px;">OMM Technologies SA de CV &nbsp;·&nbsp; RFC OTE210910PW5</div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:11px;color:#666;">FOLIO</div>
      <div style="font-size:22px;font-weight:700;font-family:monospace;">${d.folio || '—'}</div>
      <div class="badge" style="margin-top:4px;">${STATUS_CFG[d.status].label}</div>
    </div>
  </div>
  <div class="kv">
    <div class="k">Fecha</div><div>${fmtDate(d.delivery_date)}${d.scheduled_time ? ' &nbsp;·&nbsp; ' + fmtTime(d.scheduled_time) : ''}</div>
    <div class="k">Proyecto</div><div>${escapeHtml(d.project?.name || '—')}${d.project?.client_name ? ' &nbsp;·&nbsp; ' + escapeHtml(d.project.client_name) : ''}</div>
    <div class="k">Obra</div><div>${escapeHtml(d.obra?.nombre || '—')}${d.obra?.direccion ? ' &nbsp;·&nbsp; ' + escapeHtml(d.obra.direccion) : ''}</div>
    ${d.po?.po_number ? `<div class="k">PO</div><div>${escapeHtml(d.po.po_number)}</div>` : ''}
    <div class="k">Origen</div><div>${escapeHtml(d.origin || '—')}</div>
    <div class="k">Destino</div><div>${escapeHtml(d.destination || '—')}</div>
    <div class="k">Chofer</div><div>${escapeHtml(d.driver?.name || '—')}</div>
    <div class="k">Recibe</div><div>${escapeHtml(d.installer?.name || '—')}</div>
  </div>
  ${items.length > 0 ? `
  <div class="section">
    <div style="font-size:12px;font-weight:700;margin-bottom:6px;">MATERIAL</div>
    <table>
      <thead><tr><th style="width:30px;">#</th><th>Descripción</th><th style="width:60px;text-align:right;">Cant.</th><th style="width:60px;text-align:center;">Unidad</th><th style="width:90px;text-align:center;">Flujo</th></tr></thead>
      <tbody>${itemsHTML}</tbody>
    </table>
  </div>` : ''}
  ${d.material_description ? `<div class="section"><div style="font-size:12px;font-weight:700;margin-bottom:4px;">DESCRIPCIÓN GENERAL</div><div style="font-size:11px;color:#444;white-space:pre-wrap;">${escapeHtml(d.material_description)}</div></div>` : ''}
  ${d.notes ? `<div class="section"><div style="font-size:12px;font-weight:700;margin-bottom:4px;">NOTAS</div><div style="font-size:11px;color:#444;white-space:pre-wrap;">${escapeHtml(d.notes)}</div></div>` : ''}
  <div class="section sig-grid">
    ${sigBlock('Chofer (entrega)', d.driver?.name, d.signature_driver_url)}
    ${sigBlock('Recibe (obra)', d.installer?.name, d.signature_receiver_url)}
  </div>
  ${d.photo_evidence && d.photo_evidence.length > 0 ? `<div class="section" style="page-break-before:always;"><div style="font-size:12px;font-weight:700;margin-bottom:8px;">EVIDENCIA FOTOGRÁFICA (${d.photo_evidence.length})</div><div style="display:flex;flex-wrap:wrap;">${photosHTML}</div></div>` : ''}
  <div class="footer">Generado por OMM ERP &nbsp;·&nbsp; ${new Date().toLocaleString('es-MX')}</div>
  <script>setTimeout(() => window.print(), 600);</script>
</body></html>`
  w.document.write(html)
  w.document.close()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
