import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Btn, Loading, Badge } from '../components/layout/UI'
import {
  ArrowLeft, Save, Trash2, Upload, FileText, Download, X,
  User, Briefcase, FileSignature, DollarSign, CreditCard,
  Award, Folder, History, AlertCircle, Sparkles, CheckCircle2,
  Smartphone, Eye, EyeOff
} from 'lucide-react'

interface Employee {
  id: string
  numero_excel?: number | null
  numero_interno?: string | null
  nombre: string
  name?: string
  rfc?: string | null
  curp?: string | null
  imss_numero?: string | null
  ine_numero?: string | null
  puesto?: string | null
  area?: string | null
  tipo_alta?: 'SEMANAL' | 'QUINCENAL' | null
  tipo_trabajo?: 'OFICINA' | 'OBRA' | 'MIXTO' | null
  estado_empleado?: 'activo' | 'baja' | 'vacaciones' | 'incapacidad' | null
  reporta_a_id?: string | null
  level?: string | null
  banco?: string | null
  cuenta?: string | null
  clabe?: string | null
  beneficiario_cuenta?: string | null
  comentarios?: string | null
  sueldo_neto_semanal?: number | null
  sueldo_neto_quincenal?: number | null
  neto_mensual?: number | null
  salario_diario_imss?: number | null
  sdi?: number | null
  jornada_horas?: number | null
  descuento_infonavit_quincenal?: number | null
  tiene_infonavit?: boolean | null
  fecha_nacimiento?: string | null
  genero?: string | null
  estado_civil?: string | null
  telefono_personal?: string | null
  email_personal?: string | null
  email?: string | null
  phone?: string | null
  direccion_calle?: string | null
  direccion_numero?: string | null
  direccion_colonia?: string | null
  direccion_cp?: string | null
  direccion_ciudad?: string | null
  direccion_estado?: string | null
  contacto_emergencia_nombre?: string | null
  contacto_emergencia_telefono?: string | null
  contacto_emergencia_relacion?: string | null
  tipo_sangre?: string | null
  alergias?: string | null
  condiciones_medicas?: string | null
  talla_uniforme?: string | null
  talla_calzado?: string | null
  licencia_conducir_numero?: string | null
  licencia_conducir_tipo?: string | null
  licencia_conducir_vigencia?: string | null
  skills?: string[] | null
  idiomas?: string[] | null
  calificacion?: number | null
  tipo_contrato?: string | null
  contrato_fecha_inicio?: string | null
  contrato_fecha_fin?: string | null
  contrato_periodo_prueba_fin?: string | null
  contrato_renovacion_automatica?: boolean | null
  contrato_clausulas?: string | null
  activo?: boolean | null
  fecha_alta?: string | null
  fecha_baja?: string | null
  hire_date?: string | null
  notas?: string | null
  foto_url?: string | null
}

interface EmployeeDocument {
  id: string
  employee_id: string
  tipo: string
  nombre: string
  storage_path: string
  url?: string | null
  fecha_emision?: string | null
  fecha_vencimiento?: string | null
  notas?: string | null
  uploaded_at: string
}

type Section = 'identidad' | 'puesto' | 'contrato' | 'sueldo' | 'banco' | 'obra_app' | 'habilidades' | 'documentos' | 'historial'

const SECTIONS: { id: Section; label: string; icon: any }[] = [
  { id: 'identidad', label: 'Identidad y contacto', icon: User },
  { id: 'puesto', label: 'Puesto', icon: Briefcase },
  { id: 'contrato', label: 'Contrato', icon: FileSignature },
  { id: 'sueldo', label: 'Sueldo y nómina', icon: DollarSign },
  { id: 'banco', label: 'Datos bancarios', icon: CreditCard },
  { id: 'obra_app', label: 'App Obra', icon: Smartphone },
  { id: 'habilidades', label: 'Habilidades', icon: Award },
  { id: 'documentos', label: 'Documentos', icon: Folder },
  { id: 'historial', label: 'Historial', icon: History },
]

const DOC_TYPES: { value: string; label: string }[] = [
  { value: 'contrato', label: 'Contrato' },
  { value: 'ine', label: 'INE' },
  { value: 'curp', label: 'CURP' },
  { value: 'rfc', label: 'RFC' },
  { value: 'comprobante_domicilio', label: 'Comprobante de domicilio' },
  { value: 'acta_nacimiento', label: 'Acta de nacimiento' },
  { value: 'certificado', label: 'Certificado / título' },
  { value: 'examen_medico', label: 'Examen médico' },
  { value: 'licencia_conducir', label: 'Licencia de conducir' },
  { value: 'constancia_situacion_fiscal', label: 'Constancia de situación fiscal' },
  { value: 'foto', label: 'Foto' },
  { value: 'curriculum', label: 'Currículum' },
  { value: 'recibo_nomina', label: 'Recibo de nómina' },
  { value: 'aviso_alta_imss', label: 'Aviso de alta IMSS' },
  { value: 'otro', label: 'Otro' },
]

