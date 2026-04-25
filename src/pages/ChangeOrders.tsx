import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { ChangeOrder, ChangeOrderItem, QuotationItem, QuotationArea, CatalogProduct } from '../types'
import { F, calcItemPrice, calcItemTotal, formatDate } from '../lib/utils'
import { Btn, Badge, Loading } from '../components/layout/UI'
import { Plus, X, Check, AlertTriangle, ArrowRight, Trash2, ChevronDown, ChevronUp } from 'lucide-react'

// ─── CONSTANTS ─────────────────────────────────────────────────────────
const ACCION_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  agregar: { label: 'Agregar', color: '#22c55e', icon: '+' },
  quitar:  { label: 'Quitar',  color: '#ef4444', icon: '-' },
  swap:    { label: 'Cambio',  color: '#f59e0b', icon: '⇄' },
  qty:     { label: 'Cantidad',color: '#3b82f6', icon: '#' },
}

const ESTADO_CONFIG: Record<string, { label: string; color: string }> = {
  borrador:  { label: 'Borrador',  color: '#666' },
  pendiente: { label: 'Pendiente', color: '#f59e0b' },
  aprobada:  { label: 'Aprobada',  color: '#22c55e' },
  rechazada: { label: 'Rechazada', color: '#ef4444' },
}

// Threshold for requiring approval (configurable)
const APPROVAL_THRESHOLD = 5000

interface Props {
  cotId: string
  items: QuotationItem[]
  areas: QuotationArea[]
  catalog: CatalogProduct[]
  specialty: string
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────
export default function ChangeOrders({ cotId, items, areas, catalog, specialty }: Props) {
  const [orders, setOrders] = useState<ChangeOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingOrder, setEditingOrder] = useState<ChangeOrder | null>(null)

  // ─── LOAD ─────────────────────────────────────────────────────────
  async function loadOrders() {
    setLoading(true)
    const { data } = await supabase
      .from('change_orders')
      .select('*, items:change_order_items(*)')
      .eq('quotation_id', cotId)
      .order('numero')
    setOrders((data || []) as any)
    setLoading(false)
  }

  useEffect(() => { loadOrders() }, [cotId])

  // ─── SUMMARY CALCULATIONS ──────────────────────────────────────────
  const summary = useMemo(() => {
    const originalTotal = items.reduce((s, i) => s + i.total, 0)
    let deltaNeto = 0
    orders.filter(o => o.estado === 'aprobada').forEach(o => {
      deltaNeto += o.delta_costo || 0
    })
    return {
      originalTotal,
      deltaNeto,
      obraReal: originalTotal + deltaNeto,
      numOrders: orders.length,
      numAprobadas: orders.filter(o => o.estado === 'aprobada').length,
      numPendientes: orders.filter(o => o.estado === 'pendiente').length,
    }
  }, [orders, items])

  // ─── CREATE NEW ORDER ──────────────────────────────────────────────
  async function createOrder(motivo: string, descripcion: string, orderItems: NewOrderItem[]) {
    // Calculate delta
    let delta = 0
    const dbItems: any[] = []
    for (const oi of orderItems) {
      let subtotal = 0
      if (oi.accion === 'agregar') {
        subtotal = calcItemTotal(oi.costo, oi.markup, oi.cantidad_nueva)
      } else if (oi.accion === 'quitar') {
        subtotal = -calcItemTotal(oi.costo, oi.markup, oi.cantidad_original)
      } else if (oi.accion === 'qty') {
        const diff = oi.cantidad_nueva - oi.cantidad_original
        subtotal = diff * calcItemPrice(oi.costo, oi.markup)
      } else if (oi.accion === 'swap') {
        const oldTotal = calcItemTotal(oi.costoOriginal || oi.costo, oi.markupOriginal || oi.markup, oi.cantidad_original)
        const newTotal = calcItemTotal(oi.costo, oi.markup, oi.cantidad_nueva || oi.cantidad_original)
        subtotal = newTotal - oldTotal
      }
      delta += subtotal
      dbItems.push({
        accion: oi.accion,
        original_item_id: oi.original_item_id || null,
        catalog_product_id: oi.catalog_product_id || null,
        nombre: oi.nombre,
        descripcion: oi.descripcion || null,
        marca: oi.marca || null,
        modelo: oi.modelo || null,
        unidad: oi.unidad || 'pza',
        area_id: oi.area_id || null,
        system_name: oi.system_name || null,
        cantidad_original: oi.cantidad_original,
        cantidad_nueva: oi.cantidad_nueva,
        costo: oi.costo,
        markup: oi.markup,
        precio: calcItemPrice(oi.costo, oi.markup),
        subtotal,
        notas: oi.notas || null,
      })
    }

    const nextNumero = orders.length > 0 ? Math.max(...orders.map(o => o.numero)) + 1 : 1
    const needsApproval = Math.abs(delta) > APPROVAL_THRESHOLD

    const { data: co, error } = await supabase.from('change_orders').insert({
      quotation_id: cotId,
      numero: nextNumero,
      motivo,
      descripcion,
      estado: needsApproval ? 'pendiente' : 'borrador',
      delta_costo: Math.round(delta),
      requiere_aprobacion: needsApproval,
    }).select().single()

    if (error || !co) { alert('Error: ' + (error?.message || '')); return }

    // Insert items
    const itemsWithOrderId = dbItems.map(i => ({ ...i, change_order_id: co.id }))
    await supabase.from('change_order_items').insert(itemsWithOrderId)

    await loadOrders()
    setShowNew(false)
  }

