import { CSSProperties, ReactNode, MouseEvent as RMouseEvent, useState, useRef, useEffect, useCallback, useMemo } from 'react'

// ── Badge ────────────────────────────────────────────────────────────────────
export function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 20,
      fontSize: 10, fontWeight: 600,
      background: color + '22', color, border: `1px solid ${color}44`,
    }}>
      {label}
    </span>
  )
}

// ── KPI Card ─────────────────────────────────────────────────────────────────
export function KpiCard({ label, value, color = '#57FF9A', icon }: {
  label: string; value: string | number; color?: string; icon?: ReactNode
}) {
  return (
    <div style={{
      background: '#141414', border: '1px solid #222', borderRadius: 12,
      padding: '16px 18px', borderTop: `2px solid ${color}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </div>
        {icon && <span style={{ color, opacity: 0.7 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{value}</div>
    </div>
  )
}

// ── Table ────────────────────────────────────────────────────────────────────
export function Table({ children }: { children: ReactNode }) {
  return (
    <div style={{ border: '1px solid #222', borderRadius: 12, position: 'relative' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {children}
      </table>
    </div>
  )
}

export function Th({ children, right }: { children?: ReactNode; right?: boolean }) {
  return (
    <th style={{
      padding: '8px 12px', background: '#1a1a1a',
      fontSize: 10, fontWeight: 600, color: '#555',
      textAlign: right ? 'right' : 'left',
      textTransform: 'uppercase', letterSpacing: '0.06em',
      borderBottom: '1px solid #222',
      whiteSpace: 'nowrap',
    }}>
      {children}
    </th>
  )
}

export function Td({ children, right, muted, style, colSpan }: {
  children: ReactNode; right?: boolean; muted?: boolean; style?: CSSProperties; colSpan?: number
}) {
  return (
    <td colSpan={colSpan} style={{
      padding: '10px 12px',
      fontSize: 12, color: muted ? '#555' : '#ccc',
      textAlign: right ? 'right' : 'left',
      borderBottom: '1px solid #1a1a1a',
      ...style,
    }}>
      {children}
    </td>
  )
}

// ── ThFilter — Header de columna con filtro tipo Excel ──────────────────────
export function ThFilter({
  label,
  right,
  values,
  activeFilters,
  onFilterChange,
}: {
  label: string
  right?: boolean
  values: string[]              // todos los valores posibles de esta columna
  activeFilters: Set<string>    // valores actualmente seleccionados (vacío = sin filtro = todos)
  onFilterChange: (selected: Set<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  // Cerrar al hacer click afuera
  useEffect(() => {
    if (!open) return
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Valores únicos ordenados
  const uniqueValues = useMemo(() => {
    const unique = Array.from(new Set(values.map(v => (v ?? '').toString().trim())))
    unique.sort((a, b) => a.localeCompare(b, 'es'))
    return unique
  }, [values])

  const filteredOptions = useMemo(() => {
    if (!search) return uniqueValues
    const s = search.toLowerCase()
    return uniqueValues.filter(v => v.toLowerCase().includes(s))
  }, [uniqueValues, search])

  const isFiltering = activeFilters.size > 0
  const allSelected = activeFilters.size === 0 || activeFilters.size === uniqueValues.length

  const toggleValue = useCallback((val: string) => {
    const next = new Set(activeFilters)
    if (next.has(val)) {
      next.delete(val)
    } else {
      next.add(val)
    }
    // Si seleccionaron todo o nada, limpiar filtro
    if (next.size === 0 || next.size === uniqueValues.length) {
      onFilterChange(new Set())
    } else {
      onFilterChange(next)
    }
  }, [activeFilters, uniqueValues, onFilterChange])

  const selectAll = useCallback(() => onFilterChange(new Set()), [onFilterChange])
  const clearAll = useCallback(() => {
    // Seleccionar solo el primer valor visible para "limpiar"
    if (filteredOptions.length > 0) onFilterChange(new Set(filteredOptions.slice(0, 1)))
    else onFilterChange(new Set())
  }, [filteredOptions, onFilterChange])

  return (
    <th
      style={{
        padding: '8px 12px', background: '#1a1a1a',
        fontSize: 10, fontWeight: 600, color: isFiltering ? '#57FF9A' : '#555',
        textAlign: right ? 'right' : 'left',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        borderBottom: '1px solid #222',
        whiteSpace: 'nowrap',
        position: 'relative',
      }}
    >
      <div ref={ref} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => { setOpen(!open); setSearch('') }}>
        <span>{label}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ opacity: isFiltering ? 1 : 0.4, flexShrink: 0 }}>
          <path d="M1 1h8L6 5v3l-2 1V5L1 1z" fill={isFiltering ? '#57FF9A' : '#888'} />
        </svg>
        {open && (
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '100%',
              [right ? 'right' : 'left']: 0,
              zIndex: 200,
              background: '#1a1a1a',
              border: '1px solid #333',
              borderRadius: 8,
              padding: 8,
              minWidth: 180,
              maxHeight: 280,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              textTransform: 'none',
              letterSpacing: 'normal',
            }}
          >
            {/* Buscador */}
            <input
              type="text"
              placeholder="Buscar..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '5px 8px',
                background: '#111',
                border: '1px solid #333',
                borderRadius: 4,
                color: '#ccc',
                fontSize: 11,
                marginBottom: 6,
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />
            {/* Botones rápidos */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, fontSize: 10 }}>
              <button onClick={selectAll} style={{ background: 'none', border: 'none', color: '#3B82F6', cursor: 'pointer', padding: 0, fontSize: 10, fontFamily: 'inherit' }}>
                Todos
              </button>
              <button onClick={clearAll} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', padding: 0, fontSize: 10, fontFamily: 'inherit' }}>
                Limpiar
              </button>
              {isFiltering && (
                <button onClick={selectAll} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 0, fontSize: 10, fontFamily: 'inherit', marginLeft: 'auto' }}>
                  Quitar filtro
                </button>
              )}
            </div>
            {/* Lista de valores */}
            <div style={{ overflowY: 'auto', maxHeight: 200 }}>
              {filteredOptions.map(val => {
                const checked = activeFilters.size === 0 || activeFilters.has(val)
                return (
                  <label
                    key={val || '__empty__'}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '3px 4px', cursor: 'pointer', fontSize: 11,
                      color: checked ? '#ccc' : '#555',
                      borderRadius: 4,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#222')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleValue(val)}
                      style={{ cursor: 'pointer', width: 13, height: 13, flexShrink: 0 }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {val || '(vacío)'}
                    </span>
                  </label>
                )
              })}
              {filteredOptions.length === 0 && (
                <div style={{ padding: 8, color: '#555', fontSize: 11, textAlign: 'center' }}>Sin resultados</div>
              )}
            </div>
          </div>
        )}
      </div>
    </th>
  )
}

// ── useColumnFilters — Hook para manejar filtros de múltiples columnas ──────
export function useColumnFilters<T extends string>() {
  const [filters, setFilters] = useState<Record<string, Set<string>>>({})

  const setFilter = useCallback((column: string, selected: Set<string>) => {
    setFilters(prev => {
      const next = { ...prev }
      if (selected.size === 0) {
        delete next[column]
      } else {
        next[column] = selected
      }
      return next
    })
  }, [])

  const getFilter = useCallback((column: string): Set<string> => {
    return filters[column] || new Set()
  }, [filters])

  const applyFilters = useCallback(<R,>(rows: R[], getColumnValue: (row: R, column: string) => string): R[] => {
    const activeColumns = Object.keys(filters)
    if (activeColumns.length === 0) return rows
    return rows.filter(row =>
      activeColumns.every(col => {
        const val = getColumnValue(row, col).toString().trim()
        return filters[col].has(val)
      })
    )
  }, [filters])

  const activeCount = Object.keys(filters).length

  const clearAll = useCallback(() => setFilters({}), [])

  return { filters, setFilter, getFilter, applyFilters, activeCount, clearAll }
}

// ── Progress Bar ─────────────────────────────────────────────────────────────
export function ProgressBar({ pct, color = '#57FF9A' }: { pct: number; color?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: '#2a2a2a', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: 4, width: `${Math.min(100, pct)}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, color: '#666', minWidth: 30 }}>{pct}%</span>
    </div>
  )
}