export default function EmpleadoExpediente() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [employee, setEmployee] = useState<Employee | null>(null)
  const [allEmployees, setAllEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [section, setSection] = useState<Section>('identidad')
  const [form, setForm] = useState<Partial<Employee>>({})
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  const load = async () => {
    if (!id) return
    setLoading(true)
    const { data, error } = await supabase.from('employees').select('*').eq('id', id).single()
    if (error) { console.error(error); setLoading(false); return }
    setEmployee(data as Employee)
    setForm(data as Employee)
    const { data: all } = await supabase
      .from('employees')
      .select('id,nombre,puesto')
      .eq('activo', true)
      .order('nombre')
    setAllEmployees((all as Employee[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [id])

  const set = <K extends keyof Employee>(k: K, v: Employee[K]) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = async () => {
    if (!employee?.id) return
    setSaving(true)
    const payload: any = { ...form, name: form.nombre || employee.name }
    delete payload.id
    delete payload.created_at
    for (const k of [
      'sueldo_neto_semanal','sueldo_neto_quincenal','neto_mensual',
      'salario_diario_imss','sdi','descuento_infonavit_quincenal','jornada_horas',
      'numero_excel','calificacion'
    ]) {
      if (payload[k] === '' || payload[k] == null) payload[k] = null
      else payload[k] = Number(payload[k])
    }
    for (const k of [
      'fecha_nacimiento','contrato_fecha_inicio','contrato_fecha_fin',
      'contrato_periodo_prueba_fin','licencia_conducir_vigencia',
      'fecha_alta','fecha_baja','hire_date'
    ]) {
      if (payload[k] === '') payload[k] = null
    }
    const { error } = await supabase.from('employees').update(payload).eq('id', employee.id)
    setSaving(false)
    if (error) { alert('Error: ' + error.message); return }
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
    load()
  }

  const handleDeactivate = async () => {
    if (!employee?.id) return
    if (!confirm(`¿Dar de baja a ${employee.nombre}?`)) return
    await supabase
      .from('employees')
      .update({ activo: false, estado_empleado: 'baja', fecha_baja: new Date().toISOString().slice(0, 10) })
      .eq('id', employee.id)
    navigate('/nomina')
  }

  if (loading) return <div style={{ padding: 60 }}><Loading /></div>
  if (!employee) return <div style={{ padding: 60, color: '#888' }}>Empleado no encontrado</div>

  const antiguedad = computeAntiguedad(employee.contrato_fecha_inicio || employee.fecha_alta || employee.hire_date)
  const edad = computeEdad(employee.fecha_nacimiento)

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <Link to="/nomina" style={{ color: '#888', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <ArrowLeft size={14} /> Volver a nómina
        </Link>
        <div style={{ flex: 1 }} />
        {savedFlash && (
          <span style={{ color: '#57FF9A', fontSize: 12, fontWeight: 500 }}>✓ Guardado</span>
        )}
        <Btn onClick={handleSave} disabled={saving} variant="primary">
          <Save size={13} /> {saving ? 'Guardando...' : 'Guardar cambios'}
        </Btn>
      </div>

      <div style={{
        display: 'flex', gap: 20, padding: 20,
        background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 10,
        marginBottom: 20, alignItems: 'center'
      }}>
        <Avatar employee={employee} onUpload={load} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: '#fff' }}>{employee.nombre}</h1>
            <Badge
              label={(employee.estado_empleado || 'activo').toUpperCase()}
              color={
                employee.estado_empleado === 'baja' ? '#ef4444' :
                employee.estado_empleado === 'incapacidad' ? '#f59e0b' :
                employee.estado_empleado === 'vacaciones' ? '#a78bfa' : '#57FF9A'
              }
            />
            {employee.tipo_trabajo && (
              <Badge
                label={employee.tipo_trabajo}
                color={employee.tipo_trabajo === 'OBRA' ? '#f59e0b' : employee.tipo_trabajo === 'OFICINA' ? '#60a5fa' : '#a78bfa'}
              />
            )}
          </div>
          <div style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>
            {employee.puesto || 'Sin puesto'} · {employee.area || 'Sin área'}
          </div>
          <div style={{ display: 'flex', gap: 24, fontSize: 12, color: '#666', flexWrap: 'wrap' }}>
            {employee.rfc && <span>RFC: <span style={{ color: '#aaa' }}>{employee.rfc}</span></span>}
            {antiguedad && <span>Antigüedad: <span style={{ color: '#aaa' }}>{antiguedad}</span></span>}
            {edad && <span>Edad: <span style={{ color: '#aaa' }}>{edad}</span></span>}
            {employee.tipo_alta && <span>Pago: <span style={{ color: '#aaa' }}>{employee.tipo_alta.toLowerCase()}</span></span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 20 }}>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {SECTIONS.map(s => {
            const Icon = s.icon
            const active = section === s.id
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: active ? '#1a1a1a' : 'transparent',
                  border: 'none',
                  borderLeft: active ? '2px solid #57FF9A' : '2px solid transparent',
                  color: active ? '#fff' : '#888',
                  padding: '10px 14px',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderRadius: 0,
                  transition: 'all 0.15s',
                }}
              >
                <Icon size={14} />
                {s.label}
              </button>
            )
          })}
          <div style={{ borderTop: '1px solid #1f1f1f', marginTop: 12, paddingTop: 12 }}>
            {employee.activo && (
              <Btn onClick={handleDeactivate} variant="danger">
                <Trash2 size={13} /> Dar de baja
              </Btn>
            )}
          </div>
        </nav>

        <div style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 10, padding: 24, minHeight: 500 }}>
          {section === 'identidad' && <SectionIdentidad form={form} set={set} employeeId={employee.id} />}
          {section === 'puesto' && <SectionPuesto form={form} set={set} allEmployees={allEmployees} currentId={employee.id} />}
          {section === 'contrato' && <SectionContrato form={form} set={set} />}
          {section === 'sueldo' && <SectionSueldo form={form} set={set} />}
          {section === 'banco' && <SectionBanco form={form} set={set} />}
          {section === 'obra_app' && <SectionObraApp form={form} set={set} employeeId={employee.id} />}
          {section === 'habilidades' && <SectionHabilidades form={form} set={set} />}
          {section === 'documentos' && <SectionDocumentos employeeId={employee.id} />}
          {section === 'historial' && <SectionHistorial />}
        </div>
      </div>
    </div>
  )
}

