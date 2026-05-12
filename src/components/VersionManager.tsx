import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { GitBranch, Save, Eye, X, ChevronDown, ChevronRight, ArrowRight, Plus, Minus, Equal } from 'lucide-react'

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════
export interface VersionSnapshot {
  config: any
  areas: Array<{ id: string; name: string; order: number }>
  items: Array<{
    id: string; areaId: string; name: string; description?: string
    quantity: number; price: number; cost: number; total: number
    system?: string; notes?: any
    // Extra fields for comparison
    [key: string]: any
  }>
  total: number
  subtotal: number
  editorType: 'esp' | 'proyecto' | 'cortinas'
  meta?: any // editor-specific metadata
}

interface QVersion {
  id: string
  quotation_id: string
  version_number: number
  label: string | null
  snapshot: VersionSnapshot
  total: number
  created_at: string
  created_by: string | null
}

interface VersionManagerProps {
  cotId: string
  getCurrentSnapshot: () => VersionSnapshot
  accentColor?: string
  compact?: boolean // for mobile
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function VersionManager({ cotId, getCurrentSnapshot, accentColor = '#57FF9A', compact = false }: VersionManagerProps) {
  const [versions, setVersions] = useState<QVersion[]>([])
  const [loading, setLoading] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const [saving, setSaving] = useState(false)
  const [label, setLabel] = useState('')
  const [showLabelInput, setShowLabelInput] = useState(false)
  const [compareA, setCompareA] = useState<string | null>(null)
  const [compareB, setCompareB] = useState<string | null>(null)
  const [showCompare, setShowCompare] = useState(false)

  async function loadVersions() {
    setLoading(true)
    const { data } = await supabase
      .from('quotation_versions')
      .select('*')
      .eq('quotation_id', cotId)
      .order('version_number', { ascending: false })
    setVersions((data || []) as QVersion[])
    setLoading(false)
  }

  useEffect(() => {
    if (showPanel) loadVersions()
  }, [showPanel, cotId])

  async function saveVersion() {
    setSaving(true)
    try {
      // Get next version number
      const { data: maxRow } = await supabase
        .from('quotation_versions')
        .select('version_number')
        .eq('quotation_id', cotId)
        .order('version_number', { ascending: false })
        .limit(1)
      const nextNum = (maxRow && maxRow.length > 0) ? maxRow[0].version_number + 1 : 1

      const snapshot = getCurrentSnapshot()
      const { error } = await supabase.from('quotation_versions').insert({
        quotation_id: cotId,
        version_number: nextNum,
        label: label.trim() || null,
        snapshot,
        total: snapshot.total,
      })
      if (error) {
        console.error('Error saving version:', error)
        alert('Error guardando versión: ' + error.message)
      } else {
        setLabel('')
        setShowLabelInput(false)
        await loadVersions()
      }
    } finally {
      setSaving(false)
    }
  }

  function startCompare() {
    if (versions.length < 2) { alert('Necesitas al menos 2 versiones para comparar'); return }
    setCompareA(versions[1]?.id || null) // older
    setCompareB(versions[0]?.id || null) // newer
    setShowCompare(true)
  }

  const btnStyle = (active?: boolean): React.CSSProperties => ({
    padding: compact ? '2px 6px' : '3px 10px',
    borderRadius: 20,
    fontSize: compact ? 9 : 10,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: `1px solid ${active ? accentColor : accentColor + '44'}`,
    background: active ? accentColor + '22' : 'transparent',
    color: active ? accentColor : accentColor,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
  })

  return (
    <>
      {/* Trigger button */}
      <button onClick={() => setShowPanel(true)} style={btnStyle()} title="Versiones">
        <GitBranch size={compact ? 10 : 11} /> {compact ? 'V' : 'Versiones'}
      </button>

      {/* Side panel overlay */}
      {showPanel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={() => { setShowPanel(false); setShowCompare(false) }} style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ width: Math.min(480, window.innerWidth - 40), background: '#111', borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 8 }}>
              <GitBranch size={16} color={accentColor} />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#eee', flex: 1 }}>Versiones</span>
              <button onClick={() => { setShowPanel(false); setShowCompare(false) }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
            </div>

            {/* Save new version */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {showLabelInput ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                    placeholder="Nota de versión (opcional)..."
                    style={{ flex: 1, padding: '6px 10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit' }}
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') saveVersion() }}
                  />
                  <button onClick={saveVersion} disabled={saving} style={{ ...btnStyle(true), opacity: saving ? 0.5 : 1 }}>
                    <Save size={11} /> {saving ? '...' : 'Guardar'}
                  </button>
                  <button onClick={() => setShowLabelInput(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={14} /></button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setShowLabelInput(true)} style={btnStyle(true)}>
                    <Save size={11} /> Guardar versión
                  </button>
                  {versions.length >= 2 && (
                    <button onClick={startCompare} style={btnStyle()}>
                      <Eye size={11} /> Comparar
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Version list or Compare view */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {showCompare ? (
                <CompareView
                  versions={versions}
                  compareA={compareA}
                  compareB={compareB}
                  onSelectA={setCompareA}
                  onSelectB={setCompareB}
                  accentColor={accentColor}
                />
              ) : loading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#555' }}>Cargando...</div>
              ) : versions.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 12 }}>
                  No hay versiones guardadas aún.<br />
                  <span style={{ fontSize: 11, color: '#444' }}>Usa "Guardar versión" para crear un snapshot.</span>
                </div>
              ) : (
                versions.map(v => (
                  <VersionRow key={v.id} version={v} accentColor={accentColor} />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════
// VERSION ROW
// ═══════════════════════════════════════════════════════════════════
function VersionRow({ version: v, accentColor }: { version: QVersion; accentColor: string }) {
  const [expanded, setExpanded] = useState(false)
  const snap = v.snapshot
  const date = new Date(v.created_at)
  const dateStr = date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const timeStr = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })

  return (
    <div style={{ borderBottom: '1px solid #1a1a1a' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.15s' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        {expanded ? <ChevronDown size={12} color="#555" /> : <ChevronRight size={12} color="#555" />}
        <span style={{ fontSize: 13, fontWeight: 700, color: accentColor }}>v{v.version_number}</span>
        <span style={{ fontSize: 11, color: '#888', flex: 1 }}>{v.label || ''}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc' }}>${fmt(v.total)}</span>
        <span style={{ fontSize: 10, color: '#555' }}>{dateStr} {timeStr}</span>
      </div>

      {expanded && snap && (
        <div style={{ padding: '0 16px 12px 36px' }}>
          {/* Config summary */}
          <div style={{ fontSize: 10, color: '#666', marginBottom: 6 }}>
            {snap.config?.currency || 'MXN'} | IVA {snap.config?.ivaRate || 16}%
            {snap.config?.descuento ? ` | Desc ${snap.config.descuento}%` : ''}
            {snap.config?.tipoCambio ? ` | TC $${snap.config.tipoCambio}` : ''}
          </div>

          {/* Areas summary */}
          {snap.areas && snap.areas.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#555', textTransform: 'uppercase', marginBottom: 4 }}>Alcances ({snap.areas.length} áreas)</div>
              {snap.areas.map((a, i) => {
                const areaItems = snap.items.filter(it => it.areaId === a.id)
                const areaTotal = areaItems.reduce((s, it) => s + (it.total || 0), 0)
                return (
                  <div key={i} style={{ fontSize: 11, color: '#888', padding: '2px 0', display: 'flex', justifyContent: 'space-between' }}>
                    <span>{a.name} <span style={{ color: '#555' }}>({areaItems.length} items)</span></span>
                    <span style={{ color: '#aaa' }}>${fmt(areaTotal)}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Items count */}
          <div style={{ fontSize: 10, color: '#555' }}>
            {snap.items?.length || 0} conceptos | Subtotal: ${fmt(snap.subtotal || 0)} | Total: ${fmt(snap.total || 0)}
          </div>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// COMPARE VIEW
// ═══════════════════════════════════════════════════════════════════
function CompareView({ versions, compareA, compareB, onSelectA, onSelectB, accentColor }: {
  versions: QVersion[]
  compareA: string | null
  compareB: string | null
  onSelectA: (id: string) => void
  onSelectB: (id: string) => void
  accentColor: string
}) {
  const vA = versions.find(v => v.id === compareA)
  const vB = versions.find(v => v.id === compareB)

  return (
    <div style={{ padding: '0 16px' }}>
      {/* Selectors */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#EF4444', textTransform: 'uppercase', marginBottom: 4 }}>Anterior</div>
          <select value={compareA || ''} onChange={e => onSelectA(e.target.value)} style={selStyle}>
            {versions.map(v => <option key={v.id} value={v.id}>v{v.version_number} {v.label ? `- ${v.label}` : ''}</option>)}
          </select>
        </div>
        <ArrowRight size={16} color="#555" style={{ marginTop: 16 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#10B981', textTransform: 'uppercase', marginBottom: 4 }}>Actual</div>
          <select value={compareB || ''} onChange={e => onSelectB(e.target.value)} style={selStyle}>
            {versions.map(v => <option key={v.id} value={v.id}>v{v.version_number} {v.label ? `- ${v.label}` : ''}</option>)}
          </select>
        </div>
      </div>

      {vA && vB && <CompareResults a={vA} b={vB} accentColor={accentColor} />}
    </div>
  )
}

const selStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', background: '#1a1a1a', border: '1px solid #333',
  borderRadius: 6, color: '#ccc', fontSize: 11, fontFamily: 'inherit',
}

// ═══════════════════════════════════════════════════════════════════
// COMPARE RESULTS
// ═══════════════════════════════════════════════════════════════════
function CompareResults({ a, b, accentColor }: { a: QVersion; b: QVersion; accentColor: string }) {
  const snapA = a.snapshot
  const snapB = b.snapshot

  // ── Totals diff ──
  const totalDiff = (snapB.total || 0) - (snapA.total || 0)
  const subtotalDiff = (snapB.subtotal || 0) - (snapA.subtotal || 0)
  const pctChange = snapA.total ? ((totalDiff / snapA.total) * 100) : 0

  // ── Scope diff (areas) ──
  const areasA = new Map((snapA.areas || []).map(a => [a.name.toLowerCase().trim(), a]))
  const areasB = new Map((snapB.areas || []).map(a => [a.name.toLowerCase().trim(), a]))
  const addedAreas = [...areasB.keys()].filter(k => !areasA.has(k))
  const removedAreas = [...areasA.keys()].filter(k => !areasB.has(k))
  const commonAreas = [...areasB.keys()].filter(k => areasA.has(k))

  // ── Items diff ──
  // Use name as key for matching (since IDs change between versions)
  const itemsA = new Map((snapA.items || []).map(i => [itemKey(i), i]))
  const itemsB = new Map((snapB.items || []).map(i => [itemKey(i), i]))
  const addedItems = [...itemsB.entries()].filter(([k]) => !itemsA.has(k))
  const removedItems = [...itemsA.entries()].filter(([k]) => !itemsB.has(k))
  const changedItems: Array<{ key: string; before: any; after: any; changes: string[] }> = []

  for (const [key, itemB] of itemsB.entries()) {
    const itemA = itemsA.get(key)
    if (!itemA) continue
    const changes: string[] = []
    if (itemA.quantity !== itemB.quantity) changes.push(`Cantidad: ${itemA.quantity} → ${itemB.quantity}`)
    if (Math.abs((itemA.price || 0) - (itemB.price || 0)) > 0.01) changes.push(`Precio: $${fmt(itemA.price || 0)} → $${fmt(itemB.price || 0)}`)
    if (Math.abs((itemA.cost || 0) - (itemB.cost || 0)) > 0.01) changes.push(`Costo: $${fmt(itemA.cost || 0)} → $${fmt(itemB.cost || 0)}`)
    if (Math.abs((itemA.total || 0) - (itemB.total || 0)) > 0.01) changes.push(`Total: $${fmt(itemA.total || 0)} → $${fmt(itemB.total || 0)}`)
    if (changes.length > 0) changedItems.push({ key, before: itemA, after: itemB, changes })
  }

  // ── Area-level price comparison ──
  const areaComps = commonAreas.map(areaKey => {
    const aA = areasA.get(areaKey)!
    const aB = areasB.get(areaKey)!
    const totalA = (snapA.items || []).filter(i => i.areaId === aA.id).reduce((s, i) => s + (i.total || 0), 0)
    const totalB = (snapB.items || []).filter(i => i.areaId === aB.id).reduce((s, i) => s + (i.total || 0), 0)
    const countA = (snapA.items || []).filter(i => i.areaId === aA.id).length
    const countB = (snapB.items || []).filter(i => i.areaId === aB.id).length
    return { name: aB.name, totalA, totalB, diff: totalB - totalA, countA, countB }
  })

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 9, color: '#EF4444', fontWeight: 700, textTransform: 'uppercase' }}>v{a.version_number}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ccc' }}>${fmt(snapA.total || 0)}</div>
          <div style={{ fontSize: 10, color: '#555' }}>{snapA.items?.length || 0} items | {snapA.areas?.length || 0} áreas</div>
        </div>
        <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 9, color: '#10B981', fontWeight: 700, textTransform: 'uppercase' }}>v{b.version_number}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ccc' }}>${fmt(snapB.total || 0)}</div>
          <div style={{ fontSize: 10, color: '#555' }}>{snapB.items?.length || 0} items | {snapB.areas?.length || 0} áreas</div>
        </div>
      </div>

      {/* Delta */}
      <div style={{ background: totalDiff > 0 ? '#10B98115' : totalDiff < 0 ? '#EF444415' : '#33333330', borderRadius: 8, padding: 10, marginBottom: 16, textAlign: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: totalDiff > 0 ? '#10B981' : totalDiff < 0 ? '#EF4444' : '#888' }}>
          {totalDiff > 0 ? '+' : ''}{fmt(totalDiff)}
        </span>
        <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
          ({pctChange > 0 ? '+' : ''}{pctChange.toFixed(1)}%)
        </span>
      </div>

      {/* Scope changes (areas) */}
      <Section title="Cambios en Alcance" count={addedAreas.length + removedAreas.length + areaComps.filter(a => a.diff !== 0 || a.countA !== a.countB).length}>
        {addedAreas.map(k => (
          <DiffLine key={k} icon={<Plus size={10} color="#10B981" />} color="#10B981" text={`Área agregada: ${areasB.get(k)?.name}`} />
        ))}
        {removedAreas.map(k => (
          <DiffLine key={k} icon={<Minus size={10} color="#EF4444" />} color="#EF4444" text={`Área eliminada: ${areasA.get(k)?.name}`} />
        ))}
        {areaComps.filter(a => a.diff !== 0 || a.countA !== a.countB).map(a => (
          <div key={a.name} style={{ padding: '4px 0', fontSize: 11, color: '#ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{a.name} <span style={{ color: '#555' }}>({a.countA}→{a.countB} items)</span></span>
            <span style={{ color: a.diff > 0 ? '#10B981' : a.diff < 0 ? '#EF4444' : '#888', fontWeight: 600 }}>
              {a.diff > 0 ? '+' : ''}{fmt(a.diff)}
            </span>
          </div>
        ))}
        {addedAreas.length === 0 && removedAreas.length === 0 && areaComps.every(a => a.diff === 0 && a.countA === a.countB) && (
          <div style={{ fontSize: 11, color: '#555', padding: '4px 0' }}>Sin cambios en alcance</div>
        )}
      </Section>

      {/* Added items */}
      <Section title="Conceptos Agregados" count={addedItems.length}>
        {addedItems.map(([k, item]) => (
          <DiffLine key={k} icon={<Plus size={10} color="#10B981" />} color="#10B981" text={`${item.name}`} detail={`$${fmt(item.total || 0)}`} />
        ))}
        {addedItems.length === 0 && <div style={{ fontSize: 11, color: '#555', padding: '4px 0' }}>Ninguno</div>}
      </Section>

      {/* Removed items */}
      <Section title="Conceptos Eliminados" count={removedItems.length}>
        {removedItems.map(([k, item]) => (
          <DiffLine key={k} icon={<Minus size={10} color="#EF4444" />} color="#EF4444" text={`${item.name}`} detail={`$${fmt(item.total || 0)}`} />
        ))}
        {removedItems.length === 0 && <div style={{ fontSize: 11, color: '#555', padding: '4px 0' }}>Ninguno</div>}
      </Section>

      {/* Changed items */}
      <Section title="Precios Modificados" count={changedItems.length}>
        {changedItems.map(ci => (
          <div key={ci.key} style={{ padding: '4px 0', borderBottom: '1px solid #1a1a1a' }}>
            <div style={{ fontSize: 11, color: '#ccc', fontWeight: 600 }}>{ci.after.name}</div>
            {ci.changes.map((c, i) => (
              <div key={i} style={{ fontSize: 10, color: '#888', paddingLeft: 12 }}>{c}</div>
            ))}
          </div>
        ))}
        {changedItems.length === 0 && <div style={{ fontSize: 11, color: '#555', padding: '4px 0' }}>Sin cambios de precio</div>}
      </Section>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function itemKey(item: any): string {
  // Use name + areaName as key for matching across versions
  // Trim and lowercase for fuzzy matching
  const name = (item.name || '').toLowerCase().trim()
  const sys = (item.system || '').toLowerCase().trim()
  return `${sys}::${name}`
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ marginBottom: 12 }}>
      <div onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '6px 0' }}>
        {open ? <ChevronDown size={12} color="#555" /> : <ChevronRight size={12} color="#555" />}
        <span style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</span>
        {count > 0 && (
          <span style={{ fontSize: 9, fontWeight: 700, background: '#333', color: '#ccc', padding: '1px 6px', borderRadius: 10 }}>{count}</span>
        )}
      </div>
      {open && <div style={{ paddingLeft: 4 }}>{children}</div>}
    </div>
  )
}

function DiffLine({ icon, color, text, detail }: { icon: React.ReactNode; color: string; text: string; detail?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11, color }}>
      {icon}
      <span style={{ flex: 1 }}>{text}</span>
      {detail && <span style={{ fontWeight: 600 }}>{detail}</span>}
    </div>
  )
}
