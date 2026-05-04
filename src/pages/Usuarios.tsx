import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, PermissionArea } from '../contexts/AuthContext'

interface AppUser {
  id: string
  email: string
  nombre: string
  permission_area: PermissionArea
  activo: boolean
  created_at: string
}

const AREAS: { value: PermissionArea; label: string }[] = [
  { value: 'DG', label: 'Dirección General' },
  { value: 'Administracion', label: 'Administración' },
  { value: 'Ventas_Ingenieria', label: 'Ventas / Ingeniería' },
  { value: 'Operaciones', label: 'Operaciones' },
]

const inputStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
  padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', width: '100%',
  boxSizing: 'border-box',
}

const btnStyle: React.CSSProperties = {
  background: '#57FF9A', color: '#000', border: 'none', borderRadius: 8,
  padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
}

export default function Usuarios() {
  const { user } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingPw, setEditingPw] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const [form, setForm] = useState({ email: '', password: '', nombre: '', permission_area: 'Operaciones' as PermissionArea })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadUsers() {
    setLoading(true)
    const { data, error } = await supabase.from('app_users').select('id, email, nombre, permission_area, activo, created_at').order('created_at')
    if (error) console.error(error)
    setUsers((data as AppUser[]) || [])
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!form.email || !form.password || !form.nombre) {
      setError('Todos los campos son obligatorios')
      return
    }
    const { data, error: err } = await supabase.rpc('create_app_user', {
      p_email: form.email,
      p_password: form.password,
      p_nombre: form.nombre,
      p_permission_area: form.permission_area,
    })
    if (err) {
      setError(err.message.includes('unique') ? 'Ese email ya está registrado' : err.message)
      return
    }
    setSuccess(`Usuario ${form.nombre} creado`)
    setForm({ email: '', password: '', nombre: '', permission_area: 'Operaciones' })
    setShowForm(false)
    loadUsers()
  }

  async function toggleActivo(u: AppUser) {
    await supabase.from('app_users').update({ activo: !u.activo }).eq('id', u.id)
    loadUsers()
  }

  async function updateArea(userId: string, area: PermissionArea) {
    await supabase.from('app_users').update({ permission_area: area }).eq('id', userId)
    loadUsers()
  }

  async function handlePasswordChange(userId: string) {
    if (!newPw || newPw.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    const { error: err } = await supabase.rpc('update_user_password', {
      p_user_id: userId,
      p_new_password: newPw,
    })
    if (err) { setError(err.message); return }
    setSuccess('Contraseña actualizada')
    setEditingPw(null)
    setNewPw('')
  }

  if (user?.permission_area !== 'DG') {
    return <div style={{ padding: 40, color: '#f66' }}>Solo Dirección General puede administrar usuarios.</div>
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Usuarios</h1>
        <button onClick={() => { setShowForm(!showForm); setError(''); setSuccess('') }} style={btnStyle}>
          {showForm ? 'Cancelar' : '+ Nuevo usuario'}
        </button>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f66', marginBottom: 16 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: 'rgba(87,255,154,0.1)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#57FF9A', marginBottom: 16 }}>
          {success}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#111', border: '1px solid #222', borderRadius: 12,
          padding: 24, marginBottom: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Nombre</label>
            <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} style={inputStyle} placeholder="Juan Pérez" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Email</label>
            <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} placeholder="juan@omniious.com" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Contraseña</label>
            <input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} style={inputStyle} placeholder="mínimo 6 caracteres" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Área de permiso</label>
            <select value={form.permission_area} onChange={e => setForm({ ...form, permission_area: e.target.value as PermissionArea })}
              style={{ ...inputStyle, appearance: 'auto' }}>
              {AREAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" style={btnStyle}>Crear usuario</button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: '#666', padding: 20 }}>Cargando...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #333', color: '#888', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Nombre</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Email</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Área</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Estado</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #1a1a1a', opacity: u.activo ? 1 : 0.5 }}>
                <td style={{ padding: '10px 12px', color: '#fff' }}>{u.nombre}</td>
                <td style={{ padding: '10px 12px', color: '#aaa' }}>{u.email}</td>
                <td style={{ padding: '10px 12px' }}>
                  <select value={u.permission_area} onChange={e => updateArea(u.id, e.target.value as PermissionArea)}
                    style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', padding: '4px 8px', fontSize: 12 }}>
                    {AREAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                    background: u.activo ? 'rgba(87,255,154,0.15)' : 'rgba(255,60,60,0.15)',
                    color: u.activo ? '#57FF9A' : '#f66',
                  }}>
                    {u.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={() => toggleActivo(u)}
                    style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: u.activo ? '#f66' : '#57FF9A', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  {editingPw === u.id ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input type="text" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="nueva contraseña"
                        style={{ ...inputStyle, width: 140, padding: '4px 8px', fontSize: 12 }} />
                      <button onClick={() => handlePasswordChange(u.id)}
                        style={{ background: '#57FF9A', color: '#000', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                        OK
                      </button>
                      <button onClick={() => { setEditingPw(null); setNewPw('') }}
                        style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingPw(u.id); setNewPw('') }}
                      style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: '#888', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                      Cambiar contraseña
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
