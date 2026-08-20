import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { marcarVigente } from '../lib/versionesCotizacion'
import { GitBranch, Copy, Eye, X, ChevronDown, ChevronRight, ArrowRight, Plus, Minus, Pencil, Check, Trash2 } from 'lucide-react'

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
    [key: string]: any
  }>
  total: number
  subtotal: number
  editorType: 'esp' | 'proyecto' | 'cortinas' | 'ilum'
  meta?: any
}

interface SiblingVersion {
  id: string
  name: string
  version_label: string | null
  total: number
  stage: string
  created_at: string
  specialty: string | null
  vigente?: boolean | null
}

interface VersionManagerProps {
  cotId: string
  getCurrentSnapshot: () => VersionSnapshot
  onSwitchVersion: (newCotId: string) => void
  accentColor?: string
  compact?: boolean
}

// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════
export default function VersionManager({ cotId, getCurrentSnapshot, onSwitchVersion, accentColor = '#10B981', compact = false }: VersionManagerProps) {
  const [siblings, setSiblings] = useState<SiblingVersion[]>([])
  const [currentLabel, setCurrentLabel] = useState<string | null>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [showLabelInput, setShowLabelInput] = useState(false)
  // Compare state
  const [compareA, setCompareA] = useState<string | null>(null)
  const [compareB, setCompareB] = useState<string | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [snapA, setSnapA] = useState<VersionSnapshot | null>(null)
  const [snapB, setSnapB] = useState<VersionSnapshot | null>(null)
  const [loadingCompare, setLoadingCompare] = useState(false)

  async function loadSiblings() {
    setLoading(true)
    // Get this quotation's version_group_id and label
    const { data: current } = await supabase
      .from('quotations')
      .select('version_group_id, version_label')
      .eq('id', cotId)
      .single()
    const gid = current?.version_group_id || null
    setGroupId(gid)
    setCurrentLabel(current?.version_label || null)

    if (gid) {
      // Load all siblings in the group
      const { data: sibs } = await supabase
        .from('quotations')
        .select('id, name, version_label, total, stage, created_at, specialty, vigente')
        .eq('version_group_id', gid)
        .order('version_label')
      setSiblings((sibs || []) as SiblingVersion[])
    } else {
      setSiblings([])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (showPanel) loadSiblings()
  }, [showPanel, cotId])

  async function deleteVersion(s: SiblingVersion) {
    if (siblings.length <= 1) { alert('No puedes eliminar la única versión de la cotización.'); return }
    if (s.stage === 'contrato') {
      if (!confirm(`⚠ La versión "${s.version_label || ''} — ${s.name}" está en CONTRATO. ¿Seguro que quieres eliminarla? Esta acción no se puede deshacer.`)) return
    } else {
      if (!confirm(`¿Eliminar la versión "${s.version_label || ''} — ${s.name}"? Esta acción no se puede deshacer.`)) return
    }
    // Cascade: items → areas → quotation
    await supabase.from('quotation_items').delete().eq('quotation_id', s.id)
    await supabase.from('quotation_areas').delete().eq('quotation_id', s.id)
    const { error } = await supabase.from('quotations').delete().eq('id', s.id)
    if (error) { alert('Error al eliminar la versión: ' + error.message); return }
    // Si la borrada era la vigente, el grupo se queda sin dueño: se promueve
    // otra en el acto para que ningún módulo se quede sin cotización.
    if (s.vigente) {
      const otra = siblings.find(x => x.id !== s.id)
      if (otra) await marcarVigente(otra.id)
    }
    // Si borramos la versión que estamos viendo, cambiar a otra hermana
    if (s.id === cotId) {
      const other = siblings.find(x => x.id !== s.id)
      if (other) { setShowPanel(false); onSwitchVersion(other.id); return }
    }
    loadSiblings()
  }

  // La versión vigente es la que ve TODO el ERP: Cobranza, obras, compras,
  // entregas y los tableros. Cambiarla aquí cambia de qué versión cuelga el
  // proyecto en todos lados, por eso se pide confirmación.
  /**
   * Te cambia a otra versión y la deja como la vigente. Devuelve false si el
   * usuario se arrepiente en la confirmación.
   *
   * Único freno: si la que está vigente ya se firmó (contrato) y te vas a una
   * que no, se avisa — porque eso mueve de dónde cuelgan cobranza, compras,
   * entregas y la obra, hacia una versión que todavía no se vende.
   */
  async function cambiarYHacerVigente(s: SiblingVersion): Promise<boolean> {
    if (s.vigente) return true
    const actual = siblings.find(x => x.vigente)
    if (actual?.stage === 'contrato' && s.stage !== 'contrato') {
      const seguir = confirm(
        `La versión vigente es "${actual.version_label || ''} — ${actual.name}" y está en CONTRATO.\n\n` +
        `Si te cambias a "${s.version_label || ''} — ${s.name}" (${s.stage}), esa pasa a ser la vigente: ` +
        'cobranza, compras, entregas, la obra y los tableros van a colgar de ella.\n\n¿Continúo?'
      )
      if (!seguir) return false
    }
    const r = await marcarVigente(s.id)
    if (!r.ok) { alert('No se pudo dejar esta versión como vigente: ' + r.error); return false }
    await loadSiblings()
    return true
  }

  async function createVersion() {
    setCreating(true)
    try {
      const label = newLabel.trim().toUpperCase() || null

      // 1. Get current quotation data
      const { data: cot } = await supabase.from('quotations').select('*').eq('id', cotId).single()
      if (!cot) { alert('Error: cotización no encontrada'); return }

      // 2. Ensure version_group_id exists (set on original if first time)
      let vgId = cot.version_group_id
      let isFirstVersion = false
      if (!vgId) {
        vgId = crypto.randomUUID()
        isFirstVersion = true
        // Set group + label "A" on the original quotation
        await supabase.from('quotations').update({ version_group_id: vgId, version_label: 'A', vigente: true }).eq('id', cotId)
        setCurrentLabel('A')
      }

      // 3. Determine next label if not provided
      let finalLabel = label
      if (!finalLabel) {
        if (isFirstVersion) {
          // Original just got "A", so next is "B"
          finalLabel = 'B'
        } else {
          const { data: existing } = await supabase
            .from('quotations')
            .select('version_label')
            .eq('version_group_id', vgId)
            .order('version_label')
          const usedLabels = new Set((existing || []).map(e => e.version_label))
          for (let i = 0; i < 26; i++) {
            const candidate = String.fromCharCode(65 + i)
            if (!usedLabels.has(candidate)) { finalLabel = candidate; break }
          }
          if (!finalLabel) finalLabel = 'Z' + Date.now()
        }
      }

      // 4. Clone the quotation row
      const { id: _, created_at: __, version_label: ___, ...cotClone } = cot
      // La copia NACE como histórica, no como vigente. Si el original ya está
      // en contrato, promoverla sola dejaría a Cobranza y a la obra colgando de
      // una propuesta sin firmar. Cuando esta versión sea la buena, se marca
      // con «Hacer vigente» — y ahí sí cambia para todo el ERP.
      const { data: newCot, error: cotErr } = await supabase.from('quotations').insert({
        ...cotClone,
        name: cot.name + ` (${finalLabel})`,
        version_group_id: vgId,
        version_label: finalLabel,
        vigente: false,
      }).select().single()
      if (cotErr || !newCot) { alert('Error clonando cotización: ' + (cotErr?.message || 'unknown')); return }

      // 5. Clone areas
      const { data: areas } = await supabase.from('quotation_areas').select('*').eq('quotation_id', cotId).order('order_index')
      const areaIdMap: Record<string, string> = {} // old area id → new area id
      if (areas && areas.length > 0) {
        for (const area of areas) {
          const { id: aId, created_at: aCr, ...areaClone } = area
          const { data: newArea } = await supabase.from('quotation_areas').insert({
            ...areaClone,
            quotation_id: newCot.id,
          }).select().single()
          if (newArea) areaIdMap[aId] = newArea.id
        }
      }

      // 6. Clone items
      const { data: items } = await supabase.from('quotation_items').select('*').eq('quotation_id', cotId).order('order_index')
      if (items && items.length > 0) {
        // Batch insert for speed
        const clonedItems = items.map(item => {
          const { id: iId, created_at: iCr, ...itemClone } = item
          return {
            ...itemClone,
            quotation_id: newCot.id,
            area_id: areaIdMap[item.area_id] || item.area_id,
          }
        })
        await supabase.from('quotation_items').insert(clonedItems)
      }

      // 7. Also save a snapshot in quotation_versions for comparison
      const snapshot = getCurrentSnapshot()
      await supabase.from('quotation_versions').insert({
        quotation_id: cotId,
        version_number: 1,
        label: currentLabel || 'Original',
        snapshot,
        total: snapshot.total,
      }).then(() => {}) // ignore if already exists

      setNewLabel('')
      setShowLabelInput(false)
      await loadSiblings()
    } catch (err: any) {
      alert('Error: ' + (err.message || err))
    } finally {
      setCreating(false)
    }
  }

  async function startCompare() {
    if (siblings.length < 2) { alert('Necesitas al menos 2 versiones'); return }
    const other = siblings.find(s => s.id !== cotId) || siblings[0]
    setCompareA(cotId)
    setCompareB(other.id)
    setShowCompare(true)
    await loadCompareData(cotId, other.id)
  }

  async function loadCompareData(idA: string, idB: string) {
    setLoadingCompare(true)
    const [sA, sB] = await Promise.all([buildSnapshotFromDb(idA), buildSnapshotFromDb(idB)])
    setSnapA(sA)
    setSnapB(sB)
    setLoadingCompare(false)
  }

  async function buildSnapshotFromDb(qId: string): Promise<VersionSnapshot> {
    const [{ data: cot }, { data: areas }, { data: items }] = await Promise.all([
      supabase.from('quotations').select('*').eq('id', qId).single(),
      supabase.from('quotation_areas').select('*').eq('quotation_id', qId).order('order_index'),
      supabase.from('quotation_items').select('*').eq('quotation_id', qId).order('order_index'),
    ])
    const config = cot?.notes ? (() => { try { return JSON.parse(cot.notes) } catch { return {} } })() : {}
    return {
      config,
      areas: (areas || []).map((a: any) => ({ id: a.id, name: a.name, order: a.order_index || 0 })),
      items: (items || []).map((it: any) => ({
        id: it.id, areaId: it.area_id, name: it.name || '',
        description: it.description || '',
        quantity: it.quantity || 0, price: it.price || 0,
        cost: it.cost || 0, total: it.total || 0,
        system: it.system || '', notes: it.notes,
      })),
      total: cot?.total || 0,
      subtotal: cot?.total || 0, // approximate
      editorType: 'esp', // doesn't matter for comparison
    }
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

  // Show current label badge inline if it exists
  const labelBadge = currentLabel ? (
    <span style={{
      fontSize: compact ? 8 : 9, fontWeight: 800, color: '#111',
      background: accentColor, padding: '1px 5px', borderRadius: 4, marginLeft: 2,
    }}>{currentLabel}</span>
  ) : null

  return (
    <>
      {/* Version label badge (always visible if version exists) */}
      {labelBadge}

      {/* Trigger button */}
      <button onClick={() => setShowPanel(true)} style={btnStyle()} title="Versiones">
        <GitBranch size={compact ? 10 : 11} /> {compact ? 'V' : 'Versiones'}
      </button>

      {/* Side panel overlay */}
      {showPanel && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', justifyContent: 'flex-end' }}>
          <div onClick={() => { setShowPanel(false); setShowCompare(false) }} style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} />
          <div style={{ width: Math.min(520, window.innerWidth - 40), background: '#111', borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: 8 }}>
              <GitBranch size={16} color={accentColor} />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#eee', flex: 1 }}>Versiones</span>
              <button onClick={() => { setShowPanel(false); setShowCompare(false) }} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={16} /></button>
            </div>

            {/* Create new version */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#888', lineHeight: 1.4 }}>
                Crea una copia independiente de esta cotización. Cada versión se edita por separado.
              </div>
              {showLabelInput ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value.toUpperCase())}
                    placeholder="Letra (auto si vacío)..."
                    maxLength={3}
                    style={{ width: 80, padding: '6px 10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', fontSize: 12, fontFamily: 'inherit', textAlign: 'center', textTransform: 'uppercase' }}
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') createVersion() }}
                  />
                  <button onClick={createVersion} disabled={creating} style={{ ...btnStyle(true), opacity: creating ? 0.5 : 1 }}>
                    <Copy size={11} /> {creating ? 'Duplicando...' : 'Crear versión'}
                  </button>
                  <button onClick={() => setShowLabelInput(false)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}><X size={14} /></button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setShowLabelInput(true)} style={btnStyle(true)}>
                    <Copy size={11} /> Crear nueva versión
                  </button>
                  {siblings.length >= 2 && (
                    <button onClick={startCompare} style={btnStyle()}>
                      <Eye size={11} /> Comparar
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {showCompare ? (
                <CompareView
                  siblings={siblings}
                  compareA={compareA}
                  compareB={compareB}
                  onSelectA={async (id) => { setCompareA(id); if (compareB) await loadCompareData(id, compareB) }}
                  onSelectB={async (id) => { setCompareB(id); if (compareA) await loadCompareData(compareA, id) }}
                  snapA={snapA}
                  snapB={snapB}
                  loading={loadingCompare}
                  accentColor={accentColor}
                  onBack={() => setShowCompare(false)}
                />
              ) : loading ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#555' }}>Cargando...</div>
              ) : siblings.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 12 }}>
                  Esta cotización no tiene versiones aún.<br />
                  <span style={{ fontSize: 11, color: '#444' }}>Crea una versión para duplicar y editar independientemente.</span>
                </div>
              ) : (
                siblings.map(s => (
                  <SiblingRow
                    key={s.id}
                    sibling={s}
                    isCurrent={s.id === cotId}
                    accentColor={accentColor}
                    canDelete={siblings.length > 1}
                    onSwitch={async () => {
                      // La versión que seleccionas aquí es la que manda en todo
                      // el ERP: al cambiarte a ella queda vigente. Antes esto
                      // solo cambiaba lo que veías en pantalla y cada módulo
                      // seguía leyendo otra versión distinta.
                      const ok = await cambiarYHacerVigente(s)
                      if (!ok) return
                      setShowPanel(false)
                      onSwitchVersion(s.id)
                    }}
                    onRenamed={loadSiblings}
                    onDelete={() => deleteVersion(s)}
                    onHacerVigente={() => cambiarYHacerVigente(s)}
                  />
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
// SIBLING ROW
// ═══════════════════════════════════════════════════════════════════
function SiblingRow({ sibling: s, isCurrent, accentColor, canDelete, onSwitch, onRenamed, onDelete, onHacerVigente }: {
  sibling: SiblingVersion; isCurrent: boolean; accentColor: string; canDelete: boolean
  onSwitch: () => void; onRenamed: () => void; onDelete: () => void; onHacerVigente: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(s.name)
  const [saving, setSaving] = useState(false)
  const date = new Date(s.created_at)
  const dateStr = date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
  const stageColors: Record<string, string> = {
    oportunidad: '#2563EB', propuesta: '#D97706', negociacion: '#7C3AED',
    contrato: '#10B981', perdida: '#DC2626', cancelada: '#64748B',
  }

  async function saveName() {
    if (!editName.trim() || editName.trim() === s.name) { setEditing(false); return }
    setSaving(true)
    await supabase.from('quotations').update({ name: editName.trim() }).eq('id', s.id)
    setSaving(false)
    setEditing(false)
    onRenamed()
  }

  return (
    <div
      onClick={editing ? undefined : (isCurrent ? undefined : onSwitch)}
      style={{
        padding: '12px 16px', cursor: editing ? 'default' : (isCurrent ? 'default' : 'pointer'),
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: '1px solid #1a1a1a',
        background: isCurrent ? accentColor + '08' : 'transparent',
        borderLeft: isCurrent ? `3px solid ${accentColor}` : '3px solid transparent',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { if (!isCurrent && !editing) e.currentTarget.style.background = '#1a1a1a' }}
      onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = isCurrent ? accentColor + '08' : 'transparent' }}
    >
      {/* Version badge */}
      <span style={{
        fontSize: 14, fontWeight: 800, color: isCurrent ? '#111' : accentColor,
        background: isCurrent ? accentColor : accentColor + '22',
        width: 28, height: 28, borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        {s.version_label || '?'}
      </span>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false) }}
              onClick={e => e.stopPropagation()}
              autoFocus
              style={{
                flex: 1, padding: '3px 8px', background: '#1a1a1a', border: '1px solid #444',
                borderRadius: 4, color: '#ccc', fontSize: 12, fontFamily: 'inherit',
              }}
            />
            <button
              onClick={e => { e.stopPropagation(); saveName() }}
              disabled={saving}
              style={{ background: 'none', border: 'none', color: accentColor, cursor: 'pointer', padding: 2, display: 'flex' }}
            >
              <Check size={14} />
            </button>
            <button
              onClick={e => { e.stopPropagation(); setEditing(false) }}
              style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', padding: 2, display: 'flex' }}
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.name}
            </span>
            {isCurrent && <span style={{ fontSize: 9, color: accentColor }}>● Actual</span>}
            {s.vigente ? (
              <span title="Es la versión que usa todo el ERP: cobranza, compras, entregas, obras y tableros"
                style={{ fontSize: 9, fontWeight: 800, color: '#111', background: '#10B981', padding: '1px 7px', borderRadius: 5, flexShrink: 0 }}>
                VIGENTE
              </span>
            ) : (
              <button onClick={e => { e.stopPropagation(); onHacerVigente() }}
                title="Dejar esta versión como la vigente para todo el ERP"
                style={{ fontSize: 9, fontWeight: 700, color: '#888', background: 'transparent', border: '1px solid #333', borderRadius: 5, padding: '1px 7px', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                Hacer vigente
              </button>
            )}
            <button
              onClick={e => { e.stopPropagation(); setEditName(s.name); setEditing(true) }}
              style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}
              title="Renombrar"
            >
              <Pencil size={11} />
            </button>
          </div>
        )}
        <div style={{ fontSize: 10, color: '#555', display: 'flex', gap: 8, marginTop: 2 }}>
          <span>{dateStr}</span>
          <span style={{ color: stageColors[s.stage] || '#888' }}>{s.stage}</span>
        </div>
      </div>

      {/* Total */}
      <div style={{ fontSize: 14, fontWeight: 700, color: isCurrent ? accentColor : '#aaa', flexShrink: 0 }}>
        ${fmt(s.total || 0)}
      </div>

      {/* Eliminar versión */}
      {canDelete && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Eliminar esta versión"
          style={{ background: 'none', border: 'none', color: '#5a3a3a', cursor: 'pointer', padding: 4, display: 'flex', flexShrink: 0 }}
          onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
          onMouseLeave={e => (e.currentTarget.style.color = '#5a3a3a')}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// COMPARE VIEW
// ═══════════════════════════════════════════════════════════════════
function CompareView({ siblings, compareA, compareB, onSelectA, onSelectB, snapA, snapB, loading, accentColor, onBack }: {
  siblings: SiblingVersion[]
  compareA: string | null
  compareB: string | null
  onSelectA: (id: string) => void
  onSelectB: (id: string) => void
  snapA: VersionSnapshot | null
  snapB: VersionSnapshot | null
  loading: boolean
  accentColor: string
  onBack: () => void
}) {
  const sibA = siblings.find(s => s.id === compareA)
  const sibB = siblings.find(s => s.id === compareB)

  return (
    <div style={{ padding: '0 16px' }}>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
        ← Volver a versiones
      </button>

      {/* Selectors */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#DC2626', textTransform: 'uppercase', marginBottom: 4 }}>Versión A</div>
          <select value={compareA || ''} onChange={e => onSelectA(e.target.value)} style={selStyle}>
            {siblings.map(s => <option key={s.id} value={s.id}>{s.version_label || '?'} — {s.name}</option>)}
          </select>
        </div>
        <ArrowRight size={16} color="#555" style={{ marginTop: 16 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#10B981', textTransform: 'uppercase', marginBottom: 4 }}>Versión B</div>
          <select value={compareB || ''} onChange={e => onSelectB(e.target.value)} style={selStyle}>
            {siblings.map(s => <option key={s.id} value={s.id}>{s.version_label || '?'} — {s.name}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 20, textAlign: 'center', color: '#555' }}>Cargando datos...</div>
      ) : snapA && snapB && sibA && sibB ? (
        <CompareResults a={snapA} b={snapB} labelA={sibA.version_label || '?'} labelB={sibB.version_label || '?'} accentColor={accentColor} />
      ) : null}
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
function CompareResults({ a, b, labelA, labelB, accentColor }: {
  a: VersionSnapshot; b: VersionSnapshot; labelA: string; labelB: string; accentColor: string
}) {
  const totalDiff = (b.total || 0) - (a.total || 0)
  const pctChange = a.total ? ((totalDiff / a.total) * 100) : 0

  // Scope diff (areas)
  const areasA = new Map((a.areas || []).map(a => [a.name.toLowerCase().trim(), a]))
  const areasB = new Map((b.areas || []).map(a => [a.name.toLowerCase().trim(), a]))
  const addedAreas = [...areasB.keys()].filter(k => !areasA.has(k))
  const removedAreas = [...areasA.keys()].filter(k => !areasB.has(k))
  const commonAreas = [...areasB.keys()].filter(k => areasA.has(k))

  // Items diff
  const itemsA = new Map((a.items || []).map(i => [itemKey(i), i]))
  const itemsB = new Map((b.items || []).map(i => [itemKey(i), i]))
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

  // Area-level totals
  const areaComps = commonAreas.map(areaKey => {
    const aA = areasA.get(areaKey)!
    const aB = areasB.get(areaKey)!
    const totalA = (a.items || []).filter(i => i.areaId === aA.id).reduce((s, i) => s + (i.total || 0), 0)
    const totalB = (b.items || []).filter(i => i.areaId === aB.id).reduce((s, i) => s + (i.total || 0), 0)
    const countA = (a.items || []).filter(i => i.areaId === aA.id).length
    const countB = (b.items || []).filter(i => i.areaId === aB.id).length
    return { name: aB.name, totalA, totalB, diff: totalB - totalA, countA, countB }
  })

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: '#DC2626', fontWeight: 700 }}>Versión {labelA}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ccc' }}>${fmt(a.total || 0)}</div>
          <div style={{ fontSize: 10, color: '#555' }}>{a.items?.length || 0} items · {a.areas?.length || 0} áreas</div>
        </div>
        <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 10 }}>
          <div style={{ fontSize: 11, color: '#10B981', fontWeight: 700 }}>Versión {labelB}</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#ccc' }}>${fmt(b.total || 0)}</div>
          <div style={{ fontSize: 10, color: '#555' }}>{b.items?.length || 0} items · {b.areas?.length || 0} áreas</div>
        </div>
      </div>

      {/* Delta */}
      <div style={{ background: totalDiff > 0 ? '#10B98115' : totalDiff < 0 ? '#DC262615' : '#33333330', borderRadius: 8, padding: 10, marginBottom: 16, textAlign: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: totalDiff > 0 ? '#10B981' : totalDiff < 0 ? '#DC2626' : '#888' }}>
          {totalDiff > 0 ? '+' : ''}{fmt(totalDiff)}
        </span>
        <span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>
          ({pctChange > 0 ? '+' : ''}{pctChange.toFixed(1)}%)
        </span>
      </div>

      {/* Scope changes */}
      <Section title="Cambios en Alcance" count={addedAreas.length + removedAreas.length + areaComps.filter(a => a.diff !== 0 || a.countA !== a.countB).length}>
        {addedAreas.map(k => (
          <DiffLine key={k} icon={<Plus size={10} color="#10B981" />} color="#10B981" text={`Área agregada: ${areasB.get(k)?.name}`} />
        ))}
        {removedAreas.map(k => (
          <DiffLine key={k} icon={<Minus size={10} color="#DC2626" />} color="#DC2626" text={`Área eliminada: ${areasA.get(k)?.name}`} />
        ))}
        {areaComps.filter(a => a.diff !== 0 || a.countA !== a.countB).map(a => (
          <div key={a.name} style={{ padding: '4px 0', fontSize: 11, color: '#ccc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{a.name} <span style={{ color: '#555' }}>({a.countA}→{a.countB} items)</span></span>
            <span style={{ color: a.diff > 0 ? '#10B981' : a.diff < 0 ? '#DC2626' : '#888', fontWeight: 600 }}>
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
          <DiffLine key={k} icon={<Plus size={10} color="#10B981" />} color="#10B981" text={item.name} detail={`$${fmt(item.total || 0)}`} />
        ))}
        {addedItems.length === 0 && <div style={{ fontSize: 11, color: '#555', padding: '4px 0' }}>Ninguno</div>}
      </Section>

      {/* Removed items */}
      <Section title="Conceptos Eliminados" count={removedItems.length}>
        {removedItems.map(([k, item]) => (
          <DiffLine key={k} icon={<Minus size={10} color="#DC2626" />} color="#DC2626" text={item.name} detail={`$${fmt(item.total || 0)}`} />
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
