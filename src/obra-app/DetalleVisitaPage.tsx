import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCurrentPosition } from './lib/geolocation'
import {
  ArrowLeft, MapPin, Phone, Clock, Loader2, Camera, X, Send,
  CheckCircle2, AlertCircle, Navigation, Wrench, User, Truck,
  Sparkles, DollarSign, Ticket
} from 'lucide-react'

interface Property {
  id: string
  name: string
  address: string | null
  city: string | null
  client_name: string | null
  client_phone: string | null
  systems_installed: string[] | null
}
interface TicketInfo {
  id: string
  ticket_number: number
  subject: string
  description: string | null
  category: string
  priority: string
  status: string
}
interface Visit {
  id: string
  property_id: string
  ticket_id: string | null
  contract_id: string | null
  visit_date: string
  scheduled_time: string | null
  status: string
  technician: string | null
  en_route_at: string | null
  arrived_at: string | null
  started_at: string | null
  completed_at: string | null
  work_performed: string | null
  parts_used: string | null
  billable: boolean
  amount_charged: number | null
  report: any
  photos: string[]
  property?: Property | null
  ticket?: TicketInfo | null
}

const PRIORITY_COLOR: Record<string, string> = {
  urgente: '#ef4444', alta: '#f59e0b', media: '#3b82f6', baja: '#10B981',
}

