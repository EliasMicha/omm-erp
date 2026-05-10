import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import {
  Mail, X, Plus, Check, Clock, Paperclip, ChevronRight, AlertTriangle, Search
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface CachedEmail {
  id: string
  thread_id: string
  message_id: string | null
  user_email: string
  subject: string
  snippet: string
  sender: string
  sender_email: string
  recipients: string[]
  received_at: string
  has_attachment: boolean
  is_read: boolean
  body_preview: string
  cached_at: string
}

interface SimpleProject {
  id: string
  name: string
}

interface Employee {
  id: string
  name: string
  nombre: string | null
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════

const input: React.CSSProperties = {
  background: '#0a0a0a', border: '1px solid #333', borderRadius: 8, padding: '8px 12px',
  color: '#fff', fontSize: 13, width: '100%', outline: 'none',
}
const select: React.CSSProperties = {
  ...input, cursor: 'pointer', appearance: 'none' as any,
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function EmailImport({
  userEmail,
  myEmployeeId,
  myArea,
  teamEmployees,
  projects = [],
  onClose,
  onCreated,
}: {
  userEmail: string
  myEmployeeId: string
  myArea: string
  teamEmployees: Employee[]
  projects?: SimpleProject[]
  onClose: () => void
  onCreated: () => void
}) {
  const [emails, setEmails] = useState<CachedEmail[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedEmail, setSelectedEmail] = useState<CachedEmail | null>(null)
  const [creating, setCreating] = useState(false)

  // Form for converting email to pendiente
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 2,
    due_date: '',
    assignee_id: '',
    project_id: '',
  })

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('cached_emails')
        .select('*')
        .eq('user_email', userEmail)
        .order('received_at', { ascending: false })
        .limit(30)
      setEmails((data || []) as CachedEmail[])
      setLoading(false)
    }
    load()
  }, [userEmail])

  const filtered = useMemo(() => {
    if (!search.trim()) return emails
    const q = search.toLowerCase()
    return emails.filter(e =>
      e.subject.toLowerCase().includes(q) ||
      e.sender.toLowerCase().includes(q) ||
      e.snippet.toLowerCase().includes(q)
    )
  }, [emails, search])

  function selectEmail(email: CachedEmail) {
    setSelectedEmail(email)
    // Pre-fill form from email
    setForm({
      title: email.subject,
      description: `De: ${email.sender} (${email.sender_email})\n${email.body_preview || email.snippet}`,
      priority: 2,
      due_date: '',
      assignee_id: '',
      project_id: '',
    })
  }

  async function createFromEmail() {
    if (!selectedEmail || !form.title.trim()) return
    setCreating(true)
    const { error } = await supabase.from('action_items').insert({
      title: form.title.trim(),
      description: form.description || null,
      priority: form.priority,
      due_date: form.due_date || null,
      assignee_id: form.assignee_id || myEmployeeId,
      created_by: myEmployeeId,
      area: myArea,
      project_id: form.project_id || null,
      source_type: 'email',
      source_id: selectedEmail.thread_id,
      source_meta: {
        subject: selectedEmail.subject,
        sender: selectedEmail.sender,
        sender_email: selectedEmail.sender_email,
        received_at: selectedEmail.received_at,
        message_id: selectedEmail.message_id,
      },
      tags: ['email'],
    })
    setCreating(false)
    if (!error) {
      setSelectedEmail(null)
      onCreated()
    }
  }

  function formatRelativeDate(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffH = Math.floor(diffMs / 3600000)
    if (diffH < 1) return 'Hace minutos'
    if (diffH < 24) return `Hace ${diffH}h`
    const diffD = Math.floor(diffH / 24)
    if (diffD === 1) return 'Ayer'
    if (diffD < 7) return `Hace ${diffD}d`
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
  }

  const PRIORITY_LABELS: Record<number, string> = { 1: 'Baja', 2: 'Media', 3: 'Alta' }
  const PRIORITY_COLORS: Record<number, string> = { 1: '#888', 2: '#3B82F6', 3: '#EF4444' }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: '#0d0d0d', border: '1px solid #333', borderRadius: 16,
        width: '90%', maxWidth: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #222',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Mail size={18} color="#3B82F6" />
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
              {selectedEmail ? 'Crear pendiente desde email' : 'Importar desde email'}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4,
          }}>
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        {selectedEmail ? (
          /* ── EMAIL → PENDIENTE FORM ── */
          <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
            {/* Email preview */}
            <div style={{
              background: '#111', border: '1px solid #222', borderRadius: 10, padding: '12px 16px',
              marginBottom: 16, borderLeft: '3px solid #3B82F6',
            }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#fff', marginBottom: 4 }}>
                {selectedEmail.subject}
              </div>
              <div style={{ fontSize: 11, color: '#666' }}>
                De: {selectedEmail.sender} &middot; {formatRelativeDate(selectedEmail.received_at)}
              </div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 6, lineHeight: 1.4 }}>
                {selectedEmail.snippet}
              </div>
            </div>

            {/* Form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Titulo del pendiente</label>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  style={{ ...input, marginTop: 4 }}
                  autoFocus
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Notas / contexto</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  style={{ ...input, marginTop: 4, minHeight: 70, resize: 'vertical' as any }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {/* Priority */}
                <div>
                  <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Prioridad</label>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {[1, 2, 3].map(p => (
                      <button key={p} onClick={() => setForm(f => ({ ...f, priority: p }))} style={{
                        flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                        background: form.priority === p ? PRIORITY_COLORS[p] + '22' : '#0a0a0a',
                        border: `1px solid ${form.priority === p ? PRIORITY_COLORS[p] : '#333'}`,
                        color: form.priority === p ? PRIORITY_COLORS[p] : '#666',
                      }}>
                        {PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Due date */}
                <div>
                  <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Fecha limite</label>
                  <input type="date" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} style={{ ...input, marginTop: 4 }} />
                </div>
                {/* Assignee */}
                <div>
                  <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Asignar a</label>
                  <select value={form.assignee_id} onChange={e => setForm(f => ({ ...f, assignee_id: e.target.value }))} style={{ ...select, marginTop: 4 }}>
                    <option value="">Yo mismo</option>
                    {teamEmployees.map(e => <option key={e.id} value={e.id}>{e.nombre || e.name}</option>)}
                  </select>
                </div>
                {/* Project */}
                <div>
                  <label style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Proyecto</label>
                  <select value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))} style={{ ...select, marginTop: 4 }}>
                    <option value="">Sin proyecto</option>
                    {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button onClick={() => setSelectedEmail(null)} style={{
                  background: 'none', border: '1px solid #333', borderRadius: 8, padding: '10px 20px',
                  color: '#888', cursor: 'pointer', fontSize: 13,
                }}>Volver</button>
                <button onClick={createFromEmail} disabled={creating} style={{
                  background: '#3B82F6', border: 'none', borderRadius: 8, padding: '10px 24px',
                  color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                  opacity: creating ? 0.5 : 1,
                }}>
                  {creating ? 'Creando...' : 'Crear pendiente'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* ── EMAIL LIST ── */
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Search */}
            <div style={{ padding: '12px 20px', borderBottom: '1px solid #1a1a1a' }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#555' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por asunto, remitente..."
                  style={{ ...input, paddingLeft: 34 }}
                  autoFocus
                />
              </div>
            </div>

            {/* Email list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
              {loading ? (
                <div style={{ padding: 30, color: '#555', fontSize: 13, textAlign: 'center' }}>Cargando emails...</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 30, color: '#444', fontSize: 13, textAlign: 'center' }}>
                  {search ? 'Sin resultados' : 'No hay emails recientes en cache'}
                </div>
              ) : (
                filtered.map(email => (
                  <div key={email.id} onClick={() => selectEmail(email)} style={{
                    display: 'flex', gap: 12, padding: '12px 14px', cursor: 'pointer',
                    borderRadius: 10, marginBottom: 4, transition: 'background 0.15s',
                    border: '1px solid transparent',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#151515'; e.currentTarget.style.borderColor = '#222' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent' }}>
                    {/* Icon */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 18, flexShrink: 0,
                      background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Mail size={16} color="#3B82F6" />
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {email.sender}
                        </div>
                        <div style={{ fontSize: 10, color: '#555', flexShrink: 0, marginLeft: 8 }}>
                          {formatRelativeDate(email.received_at)}
                        </div>
                      </div>
                      <div style={{
                        fontSize: 13, fontWeight: 500, color: '#fff',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2,
                      }}>
                        {email.subject}
                      </div>
                      <div style={{
                        fontSize: 11, color: '#555',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {email.snippet}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        {email.has_attachment && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#666' }}>
                            <Paperclip size={9} /> Adjunto
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Arrow */}
                    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      <ChevronRight size={16} color="#333" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
