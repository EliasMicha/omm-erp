import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Project } from '../types'
import { F, STATUS_CONFIG, SPECIALTY_CONFIG } from '../lib/utils'
import { Badge, ProgressBar, Btn, Loading, SectionHeader, EmptyState } from '../components/layout/UI'
import { Plus, X } from 'lucide-react'

function NuevoProyectoModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', client_name: '', contract_value: '', lines: [] as string[], status: 'activo'
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function crear() {
    if (!form.name || !form.client_name) { setError('Nombre y cliente son requeridos'); return }
    setSaving(true); setError('')
    const { error: err } = await supabase.from('projects').insert({
      name: form.name,
      client_name: form.client_name,
      contract_value: parseFloat(form.contract_value) || 0,
      lines: form.lines,
      status: form.status,
      advance_pct: 0,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    onCreated()
  }

  const toggleLine = (l: string) =>
    setForm(f => ({ ...f, lines: f.lines.includes(l) ? f.lines.filter(x => x !== l) : [...f.lines, l] }))

  const inp = (label: string, key: string, placeholder = '', type = 'text') => (
    <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block' }}>
      {label}
      <input type={type} value={(form as any)[key]} placeholder={placeholder}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }} />
    </label>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#141414', border: '1px solid #333', borderRadius: 16, padding: 24, width: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#fff' }}>Nuevo proyecto</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          {inp('Nombre del proyecto', 'name', 'ej. Oasis 5 - Fase 2')}
          {inp('Cliente', 'client_name', 'ej. Grupo Desarrollador XYZ')}
          {inp('Valor de contrato (MXN)', 'contract_value', '0', 'number')}

          <label style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Estado
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              style={{ display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', background: '#1e1e1e', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit' }}>
              <option value="activo">Activo</option>
              <option value="pausado">Pausado</option>
              <option value="completado">Completado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </label>

          <div>
            <div style={{ fontSize: 11, color: '#555', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Lineas de especialidad</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(SPECIALTY_CONFIG).map(([k, v]) => {
                const on = form.lines.includes(k)
                return (
                  <button key={k} onClick={() => toggleLine(k)} style={{
                    padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600,
                    border: `1px solid ${on ? v.color : '#333'}`,
                    background: on ? v.color + '22' : 'transparent',
                    color: on ? v.color : '#666',
                  }}>
                    {v.icon} {v.label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        {error && <div style={{ color: '#EF4444', fontSize: 12, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose}>Cancelar</Btn>
          <Btn variant="primary" onClick={crear}>{saving ? 'Guardando...' : 'Crear proyecto'}</Btn>
        </div>
      </div>
    </div>
  )
}

export default function Proyectos() {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<string>('activo')
  const [showModal, setShowModal] = useState(false)

  function load() {
    setLoading(true)
    supabase.from('projects').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setProjects(data || []); setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const lista = filtro === 'todos' ? projects : projects.filter(p => p.status === filtro)

  return (
    <div style={{ padding: '24px 28px' }}>
      <SectionHeader
        title="Proyectos"
        subtitle={`${projects.length} proyectos totales`}
        action={<Btn variant="primary" onClick={() => setShowModal(true)}><Plus size={14} /> Nuevo proyecto</Btn>}
      />

      <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
        {['todos', 'activo', 'pausado', 'completado', 'cancelado'].map(f => {
          const on = filtro === f
          const cfg = f !== 'todos' ? STATUS_CONFIG[f as any] : null
          return (
            <button key={f} onClick={() => setFiltro(f)} style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
              border: `1px solid ${on ? (cfg?.color || '#57FF9A') : '#333'}`,
              background: on ? (cfg?.color || '#57FF9A') + '22' : 'transparent',
              color: on ? (cfg?.color || '#57FF9A') : '#666', fontWeight: on ? 600 : 400,
            }}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          )
        })}
      </div>

      {loading ? <Loading /> : lista.length === 0 ? (
        <EmptyState message="Sin proyectos — crea el primero" />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
          {lista.map(p => {
            const cfg = STATUS_CONFIG[p.status]
            return (
              <div key={p.id} style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: '16px 18px', borderTop: `2px solid ${cfg.color}33` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: '#555' }}>{p.client_name}</div>
                  </div>
                  <Badge label={cfg.label} color={cfg.color} />
                </div>

                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
                  {p.lines.map(l => {
                    const e = SPECIALTY_CONFIG[l]
                    return e ? <Badge key={l} label={e.icon + ' ' + e.label} color={e.color} /> : null
                  })}
                </div>

                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, color: '#555', marginBottom: 4 }}>Avance de obra</div>
                  <ProgressBar pct={p.advance_pct} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTop: '1px solid #1e1e1e' }}>
                  <span style={{ fontSize: 10, color: '#555' }}>Valor contrato</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#57FF9A' }}>{F(p.contract_value)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showModal && (
        <NuevoProyectoModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load() }}
        />
      )}
    </div>
  )
}
