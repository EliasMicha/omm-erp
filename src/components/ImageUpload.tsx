import { useState, useRef } from 'react'
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'

interface ImageUploadProps {
  value: string | null
  onChange: (url: string | null) => void
  bucket?: string
  folder?: string
  maxSizeMB?: number
  label?: string
  size?: 'sm' | 'md' | 'lg'
}

/**
 * Componente reutilizable para subir imágenes a Supabase Storage.
 *
 * Uso:
 *   <ImageUpload value={imageUrl} onChange={setImageUrl} />
 *
 * Sube al bucket `product-images` por default. Genera un nombre de
 * archivo único basado en timestamp + random para evitar colisiones.
 * La URL pública se devuelve vía onChange cuando el upload termina.
 * El componente también permite eliminar la imagen (pone onChange(null)).
 */
export default function ImageUpload({
  value,
  onChange,
  bucket = 'product-images',
  folder = '',
  maxSizeMB = 5,
  label = 'Subir imagen',
  size = 'md',
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const dimensions = {
    sm: { w: 60, h: 60, iconSize: 16, textSize: 9 },
    md: { w: 100, h: 100, iconSize: 22, textSize: 10 },
    lg: { w: 160, h: 160, iconSize: 32, textSize: 11 },
  }[size]

  async function handleFile(file: File) {
    setError(null)

    // Validaciones
    if (!file.type.startsWith('image/')) {
      setError('El archivo debe ser una imagen')
      return
    }
    const sizeMB = file.size / (1024 * 1024)
    if (sizeMB > maxSizeMB) {
      setError(`La imagen pesa ${sizeMB.toFixed(1)}MB, máximo ${maxSizeMB}MB`)
      return
    }

    setUploading(true)
    try {
      // Nombre único: folder/timestamp-random.ext
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const timestamp = Date.now()
      const random = Math.random().toString(36).substring(2, 8)
      const filename = `${folder ? folder + '/' : ''}${timestamp}-${random}.${ext}`

      const { error: uploadErr } = await supabase.storage
        .from(bucket)
        .upload(filename, file, {
          cacheControl: '31536000', // 1 año - las URLs son únicas, seguro cachear fuerte
          upsert: false,
        })

      if (uploadErr) {
        throw uploadErr
      }

      // Obtener URL pública
      const { data } = supabase.storage.from(bucket).getPublicUrl(filename)
      if (!data?.publicUrl) {
        throw new Error('No se pudo obtener la URL pública')
      }

      onChange(data.publicUrl)
    } catch (err: any) {
      console.error('Error subiendo imagen:', err)
      setError(err.message || 'Error al subir la imagen')
    } finally {
      setUploading(false)
    }
  }

  function handleRemove(e: React.MouseEvent) {
    e.stopPropagation()
    onChange(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: dimensions.w,
    height: dimensions.h,
    borderRadius: 8,
    border: value ? '1px solid #2a2a2a' : '1px dashed #333',
    background: value ? '#0a0a0a' : '#0e0e0e',
    cursor: uploading ? 'wait' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={containerStyle}
        onClick={() => !uploading && fileInputRef.current?.click()}
        onMouseEnter={e => { if (!value && !uploading) e.currentTarget.style.borderColor = '#57FF9A' }}
        onMouseLeave={e => { if (!value && !uploading) e.currentTarget.style.borderColor = '#333' }}
      >
        {uploading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <Loader2 size={dimensions.iconSize} color="#57FF9A" style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ fontSize: dimensions.textSize, color: '#666' }}>Subiendo...</div>
          </div>
        ) : value ? (
          <>
            <img
              src={value}
              alt="Producto"
              style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }}
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none'
                setError('No se pudo cargar la imagen')
              }}
            />
            <button
              type="button"
              onClick={handleRemove}
              style={{
                position: 'absolute', top: 4, right: 4,
                width: 20, height: 20, borderRadius: '50%',
                background: 'rgba(0,0,0,0.7)', border: '1px solid #444',
                color: '#fff', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0,
              }}
              title="Eliminar imagen"
            >
              <X size={12} />
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 8, textAlign: 'center' }}>
            <ImageIcon size={dimensions.iconSize} color="#444" />
            <div style={{ fontSize: dimensions.textSize, color: '#555', lineHeight: 1.3 }}>{label}</div>
          </div>
        )}
      </div>

      {error && (
        <div style={{ fontSize: 9, color: '#f87171', maxWidth: dimensions.w, lineHeight: 1.3 }}>
          {error}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
