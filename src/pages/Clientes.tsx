import { useState } from 'react'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import { Users2, Plus, Search, Edit, Trash2, X, CheckCircle, Building2 } from 'lucide-react'

interface ClienteFiscal {
  id: string
  rfc: string
  razon_social: string
  regimen_fiscal: string
  regimen_fiscal_clave: string
  codigo_postal: string
  uso_cfdi: string
  uso_cfdi_clave: string
  curp: string
  calle: string
  num_exterior: string
  num_interior: string
  colonia: string
  localidad: string
  municipio: string
  estado: string
  tipo_persona: 'fisica' | 'moral'
  email: string
  telefono: string
  activo: boolean
}

const REGIMENES = [
  { clave: '601', desc: 'General de Ley Personas Morales' },
  { clave: '603', desc: 'Personas Morales con Fines no Lucrativos' },
  { clave: '605', desc: 'Sueldos y Salarios' },
  { clave: '606', desc: 'Arrendamiento' },
  { clave: '607', desc: 'Regimen de Enajenacion o Adquisicion de Bienes' },
  { clave: '608', desc: 'Demas ingresos' },
  { clave: '610', desc: 'Residentes en el Extranjero' },
  { clave: '611', desc: 'Ingresos por Dividendos' },
  { clave: '612', desc: 'Personas Fisicas con Actividades Empresariales y Profesionales' },
  { clave: '614', desc: 'Ingresos por intereses' },
  { clave: '616', desc: 'Sin obligaciones fiscales' },
  { clave: '620', desc: 'Sociedades Cooperativas de Produccion' },
  { clave: '621', desc: 'Incorporacion Fiscal' },
  { clave: '622', desc: 'Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras' },
  { clave: '623', desc: 'Opcional para Grupos de Sociedades' },
  { clave: '624', desc: 'Coordinados' },
  { clave: '625', desc: 'Regimen de las Actividades Empresariales con ingresos a traves de Plataformas Tecnologicas' },
  { clave: '626', desc: 'Regimen Simplificado de Confianza' },
]

const USOS_CFDI = [
  { clave: 'G01', desc: 'Adquisicion de mercancias' },
  { clave: 'G02', desc: 'Devoluciones, descuentos o bonificaciones' },
  { clave: 'G03', desc: 'Gastos en general' },
  { clave: 'I01', desc: 'Construcciones' },
  { clave: 'I02', desc: 'Mobiliario y equipo de oficina' },
  { clave: 'I03', desc: 'Equipo de transporte' },
  { clave: 'I04', desc: 'Equipo de computo y accesorios' },
  { clave: 'I08', desc: 'Otra maquinaria y equipo' },
  { clave: 'P01', desc: 'Por definir' },
  { clave: 'S01', desc: 'Sin efectos fiscales' },
  { clave: 'CP01', desc: 'Pagos' },
]

const MOCK_CLIENTES: ClienteFiscal[] = [
  { id: '1', rfc: 'ANI920101AB1', razon_social: 'Alex Niz', regimen_fiscal: 'Regimen Simplificado de Confianza', regimen_fiscal_clave: '626', codigo_postal: '06600', uso_cfdi: 'Gastos en general', uso_cfdi_clave: 'G03', curp: '', calle: 'Av Reforma', num_exterior: '222', num_interior: '', colonia: 'Juarez', localidad: '', municipio: 'Cuauhtemoc', estado: 'Ciudad de Mexico', tipo_persona: 'fisica', email: 'alex@email.com', telefono: '5512345678', activo: true },
  { id: '2', rfc: 'GIN850315XY2', razon_social: 'Grupo Inmobiliario del Norte SA de CV', regimen_fiscal: 'General de Ley Personas Morales', regimen_fiscal_clave: '601', codigo_postal: '64000', uso_cfdi: 'Construcciones', uso_cfdi_clave: 'I01', curp: '', calle: 'Blvd Monterrey', num_exterior: '1500', num_interior: 'P4', colonia: 'Centro', localidad: 'Monterrey', municipio: 'Monterrey', estado: 'Nuevo Leon', tipo_persona: 'moral', email: 'fiscal@ginorte.com', telefono: '8187654321', activo: true },
  { id: '3', rfc: 'DPA900101CD3', razon_social: 'Desarrollos Pachuca SA de CV', regimen_fiscal: 'General de Ley Personas Morales', regimen_fiscal_clave: '601', codigo_postal: '42000', uso_cfdi: 'Construcciones', uso_cfdi_clave: 'I01', curp: '', calle: 'Av Juarez', num_exterior: '100', num_interior: '', colonia: 'Centro', localidad: 'Pachuca', municipio: 'Pachuca de Soto', estado: 'Hidalgo', tipo_persona: 'moral', email: 'admin@despachuca.com', telefono: '7711234567', activo: true },
  { id: '4', rfc: 'CDE880520EF4', razon_social: 'Chapultepec Desarrollo SA de CV', regimen_fiscal: 'General de Ley Personas Morales', regimen_fiscal_clave: '601', codigo_postal: '11560', uso_cfdi: 'Construcciones', uso_cfdi_clave: 'I01', curp: '', calle: 'Av Chapultepec', num_exterior: '500', num_interior: '', colonia: 'Polanco', localidad: '', municipio: 'Miguel Hidalgo', estado: 'Ciudad de Mexico', tipo_persona: 'moral', email: 'contabilidad@chapdev.com', telefono: '5598765432', activo: true },
]

