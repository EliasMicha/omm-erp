import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getCurrentPosition } from './lib/geolocation'
import {
  ArrowLeft, Camera, Mic, Square, X, Send, Loader2,
  CheckCircle2, AlertCircle, Play, Pause, Sparkles
} from 'lucide-react'

interface Project {
  id: string
  name: string
}
interface Obra {
  id: string
  nombre: string
  project_id: string | null
}

const TIPO_OPTIONS = [
  { value: 'avance', label: 'Avance' },
  { value: 'problema', label: 'Problema' },
  { value: 'terminacion_tarea', label: 'Tarea terminada' },
  { value: 'material_faltante', label: 'Falta material' },
  { value: 'general', label: 'General' },
]

export default function SubirReportePage({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [tipoReporte, setTipoReporte] = useState('avance')
  const [texto, setTexto] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const photoInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const recordTimerRef = useRef<number | null>(null)


  useEffect(() => {
    // Load projects from weekly_plan_assignments (recent) + installer_daily_assignment
    // + obra_reportes history to build a "my projects" list
    (async () => {
      const { data: assigned } = await supabase
        .from('weekly_plan_assignments')
        .select('project_id, projects(id, name)')
        .eq('employee_id', employeeId)
      const { data: daily } = await supabase
        .from('installer_daily_assignment')
        .select('project_id, projects(id, name)')
        .eq('employee_id', employeeId)

      const map = new Map<string, Project>()
      for (const a of (assigned || [])) {
        if (a.projects) map.set((a.projects as any).id, a.projects as any)
      }
      for (const a of (daily || [])) {
        if (a.projects) map.set((a.projects as any).id, a.projects as any)
      }
      const list = Array.from(map.values())
      setProjects(list)

      // Pre-select today's project if present
      const today = new Date().toISOString().slice(0, 10)
      const { data: todayAsn } = await supabase
        .from('installer_daily_assignment')
        .select('project_id')
        .eq('employee_id', employeeId)
        .eq('fecha', today)
        .maybeSingle()
      if (todayAsn?.project_id) setSelectedProject(todayAsn.project_id)
      else if (list.length > 0) setSelectedProject(list[0].id)
    })()
  }, [employeeId])

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const newPhotos = [...photos, ...files].slice(0, 5)
    setPhotos(newPhotos)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  const removePhoto = (i: number) => setPhotos(photos.filter((_, idx) => idx !== i))

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                       MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      audioChunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType || 'audio/webm' })
        setAudioBlob(blob)
        setAudioUrl(URL.createObjectURL(blob))
        stream.getTracks().forEach(t => t.stop())
      }
      mr.start()
      mediaRecorderRef.current = mr
      setRecording(true)
      setRecordingTime(0)
      recordTimerRef.current = window.setInterval(() => setRecordingTime(t => t + 1), 1000)
    } catch (e: any) {
      alert('No se pudo acceder al micrófono: ' + e.message)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current)
      recordTimerRef.current = null
    }
    setRecording(false)
  }

  const discardAudio = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl)
    setAudioBlob(null)
    setAudioUrl(null)
    setRecordingTime(0)
    setPlaying(false)
  }

  const togglePlay = () => {
    if (!audioElRef.current) return
    if (playing) audioElRef.current.pause()
    else audioElRef.current.play()
  }


  const handleSubmit = async () => {
    if (!selectedProject) {
      alert('Selecciona una obra')
      return
    }
    if (photos.length === 0 && !texto.trim() && !audioBlob) {
      alert('Agrega al menos una foto, texto o audio')
      return
    }

    setSubmitting(true)
    setResult(null)

    try {
      // 1. Get or auto-create the obra linked to this project
      let obraId: string | null = null
      const { data: existingObra } = await supabase
        .from('obras')
        .select('id')
        .eq('project_id', selectedProject)
        .maybeSingle()

      if (existingObra) {
        obraId = existingObra.id
      } else {
        // Auto-create obra from project
        const { data: proj } = await supabase
          .from('projects')
          .select('name, direccion_completa')
          .eq('id', selectedProject)
          .single()
        const { data: newObra, error: createErr } = await supabase
          .from('obras')
          .insert({
            nombre: proj?.name || 'Obra sin nombre',
            direccion: proj?.direccion_completa || null,
            project_id: selectedProject,
          })
          .select('id')
          .single()
        if (createErr) throw new Error('Error creando obra: ' + createErr.message)
        obraId = newObra.id
      }

      // 2. Try to get GPS (optional, don't fail if denied)
      let lat: number | null = null
      let lng: number | null = null
      try {
        const coords = await getCurrentPosition()
        lat = coords.latitude
        lng = coords.longitude
      } catch (_) { /* ignore */ }

      // 3. Upload photos
      const photoPaths: string[] = []
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i]
        const ext = (p.name.split('.').pop() || 'jpg').toLowerCase()
        const path = `${employeeId}/${Date.now()}_photo_${i}.${ext}`
        const { error: upErr } = await supabase.storage
          .from('obra-reportes')
          .upload(path, p)
        if (upErr) throw new Error('Error subiendo foto: ' + upErr.message)
        photoPaths.push(path)
      }

      // 4. Upload audio if present
      let audioPath: string | null = null
      let audioPublicUrl: string | null = null
      if (audioBlob) {
        const ext = (audioBlob.type.split('/').pop() || 'webm').replace(/;.*/, '')
        audioPath = `${employeeId}/${Date.now()}_audio.${ext}`
        const { error: upErr } = await supabase.storage
          .from('obra-reportes')
          .upload(audioPath, audioBlob)
        if (upErr) throw new Error('Error subiendo audio: ' + upErr.message)
        const { data: urlData } = supabase.storage.from('obra-reportes').getPublicUrl(audioPath)
        audioPublicUrl = urlData.publicUrl
      }

      // 5. Insert obra_reporte
      const { data: reporte, error: insErr } = await supabase
        .from('obra_reportes')
        .insert({
          obra_id: obraId,
          instalador_id: employeeId,
          fecha: new Date().toISOString().slice(0, 10),
          texto_raw: texto.trim() || null,
          fotos: photoPaths,
          audio_path: audioPath,
          audio_url: audioPublicUrl,
          latitude: lat,
          longitude: lng,
          tipo_reporte: tipoReporte,
          procesado: false,
        })
        .select('id')
        .single()
      if (insErr) throw new Error('Error insertando reporte: ' + insErr.message)

      // 6. Trigger AI processing (don't await, fire-and-forget)
      const { data: sessionData } = await supabase.auth.getSession()
      const apiKey = (supabase as any).supabaseKey
      fetch(`${(supabase as any).supabaseUrl}/functions/v1/process-obra-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'apikey': apiKey,
        },
        body: JSON.stringify({ reporte_id: reporte.id }),
      }).catch(e => console.warn('AI processing failed:', e))

      setResult({ ok: true, msg: 'Reporte enviado. La IA lo procesará en unos segundos.' })
      setTimeout(() => navigate('/obra-app'), 1800)
    } catch (e: any) {
      setResult({ ok: false, msg: e.message || 'Error desconocido' })
      setSubmitting(false)
    }
  }


  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(180deg, #0a0a0a 0%, #0f1a12 40%, #0a0a0a 100%)',
      color: '#fff',
      paddingTop: 'max(env(safe-area-inset-top), 20px)',
      paddingBottom: 40,
      paddingLeft: 16,
      paddingRight: 16,
      maxWidth: 480,
      margin: '0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button
          onClick={() => navigate('/obra-app')}
          style={{
            background: 'transparent', border: '1px solid #1f1f1f',
            borderRadius: 10, padding: 10, cursor: 'pointer', color: '#fff',
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Nuevo reporte</div>
          <div style={{ fontSize: 11, color: '#666' }}>Foto, texto o nota de voz</div>
        </div>
      </div>

      {/* Project selector */}
      <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
        Obra
      </label>
      <select
        value={selectedProject}
        onChange={e => setSelectedProject(e.target.value)}
        style={{
          width: '100%', padding: '14px 16px', marginBottom: 16,
          background: '#0f0f0f', border: '1px solid #1f1f1f',
          borderRadius: 10, color: '#fff', fontSize: 15,
          boxSizing: 'border-box',
        }}
      >
        <option value="" disabled>Selecciona obra...</option>
        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>

      {/* Tipo de reporte */}
      <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
        Tipo
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6, marginBottom: 16 }}>
        {TIPO_OPTIONS.map(t => (
          <button
            key={t.value}
            onClick={() => setTipoReporte(t.value)}
            style={{
              padding: '10px 8px',
              background: tipoReporte === t.value ? '#0f2a1a' : '#0f0f0f',
              border: `1px solid ${tipoReporte === t.value ? '#57FF9A' : '#1f1f1f'}`,
              borderRadius: 10,
              color: tipoReporte === t.value ? '#57FF9A' : '#888',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Text */}
      <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
        Descripción
      </label>
      <textarea
        value={texto}
        onChange={e => setTexto(e.target.value)}
        placeholder="¿Qué hiciste? ¿Hubo algún problema?"
        rows={4}
        style={{
          width: '100%', padding: '14px 16px', marginBottom: 16,
          background: '#0f0f0f', border: '1px solid #1f1f1f',
          borderRadius: 10, color: '#fff', fontSize: 14,
          boxSizing: 'border-box', resize: 'vertical',
          fontFamily: 'inherit',
        }}
      />

      {/* Photos */}
      <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
        Fotos ({photos.length}/5)
      </label>
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handlePhotoChange}
        style={{ display: 'none' }}
      />
      {photos.length < 5 && (
        <button
          onClick={() => photoInputRef.current?.click()}
          style={{
            width: '100%', padding: '16px', marginBottom: 10,
            background: '#0f0f0f', border: '1px dashed #1f3a2a',
            borderRadius: 12, color: '#57FF9A', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Camera size={18} /> Tomar foto
        </button>
      )}
      {photos.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 16 }}>
          {photos.map((p, i) => (
            <div key={i} style={{ position: 'relative', aspectRatio: '1', background: '#0f0f0f', borderRadius: 8, overflow: 'hidden' }}>
              <img src={URL.createObjectURL(p)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
              <button
                onClick={() => removePhoto(i)}
                style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 22, height: 22, borderRadius: 11,
                  background: 'rgba(0,0,0,0.7)', border: 'none',
                  color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Audio recording */}
      <label style={{ display: 'block', fontSize: 11, color: '#666', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
        Nota de voz (transcripción automática)
      </label>
      {!audioBlob && !recording && (
        <button
          onClick={startRecording}
          style={{
            width: '100%', padding: '16px', marginBottom: 20,
            background: '#0f0f0f', border: '1px dashed #3a2a5a',
            borderRadius: 12, color: '#a78bfa', fontSize: 14, fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Mic size={18} /> Grabar audio
        </button>
      )}
      {recording && (
        <button
          onClick={stopRecording}
          style={{
            width: '100%', padding: '16px', marginBottom: 20,
            background: '#3a1a1a', border: '1px solid #ef4444',
            borderRadius: 12, color: '#ef4444', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Square size={16} /> DETENER · {fmtTime(recordingTime)}
        </button>
      )}
      {audioBlob && audioUrl && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: 12, marginBottom: 20,
          background: '#1a1530', border: '1px solid #3a2a5a', borderRadius: 12,
        }}>
          <button
            onClick={togglePlay}
            style={{
              width: 40, height: 40, borderRadius: 20,
              background: '#a78bfa', border: 'none', color: '#0a0a0a',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <div style={{ flex: 1, fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>
            Audio grabado · {fmtTime(recordingTime)}
          </div>
          <button
            onClick={discardAudio}
            style={{
              background: 'transparent', border: '1px solid #3a2a5a',
              borderRadius: 8, padding: 8, color: '#888', cursor: 'pointer',
            }}
          >
            <X size={14} />
          </button>
          <audio
            ref={audioElRef}
            src={audioUrl}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
          />
        </div>
      )}

      {/* Result message */}
      {result && (
        <div style={{
          padding: 14, marginBottom: 16, borderRadius: 10,
          background: result.ok ? '#0f2a1a' : '#3a1a1a',
          border: `1px solid ${result.ok ? '#2a5a3a' : '#5a2a2a'}`,
          color: result.ok ? '#57FF9A' : '#fca5a5',
          fontSize: 13, display: 'flex', gap: 8, alignItems: 'center',
        }}>
          {result.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {result.msg}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting || recording}
        style={{
          width: '100%', padding: '18px',
          background: submitting ? '#3a5f48' : '#57FF9A',
          color: '#0a0a0a', border: 'none',
          borderRadius: 14, fontSize: 16, fontWeight: 700,
          cursor: submitting || recording ? 'not-allowed' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
          marginBottom: 12,
        }}
      >
        {submitting ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
        {submitting ? 'Enviando...' : 'Enviar reporte'}
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 10, color: '#666' }}>
        <Sparkles size={11} color="#a78bfa" />
        <span>Claude analizará el reporte automáticamente</span>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
