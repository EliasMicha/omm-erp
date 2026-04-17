import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { SectionHeader, Table, Th, Td, Badge, Btn, EmptyState } from '../components/layout/UI'
import { Plus, Search, Edit, X, Trash2, BookOpen, ChevronDown, ChevronUp, Copy } from 'lucide-react'

interface DesignRule {
  id: string
  system: string
  category: string
  rule_title: string
  rule_text: string
  applies_to: string[]
  priority: number
  is_active: boolean
  created_at: string
  updated_at: string
}

const SYSTEMS = [
  'Audio', 'Redes', 'CCTV', 'Control de Acceso', 'Control de Iluminación',
  'Detección de Humo', 'BMS', 'Telefonía', 'Red Celular', 'Cortinas', 'General',
]

const CATEGORIES = ['sizing', 'brands', 'placement', 'wiring', 'architecture', 'general']

const LEVELS = ['premium', 'alto', 'medio', 'basico']

const iS: React.CSSProperties = {
  width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333',
  borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none',
  boxSizing: 'border-box' as const,
}

const taS: React.CSSProperties = {
  ...iS, minHeight: 120, resize: 'vertical' as const, lineHeight: 1.5,
}

function Fld({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div style={{ marginBottom: 12, gridColumn: span ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  )
}

const emptyForm: Partial<DesignRule> = {
  system: 'Audio',
  category: 'general',
  rule_title: '',
  rule_text: '',
  applies_to: [],
  priority: 50,
  is_active: true,
}

export default function DesignRules() {
  const [rules, setRules] = useState<DesignRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<DesignRule>>(emptyForm)
  const [search, setSearch] = useState('')
  const [filterSystem, setFilterSystem] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('design_rules')
      .select('*')
      .order('system', { ascending: true })
      .order('priority', { ascending: false })
    if (!error && data) setRules(data)
    setLoading(false)
  }

  function openNew() {
    setForm({ ...emptyForm })
    setEditId(null)
    setShowForm(true)
  }

  function openEdit(rule: DesignRule) {
    setForm({ ...rule })
    setEditId(rule.id)
    setShowForm(true)
  }

  function openDuplicate(rule: DesignRule) {
    setForm({ ...rule, rule_title: rule.rule_title + ' (copia)', id: undefined })
    setEditId(null)
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.rule_title?.trim() || !form.rule_text?.trim()) return
    setSaving(true)
    const payload = {
      system: form.system || 'General',
      category: form.category || 'general',
      rule_title: form.rule_title!.trim(),
      rule_text: form.rule_text!.trim(),
      applies_to: form.applies_to || [],
      priority: form.priority || 50,
      is_active: form.is_active !== false,
    }

    if (editId) {
      await supabase.from('design_rules').update(payload).eq('id', editId)
    } else {
      await supabase.from('design_rules').insert(payload)
    }
    setSaving(false)
    setShowForm(false)
    load()
  }

  async function handleDelete(id: string) {
    if (!confirm('¿Eliminar esta regla de diseño?')) return
    await supabase.from('design_rules').delete().eq('id', id)
    load()
  }

  async function handleToggleActive(rule: DesignRule) {
    await supabase.from('design_rules').update({ is_active: !rule.is_active }).eq('id', rule.id)
    load()
  }

  function toggleLevel(level: string) {
    const current = form.applies_to || []
    if (current.includes(level)) {
      setForm({ ...form, applies_to: current.filter(l => l !== level) })
    } else {
      setForm({ ...form, applies_to: [...current, level] })
    }
  }

  const filtered = rules.filter(r => {
    if (filterSystem && r.system !== filterSystem) return false
    if (filterCategory && r.category !== filterCategory) return false
    if (search) {
      const s = search.toLowerCase()
      return r.rule_title.toLowerCase().includes(s) || r.rule_text.toLowerCase().includes(s) || r.system.toLowerCase().includes(s)
    }
    return true
  })

  const systemCounts: Record<string, number> = {}
  for (const r of rules) {
    systemCounts[r.system] = (systemCounts[r.system] || 0) + 1
  }

  return (
    <div style={{ padding: 24 }}>
      <SectionHeader
        title="Reglas de Diseño AI"
        subtitle={`${rules.length} reglas activas — el agente AI las carga dinámicamente al generar propuestas`}
        action={
          <Btn variant="primary" onClick={openNew}>
            <Plus size={14} /> Nueva Regla
          </Btn>
        }
      />

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
        {Object.entries(systemCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([sys, count]) => (
          <div
            key={sys}
            onClick={() => setFilterSystem(filterSystem === sys ? '' : sys)}
            style={{
              background: filterSystem === sys ? 'rgba(87,255,154,0.08)' : '#141414',
              border: filterSystem === sys ? '1px solid rgba(87,255,154,0.3)' : '1px solid #222',
              borderRadius: 10, padding: '10px 14px', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 10, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{sys}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: filterSystem === sys ? '#57FF9A' : '#fff', marginTop: 2 }}>{count}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#555' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar reglas..."
            style={{ ...iS, paddingLeft: 30 }}
          />
        </div>
        <select value={filterSystem} onChange={e => setFilterSystem(e.target.value)} style={{ ...iS, width: 180 }}>
          <option value="">Todos los sistemas</option>
          {SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)} style={{ ...iS, width: 160 }}>
          <option value="">Todas las categorías</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        {(filterSystem || filterCategory || search) && (
          <Btn variant="ghost" size="sm" onClick={() => { setFilterSystem(''); setFilterCategory(''); setSearch('') }}>
            <X size={12} /> Limpiar
          </Btn>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#555' }}>Cargando reglas...</div>
      ) : filtered.length === 0 ? (
        <EmptyState message="No hay reglas que coincidan con los filtros" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Sistema</Th>
              <Th>Categoría</Th>
              <Th>Título</Th>
              <Th>Aplica a</Th>
              <Th right>Prioridad</Th>
              <Th>Estado</Th>
              <Th right>Acciones</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(rule => (
              <>
                <tr
                  key={rule.id}
                  style={{ cursor: 'pointer', opacity: rule.is_active ? 1 : 0.5 }}
                  onClick={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
                >
                  <Td>
                    <Badge label={rule.system} color="#57FF9A" />
                  </Td>
                  <Td><span style={{ fontSize: 11, color: '#888' }}>{rule.category}</span></Td>
                  <Td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {expandedId === rule.id ? <ChevronUp size={12} color="#555" /> : <ChevronDown size={12} color="#555" />}
                      <span style={{ fontWeight: 500, color: '#ddd' }}>{rule.rule_title}</span>
                    </div>
                  </Td>
                  <Td>
                    {rule.applies_to && rule.applies_to.length > 0
                      ? rule.applies_to.map(l => (
                          <span key={l} style={{
                            display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                            fontSize: 10, background: '#222', color: '#aaa', marginRight: 4,
                          }}>{l}</span>
                        ))
                      : <span style={{ fontSize: 10, color: '#555' }}>todos</span>
                    }
                  </Td>
                  <Td right><span style={{ fontSize: 12, color: '#888' }}>{rule.priority}</span></Td>
                  <Td>
                    <Badge label={rule.is_active ? 'Activa' : 'Inactiva'} color={rule.is_active ? '#57FF9A' : '#666'} />
                  </Td>
                  <Td right>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
                      <Btn variant="ghost" size="sm" onClick={() => openEdit(rule)}><Edit size={12} /></Btn>
                      <Btn variant="ghost" size="sm" onClick={() => openDuplicate(rule)}><Copy size={12} /></Btn>
                      <Btn variant="ghost" size="sm" onClick={() => handleToggleActive(rule)}>
                        {rule.is_active ? '⏸' : '▶'}
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => handleDelete(rule.id)}><Trash2 size={12} color="#EF4444" /></Btn>
                    </div>
                  </Td>
                </tr>
                {expandedId === rule.id && (
                  <tr key={rule.id + '-exp'}>
                    <Td colSpan={7} style={{ background: '#0d0d0d', padding: '12px 20px' }}>
                      <pre style={{
                        whiteSpace: 'pre-wrap', fontSize: 12, color: '#bbb', lineHeight: 1.6,
                        margin: 0, fontFamily: 'inherit',
                      }}>
                        {rule.rule_text}
                      </pre>
                      <div style={{ fontSize: 10, color: '#444', marginTop: 8 }}>
                        Actualizado: {new Date(rule.updated_at).toLocaleDateString('es-MX')}
                      </div>
                    </Td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </Table>
      )}

      {/* Form Modal */}
      {showForm && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }} onClick={() => setShowForm(false)}>
          <div
            style={{
              background: '#1a1a1a', border: '1px solid #333', borderRadius: 16,
              padding: 28, width: 620, maxHeight: '85vh', overflowY: 'auto',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>
                <BookOpen size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />
                {editId ? 'Editar Regla' : 'Nueva Regla de Diseño'}
              </div>
              <Btn variant="ghost" size="sm" onClick={() => setShowForm(false)}><X size={14} /></Btn>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              <Fld label="Sistema">
                <select value={form.system || ''} onChange={e => setForm({ ...form, system: e.target.value })} style={iS}>
                  {SYSTEMS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Fld>
              <Fld label="Categoría">
                <select value={form.category || ''} onChange={e => setForm({ ...form, category: e.target.value })} style={iS}>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Fld>
              <Fld label="Título de la Regla" span>
                <input
                  value={form.rule_title || ''}
                  onChange={e => setForm({ ...form, rule_title: e.target.value })}
                  placeholder="Ej: Sizing de bocinas por m²"
                  style={iS}
                />
              </Fld>
              <Fld label="Texto de la Regla (lo que lee el AI)" span>
                <textarea
                  value={form.rule_text || ''}
                  onChange={e => setForm({ ...form, rule_text: e.target.value })}
                  placeholder="Escribe la regla tal como quieres que el AI la interprete..."
                  style={taS}
                />
              </Fld>
              <Fld label="Aplica a niveles (vacío = todos)">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {LEVELS.map(level => {
                    const active = (form.applies_to || []).includes(level)
                    return (
                      <button
                        key={level}
                        onClick={() => toggleLevel(level)}
                        style={{
                          padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                          cursor: 'pointer', transition: 'all 0.15s', border: 'none',
                          background: active ? 'rgba(87,255,154,0.15)' : '#222',
                          color: active ? '#57FF9A' : '#888',
                        }}
                      >
                        {level}
                      </button>
                    )
                  })}
                </div>
              </Fld>
              <Fld label="Prioridad (mayor = más importante)">
                <input
                  type="number"
                  value={form.priority || 50}
                  onChange={e => setForm({ ...form, priority: parseInt(e.target.value) || 50 })}
                  style={iS}
                />
              </Fld>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={form.is_active !== false}
                  onChange={e => setForm({ ...form, is_active: e.target.checked })}
                />
                <span style={{ fontSize: 12, color: '#aaa' }}>Regla activa</span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Btn variant="default" onClick={() => setShowForm(false)}>Cancelar</Btn>
              <Btn variant="primary" onClick={handleSave} disabled={saving || !form.rule_title?.trim() || !form.rule_text?.trim()}>
                {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Crear Regla'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