// ── Button ────────────────────────────────────────────────────────────────────
export function Btn({ children, onClick, variant = 'default', size = 'md', style, disabled }: {
  children: ReactNode
  onClick?: (e?: RMouseEvent<HTMLButtonElement>) => void
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  style?: CSSProperties
  disabled?: boolean
}) {
  const base: CSSProperties = {
    cursor: disabled ? 'not-allowed' : 'pointer', border: 'none', borderRadius: 8, fontFamily: 'inherit',
    transition: 'all 0.12s', display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: size === 'sm' ? 11 : 12,
    padding: size === 'sm' ? '4px 10px' : '7px 14px',
    fontWeight: 500,
    opacity: disabled ? 0.5 : 1,
  }
  const variants: Record<string, CSSProperties> = {
    default: { background: '#1e1e1e', color: '#aaa', border: '1px solid #333' },
    primary: { background: '#57FF9A', color: '#000', fontWeight: 700 },
    ghost:   { background: 'transparent', color: '#666', border: '1px solid transparent' },
    danger:  { background: '#EF4444', color: '#fff', fontWeight: 600 },
  }
  return (
    <button onClick={disabled ? undefined : onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  )
}

// ── Section Header ────────────────────────────────────────────────────────────
export function SectionHeader({ title, subtitle, action }: {
  title: string; subtitle?: string; action?: ReactNode
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 2 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#555' }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────
export function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#444', fontSize: 13 }}>
      {message}
    </div>
  )
}

// ── Loading ───────────────────────────────────────────────────────────────────
export function Loading() {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: '#444', fontSize: 13 }}>
      Cargando...
    </div>
  )
}