const iS: React.CSSProperties = { width: '100%', padding: '8px 12px', background: '#111', border: '1px solid #333', borderRadius: 8, color: '#fff', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const }

function Fld({ label, children, span }: { label: string; children: React.ReactNode; span?: boolean }) {
  return (<div style={{ marginBottom: 12, gridColumn: span ? '1 / -1' : undefined }}><div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 500 }}>{label}</div>{children}</div>)
}

export default function Clientes() {
  const [clientes, setClientes] = useState<ClienteFiscal[]>(MOCK_CLIENTES)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<Partial<ClienteFiscal>>({
    tipo_persona: 'moral', regimen_fiscal_clave: '601', uso_cfdi_clave: 'G03', activo: true,
  })

  const filtered = clientes.filter(c =>
    c.razon_social.toLowerCase().includes(search.toLowerCase()) ||
    c.rfc.toLowerCase().includes(search.toLowerCase())
  )

  const openNew = () => {
    setEditId(null)
    setForm({ tipo_persona: 'moral', regimen_fiscal_clave: '601', uso_cfdi_clave: 'G03', activo: true })
    setShowForm(true)
  }

  const openEdit = (c: ClienteFiscal) => {
    setEditId(c.id)
    setForm({ ...c })
    setShowForm(true)
  }

  const save = () => {
    if (!form.rfc || !form.razon_social || !form.codigo_postal) return
    const reg = REGIMENES.find(r => r.clave === form.regimen_fiscal_clave)
    const uso = USOS_CFDI.find(u => u.clave === form.uso_cfdi_clave)
    const full: ClienteFiscal = {
      id: editId || String(Date.now()),
      rfc: (form.rfc || '').toUpperCase(),
      razon_social: form.razon_social || '',
      regimen_fiscal: reg?.desc || '',
      regimen_fiscal_clave: form.regimen_fiscal_clave || '601',
      codigo_postal: form.codigo_postal || '',
      uso_cfdi: uso?.desc || '',
      uso_cfdi_clave: form.uso_cfdi_clave || 'G03',
      curp: form.curp || '',
      calle: form.calle || '',
      num_exterior: form.num_exterior || '',
      num_interior: form.num_interior || '',
      colonia: form.colonia || '',
      localidad: form.localidad || '',
      municipio: form.municipio || '',
      estado: form.estado || '',
      tipo_persona: form.tipo_persona || 'moral',
      email: form.email || '',
      telefono: form.telefono || '',
      activo: form.activo !== false,
    }
    if (editId) {
      setClientes(clientes.map(c => c.id === editId ? full : c))
    } else {
      setClientes([full, ...clientes])
    }
    setShowForm(false)
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
      <SectionHeader title="Clientes" subtitle="Datos fiscales de clientes (Constancia de Situacion Fiscal)" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
        <KpiCard label="Total clientes" value={clientes.length} icon={<Users2 size={16} />} />
        <KpiCard label="Personas morales" value={clientes.filter(c => c.tipo_persona === 'moral').length} color="#3B82F6" icon={<Building2 size={16} />} />
        <KpiCard label="Activos" value={clientes.filter(c => c.activo).length} color="#57FF9A" icon={<CheckCircle size={16} />} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 9, color: '#555' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre o RFC..." style={{ ...iS, width: 300, paddingLeft: 32 }} />
        </div>
        <Btn size="sm" variant="primary" onClick={openNew}><Plus size={12} /> Nuevo cliente</Btn>
      </div>

      <Table>
        <thead><tr><Th>RFC</Th><Th>Razon Social</Th><Th>Regimen</Th><Th>C.P.</Th><Th>Uso CFDI</Th><Th>Tipo</Th><Th>{' '}</Th></tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><Td colSpan={7} muted>Sin clientes</Td></tr>}
          {filtered.map(c => (
            <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => openEdit(c)}>
              <Td><span style={{ fontWeight: 600, color: '#fff', fontFamily: 'monospace', fontSize: 12 }}>{c.rfc}</span></Td>
              <Td><span style={{ color: '#ccc' }}>{c.razon_social}</span></Td>
              <Td muted style={{ fontSize: 11 }}>{c.regimen_fiscal_clave} - {c.regimen_fiscal.substring(0, 30)}</Td>
              <Td muted>{c.codigo_postal}</Td>
              <Td muted style={{ fontSize: 11 }}>{c.uso_cfdi_clave}</Td>
              <Td><Badge label={c.tipo_persona === 'moral' ? 'Moral' : 'Fisica'} color={c.tipo_persona === 'moral' ? '#3B82F6' : '#C084FC'} /></Td>
              <Td><Edit size={12} style={{ color: '#555' }} /></Td>
            </tr>
          ))}
        </tbody>
      </Table>

      {showForm && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowForm(false)}>
          <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, padding: 24, width: 700, maxHeight: '85vh', overflowY: 'auto' as const }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{editId ? 'Editar Cliente' : 'Nuevo Cliente'}</div>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><X size={18} /></button>
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, color: '#57FF9A', marginBottom: 12 }}>Datos Fiscales (Constancia de Situacion Fiscal)</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Fld label="RFC *"><input style={iS} value={form.rfc || ''} onChange={e => setForm({...form, rfc: e.target.value.toUpperCase()})} placeholder="XAXX010101000" maxLength={13} /></Fld>
              <Fld label="Tipo persona"><select style={iS} value={form.tipo_persona} onChange={e => setForm({...form, tipo_persona: e.target.value as any})}><option value="moral">Persona Moral</option><option value="fisica">Persona Fisica</option></select></Fld>
              <Fld label="CURP (fisica)"><input style={iS} value={form.curp || ''} onChange={e => setForm({...form, curp: e.target.value.toUpperCase()})} placeholder="Solo personas fisicas" maxLength={18} /></Fld>
              <Fld label="Razon Social / Nombre *" span><input style={iS} value={form.razon_social || ''} onChange={e => setForm({...form, razon_social: e.target.value})} placeholder="Exacto como aparece en la constancia del SAT" /></Fld>
              <Fld label="Regimen Fiscal *" span><select style={iS} value={form.regimen_fiscal_clave} onChange={e => setForm({...form, regimen_fiscal_clave: e.target.value})}>{REGIMENES.map(r => <option key={r.clave} value={r.clave}>{r.clave} - {r.desc}</option>)}</select></Fld>
              <Fld label="Uso CFDI habitual"><select style={iS} value={form.uso_cfdi_clave} onChange={e => setForm({...form, uso_cfdi_clave: e.target.value})}>{USOS_CFDI.map(u => <option key={u.clave} value={u.clave}>{u.clave} - {u.desc}</option>)}</select></Fld>
            </div>

            <div style={{ fontSize: 13, fontWeight: 600, color: '#888', marginTop: 16, marginBottom: 12 }}>Domicilio Fiscal</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              <Fld label="Codigo Postal *"><input style={iS} value={form.codigo_postal || ''} onChange={e => setForm({...form, codigo_postal: e.target.value})} placeholder="06600" maxLength={5} /></Fld>
              <Fld label="Calle"><input style={iS} value={form.calle || ''} onChange={e => setForm({...form, calle: e.target.value})} /></Fld>
              <Fld label="No. Exterior"><input style={iS} value={form.num_exterior || ''} onChange={e => setForm({...form, num_exterior: e.target.value})} /></Fld>
              <Fld label="No. Interior"><input style={iS} value={form.num_interior || ''} onChange={e => setForm({...form, num_interior: e.target.value})} /></Fld>
              <Fld label="Colonia"><input style={iS} value={form.colonia || ''} onChange={e => setForm({...form, colonia: e.target.value})} /></Fld>
              <Fld label="Municipio / Delegacion"><input style={iS} value={form.municipio || ''} onChange={e => setForm({...form, municipio: e.target.value})} /></Fld>
              <Fld label="Estado"><input style={iS} value={form.estado || ''} onChange={e => setForm({...form, estado: e.target.value})} /></Fld>
              <Fld label="Email"><input style={iS} type="email" value={form.email || ''} onChange={e => setForm({...form, email: e.target.value})} /></Fld>
              <Fld label="Telefono"><input style={iS} value={form.telefono || ''} onChange={e => setForm({...form, telefono: e.target.value})} /></Fld>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <Btn size="sm" variant="default" onClick={() => setShowForm(false)}>Cancelar</Btn>
              <Btn size="sm" variant="primary" onClick={save}>{editId ? 'Guardar cambios' : 'Crear cliente'}</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Export client list for use in Contabilidad
export { MOCK_CLIENTES }
export type { ClienteFiscal }