export default function DetalleVisitaPage() {
  const { visitId } = useParams<{ visitId: string }>()
  const navigate = useNavigate()
  const [visit, setVisit] = useState<Visit | null>(null)
  const [equipment, setEquipment] = useState<any[]>([])
  const [showEquipment, setShowEquipment] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Report form
  const [workPerformed, setWorkPerformed] = useState('')
  const [partsUsed, setPartsUsed] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [recomendacion, setRecomendacion] = useState('')
  const [billable, setBillable] = useState(false)
  const [amount, setAmount] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const photoInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('maintenance_visits')
      .select('*, property:maintenance_properties(id, name, address, city, client_name, client_phone, systems_installed), ticket:maintenance_tickets(id, ticket_number, subject, description, category, priority, status)')
      .eq('id', visitId)
      .maybeSingle()
    const v = data as any as Visit | null
    setVisit(v)
    if (v?.property_id) {
      const { data: eq } = await supabase
        .from('maintenance_equipment')
        .select('id, system, marca, modelo, sku, ubicacion, cantidad, garantia_fin')
        .eq('property_id', v.property_id)
        .order('system', { ascending: true })
      setEquipment(eq || [])
    }
    if (v) {
      setWorkPerformed(v.work_performed || '')
      setPartsUsed(v.parts_used || '')
      setObservaciones(v.report?.observaciones || '')
      setRecomendacion(v.report?.recomendacion || '')
      setBillable(v.billable || false)
      setAmount(v.amount_charged ? String(v.amount_charged) : '')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [visitId])

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), ok ? 2500 : 4000)
  }

  const markEnRoute = async () => {
    if (!visit) return
    setBusy('route')
    const { error } = await supabase.from('maintenance_visits')
      .update({ en_route_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', visit.id)
    setBusy('')
    if (error) { flash(false, error.message); return }
    flash(true, 'Marcado en camino. Se avisará al cliente.')
    load()
  }

  const checkIn = async () => {
    if (!visit) return
    setBusy('checkin')
    setMsg({ ok: true, text: 'Obteniendo tu ubicación...' })
    let lat: number | null = null, lng: number | null = null, acc: number | null = null
    try {
      const c = await getCurrentPosition()
      lat = c.latitude; lng = c.longitude; acc = c.accuracy ?? null
    } catch (_) { /* sin GPS, igual registramos llegada */ }
    const now = new Date().toISOString()
    const { error } = await supabase.from('maintenance_visits')
      .update({ arrived_at: now, started_at: now, checkin_lat: lat, checkin_lng: lng, checkin_accuracy: acc, updated_at: now })
      .eq('id', visit.id)
    setBusy('')
    if (error) { flash(false, error.message); return }
    flash(true, lat ? 'Llegada registrada con ubicación' : 'Llegada registrada (sin GPS)')
    load()
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    setPhotos(prev => [...prev, ...files].slice(0, 8))
    if (photoInputRef.current) photoInputRef.current.value = ''
  }
  const removePhoto = (i: number) => setPhotos(p => p.filter((_, idx) => idx !== i))

  const completeVisit = async () => {
    if (!visit) return
    if (!workPerformed.trim()) { flash(false, 'Describe el trabajo realizado'); return }
    setBusy('complete')
    try {
      // Subir fotos nuevas
      const photoPaths: string[] = [...(visit.photos || [])]
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i]
        const ext = (p.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${visit.id}/${Date.now()}_${i}.${ext}`
        const { error: upErr } = await supabase.storage.from('mantenimiento-evidencias').upload(path, p)
        if (upErr) throw new Error('Foto: ' + upErr.message)
        photoPaths.push(path)
      }

      const now = new Date().toISOString()
      const report = {
        observaciones: observaciones.trim() || null,
        recomendacion: recomendacion.trim() || null,
      }
      const { error } = await supabase.from('maintenance_visits').update({
        status: 'completada',
        completed_at: now,
        arrived_at: visit.arrived_at || now,
        work_performed: workPerformed.trim(),
        parts_used: partsUsed.trim() || null,
        billable,
        amount_charged: billable && amount ? parseFloat(amount) : null,
        report,
        photos: photoPaths,
        updated_at: now,
      }).eq('id', visit.id)
      if (error) throw new Error(error.message)

      // Descontar la cubeta correcta de la póliza (preventiva vs bomberazo)
      if (visit.contract_id) {
        await supabase.rpc('increment_contract_visit', {
          p_contract_id: visit.contract_id,
          p_kind: (visit as any).visit_kind || 'preventiva',
        }).catch(() => {})
      }

      // Cerrar ticket vinculado como resuelto (no bloquea si falla)
      if (visit.ticket_id) {
        await supabase.from('maintenance_tickets')
          .update({ status: 'resuelto', resolved_at: now, updated_at: now })
          .eq('id', visit.ticket_id)
      }

      // Recomendación del técnico → oportunidad de venta (pipeline upsell)
      if (recomendacion.trim()) {
        await supabase.from('maintenance_upsell').insert({
          property_id: visit.property_id,
          ticket_id: visit.ticket_id,
          title: 'Sugerencia de campo',
          description: recomendacion.trim(),
          status: 'identificada',
          assigned_to: visit.technician || null,
        })
      }

      flash(true, 'Visita completada')
      setTimeout(() => navigate('/obra-app/visitas'), 1400)
    } catch (e: any) {
      setBusy('')
      flash(false, e.message || 'Error al completar')
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={32} className="spin" />
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
      </div>
    )
  }
  if (!visit) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', padding: 24, maxWidth: 480, margin: '0 auto' }}>
        <button onClick={() => navigate('/obra-app/visitas')} style={backBtn}><ArrowLeft size={18} /></button>
        <div style={{ marginTop: 40, textAlign: 'center', color: '#888' }}>Visita no encontrada</div>
      </div>
    )
  }

  const prop = visit.property
  const done = visit.status === 'completada'
  const mapsUrl = prop?.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${prop.address}${prop.city ? ', ' + prop.city : ''}`)}`
    : null

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1a12 40%, #0a0a0a 100%)',
      color: '#fff',
      paddingTop: 'max(env(safe-area-inset-top), 20px)',
      paddingBottom: 40, paddingLeft: 16, paddingRight: 16,
      maxWidth: 480, margin: '0 auto',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={() => navigate('/obra-app/visitas')} style={backBtn}><ArrowLeft size={18} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{prop?.name || 'Visita'}</div>
          <div style={{ fontSize: 11, color: '#666' }}>
            {new Date(visit.visit_date + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })}
            {visit.scheduled_time ? ` · ${visit.scheduled_time.slice(0, 5)}` : ''}
          </div>
        </div>
        {done && <div style={{ fontSize: 11, padding: '4px 10px', borderRadius: 10, background: '#10B98122', color: '#10B981', fontWeight: 700 }}>Completada</div>}
      </div>

      {/* Datos de la propiedad */}
      <div style={card}>
        {prop?.client_name && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#ccc', marginBottom: 8 }}>
            <User size={14} color="#10B981" /> {prop.client_name}
          </div>
        )}
        {prop?.address && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#aaa', marginBottom: 8 }}>
            <MapPin size={14} style={{ marginTop: 2, flexShrink: 0 }} color="#10B981" />
            <span>{prop.address}{prop.city ? `, ${prop.city}` : ''}</span>
          </div>
        )}
        {prop?.systems_installed && prop.systems_installed.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {prop.systems_installed.map((s, i) => (
              <span key={i} style={{ fontSize: 10, padding: '3px 8px', borderRadius: 8, background: '#1a2a1f', color: '#10B981' }}>{s}</span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer" style={actionLink('#3b82f6')}>
              <Navigation size={14} /> Cómo llegar
            </a>
          )}
          {prop?.client_phone && (
            <a href={`tel:${prop.client_phone}`} style={actionLink('#10B981')}>
              <Phone size={14} /> Llamar
            </a>
          )}
        </div>
      </div>

      {/* Equipos instalados (contexto para el técnico) */}
      {equipment.length > 0 && (
        <div style={card}>
          <button onClick={() => setShowEquipment(s => !s)} style={{
            width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            color: '#fff', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Wrench size={14} color="#06b6d4" />
            <span style={{ fontSize: 13, fontWeight: 600 }}>Equipos instalados ({equipment.length})</span>
            <span style={{ marginLeft: 'auto', fontSize: 18, color: '#666', lineHeight: 1 }}>{showEquipment ? '−' : '+'}</span>
          </button>
          {showEquipment && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {equipment.map(e => (
                <div key={e.id} style={{ paddingBottom: 8, borderBottom: '1px solid #1a1a1a' }}>
                  <div style={{ fontSize: 13, color: '#fff' }}>
                    {[e.marca, e.modelo].filter(Boolean).join(' ') || 'Equipo'}
                    {e.cantidad && e.cantidad > 1 ? <span style={{ color: '#888' }}> ×{e.cantidad}</span> : null}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {e.system && <span style={{ color: '#06b6d4' }}>{e.system}</span>}
                    {e.ubicacion && <span>· {e.ubicacion}</span>}
                    {e.sku && <span>· {e.sku}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ticket vinculado */}
      {visit.ticket && (
        <div style={{ ...card, borderColor: (PRIORITY_COLOR[visit.ticket.priority] || '#333') + '55' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <Ticket size={14} color={PRIORITY_COLOR[visit.ticket.priority] || '#888'} />
            <span style={{ fontSize: 11, color: '#888' }}>Ticket #{visit.ticket.ticket_number}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', borderRadius: 8, background: (PRIORITY_COLOR[visit.ticket.priority] || '#333') + '22', color: PRIORITY_COLOR[visit.ticket.priority] || '#888', fontWeight: 700, textTransform: 'uppercase' }}>
              {visit.ticket.priority}
            </span>
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{visit.ticket.subject}</div>
          {visit.ticket.description && <div style={{ fontSize: 12, color: '#999', lineHeight: 1.5 }}>{visit.ticket.description}</div>}
        </div>
      )}

      {/* Acciones de progreso (si no completada) */}
      {!done && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button onClick={markEnRoute} disabled={!!busy || !!visit.en_route_at}
            style={progressBtn(!!visit.en_route_at, '#f59e0b')}>
            {busy === 'route' ? <Loader2 size={15} className="spin" /> : <Truck size={15} />}
            {visit.en_route_at ? 'En camino ✓' : 'Voy en camino'}
          </button>
          <button onClick={checkIn} disabled={!!busy || !!visit.arrived_at}
            style={progressBtn(!!visit.arrived_at, '#3b82f6')}>
            {busy === 'checkin' ? <Loader2 size={15} className="spin" /> : <MapPin size={15} />}
            {visit.arrived_at ? 'En sitio ✓' : 'Llegué'}
          </button>
        </div>
      )}

      {/* Reporte de la visita */}
      <div style={{ fontSize: 11, color: '#666', margin: '4px 0 8px', textTransform: 'uppercase', letterSpacing: 1, paddingLeft: 4 }}>
        Reporte de la visita
      </div>

      <label style={lbl}>Trabajo realizado *</label>
      <textarea value={workPerformed} onChange={e => setWorkPerformed(e.target.value)} disabled={done}
        placeholder="¿Qué se hizo en la visita?" rows={3} style={inputStyle} />

      <label style={lbl}>Refacciones / material usado</label>
      <input value={partsUsed} onChange={e => setPartsUsed(e.target.value)} disabled={done}
        placeholder="Ej. 2 sensores, 1 fuente..." style={{ ...inputStyle, minHeight: 0 }} />

      <label style={lbl}>Observaciones / levantamiento</label>
      <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} disabled={done}
        placeholder="Estado del sistema, hallazgos, pendientes..." rows={2} style={inputStyle} />

      <label style={{ ...lbl, color: '#a78bfa' }}>
        <Sparkles size={11} style={{ verticalAlign: -1 }} /> Recomendación de venta (opcional)
      </label>
      <textarea value={recomendacion} onChange={e => setRecomendacion(e.target.value)} disabled={done}
        placeholder="¿Detectaste una oportunidad? Se registra como oportunidad automáticamente."
        rows={2} style={{ ...inputStyle, borderColor: recomendacion ? '#3a2a5a' : '#1f1f1f' }} />

      {/* Fotos */}
      <label style={lbl}>Fotos / evidencia ({(visit.photos?.length || 0) + photos.length})</label>
      {!done && (
        <>
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} style={{ display: 'none' }} />
          <button onClick={() => photoInputRef.current?.click()} style={{
            width: '100%', padding: 14, marginBottom: 10, background: '#0f0f0f',
            border: '1px dashed #1f3a2a', borderRadius: 12, color: '#10B981', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'inherit',
          }}>
            <Camera size={18} /> Tomar foto
          </button>
        </>
      )}
      {(photos.length > 0 || (visit.photos?.length || 0) > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
          {(visit.photos || []).map((path, i) => {
            const url = supabase.storage.from('mantenimiento-evidencias').getPublicUrl(path).data.publicUrl
            return <div key={'e' + i} style={thumb}><img src={url} style={imgFill} alt="" /></div>
          })}
          {photos.map((p, i) => (
            <div key={'n' + i} style={thumb}>
              <img src={URL.createObjectURL(p)} style={imgFill} alt="" />
              <button onClick={() => removePhoto(i)} style={thumbX}><X size={11} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Facturable */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, marginTop: 4 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: done ? 'default' : 'pointer', fontSize: 13, color: '#ccc' }}>
          <input type="checkbox" checked={billable} disabled={done} onChange={e => setBillable(e.target.checked)} />
          <DollarSign size={14} color="#f59e0b" /> Facturable
        </label>
        {billable && (
          <input value={amount} onChange={e => setAmount(e.target.value)} disabled={done} type="number"
            placeholder="Monto MXN" style={{ ...inputStyle, minHeight: 0, marginBottom: 0, flex: 1 }} />
        )}
      </div>

      {msg && (
        <div style={{
          padding: 12, marginBottom: 14, borderRadius: 10,
          background: msg.ok ? '#0f2a1a' : '#3a1a1a',
          border: `1px solid ${msg.ok ? '#2a5a3a' : '#5a2a2a'}`,
          color: msg.ok ? '#10B981' : '#fca5a5', fontSize: 13,
          display: 'flex', gap: 8, alignItems: 'center',
        }}>
          {msg.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />} {msg.text}
        </div>
      )}

      {!done && (
        <button onClick={completeVisit} disabled={!!busy} style={{
          width: '100%', padding: 18, background: busy === 'complete' ? '#3a5f48' : '#10B981',
          color: '#0a0a0a', border: 'none', borderRadius: 14, fontSize: 16, fontWeight: 700,
          cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
        }}>
          {busy === 'complete' ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
          {busy === 'complete' ? 'Guardando...' : 'Completar visita'}
        </button>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } .spin { animation: spin 1s linear infinite; }`}</style>
    </div>
  )
}

