import { useState, useEffect, useRef } from 'react'
import React from 'react'

export interface SearchOption {
  id: string
  /** Lo que se ve y contra lo que se teclea. */
  label: string
  /** Segunda linea opcional: contexto que ayuda a elegir sin alargar el label. */
  sub?: string
  /** Texto extra que tambien hace match al teclear pero no se muestra. */
  buscar?: string
}

/**
 * Select con busqueda por tecleo. Reemplaza a un <select> cuando la lista es
 * larga y el usuario sabe parte del nombre pero no la posicion.
 *
 * size 'sm' es la variante compacta de Contabilidad (celdas de tabla).
 * size 'md' iguala a los inputs de formulario del resto del ERP.
 *
 * Al abrir se vacia el texto a proposito: el usuario ya sabe que eligio, lo
 * que quiere es teclear lo nuevo sin borrar antes. Si cierra sin elegir,
 * vuelve a mostrarse lo que estaba seleccionado.
 */
export default function SearchSelect({
  value, options, placeholder, disabled, onChange, size = 'sm', maxVisible = 50,
}: {
  value: string
  options: SearchOption[]
  placeholder?: string
  disabled?: boolean
  onChange: (val: string) => void
  size?: 'sm' | 'md'
  maxVisible?: number
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find(o => o.id === value)

  const q = query.trim().toLowerCase()
  // Cada palabra tecleada debe aparecer en algun lado: asi "torreon ilu"
  // encuentra "Casa Torreon Breede - Diseno de Iluminacion" sin importar el orden.
  const palabras = q ? q.split(/\s+/) : []
  const filtered = palabras.length === 0 ? options : options.filter(o => {
    const heno = (o.label + ' ' + (o.sub || '') + ' ' + (o.buscar || '')).toLowerCase()
    return palabras.every(p => heno.includes(p))
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQuery('') } }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const sm = size === 'sm'
  const inputStyle: React.CSSProperties = sm
    ? { background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 4, padding: '4px 6px', fontSize: 11, fontFamily: 'inherit', width: '100%', outline: 'none', opacity: disabled ? 0.4 : 1, boxSizing: 'border-box' }
    : { background: '#0e0e0e', color: '#fff', border: '1px solid #1e1e1e', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', width: '100%', outline: 'none', opacity: disabled ? 0.4 : 1, boxSizing: 'border-box' }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <input
        style={inputStyle}
        placeholder={placeholder || 'Buscar...'}
        disabled={disabled}
        value={open ? query : (selected?.label || '')}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true) }}
        onFocus={() => { setOpen(true); setQuery('') }}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); setQuery('') }
          if (e.key === 'Enter' && open && filtered.length > 0) {
            e.preventDefault()
            onChange(filtered[0].id); setOpen(false); setQuery('')
          }
        }}
      />
      {value && !open && !disabled && (
        <span
          onClick={() => { onChange(''); setQuery('') }}
          title="Quitar"
          style={{ position: 'absolute', right: sm ? 6 : 10, top: '50%', transform: 'translateY(-50%)', color: '#666', cursor: 'pointer', fontSize: sm ? 12 : 14, lineHeight: 1 }}
        >✕</span>
      )}
      {open && !disabled && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: '#111', border: '1px solid #2a2a2a', borderRadius: sm ? 4 : 8,
          maxHeight: sm ? 200 : 260, overflowY: 'auto', marginTop: 2,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 8, fontSize: sm ? 10 : 12, color: '#555', textAlign: 'center' }}>Sin resultados</div>
          ) : filtered.slice(0, maxVisible).map(o => (
            <div
              key={o.id}
              onClick={() => { onChange(o.id); setOpen(false); setQuery('') }}
              style={{
                padding: sm ? '5px 8px' : '7px 10px', fontSize: sm ? 11 : 12.5, cursor: 'pointer',
                color: o.id === value ? '#10B981' : '#ccc',
                background: o.id === value ? 'rgba(87,255,154,0.06)' : 'transparent',
                borderBottom: '1px solid #1a1a1a',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = o.id === value ? 'rgba(87,255,154,0.06)' : 'transparent')}
            >
              <div>{o.label}</div>
              {o.sub && <div style={{ fontSize: sm ? 9 : 10.5, color: '#666', marginTop: 1 }}>{o.sub}</div>}
            </div>
          ))}
          {filtered.length > maxVisible && (
            <div style={{ padding: '5px 8px', fontSize: sm ? 9 : 10.5, color: '#555', textAlign: 'center' }}>
              {filtered.length - maxVisible} mas — sigue tecleando para acotar
            </div>
          )}
        </div>
      )}
    </div>
  )
}