function Avatar({ employee, onUpload }: { employee: Employee; onUpload: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const ext = file.name.split('.').pop() || 'jpg'
    const path = `${employee.id}/avatar.${ext}`
    const { error } = await supabase.storage.from('employee-documents').upload(path, file, { upsert: true })
    if (error) { alert('Error: ' + error.message); setUploading(false); return }
    const { data } = supabase.storage.from('employee-documents').getPublicUrl(path)
    await supabase.from('employees').update({ foto_url: data.publicUrl }).eq('id', employee.id)
    setUploading(false)
    onUpload()
  }

  const initials = (employee.nombre || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

  return (
    <div style={{ position: 'relative' }}>
      {employee.foto_url ? (
        <img
          src={employee.foto_url}
          alt={employee.nombre}
          style={{ width: 84, height: 84, borderRadius: '50%', objectFit: 'cover', border: '2px solid #1f1f1f' }}
        />
      ) : (
        <div style={{
          width: 84, height: 84, borderRadius: '50%',
          background: '#1a1a1a', border: '2px solid #1f1f1f',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, fontWeight: 600, color: '#888'
        }}>
          {initials}
        </div>
      )}
      <button
        onClick={() => inputRef.current?.click()}
        style={{
          position: 'absolute', bottom: 0, right: 0,
          background: '#57FF9A', color: '#000', border: 'none',
          borderRadius: '50%', width: 26, height: 26,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer'
        }}
        title="Subir foto"
      >
        <Upload size={12} />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleUpload}
        style={{ display: 'none' }}
      />
      {uploading && <div style={{ position: 'absolute', top: -20, left: 0, fontSize: 10, color: '#888' }}>Subiendo...</div>}
    </div>
  )
}

function SectionIdentidad({ form, set, employeeId }: { form: Partial<Employee>; set: any; employeeId: string }) {
  const applyExtractedFields = (fields: Record<string, any>) => {
    const allowed = [
      'nombre','fecha_nacimiento','genero','curp','rfc','ine_numero',
      'direccion_calle','direccion_numero','direccion_colonia','direccion_cp',
      'direccion_ciudad','direccion_estado'
    ]
    for (const k of Object.keys(fields)) {
      if (allowed.includes(k) && fields[k] != null && fields[k] !== '') {
        set(k as any, fields[k])
      }
    }
  }
  return (
    <>
      <SectionTitle icon={User} title="Identidad y contacto" />
      <AIExtractor employeeId={employeeId} onExtracted={applyExtractedFields} />
      <Grid>
        <Field label="Nombre completo" full>
          <Input value={form.nombre || ''} onChange={v => set('nombre', v)} />
        </Field>
        <Field label="Fecha de nacimiento">
          <Input type="date" value={form.fecha_nacimiento || ''} onChange={v => set('fecha_nacimiento', v)} />
        </Field>
        <Field label="Género">
          <Select value={form.genero || ''} onChange={v => set('genero', v)}
            options={['', 'Masculino', 'Femenino', 'Otro']} />
        </Field>
        <Field label="Estado civil">
          <Select value={form.estado_civil || ''} onChange={v => set('estado_civil', v)}
            options={['', 'Soltero(a)', 'Casado(a)', 'Unión libre', 'Divorciado(a)', 'Viudo(a)']} />
        </Field>
        <Field label="Tipo de sangre">
          <Select value={form.tipo_sangre || ''} onChange={v => set('tipo_sangre', v)}
            options={['', 'O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']} />
        </Field>

        <Divider label="Identificaciones" />
        <Field label="RFC">
          <Input value={form.rfc || ''} onChange={v => set('rfc', v.toUpperCase())} />
        </Field>
        <Field label="CURP">
          <Input value={form.curp || ''} onChange={v => set('curp', v.toUpperCase())} />
        </Field>
        <Field label="No. IMSS">
          <Input value={form.imss_numero || ''} onChange={v => set('imss_numero', v)} />
        </Field>
        <Field label="No. INE">
          <Input value={form.ine_numero || ''} onChange={v => set('ine_numero', v)} />
        </Field>

        <Divider label="Contacto" />
        <Field label="Teléfono personal">
          <Input value={form.telefono_personal || form.phone || ''} onChange={v => set('telefono_personal', v)} />
        </Field>
        <Field label="Email personal">
          <Input type="email" value={form.email_personal || form.email || ''} onChange={v => set('email_personal', v)} />
        </Field>

        <Divider label="Domicilio" />
        <Field label="Calle">
          <Input value={form.direccion_calle || ''} onChange={v => set('direccion_calle', v)} />
        </Field>
        <Field label="Número">
          <Input value={form.direccion_numero || ''} onChange={v => set('direccion_numero', v)} />
        </Field>
        <Field label="Colonia">
          <Input value={form.direccion_colonia || ''} onChange={v => set('direccion_colonia', v)} />
        </Field>
        <Field label="Código postal">
          <Input value={form.direccion_cp || ''} onChange={v => set('direccion_cp', v)} />
        </Field>
        <Field label="Ciudad">
          <Input value={form.direccion_ciudad || ''} onChange={v => set('direccion_ciudad', v)} />
        </Field>
        <Field label="Estado">
          <Input value={form.direccion_estado || ''} onChange={v => set('direccion_estado', v)} />
        </Field>

        <Divider label="Contacto de emergencia" />
        <Field label="Nombre">
          <Input value={form.contacto_emergencia_nombre || ''} onChange={v => set('contacto_emergencia_nombre', v)} />
        </Field>
        <Field label="Teléfono">
          <Input value={form.contacto_emergencia_telefono || ''} onChange={v => set('contacto_emergencia_telefono', v)} />
        </Field>
        <Field label="Relación">
          <Input value={form.contacto_emergencia_relacion || ''} onChange={v => set('contacto_emergencia_relacion', v)}
            placeholder="Madre, padre, esposo(a), hermano(a)..." />
        </Field>

        <Divider label="Información médica" />
        <Field label="Alergias" full>
          <Textarea value={form.alergias || ''} onChange={v => set('alergias', v)} rows={2} />
        </Field>
        <Field label="Condiciones médicas" full>
          <Textarea value={form.condiciones_medicas || ''} onChange={v => set('condiciones_medicas', v)} rows={2} />
        </Field>
      </Grid>
    </>
  )
}