  // ─── UPDATE STATUS ──────────────────────────────────────────────────
  async function updateEstado(orderId: string, estado: string) {
    const updates: any = { estado, updated_at: new Date().toISOString() }
    if (estado === 'aprobada') {
      updates.aprobado_at = new Date().toISOString()
    }
    await supabase.from('change_orders').update(updates).eq('id', orderId)
    await loadOrders()
  }

  async function deleteOrder(orderId: string) {
    if (!confirm('¿Eliminar esta orden de cambio?')) return
    await supabase.from('change_order_items').delete().eq('change_order_id', orderId)
    await supabase.from('change_orders').delete().eq('id', orderId)
    setOrders(prev => prev.filter(o => o.id !== orderId))
    if (expandedId === orderId) setExpandedId(null)
  }

  // ─── OBRA REAL (original + approved changes) ───────────────────────
  const obraReal = useMemo(() => {
    // Start with original items
    const result: ObraRealItem[] = items.map(it => ({
      ...it,
      fuente: 'original' as const,
      cambio: null,
    }))

    // Apply approved changes
    orders.filter(o => o.estado === 'aprobada').forEach(co => {
      const coItems = co.items || []
      coItems.forEach(ci => {
        if (ci.accion === 'agregar') {
          result.push({
            id: ci.id,
            name: ci.nombre,
            description: ci.descripcion,
            system: ci.system_name as any,
            quantity: ci.cantidad_nueva,
            cost: ci.costo,
            markup: ci.markup,
            price: ci.precio,
            total: ci.subtotal,
            area_id: ci.area_id || '',
            quotation_id: '',
            type: 'material',
            created_at: ci.created_at,
            catalog_product_id: ci.catalog_product_id,
            provider: ci.marca,
            purchase_phase: 'inicio' as any,
            installation_cost: 0,
            order_index: 0,
            fuente: 'cambio',
            cambio: { orden: co.numero, accion: ci.accion },
          })
        } else if (ci.accion === 'quitar' && ci.original_item_id) {
          const idx = result.findIndex(r => r.id === ci.original_item_id)
          if (idx >= 0) result.splice(idx, 1)
        } else if (ci.accion === 'qty' && ci.original_item_id) {
          const idx = result.findIndex(r => r.id === ci.original_item_id)
          if (idx >= 0) {
            result[idx] = {
              ...result[idx],
              quantity: ci.cantidad_nueva,
              total: calcItemTotal(result[idx].cost, result[idx].markup, ci.cantidad_nueva),
              fuente: 'modificado',
              cambio: { orden: co.numero, accion: ci.accion },
            }
          }
        } else if (ci.accion === 'swap' && ci.original_item_id) {
          const idx = result.findIndex(r => r.id === ci.original_item_id)
          if (idx >= 0) {
            result[idx] = {
              ...result[idx],
              name: ci.nombre,
              description: ci.descripcion,
              cost: ci.costo,
              markup: ci.markup,
              price: ci.precio,
              quantity: ci.cantidad_nueva || result[idx].quantity,
              total: calcItemTotal(ci.costo, ci.markup, ci.cantidad_nueva || result[idx].quantity),
              catalog_product_id: ci.catalog_product_id,
              fuente: 'modificado',
              cambio: { orden: co.numero, accion: ci.accion },
            }
          }
        }
      })
    })

    return result
  }, [items, orders])

