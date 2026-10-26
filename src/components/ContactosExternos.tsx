import { useEffect, useState } from 'react'
import { Users, Trash2, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'

// Contactos externos de un lead (o de una obra): cliente, arquitecto,
// residente, segurista. Con su teléfono el bot de WhatsApp reconoce a quien
// escribe —p. ej. un cliente que pide su estado de cuenta, que se le manda
// con el OK de Elias— y sabe a quién va dirigido un reporte oficial.

interface Contacto {
  id: string; nombre: string; rol: string; empresa: string | null; telefono: string | null
  email: string | null; recibe_estado_cuenta: boolean; notas: string | null; activo: boolean
}

const ROLES: Record<string, string> = {
  cliente: 'Cliente', arquitecto: 'Arquitecto / despacho', residente: 'Residente de obra',
  segurista: 'Seguridad e higiene', administracion: 'Administración / pagos', otro: 'Otro',
}

const input: React.CSSProperties = { background: '#0d0d0d', border: '1px solid #2b2b2b', borderRadius: 7, padding: '6px 8px', color: '#ddd', fontSize: 12.5, fontFamily: 'inherit' }
const th: React.CSSProperties = { textAlign: 'left', padding: '5px 6px', color: '#666', fontSize: 11, fontWeight: 500, borderBottom: '1px solid #222' }
const td: React.CSSProperties = { padding: '5px 6px', color: '#ccc', fontSize: 12.5, borderBottom: '1px solid #1a1a1a', verticalAlign: 'middle' }

const solo10 = (t: string) => t.replace(/\D/g, '').slice(-10)

export default function ContactosExternos({ leadId, obraId }: { leadId?: string; obraId?: string }) {
  const [lista, setLista] = useState([] as Contacto[])
  const [nuevo, setNuevo] = useState({ nombre: '', rol: 'cliente', empresa: '', telefono: '', email: '', recibe_estado_cuenta: false })
  const [err, setErr] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    let q = supabase.from('contactos_externos').select('id, nombre, rol, empresa, telefono, email, recibe_estado_cuenta, notas, activo').order('created_at')
    q = leadId ? q.eq('lead_id', leadId) : q.eq('obra_id', obraId || '')
    const { data, error } = await q
    if (error) setErr(error.message)
    setLista((data || []) as Contacto[])
  }
  useEffect(() => { if (leadId || obraId) cargar() }, [leadId, obraId])

  async function agregar() {
    if (!nuevo.nombre.trim()) { setErr('Falta el nombre.'); return }
    const t = solo10(nuevo.telefono)
    if (nuevo.telefono && t.length !== 10) { setErr('El teléfono debe tener 10 dígitos.'); return }
    setGuardando(true); setErr('')
    const { error } = await supabase.from('contactos_externos').insert({
      lead_id: leadId || null, obra_id: obraId || null, nombre: nuevo.nombre.trim(), rol: nuevo.rol,
      empresa: nuevo.empresa.trim() || null, telefono: t || null, email: nuevo.email.trim() || null,
      recibe_estado_cuenta: nuevo.recibe_estado_cuenta,
    })
    setGuardando(false)
    if (error) { setErr(error.message); return }
    setNuevo({ nombre: '', rol: 'cliente', empresa: '', telefono: '', email: '', recibe_estado_cuenta: false })
    cargar()
  }
  async function cambiar(c: Contacto, cambios: Partial<Contacto>) {
    const { error } = await supabase.from('contactos_externos').update(cambios).eq('id', c.id)
    if (error) setErr(error.message); else cargar()
  }
  async function quitar(c: Contacto) {
    if (!confirm(`¿Quitar a ${c.nombre} de los contactos?`)) return
    const { error } = await supabase.from('contactos_externos').delete().eq('id', c.id)
    if (error) setErr(error.message); else cargar()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Users size={14} color="#57FF9A" />
        <span style={{ color: '#eee', fontSize: 13.5, fontWeight: 600 }}>Contactos</span>
        <span style={{ color: '#666', fontSize: 11.5 }}>Con su celular, el WhatsApp de OMM los reconoce. El estado de cuenta sólo sale con tu OK.</span>
      </div>
      {err && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 6 }}>{err}</div>}
      {lista.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 8 }}>
          <thead><tr><th style={th}>Nombre</th><th style={th}>Rol</th><th style={th}>Celular</th><th style={th}>Correo</th><th style={th} title="Puede recibir su estado de cuenta por WhatsApp (siempre con tu aprobación)">Edo. cuenta</th><th style={th}></th></tr></thead>
          <tbody>{lista.map(c => (
            <tr key={c.id} style={{ opacity: c.activo ? 1 : 0.5 }}>
              <td style={td}>{c.nombre}{c.empresa ? <span style={{ color: '#777' }}> · {c.empresa}</span> : null}</td>
              <td style={td}>
                <select style={input} value={c.rol} onChange={e => cambiar(c, { rol: e.target.value })}>
                  {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td style={td}><input style={{ ...input, width: 110 }} defaultValue={c.telefono || ''} onBlur={e => { const t = solo10(e.target.value); if (t !== (c.telefono || '') && (t.length === 10 || t === '')) cambiar(c, { telefono: t || null }) }} /></td>
              <td style={td}><input style={{ ...input, width: 170 }} defaultValue={c.email || ''} onBlur={e => { const v = e.target.value.trim(); if (v !== (c.email || '')) cambiar(c, { email: v || null }) }} /></td>
              <td style={td}><input type="checkbox" checked={c.recibe_estado_cuenta} onChange={() => cambiar(c, { recibe_estado_cuenta: !c.recibe_estado_cuenta })} /></td>
              <td style={td}><button onClick={() => quitar(c)} style={{ background: 'none', border: 0, color: '#777', cursor: 'pointer' }}><Trash2 size={13} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <input style={{ ...input, width: 170 }} placeholder="Nombre" value={nuevo.nombre} onChange={e => setNuevo({ ...nuevo, nombre: e.target.value })} />
        <select style={input} value={nuevo.rol} onChange={e => setNuevo({ ...nuevo, rol: e.target.value })}>
          {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input style={{ ...input, width: 140 }} placeholder="Empresa (opcional)" value={nuevo.empresa} onChange={e => setNuevo({ ...nuevo, empresa: e.target.value })} />
        <input style={{ ...input, width: 110 }} placeholder="Celular 10 dígitos" value={nuevo.telefono} onChange={e => setNuevo({ ...nuevo, telefono: e.target.value })} />
        <input style={{ ...input, width: 170 }} placeholder="Correo (opcional)" value={nuevo.email} onChange={e => setNuevo({ ...nuevo, email: e.target.value })} />
        <label style={{ color: '#aaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={nuevo.recibe_estado_cuenta} onChange={e => setNuevo({ ...nuevo, recibe_estado_cuenta: e.target.checked })} /> recibe estado de cuenta
        </label>
        <button onClick={agregar} disabled={guardando} style={{ border: 0, borderRadius: 7, padding: '6px 10px', background: '#57FF9A', color: '#062012', fontWeight: 700, cursor: 'pointer', fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <Plus size={13} /> Agregar
        </button>
      </div>
    </div>
  )
}
