// ═══════════════════════════════════════════════════════════════════════════
// DocsLead — los planos y documentos que llegan CON el lead.
//
// Antes esto no tenía dónde vivir: `obra_documentos` exigía proyecto u obra,
// y el proyecto todavía no existe cuando el arquitecto manda la carpeta. Así
// que la carpeta se quedaba en un chat y cada quien la volvía a pedir.
//
// Van a la misma tabla que la documentación técnica de proyecto, solo que
// colgados del lead. Eso importa: aparecen en Documentación con todo lo demás,
// y cuando el lead se vuelve proyecto no hay que mover nada.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { FileText, Link2, Upload, Trash2, ExternalLink, Plus } from 'lucide-react'

export const DOC_TIPOS = [
  { key: 'plano', label: 'Plano' },
  { key: 'render', label: 'Render' },
  { key: 'ficha_tecnica', label: 'Ficha técnica' },
  { key: 'diagrama', label: 'Diagrama' },
  { key: 'memoria_calculo', label: 'Memoria de cálculo' },
  { key: 'manual', label: 'Manual' },
  { key: 'otro', label: 'Otro' },
] as const

export interface DocLead {
  id: string
  nombre: string
  tipo: string
  drive_url: string
  version?: string | null
  notas?: string | null
  fecha_subida?: string | null
}

const BUCKET = 'obra-documentos'
const LIMITE = 50 * 1024 * 1024

const inp: React.CSSProperties = { background: '#141414', color: '#ddd', border: '1px solid #242424', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontFamily: 'inherit', outline: 'none' }
const btn: React.CSSProperties = { border: '1px solid #333', background: '#161616', color: '#ccc', borderRadius: 8, padding: '6px 11px', fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'inherit' }

const limpiar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')

