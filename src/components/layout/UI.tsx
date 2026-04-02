import { CSSProperties, ReactNode } from 'react'

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
    <div style={{ border: '1px solid #222', borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        {children}
      </table>
    </div>
  )
}

export function Th({ children, right }: { children: ReactNode; right?: boolean }) {
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

export function Td({ children, right, muted, style }: {
  children: ReactNode; right?: boolean; muted?: boolean; style?: CSSProperties
}) {
  return (
    <td style={{
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
export function Btn({ children, onClick, variant = 'default', size = 'md', style }: {
  children: ReactNode
  onClick?: () => void
  variant?: 'default' | 'primary' | 'ghost'
  size?: 'sm' | 'md'
  style?: CSSProperties
}) {
  const base: CSSProperties = {
    cursor: 'pointer', border: 'none', borderRadius: 8, fontFamily: 'inherit',
    transition: 'all 0.12s', display: 'inline-flex', alignItems: 'center', gap: 5,
    fontSize: size === 'sm' ? 11 : 12,
    padding: size === 'sm' ? '4px 10px' : '7px 14px',
    fontWeight: 500,
  }
  const variants: Record<string, CSSProperties> = {
    default: { background: '#1e1e1e', color: '#aaa', border: '1px solid #333' },
    primary: { background: '#57FF9A', color: '#000', fontWeight: 700 },
    ghost:   { background: 'transparent', color: '#666', border: '1px solid transparent' },
  }
  return (
    <button onClick={onClick} style={{ ...base, ...variants[variant], ...style }}>
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