function SectionPuesto({ form, set, allEmployees, currentId }: {
  form: Partial<Employee>; set: any; allEmployees: Employee[]; currentId: string
}) {
  return (
    <>
      <SectionTitle icon={Briefcase} title="Puesto y clasificación" />
      <Grid>
        <Field label="Número (Excel)">
          <Input type="number" value={form.numero_excel ?? ''} onChange={v => set('numero_excel', v ? Number(v) : null)} />
        </Field>
        <Field label="Número interno (CFDI)">
          <Input value={form.numero_interno || ''} onChange={v => set('numero_interno', v)} />
        </Field>
        <Field label="Puesto" full>
          <Input value={form.puesto || ''} onChange={v => set('puesto', v)} />
        </Field>
        <Field label="Área">
          <Input value={form.area || ''} onChange={v => set('area', v)} />
        </Field>
        <Field label="Tipo de trabajo">
          <Select value={form.tipo_trabajo || ''} onChange={v => set('tipo_trabajo', v || null)}
            options={['', 'OFICINA', 'OBRA', 'MIXTO']} />
        </Field>
        <Field label="Reporta a">
          <select
            value={form.reporta_a_id || ''}
            onChange={e => set('reporta_a_id', e.target.value || null)}
            style={inputCss}
          >
            <option value="">— Sin jefe directo —</option>
            {allEmployees.filter(e => e.id !== currentId).map(e => (
              <option key={e.id} value={e.id}>{e.nombre}{e.puesto ? ` (${e.puesto})` : ''}</option>
            ))}
          </select>
        </Field>
        <Field label="Nivel">
          <Select value={form.level || ''} onChange={v => set('level', v || null)}
            options={['', 'junior', 'semi_senior', 'senior', 'lead', 'director']} />
        </Field>
        <Field label="Estado">
          <Select value={form.estado_empleado || 'activo'} onChange={v => set('estado_empleado', v as any)}
            options={['activo', 'baja', 'vacaciones', 'incapacidad']} />
        </Field>
        <Field label="Fecha de alta a la empresa">
          <Input type="date" value={form.fecha_alta || form.hire_date || ''} onChange={v => set('fecha_alta', v)} />
        </Field>

        <Divider label="EPP / uniforme (obra)" />
        <Field label="Talla de uniforme">
          <Select value={form.talla_uniforme || ''} onChange={v => set('talla_uniforme', v || null)}
            options={['', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']} />
        </Field>
        <Field label="Talla de calzado">
          <Input value={form.talla_calzado || ''} onChange={v => set('talla_calzado', v)} placeholder="ej. 27" />
        </Field>

        <Divider label="Licencia de conducir" />
        <Field label="Número de licencia">
          <Input value={form.licencia_conducir_numero || ''} onChange={v => set('licencia_conducir_numero', v)} />
        </Field>
        <Field label="Tipo">
          <Select value={form.licencia_conducir_tipo || ''} onChange={v => set('licencia_conducir_tipo', v || null)}
            options={['', 'A', 'B', 'C', 'D', 'E', 'Permiso']} />
        </Field>
        <Field label="Vigencia">
          <Input type="date" value={form.licencia_conducir_vigencia || ''} onChange={v => set('licencia_conducir_vigencia', v)} />
        </Field>
      </Grid>
    </>
  )
}

function SectionContrato({ form, set }: { form: Partial<Employee>; set: any }) {
  return (
    <>
      <SectionTitle icon={FileSignature} title="Contrato laboral" />
      <Grid>
        <Field label="Tipo de contrato" full>
          <select value={form.tipo_contrato || ''} onChange={e => set('tipo_contrato', e.target.value || null)} style={inputCss}>
            <option value="">— Seleccionar —</option>
            <option value="indeterminado">Indeterminado</option>
            <option value="determinado">Determinado (con fecha fin)</option>
            <option value="obra_o_proyecto">Por obra o proyecto</option>
            <option value="honorarios">Honorarios</option>
            <option value="prueba">Período de prueba</option>
          </select>
        </Field>
        <Field label="Fecha de inicio">
          <Input type="date" value={form.contrato_fecha_inicio || ''} onChange={v => set('contrato_fecha_inicio', v)} />
        </Field>
        <Field label="Fecha de término">
          <Input type="date" value={form.contrato_fecha_fin || ''} onChange={v => set('contrato_fecha_fin', v)} />
        </Field>
        <Field label="Fin de período de prueba">
          <Input type="date" value={form.contrato_periodo_prueba_fin || ''} onChange={v => set('contrato_periodo_prueba_fin', v)} />
        </Field>
        <Field label="Renovación automática">
          <Select value={form.contrato_renovacion_automatica ? 'sí' : 'no'} onChange={v => set('contrato_renovacion_automatica', v === 'sí')}
            options={['no', 'sí']} />
        </Field>
        <Field label="Cláusulas especiales / observaciones" full>
          <Textarea value={form.contrato_clausulas || ''} onChange={v => set('contrato_clausulas', v)} rows={5} />
        </Field>
      </Grid>
      {form.contrato_fecha_fin && <ContractAlert fechaFin={form.contrato_fecha_fin} />}
    </>
  )
}

function ContractAlert({ fechaFin }: { fechaFin: string }) {
  const days = Math.ceil((new Date(fechaFin).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0) {
    return (
      <div style={{ marginTop: 16, padding: 12, background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
        <AlertCircle size={16} color="#ef4444" />
        <span style={{ color: '#fca5a5', fontSize: 13 }}>Contrato vencido hace {Math.abs(days)} día(s)</span>
      </div>
    )
  }
  if (days < 30) {
    return (
      <div style={{ marginTop: 16, padding: 12, background: '#3a2e1a', border: '1px solid #5a4a2a', borderRadius: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
        <AlertCircle size={16} color="#f59e0b" />
        <span style={{ color: '#fcd34d', fontSize: 13 }}>Contrato vence en {days} día(s)</span>
      </div>
    )
  }
  return null
}

function SectionSueldo({ form, set }: { form: Partial<Employee>; set: any }) {
  return (
    <>
      <SectionTitle icon={DollarSign} title="Sueldo y nómina" />
      <Grid>
        <Field label="Tipo de alta">
          <Select value={form.tipo_alta || 'QUINCENAL'} onChange={v => set('tipo_alta', v as any)}
            options={['QUINCENAL', 'SEMANAL']} />
        </Field>
        <Field label="Jornada (horas)">
          <Input type="number" step="0.5" value={form.jornada_horas ?? 8} onChange={v => set('jornada_horas', v ? Number(v) : null)} />
        </Field>

        <Divider label="Sueldo neto pactado (X) — lo que recibe en mano" />
        <Field label="Sueldo neto semanal">
          <Input type="number" step="0.01" value={form.sueldo_neto_semanal ?? ''} onChange={v => set('sueldo_neto_semanal', v ? Number(v) : null)} />
        </Field>
        <Field label="Sueldo neto quincenal">
          <Input type="number" step="0.01" value={form.sueldo_neto_quincenal ?? ''} onChange={v => set('sueldo_neto_quincenal', v ? Number(v) : null)} />
        </Field>
        <Field label="Neto mensual">
          <Input type="number" step="0.01" value={form.neto_mensual ?? ''} onChange={v => set('neto_mensual', v ? Number(v) : null)} />
        </Field>

        <Divider label="Datos fiscales (Y) — declarado al SAT/IMSS" />
        <Field label="Salario diario IMSS">
          <Input type="number" step="0.01" value={form.salario_diario_imss ?? ''} onChange={v => set('salario_diario_imss', v ? Number(v) : null)} />
        </Field>
        <Field label="SDI (salario diario integrado)">
          <Input type="number" step="0.01" value={form.sdi ?? ''} onChange={v => set('sdi', v ? Number(v) : null)} />
        </Field>

        <Divider label="Descuentos recurrentes" />
        <Field label="Descuento INFONAVIT (qna)">
          <Input type="number" step="0.01" value={form.descuento_infonavit_quincenal ?? ''} onChange={v => set('descuento_infonavit_quincenal', v ? Number(v) : null)} />
        </Field>
        <Field label="Tiene crédito INFONAVIT">
          <Select value={form.tiene_infonavit ? 'sí' : 'no'} onChange={v => set('tiene_infonavit', v === 'sí')}
            options={['no', 'sí']} />
        </Field>
      </Grid>
    </>
  )
}

function SectionBanco({ form, set }: { form: Partial<Employee>; set: any }) {
  return (
    <>
      <SectionTitle icon={CreditCard} title="Datos bancarios" />
      <Grid>
        <Field label="Banco">
          <Select value={form.banco || ''} onChange={v => set('banco', v || null)}
            options={['', 'BBVA', 'CITIBANAMEX', 'SANTANDER', 'BANORTE', 'HSBC', 'SCOTIABANK', 'INBURSA', 'AZTECA', 'OTRO']} />
        </Field>
        <Field label="Cuenta">
          <Input value={form.cuenta || ''} onChange={v => set('cuenta', v)} />
        </Field>
        <Field label="CLABE interbancaria" full>
          <Input value={form.clabe || ''} onChange={v => set('clabe', v)} />
        </Field>
        <Field label="Beneficiario de la cuenta (si está a nombre de otra persona)" full>
          <Input value={form.beneficiario_cuenta || ''} onChange={v => set('beneficiario_cuenta', v)}
            placeholder="Dejar vacío si la cuenta está a nombre del empleado" />
        </Field>
        <Field label="Comentarios bancarios" full>
          <Textarea value={form.comentarios || ''} onChange={v => set('comentarios', v)} rows={3} />
        </Field>
      </Grid>
    </>
  )
}

function SectionObraApp({ form, set, employeeId }: { form: Partial<Employee>; set: any; employeeId: string }) {
  const [showPw, setShowPw] = useState(false)
  const [creating, setCreating] = useState(false)

  const hasAuth = !!form.auth_user_id
  const isActive = !!form.app_activo

  const createAccount = async () => {
    const phone = form.obra_app_phone?.trim()
    const password = form.obra_app_password?.trim()
    if (!phone || !password) {
      alert('Primero llena el celular y contraseña, luego guarda, y después crea la cuenta.')
      return
    }
    if (password.length < 6) {
      alert('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    // Derive a synthetic email from the phone number for Supabase Auth
    // The installer logs in with their phone + password; the app converts internally
    const phoneClean = phone.replace(/[\s\-\(\)\.+]/g, '')
    const syntheticEmail = `${phoneClean}@obra.omm.app`
    setCreating(true)
    try {
      const { data, error } = await supabase.auth.signUp({
        email: syntheticEmail,
        password,
        options: { data: { employee_id: employeeId, nombre: form.nombre, phone: phoneClean } },
      })
      if (error) throw error
      if (data.user) {
        // Link auth user to employee
        await supabase.from('employees').update({
          auth_user_id: data.user.id,
          app_activo: true,
        }).eq('id', employeeId)
        set('auth_user_id', data.user.id)
        set('app_activo', true)
        alert('✅ Cuenta creada exitosamente. El empleado ya puede entrar a la App de Obra.')
      }
    } catch (err: any) {
      alert('Error creando cuenta: ' + (err.message || err))
    }
    setCreating(false)
  }

  return (
    <>
      <SectionTitle icon={Smartphone} title="Acceso App de Obra" />

      {/* Status banner */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: 16, marginBottom: 20,
        background: hasAuth && isActive ? 'rgba(87, 255, 154, 0.08)' : 'rgba(239, 68, 68, 0.08)',
        border: `1px solid ${hasAuth && isActive ? '#57FF9A30' : '#ef444430'}`,
        borderRadius: 10,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: hasAuth && isActive ? '#57FF9A20' : '#ef444420',
        }}>
          <Smartphone size={18} style={{ color: hasAuth && isActive ? '#57FF9A' : '#ef4444' }} />
        </div>
        <div>
          <div style={{ fontWeight: 600, color: '#eee', fontSize: 14 }}>
            {hasAuth && isActive ? 'Cuenta activa' : hasAuth ? 'Cuenta desactivada' : 'Sin cuenta'}
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            {hasAuth && isActive
              ? 'El empleado tiene acceso a la app móvil de Obra'
              : hasAuth
              ? 'La cuenta existe pero el acceso está desactivado'
              : 'Este empleado no tiene cuenta para la app de Obra'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {hasAuth && (
          <div
            onClick={() => set('app_activo', !isActive)}
            style={{
              padding: '6px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: isActive ? '#57FF9A' : '#333', color: isActive ? '#000' : '#888',
              transition: 'all 0.2s',
            }}
          >
            {isActive ? 'Activo' : 'Inactivo'}
          </div>
        )}
      </div>

      <Grid>
        <Field label="Celular">
          <Input value={form.obra_app_phone || ''} onChange={v => set('obra_app_phone', v)}
            placeholder="ej: 33 1234 5678" />
        </Field>
        <Field label="Contraseña">
          <div style={{ position: 'relative' }}>
            <Input
              value={form.obra_app_password || ''}
              onChange={v => set('obra_app_password', v)}
              placeholder="Contraseña para la app"
              type={showPw ? 'text' : 'password'}
            />
            <button
              type="button"
              onClick={() => setShowPw(!showPw)}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 4,
              }}
            >
              {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
        <Field label="Rol en la app">
          <Select value={form.app_role || 'instalador'} onChange={v => set('app_role', v)}
            options={['instalador', 'supervisor', 'admin']} />
        </Field>
        {hasAuth && (
          <Field label="Auth User ID">
            <Input value={form.auth_user_id || ''} onChange={() => {}} placeholder="(automático)" />
          </Field>
        )}
      </Grid>

      {/* Create account button */}
      {!hasAuth && (
        <div style={{ marginTop: 20, padding: 16, background: '#0f0f0f', borderRadius: 10, border: '1px solid #1a1a1a' }}>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 12 }}>
            Para que el empleado pueda usar la app de Obra, primero guarda el celular y contraseña arriba, y después crea la cuenta:
          </div>
          <Btn onClick={createAccount} variant="primary" disabled={creating}>
            <Smartphone size={14} /> {creating ? 'Creando...' : 'Crear cuenta de App Obra'}
          </Btn>
        </div>
      )}
    </>
  )
}

function SectionHabilidades({ form, set }: { form: Partial<Employee>; set: any }) {
  const skills = form.skills || []
  const idiomas = form.idiomas || []

  return (
    <>
      <SectionTitle icon={Award} title="Habilidades e idiomas" />
      <Grid>
        <Field label="Habilidades técnicas" full>
          <TagInput value={skills} onChange={v => set('skills', v)} placeholder="Escribir y presionar Enter..." />
        </Field>
        <Field label="Idiomas" full>
          <TagInput value={idiomas} onChange={v => set('idiomas', v)} placeholder="ej. Español, Inglés..." />
        </Field>
        <Field label="Calificación interna (1-10)">
          <Input type="number" min="0" max="10" step="0.5" value={form.calificacion ?? ''} onChange={v => set('calificacion', v ? Number(v) : null)} />
        </Field>
        <Field label="Notas adicionales" full>
          <Textarea value={form.notas || ''} onChange={v => set('notas', v)} rows={4} />
        </Field>
      </Grid>
    </>
  )
}

function SectionDocumentos({ employeeId }: { employeeId: string }) {
  const [docs, setDocs] = useState<EmployeeDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('employee_documents')
      .select('*')
      .eq('employee_id', employeeId)
      .order('uploaded_at', { ascending: false })
    setDocs((data as EmployeeDocument[]) || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [employeeId])

  const handleDelete = async (doc: EmployeeDocument) => {
    if (!confirm(`¿Eliminar ${doc.nombre}?`)) return
    await supabase.storage.from('employee-documents').remove([doc.storage_path])
    await supabase.from('employee_documents').delete().eq('id', doc.id)
    load()
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <SectionTitle icon={Folder} title="Documentos del expediente" inline />
        <Btn onClick={() => setShowUpload(true)} variant="primary">
          <Upload size={13} /> Subir documento
        </Btn>
      </div>

      {loading ? <Loading /> : docs.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: '#666', border: '1px dashed #1f1f1f', borderRadius: 8 }}>
          <FileText size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
          <div style={{ fontSize: 13 }}>Aún no hay documentos</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {docs.map(d => (
            <DocumentCard key={d.id} doc={d} onDelete={() => handleDelete(d)} />
          ))}
        </div>
      )}

      {showUpload && (
        <UploadModal
          employeeId={employeeId}
          onClose={() => setShowUpload(false)}
          onUploaded={() => { setShowUpload(false); load() }}
        />
      )}
    </>
  )
}

function DocumentCard({ doc, onDelete }: { doc: EmployeeDocument; onDelete: () => void }) {
  const typeLabel = DOC_TYPES.find(t => t.value === doc.tipo)?.label || doc.tipo
  const expired = doc.fecha_vencimiento && new Date(doc.fecha_vencimiento) < new Date()
  const expiringSoon = doc.fecha_vencimiento && !expired &&
    (new Date(doc.fecha_vencimiento).getTime() - Date.now()) / (1000 * 60 * 60 * 24) < 30

  return (
    <div style={{
      padding: 14,
      background: '#0f0f0f',
      border: '1px solid #1f1f1f',
      borderRadius: 8,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <FileText size={20} color="#888" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#eee', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {doc.nombre}
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{typeLabel}</div>
        </div>
      </div>
      {(doc.fecha_emision || doc.fecha_vencimiento) && (
        <div style={{ fontSize: 10, color: '#666', display: 'flex', gap: 8 }}>
          {doc.fecha_emision && <span>Emitido: {doc.fecha_emision}</span>}
          {doc.fecha_vencimiento && (
            <span style={{ color: expired ? '#ef4444' : expiringSoon ? '#f59e0b' : '#666' }}>
              Vence: {doc.fecha_vencimiento}
            </span>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        {doc.url && (
          <a href={doc.url} target="_blank" rel="noopener noreferrer"
            style={{ flex: 1, textAlign: 'center', padding: '6px 10px', background: '#1a1a1a', borderRadius: 4, color: '#aaa', fontSize: 11, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Download size={11} /> Ver / descargar
          </a>
        )}
        <button onClick={onDelete}
          style={{ background: 'none', border: '1px solid #3a1a1a', color: '#c44', padding: '6px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

function UploadModal({ employeeId, onClose, onUploaded }: {
  employeeId: string; onClose: () => void; onUploaded: () => void
}) {
  const [tipo, setTipo] = useState('contrato')
  const [file, setFile] = useState<File | null>(null)
  const [fechaEmision, setFechaEmision] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [notas, setNotas] = useState('')
  const [uploading, setUploading] = useState(false)

  const handleUpload = async () => {
    if (!file) { alert('Selecciona un archivo'); return }
    setUploading(true)
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${employeeId}/${tipo}_${Date.now()}_${safeName}`
    const { error: upErr } = await supabase.storage.from('employee-documents').upload(path, file)
    if (upErr) { alert('Error al subir: ' + upErr.message); setUploading(false); return }
    const { data: urlData } = supabase.storage.from('employee-documents').getPublicUrl(path)
    const { error: insErr } = await supabase.from('employee_documents').insert({
      employee_id: employeeId,
      tipo,
      nombre: file.name,
      storage_path: path,
      url: urlData.publicUrl,
      size_bytes: file.size,
      mime_type: file.type,
      fecha_emision: fechaEmision || null,
      fecha_vencimiento: fechaVencimiento || null,
      notas: notas || null
    })
    setUploading(false)
    if (insErr) { alert('Error al guardar metadata: ' + insErr.message); return }
    onUploaded()
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 10, width: 520, maxWidth: '92vw', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 16, color: '#eee' }}>Subir documento</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <Grid>
          <Field label="Tipo de documento" full>
            <select value={tipo} onChange={e => setTipo(e.target.value)} style={inputCss}>
              {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Archivo" full>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={e => setFile(e.target.files?.[0] || null)}
              style={{ ...inputCss, padding: 8 }}
            />
            <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>PDF, JPG, PNG, WEBP, HEIC · Máx 10MB</div>
          </Field>
          <Field label="Fecha de emisión">
            <Input type="date" value={fechaEmision} onChange={setFechaEmision} />
          </Field>
          <Field label="Fecha de vencimiento">
            <Input type="date" value={fechaVencimiento} onChange={setFechaVencimiento} />
          </Field>
          <Field label="Notas" full>
            <Textarea value={notas} onChange={setNotas} rows={2} />
          </Field>
        </Grid>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <Btn onClick={onClose} variant="ghost">Cancelar</Btn>
          <Btn onClick={handleUpload} disabled={uploading || !file} variant="primary">
            <Upload size={13} /> {uploading ? 'Subiendo...' : 'Subir'}
          </Btn>
        </div>
      </div>
    </div>
  )
}

function SectionHistorial() {
  return (
    <>
      <SectionTitle icon={History} title="Historial del empleado" />
      <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>
        <History size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
        <div style={{ fontSize: 13, marginBottom: 4 }}>Próximamente</div>
        <div style={{ fontSize: 11 }}>Aumentos de sueldo, cambios de puesto, promociones, llamadas de atención, reconocimientos.</div>
      </div>
    </>
  )
}

function SectionTitle({ icon: Icon, title, inline }: { icon: any; title: string; inline?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: inline ? 0 : 18 }}>
      <Icon size={16} color="#57FF9A" />
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#eee' }}>{title}</h2>
    </div>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>{children}</div>
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? '1 / -1' : undefined }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid #1f1f1f', marginTop: 8, paddingTop: 12 }}>
      <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  )
}

const inputCss: React.CSSProperties = {
  width: '100%',
  background: '#0f0f0f',
  border: '1px solid #1f1f1f',
  borderRadius: 6,
  padding: '8px 12px',
  color: '#ccc',
  fontSize: 13,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

function Input({ value, onChange, type = 'text', placeholder, step, min, max }: {
  value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string;
  step?: string; min?: string; max?: string;
}) {
  return (
    <input
      type={type}
      value={value as any}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      step={step}
      min={min}
      max={max}
      style={inputCss}
    />
  )
}

function Textarea({ value, onChange, rows = 3 }: { value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      rows={rows}
      style={{ ...inputCss, resize: 'vertical', minHeight: rows * 20 }}
    />
  )
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: string[]
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={inputCss}>
      {options.map((o, i) => (
        <option key={i} value={o}>{o || '— Seleccionar —'}</option>
      ))}
    </select>
  )
}

function TagInput({ value, onChange, placeholder }: {
  value: string[]; onChange: (v: string[]) => void; placeholder?: string
}) {
  const [input, setInput] = useState('')
  const add = () => {
    const v = input.trim()
    if (v && !value.includes(v)) onChange([...value, v])
    setInput('')
  }
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {value.map((t, i) => (
          <span key={i} style={{
            background: '#1a1a1a', color: '#aaa', padding: '4px 10px',
            borderRadius: 12, fontSize: 11, display: 'flex', alignItems: 'center', gap: 6
          }}>
            {t}
            <button onClick={() => onChange(value.filter((_, j) => j !== i))}
              style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        onBlur={add}
        placeholder={placeholder}
        style={inputCss}
      />
    </div>
  )
}

// ─── AI Extractor ─────────────────────────────────────────────────────────────
const AI_DOC_TYPES: { value: string; label: string }[] = [
  { value: 'ine', label: 'INE (credencial)' },
  { value: 'constancia_situacion_fiscal', label: 'Constancia de Situación Fiscal' },
  { value: 'curp', label: 'CURP' },
  { value: 'comprobante_domicilio', label: 'Comprobante de domicilio' },
  { value: 'acta_nacimiento', label: 'Acta de nacimiento' },
]

const FIELD_LABELS: Record<string, string> = {
  nombre: 'Nombre',
  fecha_nacimiento: 'Fecha nacimiento',
  genero: 'Género',
  curp: 'CURP',
  rfc: 'RFC',
  ine_numero: 'No. INE',
  direccion_calle: 'Calle',
  direccion_numero: 'Número',
  direccion_colonia: 'Colonia',
  direccion_cp: 'C.P.',
  direccion_ciudad: 'Ciudad',
  direccion_estado: 'Estado',
}

function AIExtractor({ employeeId, onExtracted }: {
  employeeId: string
  onExtracted: (fields: Record<string, any>) => void
}) {
  const [docType, setDocType] = useState('ine')
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'extracting' | 'done' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [extracted, setExtracted] = useState<Record<string, any> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setStatus('idle')
    setExtracted(null)
    setErrorMsg('')
  }

  const handleExtract = async () => {
    if (!file) { alert('Selecciona un archivo'); return }
    try {
      // 1. Upload to storage
      setStatus('uploading')
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${employeeId}/${docType}_${Date.now()}_${safeName}`
      const { error: upErr } = await supabase.storage.from('employee-documents').upload(path, file)
      if (upErr) throw new Error('Error al subir: ' + upErr.message)

      // 2. Save document metadata
      const { data: urlData } = supabase.storage.from('employee-documents').getPublicUrl(path)
      await supabase.from('employee_documents').insert({
        employee_id: employeeId,
        tipo: docType,
        nombre: file.name,
        storage_path: path,
        url: urlData.publicUrl,
        size_bytes: file.size,
        mime_type: file.type,
        notas: 'Subido para extracción con IA'
      })

      // 3. Call Edge Function
      setStatus('extracting')
      const { data: sessionData } = await supabase.auth.getSession()
      const functionUrl = `${(supabase as any).supabaseUrl}/functions/v1/extract-identity`
      const resp = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(supabase as any).supabaseKey}`,
          'apikey': (supabase as any).supabaseKey,
        },
        body: JSON.stringify({
          employee_id: employeeId,
          storage_path: path,
          doc_type: docType,
        }),
      })

      if (!resp.ok) {
        const errBody = await resp.text()
        throw new Error(`Error de extracción (${resp.status}): ${errBody.slice(0, 200)}`)
      }

      const result = await resp.json()
      if (result.error) throw new Error(result.error)

      setExtracted(result.extracted || {})
      setStatus('done')
    } catch (e: any) {
      setErrorMsg(e.message || String(e))
      setStatus('error')
    }
  }

  const handleApply = () => {
    if (!extracted) return
    onExtracted(extracted)
    // Reset
    setFile(null)
    setExtracted(null)
    setStatus('idle')
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div style={{
      marginBottom: 20,
      padding: 16,
      background: 'linear-gradient(135deg, #0f1a1a 0%, #0a1a12 100%)',
      border: '1px solid #1f3a2a',
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Sparkles size={15} color="#57FF9A" />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#eee' }}>Extracción automática con IA</span>
        <span style={{ fontSize: 10, color: '#666', marginLeft: 'auto' }}>
          Sube un documento y los campos se llenarán solos
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <select
          value={docType}
          onChange={e => { setDocType(e.target.value); setFile(null); setStatus('idle'); setExtracted(null) }}
          style={{
            background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 6,
            padding: '8px 12px', color: '#ccc', fontSize: 13, minWidth: 220
          }}
        >
          {AI_DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>

        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={handleFileChange}
          style={{
            background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 6,
            padding: '7px 10px', color: '#ccc', fontSize: 12, flex: 1, minWidth: 200
          }}
        />

        <Btn
          onClick={handleExtract}
          disabled={!file || status === 'uploading' || status === 'extracting'}
          variant="primary"
        >
          <Sparkles size={13} />
          {status === 'uploading' ? 'Subiendo...' :
           status === 'extracting' ? 'Extrayendo...' :
           'Extraer datos'}
        </Btn>
      </div>

      {status === 'error' && (
        <div style={{ marginTop: 12, padding: 10, background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 6, fontSize: 12, color: '#fca5a5', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>{errorMsg}</span>
        </div>
      )}

      {status === 'done' && extracted && (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <CheckCircle2 size={14} color="#57FF9A" />
            <span style={{ fontSize: 12, color: '#57FF9A', fontWeight: 500 }}>
              Campos extraídos · revisa antes de aplicar
            </span>
          </div>
          <div style={{
            background: '#0a0a0a', border: '1px solid #1f1f1f', borderRadius: 6,
            padding: 12, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 16px',
            fontSize: 12, marginBottom: 10
          }}>
            {Object.entries(extracted).filter(([_, v]) => v != null && v !== '').map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 8, minWidth: 0 }}>
                <span style={{ color: '#666', flexShrink: 0 }}>{FIELD_LABELS[k] || k}:</span>
                <span style={{ color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(v)}</span>
              </div>
            ))}
            {Object.values(extracted).filter(v => v != null && v !== '').length === 0 && (
              <div style={{ gridColumn: '1 / -1', color: '#888', textAlign: 'center', padding: 8 }}>
                No se detectaron campos. Intenta con otra imagen más clara.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn
              onClick={() => { setExtracted(null); setStatus('idle'); setFile(null); if (inputRef.current) inputRef.current.value = '' }}
              variant="ghost"
            >
              Descartar
            </Btn>
            <Btn onClick={handleApply} variant="primary">
              <CheckCircle2 size={13} /> Aplicar al formulario
            </Btn>
          </div>
          <div style={{ fontSize: 10, color: '#666', marginTop: 8, textAlign: 'right' }}>
            Recuerda presionar "Guardar cambios" arriba para persistir
          </div>
        </div>
      )}
    </div>
  )
}

function computeAntiguedad(fecha: string | null | undefined): string | null {
  if (!fecha) return null
  const start = new Date(fecha)
  if (isNaN(start.getTime())) return null
  const diff = Date.now() - start.getTime()
  const years = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000))
  const months = Math.floor((diff % (365.25 * 24 * 60 * 60 * 1000)) / (30.44 * 24 * 60 * 60 * 1000))
  if (years > 0) return `${years} año${years > 1 ? 's' : ''} ${months}m`
  return `${months} mes${months !== 1 ? 'es' : ''}`
}

function computeEdad(fecha: string | null | undefined): string | null {
  if (!fecha) return null
  const birth = new Date(fecha)
  if (isNaN(birth.getTime())) return null
  const ageMs = Date.now() - birth.getTime()
  const years = Math.floor(ageMs / (365.25 * 24 * 60 * 60 * 1000))
  return `${years} años`
}