/** Sube un archivo al bucket de documentos y devuelve su URL pública. */
export async function subirDocumento(leadId: string, f: File): Promise<{ url?: string; error?: string }> {
  if (f.size > LIMITE) return { error: `El archivo pesa ${(f.size / 1048576).toFixed(0)} MB y el límite es 50 MB. Súbelo a Drive y pega el link.` }
  const path = `leads/${leadId}/${Date.now()}_${limpiar(f.name)}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, f)
  if (error) return { error: error.message }
  return { url: supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl }
}

export async function guardarDocLead(leadId: string, d: { nombre: string; tipo: string; url: string; notas?: string }): Promise<{ error?: string }> {
  if (!d.nombre.trim()) return { error: 'El documento necesita nombre: "plano.pdf" no le dice nada a quien lo busque en seis meses.' }
  if (!/^https?:\/\//i.test(d.url)) return { error: 'El link debe empezar con http o https.' }
  const { error } = await supabase.from('obra_documentos').insert({
    lead_id: leadId, nombre: d.nombre.trim(), tipo: d.tipo || 'otro',
    drive_url: d.url.trim(), notas: d.notas?.trim() || null,
  })
  return error ? { error: error.message } : {}
}

export default function DocsLead({ leadId, compacto }: { leadId: string; compacto?: boolean }) {
  const [docs, setDocs] = useState<DocLead[]>([])
  const [nuevo, setNuevo] = useState(false)
  const [modo, setModo] = useState<'link' | 'archivo'>('link')
  const [form, setForm] = useState({ nombre: '', tipo: 'plano', url: '', notas: '' })
  const [archivo, setArchivo] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function cargar() {
    const { data } = await supabase.from('obra_documentos')
      .select('id,nombre,tipo,drive_url,version,notas,fecha_subida')
      .eq('lead_id', leadId).order('fecha_subida', { ascending: false })
    setDocs(((data as any[]) || []) as DocLead[])
  }
  useEffect(() => { cargar() }, [leadId])

  async function agregar() {
    setErr(''); setBusy(true)
    let url = form.url
    if (modo === 'archivo') {
      if (!archivo) { setBusy(false); return setErr('Elige el archivo.') }
      const r = await subirDocumento(leadId, archivo)
      if (r.error) { setBusy(false); return setErr(r.error) }
      url = r.url!
    }
    const r = await guardarDocLead(leadId, { ...form, nombre: form.nombre || archivo?.name || '', url })
    setBusy(false)
    if (r.error) return setErr(r.error)
    setForm({ nombre: '', tipo: 'plano', url: '', notas: '' }); setArchivo(null); setNuevo(false)
    cargar()
  }

  async function borrar(id: string) {
    if (!confirm('¿Quitar este documento del lead? Si era un link de Drive, el archivo en Drive no se toca.')) return
    await supabase.from('obra_documentos').delete().eq('id', id)
    cargar()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Planos y documentos {docs.length > 0 && <span style={{ color: '#67E8F9' }}>({docs.length})</span>}
        </span>
        <button onClick={() => setNuevo(v => !v)} style={{ ...btn, marginLeft: 'auto', padding: '4px 9px', fontSize: 11 }}>
          <Plus size={12} /> Agregar
        </button>
      </div>

      {!compacto && docs.length === 0 && !nuevo && (
        <div style={{ fontSize: 11.5, color: '#666', lineHeight: 1.6, marginBottom: 8 }}>
          Lo que el cliente ya mandó: arquitectónicos, referencias, la carpeta de Drive. Todo lo que evite
          que alguien lo vuelva a pedir por WhatsApp.
        </div>
      )}

      {nuevo && (
        <div style={{ background: '#0e0e0e', border: '1px solid #1f1f1f', borderRadius: 9, padding: 11, marginBottom: 9 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setModo('link')} style={{ ...btn, padding: '4px 9px', fontSize: 11, borderColor: modo === 'link' ? '#3b82f6' : '#333', color: modo === 'link' ? '#93c5fd' : '#888' }}>
              <Link2 size={12} /> Link de Drive
            </button>
            <button onClick={() => setModo('archivo')} style={{ ...btn, padding: '4px 9px', fontSize: 11, borderColor: modo === 'archivo' ? '#3b82f6' : '#333', color: modo === 'archivo' ? '#93c5fd' : '#888' }}>
              <Upload size={12} /> Subir archivo
            </button>
          </div>
          {modo === 'link' ? (
            <input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              placeholder="https://drive.google.com/…" style={{ ...inp, width: '100%' }} />
          ) : (
            <input type="file" onChange={e => { setArchivo(e.target.files?.[0] || null); setErr('') }} style={{ ...inp, width: '100%', padding: 6 }} />
          )}
          <div style={{ display: 'flex', gap: 7, marginTop: 8, flexWrap: 'wrap' }}>
            <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder="Nombre (ej. Arquitectónico PB rev C)" style={{ ...inp, flex: 1, minWidth: 190 }} />
            <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))} style={{ ...inp, width: 150 }}>
              {DOC_TIPOS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          {err && <div style={{ fontSize: 11.5, color: '#DC2626', marginTop: 7 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button onClick={agregar} disabled={busy} style={{ ...btn, borderColor: '#10B981', color: '#10B981' }}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setNuevo(false); setErr('') }} style={btn}>Cancelar</button>
          </div>
        </div>
      )}

      {docs.map(d => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid #1a1a1a' }}>
          <FileText size={13} color="#666" style={{ flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: '#ddd' }}>{d.nombre}</div>
            <div style={{ fontSize: 10, color: '#666' }}>
              {DOC_TIPOS.find(t => t.key === d.tipo)?.label || d.tipo}
              {d.fecha_subida ? ` · ${new Date(d.fecha_subida).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}` : ''}
            </div>
          </div>
          <a href={d.drive_url} target="_blank" rel="noreferrer" style={{ ...btn, padding: '3px 8px', fontSize: 11, textDecoration: 'none' }}>
            <ExternalLink size={11} /> Abrir
          </a>
          <button onClick={() => borrar(d.id)} style={{ background: 'none', border: 'none', color: '#444', cursor: 'pointer', display: 'flex' }}><Trash2 size={12} /></button>
        </div>
      ))}
    </div>
  )
}