// ── styles ──
const backBtn: React.CSSProperties = { background: 'transparent', border: '1px solid #1f1f1f', borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff' }
const card: React.CSSProperties = { background: '#0f0f0f', border: '1px solid #1a1a1a', borderRadius: 14, padding: 14, marginBottom: 14 }
const lbl: React.CSSProperties = { display: 'block', fontSize: 11, color: '#777', marginBottom: 6, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', marginBottom: 14, background: '#0f0f0f',
  border: '1px solid #1f1f1f', borderRadius: 10, color: '#fff', fontSize: 14,
  boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit',
}
const thumb: React.CSSProperties = { position: 'relative', aspectRatio: '1', background: '#0f0f0f', borderRadius: 8, overflow: 'hidden' }
const imgFill: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover' }
const thumbX: React.CSSProperties = { position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 10, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }
function actionLink(color: string): React.CSSProperties {
  return { flex: 1, padding: '10px', background: color + '14', border: `1px solid ${color}44`, borderRadius: 10, color, fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, textDecoration: 'none' }
}
function progressBtn(doneState: boolean, color: string): React.CSSProperties {
  return { flex: 1, padding: '13px', background: doneState ? color + '18' : '#0f0f0f', border: `1px solid ${doneState ? color + '55' : '#1f1f1f'}`, borderRadius: 12, color: doneState ? color : '#ccc', fontSize: 13, fontWeight: 600, cursor: doneState ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontFamily: 'inherit' }
}
