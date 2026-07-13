import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, PermissionArea, UserNivel } from '../contexts/AuthContext'

interface AppUser {
  id: string
  email: string
  nombre: string
  permission_area: PermissionArea
  nivel: UserNivel | null
  activo: boolean
  created_at: string
  employee_id: string | null
}

interface Employee {
  id: string
  name: string
  nombre: string | null
  email: string | null
  puesto: string | null
  area: string | null
  activo: boolean | null
}

const AREAS: { value: PermissionArea; label: string }[] = [
  { value: 'DG', label: 'Dirección General' },
  { value: 'Administracion', label: 'Administración' },
  { value: 'Ventas_Ingenieria', label: 'Ventas / Ingeniería' },
  { value: 'Operaciones', label: 'Operaciones' },
  { value: 'Mantenimiento', label: 'Mantenimiento (solo Mtto, Catálogo y Obra)' },
  { value: 'Coordinador_Obra', label: 'Coordinador de Obra (solo Obra)' },
]

const inputStyle: React.CSSProperties = {
  background: '#1a1a1a', border: '1px solid #333', borderRadius: 8,
  padding: '10px 14px', color: '#fff', fontSize: 14, outline: 'none', width: '100%',
  boxSizing: 'border-box',
}

const btnStyle: React.CSSProperties = {
  background: '#10B981', color: '#000', border: 'none', borderRadius: 8,
  padding: '10px 20px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
}

export default function Usuarios() {
  const { user } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingPw, setEditingPw] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const [selectedEmployee, setSelectedEmployee] = useState<string>('')
  const [form, setForm] = useState({ email: '', password: '', nombre: '', permission_area: 'Operaciones' as PermissionArea, nivel: 'ejecutor' as UserNivel })

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadUsers() {
    setLoading(true)
    const { data } = await supabase.from('app_users').select('id, email, nombre, permission_area, nivel, activo, created_at, employee_id').order('created_at', { ascending: true })
    setUsers((data as AppUser[]) || [])
    setLoading(false)
  }

  async function loadEmployees() {
    const { data } = await supabase.from('employees').select('id, name, nombre, email, puesto, area, activo').order('name')
    setEmployees((data as Employee[]) || [])
  }

  useEffect(() => { loadUsers(); loadEmployees() }, [])

  // Employees that don't already have a user account
  const usedEmployeeIds = new Set(users.map(u => u.employee_id).filter(Boolean))
  const availableEmployees = employees.filter(e => !usedEmployeeIds.has(e.id) && e.activo !== false)

  function handleSelectEmployee(empId: string) {
    setSelectedEmployee(empId)
    const emp = employees.find(e => e.id === empId)
    if (emp) {
      setForm(f => ({
        ...f,
        nombre: emp.nombre || emp.name || '',
        email: emp.email || '',
      }))
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!form.email || !form.password || !form.nombre) {
      setError('Todos los campos son obligatorios')
      return
    }
    if (form.password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres')
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
    // Link to employee and set nivel
    if (data) {
      const updates: any = { nivel: form.nivel }
      if (selectedEmployee) updates.employee_id = selectedEmployee
      await supabase.from('app_users').update(updates).eq('id', data)
    }
    setSuccess(`Usuario ${form.nombre} creado`)
    setForm({ email: '', password: '', nombre: '', permission_area: 'Operaciones', nivel: 'ejecutor' })
    setSelectedEmployee('')
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

  async function updateNivel(userId: string, nivel: UserNivel) {
    await supabase.from('app_users').update({ nivel }).eq('id', userId)
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

  // Find employee name for a user
  function getEmployeeName(empId: string | null) {
    if (!empId) return null
    const emp = employees.find(e => e.id === empId)
    return emp ? (emp.nombre || emp.name) : null
  }

  if (user?.permission_area !== 'DG') {
    return <div style={{ padding: 40, color: '#f66' }}>Solo Dirección General puede administrar usuarios.</div>
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1000 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>Usuarios del Sistema</h1>
          <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{users.length} usuarios · {users.filter(u => u.activo).length} activos</div>
        </div>
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
        <div style={{ background: 'rgba(87,255,154,0.1)', border: '1px solid rgba(87,255,154,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#10B981', marginBottom: 16 }}>
          {success}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} style={{
          background: '#111', border: '1px solid #222', borderRadius: 12,
          padding: 24, marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {/* Employee selector */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 12, color: '#888' }}>Empleado</label>
            <select value={selectedEmployee} onChange={e => handleSelectEmployee(e.target.value)}
              style={{ ...inputStyle, appearance: 'auto' }}>
              <option value="">— Seleccionar empleado —</option>
              {availableEmployees.map(emp => (
                <option key={emp.id} value={emp.id}>
                  {emp.nombre || emp.name}{emp.puesto ? ` · ${emp.puesto}` : ''}{emp.area ? ` · ${emp.area}` : ''}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: '#555' }}>Solo empleados activos sin cuenta</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Nombre</label>
              <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} style={inputStyle} placeholder="Se llena automáticamente" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} style={inputStyle} placeholder="Se llena automáticamente" />
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 12, color: '#888' }}>Nivel</label>
              <select value={form.nivel} onChange={e => setForm({ ...form, nivel: e.target.value as UserNivel })}
                style={{ ...inputStyle, appearance: 'auto' }}>
                <option value="director">Director — ve todo su área</option>
                <option value="ejecutor">Ejecutor — solo lo asignado</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
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
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Empleado</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Área</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Nivel</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Estado</th>
              <th style={{ padding: '10px 12px', fontWeight: 500 }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderBottom: '1px solid #1a1a1a', opacity: u.activo ? 1 : 0.5 }}>
                <td style={{ padding: '10px 12px', color: '#fff' }}>{u.nombre}</td>
                <td style={{ padding: '10px 12px', color: '#aaa' }}>{u.email}</td>
                <td style={{ padding: '10px 12px', color: u.employee_id ? '#10B981' : '#555' }}>
                  {u.employee_id ? getEmployeeName(u.employee_id) || 'Vinculado' : 'Sin vincular'}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <select value={u.permission_area} onChange={e => updateArea(u.id, e.target.value as PermissionArea)}
                    style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', padding: '4px 8px', fontSize: 12 }}>
                    {AREAS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <select value={u.nivel || 'ejecutor'} onChange={e => updateNivel(u.id, e.target.value as UserNivel)}
                    style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, color: '#ccc', padding: '4px 8px', fontSize: 12 }}>
                    <option value="director">Director</option>
                    <option value="ejecutor">Ejecutor</option>
                  </select>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                    background: u.activo ? 'rgba(87,255,154,0.15)' : 'rgba(255,60,60,0.15)',
                    color: u.activo ? '#10B981' : '#f66',
                  }}>
                    {u.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={() => toggleActivo(u)}
                      style={{ background: 'none', border: '1px solid #333', borderRadius: 6, color: u.activo ? '#f66' : '#10B981', padding: '4px 10px', fontSize: 11, cursor: 'pointer' }}>
                      {u.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    {editingPw === u.id ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input type="text" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="nueva contraseña"
                          style={{ ...inputStyle, width: 140, padding: '4px 8px', fontSize: 12 }} />
                        <button onClick={() => handlePasswordChange(u.id)}
                          style={{ background: '#10B981', color: '#000', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
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
                        Contraseña
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