  if (loading) return <Loading />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Summary Bar */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #222', background: '#111', display: 'flex', gap: 24, alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.1em' }}>Original</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{F(summary.originalTotal)}</div>
        </div>
        <ArrowRight size={14} style={{ color: '#444' }} />
        <div>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.1em' }}>Cambios Netos</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: summary.deltaNeto >= 0 ? '#22c55e' : '#ef4444' }}>
            {summary.deltaNeto >= 0 ? '+' : ''}{F(summary.deltaNeto)}
          </div>
        </div>
        <ArrowRight size={14} style={{ color: '#444' }} />
        <div>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.1em' }}>Obra Real</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#57FF9A' }}>{F(summary.obraReal)}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#666' }}>
            {summary.numOrders} orden{summary.numOrders !== 1 ? 'es' : ''}
            {summary.numPendientes > 0 && <span style={{ color: '#f59e0b' }}> · {summary.numPendientes} pendiente{summary.numPendientes !== 1 ? 's' : ''}</span>}
          </span>
          <Btn size="sm" variant="primary" onClick={() => setShowNew(true)}><Plus size={12} /> Nueva Orden</Btn>
        </div>
      </div>

      {/* Content: either list or New form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0' }}>
        {orders.length === 0 && !showNew ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#555' }}>
            <AlertTriangle size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Sin ordenes de cambio</div>
            <div style={{ fontSize: 12 }}>Las ordenes de cambio documentan diferencias entre la cotizacion contratada y la obra real.</div>
          </div>
        ) : (
          <div>
            {orders.map(co => {
              const est = ESTADO_CONFIG[co.estado] || ESTADO_CONFIG.borrador
              const expanded = expandedId === co.id
              const coItems = co.items || []
              return (
                <div key={co.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                  {/* Order header */}
                  <div
                    onClick={() => setExpandedId(expanded ? null : co.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', cursor: 'pointer', background: expanded ? '#141414' : 'transparent' }}
                  >
                    {expanded ? <ChevronUp size={14} style={{ color: '#555' }} /> : <ChevronDown size={14} style={{ color: '#555' }} />}
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#888', minWidth: 50 }}>OC-{String(co.numero).padStart(2, '0')}</span>
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#ddd', flex: 1 }}>{co.motivo}</span>
                    <span style={{ fontSize: 11, color: '#555' }}>{coItems.length} item{coItems.length !== 1 ? 's' : ''}</span>
                    <div style={{ padding: '2px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600, background: est.color + '22', color: est.color, border: `1px solid ${est.color}44` }}>
                      {est.label}
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: (co.delta_costo || 0) >= 0 ? '#22c55e' : '#ef4444', minWidth: 80, textAlign: 'right' }}>
                      {(co.delta_costo || 0) >= 0 ? '+' : ''}{F(co.delta_costo || 0)}
                    </span>
                  </div>

                  {/* Expanded details */}
                  {expanded && (
                    <div style={{ padding: '0 16px 16px 40px' }}>
                      {co.descripcion && <p style={{ fontSize: 12, color: '#888', margin: '0 0 12px', lineHeight: 1.5 }}>{co.descripcion}</p>}

                      {/* Items table */}
                      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                        <thead>
                          <tr style={{ background: '#1a1a1a' }}>
                            {['Accion', 'Producto', 'Area', 'Cant. Orig', 'Cant. Nueva', 'Costo', 'Precio', 'Subtotal'].map(h => (
                              <th key={h} style={{ padding: '6px 8px', fontSize: 10, fontWeight: 600, color: '#444', textAlign: h === 'Producto' || h === 'Area' || h === 'Accion' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #222' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {coItems.map((ci: ChangeOrderItem) => {
                            const acc = ACCION_CONFIG[ci.accion] || ACCION_CONFIG.agregar
                            const areaName = ci.area_id ? areas.find(a => a.id === ci.area_id)?.name : '--'
                            return (
                              <tr key={ci.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
                                <td style={{ padding: '7px 8px' }}>
                                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: acc.color + '22', color: acc.color }}>{acc.icon} {acc.label}</span>
                                </td>
                                <td style={{ padding: '7px 8px', fontSize: 12, color: '#ddd', fontWeight: 500 }}>
                                  {ci.nombre}
                                  {ci.marca && <span style={{ fontSize: 10, color: '#666', marginLeft: 6 }}>{ci.marca}</span>}
                                </td>
                                <td style={{ padding: '7px 8px', fontSize: 11, color: '#666' }}>{areaName}</td>
                                <td style={{ padding: '7px 8px', fontSize: 12, color: '#888', textAlign: 'right' }}>{ci.cantidad_original || '--'}</td>
                                <td style={{ padding: '7px 8px', fontSize: 12, color: '#fff', textAlign: 'right', fontWeight: 500 }}>{ci.cantidad_nueva || '--'}</td>
                                <td style={{ padding: '7px 8px', fontSize: 12, color: '#888', textAlign: 'right' }}>{F(ci.costo)}</td>
                                <td style={{ padding: '7px 8px', fontSize: 12, color: '#888', textAlign: 'right' }}>{F(ci.precio)}</td>
                                <td style={{ padding: '7px 8px', fontSize: 12, textAlign: 'right', fontWeight: 600, color: ci.subtotal >= 0 ? '#22c55e' : '#ef4444' }}>
                                  {ci.subtotal >= 0 ? '+' : ''}{F(ci.subtotal)}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {co.estado === 'borrador' && (
                          <>
                            <Btn size="sm" variant="primary" onClick={() => updateEstado(co.id, co.requiere_aprobacion ? 'pendiente' : 'aprobada')}>
                              <Check size={12} /> {co.requiere_aprobacion ? 'Enviar a aprobacion' : 'Aprobar'}
                            </Btn>
                            <Btn size="sm" onClick={() => deleteOrder(co.id)} style={{ color: '#ef4444' }}><Trash2 size={12} /> Eliminar</Btn>
                          </>
                        )}
                        {co.estado === 'pendiente' && (
                          <>
                            <Btn size="sm" variant="primary" onClick={() => updateEstado(co.id, 'aprobada')}><Check size={12} /> Aprobar</Btn>
                            <Btn size="sm" onClick={() => updateEstado(co.id, 'rechazada')} style={{ color: '#ef4444' }}>Rechazar</Btn>
                          </>
                        )}
                        {co.estado === 'rechazada' && (
                          <Btn size="sm" onClick={() => updateEstado(co.id, 'borrador')}>Reabrir</Btn>
                        )}
                        {co.requiere_aprobacion && (
                          <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 8 }}>
                            <AlertTriangle size={10} style={{ verticalAlign: 'middle' }} /> Requiere aprobacion (delta {'>'} ${APPROVAL_THRESHOLD.toLocaleString()})
                          </span>
                        )}
                        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#444' }}>
                          {formatDate(co.created_at)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* New Order Modal */}
      {showNew && (
        <NewOrderModal
          items={items}
          areas={areas}
          catalog={catalog}
          specialty={specialty}
          onSave={createOrder}
          onClose={() => setShowNew(false)}
        />
      )}
    </div>
  )
}

// ─── TYPES ─────────────────────────────────────────────────────────────
interface ObraRealItem extends QuotationItem {
  fuente: 'original' | 'cambio' | 'modificado'
  cambio: { orden: number; accion: string } | null
}

interface NewOrderItem {
  accion: string
  original_item_id?: string
  catalog_product_id?: string
  nombre: string
  descripcion?: string
  marca?: string
  modelo?: string
  unidad?: string
  area_id?: string
  system_name?: string
  cantidad_original: number
  cantidad_nueva: number
  costo: number
  markup: number
  costoOriginal?: number
  markupOriginal?: number
  notas?: string
}

// ─── NEW ORDER MODAL ──────────────────────────────────────────────────
function NewOrderModal({ items, areas, catalog, specialty, onSave, onClose }: {
  items: QuotationItem[]
  areas: QuotationArea[]
  catalog: CatalogProduct[]
  specialty: string
  onSave: (motivo: string, descripcion: string, items: NewOrderItem[]) => Promise<void>
  onClose: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [orderItems, setOrderItems] = useState<NewOrderItem[]>([])
  const [saving, setSaving] = useState(false)
  const [showAddItem, setShowAddItem] = useState(false)
  const [addAccion, setAddAccion] = useState<string>('agregar')
  const [selectedOriginal, setSelectedOriginal] = useState<string>('')
  const [selectedCatalog, setSelectedCatalog] = useState<string>('')
  const [cantNueva, setCantNueva] = useState<number>(1)
  const [searchCat, setSearchCat] = useState('')

  const relevantCatalog = catalog.filter(p => (p.specialty || 'esp') === specialty)

  function addItem() {
    if (addAccion === 'agregar') {
      const prod = relevantCatalog.find(p => p.id === selectedCatalog)
      if (!prod) return
      setOrderItems([...orderItems, {
        accion: 'agregar',
        catalog_product_id: prod.id,
        nombre: prod.name,
        descripcion: prod.description,
        marca: (prod as any).marca,
        modelo: (prod as any).modelo,
        unidad: (prod as any).unit || 'pza',
        cantidad_original: 0,
        cantidad_nueva: cantNueva,
        costo: prod.cost,
        markup: prod.markup,
      }])
    } else if (addAccion === 'quitar') {
      const orig = items.find(i => i.id === selectedOriginal)
      if (!orig) return
      setOrderItems([...orderItems, {
        accion: 'quitar',
        original_item_id: orig.id,
        nombre: orig.name,
        cantidad_original: orig.quantity,
        cantidad_nueva: 0,
        costo: orig.cost,
        markup: orig.markup,
      }])
    } else if (addAccion === 'qty') {
      const orig = items.find(i => i.id === selectedOriginal)
      if (!orig) return
      setOrderItems([...orderItems, {
        accion: 'qty',
        original_item_id: orig.id,
        nombre: orig.name,
        cantidad_original: orig.quantity,
        cantidad_nueva: cantNueva,
        costo: orig.cost,
        markup: orig.markup,
      }])
    } else if (addAccion === 'swap') {
      const orig = items.find(i => i.id === selectedOriginal)
      const prod = relevantCatalog.find(p => p.id === selectedCatalog)
      if (!orig || !prod) return
      setOrderItems([...orderItems, {
        accion: 'swap',
        original_item_id: orig.id,
        catalog_product_id: prod.id,
        nombre: prod.name,
        descripcion: prod.description,
        marca: (prod as any).marca,
        modelo: (prod as any).modelo,
        cantidad_original: orig.quantity,
        cantidad_nueva: cantNueva || orig.quantity,
        costo: prod.cost,
        markup: prod.markup,
        costoOriginal: orig.cost,
        markupOriginal: orig.markup,
      }])
    }
    setShowAddItem(false)
    setSelectedOriginal('')
    setSelectedCatalog('')
    setCantNueva(1)
    setSearchCat('')
  }

  function removeItem(idx: number) {
    setOrderItems(orderItems.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!motivo.trim() || orderItems.length === 0) return
    setSaving(true)
    await onSave(motivo, descripcion, orderItems)
    setSaving(false)
  }

  // Calculate preview delta
  const previewDelta = orderItems.reduce((sum, oi) => {
    if (oi.accion === 'agregar') return sum + calcItemTotal(oi.costo, oi.markup, oi.cantidad_nueva)
    if (oi.accion === 'quitar') return sum - calcItemTotal(oi.costo, oi.markup, oi.cantidad_original)
    if (oi.accion === 'qty') return sum + (oi.cantidad_nueva - oi.cantidad_original) * calcItemPrice(oi.costo, oi.markup)
    if (oi.accion === 'swap') {
      const oldT = calcItemTotal(oi.costoOriginal || oi.costo, oi.markupOriginal || oi.markup, oi.cantidad_original)
      const newT = calcItemTotal(oi.costo, oi.markup, oi.cantidad_nueva || oi.cantidad_original)
      return sum + newT - oldT
    }
    return sum
  }, 0)

  const filteredCatalog = relevantCatalog.filter(p => {
    if (!searchCat.trim()) return true
    const q = searchCat.toLowerCase()
    return p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || ((p as any).marca || '').toLowerCase().includes(q)
  })

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#0e0e0e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 860, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>Nueva Orden de Cambio</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {/* Motivo & Descripcion */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Motivo *</div>
              <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: Cliente solicita cambio de marca en CCTV" style={inputStyle} autoFocus />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Descripcion</div>
              <textarea value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Detalles adicionales..." rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>
          </div>

          {/* Items list */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Items ({orderItems.length})</div>
              <Btn size="sm" onClick={() => setShowAddItem(true)}><Plus size={12} /> Agregar item</Btn>
            </div>

            {orderItems.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#555', fontSize: 12, border: '1px dashed #333', borderRadius: 8 }}>
                Agrega items para definir los cambios
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#1a1a1a' }}>
                    {['Accion', 'Producto', 'Cant. Orig', 'Cant. Nueva', 'Precio Unit.', 'Subtotal', ''].map(h => (
                      <th key={h} style={{ padding: '6px 8px', fontSize: 10, fontWeight: 600, color: '#444', textAlign: h === 'Producto' || h === 'Accion' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #222' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderItems.map((oi, idx) => {
                    const acc = ACCION_CONFIG[oi.accion]
                    let sub = 0
                    if (oi.accion === 'agregar') sub = calcItemTotal(oi.costo, oi.markup, oi.cantidad_nueva)
                    else if (oi.accion === 'quitar') sub = -calcItemTotal(oi.costo, oi.markup, oi.cantidad_original)
                    else if (oi.accion === 'qty') sub = (oi.cantidad_nueva - oi.cantidad_original) * calcItemPrice(oi.costo, oi.markup)
                    else if (oi.accion === 'swap') {
                      sub = calcItemTotal(oi.costo, oi.markup, oi.cantidad_nueva || oi.cantidad_original) - calcItemTotal(oi.costoOriginal || oi.costo, oi.markupOriginal || oi.markup, oi.cantidad_original)
                    }
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #1a1a1a' }}>
                        <td style={{ padding: '7px 8px' }}>
                          <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: acc.color + '22', color: acc.color }}>{acc.icon} {acc.label}</span>
                        </td>
                        <td style={{ padding: '7px 8px', fontSize: 12, color: '#ddd' }}>{oi.nombre}</td>
                        <td style={{ padding: '7px 8px', fontSize: 12, color: '#888', textAlign: 'right' }}>{oi.cantidad_original || '--'}</td>
                        <td style={{ padding: '7px 8px', fontSize: 12, color: '#fff', textAlign: 'right' }}>{oi.cantidad_nueva || '--'}</td>
                        <td style={{ padding: '7px 8px', fontSize: 12, color: '#888', textAlign: 'right' }}>{F(calcItemPrice(oi.costo, oi.markup))}</td>
                        <td style={{ padding: '7px 8px', fontSize: 12, textAlign: 'right', fontWeight: 600, color: sub >= 0 ? '#22c55e' : '#ef4444' }}>
                          {sub >= 0 ? '+' : ''}{F(sub)}
                        </td>
                        <td style={{ padding: '7px 8px' }}>
                          <button onClick={() => removeItem(idx)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer' }}>
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Add item sub-form */}
          {showAddItem && (
            <div style={{ background: '#0e0e0e', border: '1px solid #333', borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 12 }}>Agregar item al cambio</div>

              {/* Accion selector */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                {Object.entries(ACCION_CONFIG).map(([key, cfg]) => (
                  <button key={key} onClick={() => { setAddAccion(key); setSelectedOriginal(''); setSelectedCatalog('') }}
                    style={{
                      padding: '5px 14px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                      border: `1px solid ${addAccion === key ? cfg.color : '#333'}`,
                      background: addAccion === key ? cfg.color + '22' : 'transparent',
                      color: addAccion === key ? cfg.color : '#666',
                    }}>
                    {cfg.icon} {cfg.label}
                  </button>
                ))}
              </div>

              {/* Original item selector (for quitar, swap, qty) */}
              {(addAccion === 'quitar' || addAccion === 'swap' || addAccion === 'qty') && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>Producto original</div>
                  <select value={selectedOriginal} onChange={e => setSelectedOriginal(e.target.value)} style={inputStyle}>
                    <option value="">Seleccionar...</option>
                    {items.map(it => (
                      <option key={it.id} value={it.id}>{it.name} (cant: {it.quantity})</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Catalog selector (for agregar, swap) */}
              {(addAccion === 'agregar' || addAccion === 'swap') && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                    {addAccion === 'swap' ? 'Nuevo producto (reemplazo)' : 'Producto del catalogo'}
                  </div>
                  <input value={searchCat} onChange={e => setSearchCat(e.target.value)} placeholder="Buscar en catalogo..." style={{ ...inputStyle, marginBottom: 6 }} />
                  <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid #222', borderRadius: 8 }}>
                    {filteredCatalog.slice(0, 20).map(p => (
                      <div key={p.id} onClick={() => setSelectedCatalog(p.id)}
                        style={{
                          padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                          background: selectedCatalog === p.id ? '#22c55e11' : 'transparent',
                          borderBottom: '1px solid #1a1a1a',
                          color: selectedCatalog === p.id ? '#22c55e' : '#ccc',
                          display: 'flex', justifyContent: 'space-between',
                        }}>
                        <span>{p.name}</span>
                        <span style={{ color: '#666', fontSize: 11 }}>{F(calcItemPrice(p.cost, p.markup))}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Quantity (for agregar, qty, swap) */}
              {(addAccion === 'agregar' || addAccion === 'qty' || addAccion === 'swap') && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
                    {addAccion === 'qty' ? 'Nueva cantidad' : 'Cantidad'}
                  </div>
                  <input type="number" value={cantNueva} onChange={e => setCantNueva(parseFloat(e.target.value) || 0)} min={0} style={{ ...inputStyle, width: 120 }} />
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Btn size="sm" onClick={() => setShowAddItem(false)}>Cancelar</Btn>
                <Btn size="sm" variant="primary" onClick={addItem}
                  disabled={
                    (addAccion === 'agregar' && !selectedCatalog) ||
                    ((addAccion === 'quitar' || addAccion === 'qty') && !selectedOriginal) ||
                    (addAccion === 'swap' && (!selectedOriginal || !selectedCatalog))
                  }>
                  <Plus size={12} /> Agregar
                </Btn>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: '1px solid #222', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 13 }}>
            <span style={{ color: '#666' }}>Delta: </span>
            <span style={{ fontWeight: 700, color: previewDelta >= 0 ? '#22c55e' : '#ef4444' }}>
              {previewDelta >= 0 ? '+' : ''}{F(previewDelta)}
            </span>
            {Math.abs(previewDelta) > APPROVAL_THRESHOLD && (
              <span style={{ fontSize: 10, color: '#f59e0b', marginLeft: 8 }}>
                <AlertTriangle size={10} style={{ verticalAlign: 'middle' }} /> Requiere aprobacion
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Btn size="sm" onClick={onClose}>Cancelar</Btn>
            <Btn size="sm" variant="primary" onClick={handleSave} disabled={saving || !motivo.trim() || orderItems.length === 0}>
              {saving ? 'Guardando...' : 'Crear Orden de Cambio'}
            </Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── OBRA REAL TAB ────────────────────────────────────────────────────
export function ObraRealTab({ items, orders, areas }: {
  items: QuotationItem[]
  orders: ChangeOrder[]
  areas: QuotationArea[]
}) {
  const obraReal = useMemo(() => {
    const result: ObraRealItem[] = items.map(it => ({
      ...it,
      fuente: 'original' as const,
      cambio: null,
    }))

    orders.filter(o => o.estado === 'aprobada').forEach(co => {
      const coItems = co.items || []
      coItems.forEach(ci => {
        if (ci.accion === 'agregar') {
          result.push({
            id: ci.id,
            name: ci.nombre,
            description: ci.descripcion,
            system: ci.system_name as any,
            quantity: ci.cantidad_nueva,
            cost: ci.costo,
            markup: ci.markup,
            price: ci.precio,
            total: ci.subtotal,
            area_id: ci.area_id || '',
            quotation_id: '',
            type: 'material',
            created_at: ci.created_at,
            catalog_product_id: ci.catalog_product_id,
            provider: ci.marca,
            purchase_phase: 'inicio' as any,
            installation_cost: 0,
            order_index: 0,
            fuente: 'cambio',
            cambio: { orden: co.numero, accion: ci.accion },
          })
        } else if (ci.accion === 'quitar' && ci.original_item_id) {
          const idx = result.findIndex(r => r.id === ci.original_item_id)
          if (idx >= 0) result.splice(idx, 1)
        } else if (ci.accion === 'qty' && ci.original_item_id) {
          const idx = result.findIndex(r => r.id === ci.original_item_id)
          if (idx >= 0) {
            result[idx] = {
              ...result[idx],
              quantity: ci.cantidad_nueva,
              total: calcItemTotal(result[idx].cost, result[idx].markup, ci.cantidad_nueva),
              fuente: 'modificado',
              cambio: { orden: co.numero, accion: ci.accion },
            }
          }
        } else if (ci.accion === 'swap' && ci.original_item_id) {
          const idx = result.findIndex(r => r.id === ci.original_item_id)
          if (idx >= 0) {
            result[idx] = {
              ...result[idx],
              name: ci.nombre,
              description: ci.descripcion,
              cost: ci.costo,
              markup: ci.markup,
              price: ci.precio,
              quantity: ci.cantidad_nueva || result[idx].quantity,
              total: calcItemTotal(ci.costo, ci.markup, ci.cantidad_nueva || result[idx].quantity),
              catalog_product_id: ci.catalog_product_id,
              fuente: 'modificado',
              cambio: { orden: co.numero, accion: ci.accion },
            }
          }
        }
      })
    })

    return result
  }, [items, orders])

  const originalTotal = items.reduce((s, i) => s + i.total, 0)
  const obraTotal = obraReal.reduce((s, i) => s + i.total, 0)
  const delta = obraTotal - originalTotal

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Summary */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #222', background: '#111', display: 'flex', gap: 24, alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.1em' }}>Original</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#888' }}>{F(originalTotal)}</div>
        </div>
        <ArrowRight size={14} style={{ color: '#444' }} />
        <div>
          <div style={{ fontSize: 9, color: '#555', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.1em' }}>Obra Real</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#57FF9A' }}>{F(obraTotal)}</div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, color: delta >= 0 ? '#22c55e' : '#ef4444' }}>
          ({delta >= 0 ? '+' : ''}{F(delta)})
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#666' }}>
          {obraReal.length} items
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#1a1a1a', position: 'sticky', top: 0, zIndex: 1 }}>
              {['Producto', 'Area', 'Cant.', 'Costo', 'Precio', 'Total', 'Fuente'].map(h => (
                <th key={h} style={{ padding: '6px 10px', fontSize: 10, fontWeight: 600, color: '#444', textAlign: h === 'Producto' || h === 'Area' || h === 'Fuente' ? 'left' : 'right', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #222' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {obraReal.map((item, idx) => {
              const areaName = item.area_id ? areas.find(a => a.id === item.area_id)?.name || '--' : '--'
              const fuenteColor = item.fuente === 'original' ? '#555' : item.fuente === 'cambio' ? '#22c55e' : '#f59e0b'
              return (
                <tr key={idx} style={{ borderBottom: '1px solid #1a1a1a', background: item.fuente !== 'original' ? item.fuente === 'cambio' ? '#22c55e06' : '#f59e0b06' : 'transparent' }}>
                  <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 500, color: '#ddd' }}>
                    {item.name}
                    {item.description && <div style={{ fontSize: 10, color: '#555' }}>{item.description}</div>}
                  </td>
                  <td style={{ padding: '7px 10px', fontSize: 11, color: '#666' }}>{areaName}</td>
                  <td style={{ padding: '7px 10px', fontSize: 12, color: '#aaa', textAlign: 'right' }}>{item.quantity}</td>
                  <td style={{ padding: '7px 10px', fontSize: 12, color: '#888', textAlign: 'right' }}>{F(item.cost)}</td>
                  <td style={{ padding: '7px 10px', fontSize: 12, color: '#888', textAlign: 'right' }}>{F(item.price)}</td>
                  <td style={{ padding: '7px 10px', fontSize: 12, fontWeight: 600, color: '#fff', textAlign: 'right' }}>{F(item.total)}</td>
                  <td style={{ padding: '7px 10px' }}>
                    {item.fuente === 'original' ? (
                      <span style={{ fontSize: 10, color: '#555' }}>Original</span>
                    ) : (
                      <span style={{ fontSize: 10, fontWeight: 600, color: fuenteColor }}>
                        OC-{String(item.cambio?.orden || 0).padStart(2, '0')} · {ACCION_CONFIG[item.cambio?.accion || '']?.label || ''}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
