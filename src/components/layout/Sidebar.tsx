import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, FileText, ClipboardList, Users, Truck, FolderOpen, Users2, BookOpen, ShoppingCart, TrendingUp, Building2, Package, Receipt, BrainCircuit, ChevronLeft, ChevronRight } from 'lucide-react'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/crm', icon: Users2, label: 'CRM y Ventas' },
  { to: '/cotizaciones', icon: FileText, label: 'Cotizaciones' },
  { to: '/proyectos', icon: FolderOpen, label: 'Proyectos' },
  { to: '/compras', icon: ShoppingCart, label: 'Compras' },
  { to: '/obra', icon: ClipboardList, label: 'Obra' },
  { to: '/finanzas', icon: TrendingUp, label: 'Finanzas' },
  { to: '/nomina', icon: Users, label: 'Nomina' },
  { to: '/entregas', icon: Truck, label: 'Entregas' },
  { to: '/empleados', icon: BookOpen, label: 'Empleados' },
  { to: '/catalogo', icon: Package, label: 'Catalogo' },
  { to: '/clientes', icon: Users2, label: 'Clientes' },
  { to: '/contabilidad', icon: Building2, label: 'Contabilidad' },
  { to: '/facturacion', icon: Receipt, label: 'Facturacion' },
  { to: '/design-rules', icon: BrainCircuit, label: 'Reglas AI' },
]

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)
  const w = collapsed ? 56 : 200

  return (
    <aside style={{
      width: w, minWidth: w, background: '#111', borderRight: '1px solid #222',
      display: 'flex', flexDirection: 'column' as const, height: '100vh',
      position: 'sticky' as const, top: 0, transition: 'width 0.2s ease, min-width 0.2s ease',
      overflow: 'hidden',
    }}>
      <div style={{ padding: collapsed ? '20px 8px 16px' : '20px 16px 16px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', minHeight: 56 }}>
        {!collapsed && (
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
              <span style={{ color: '#57FF9A' }}>OMM</span> Tech
            </div>
            <div style={{ fontSize: 10, color: '#555', marginTop: 2, letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>ERP Sistema</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          style={{
            background: 'none', border: '1px solid #333', borderRadius: 6, color: '#666',
            cursor: 'pointer', padding: '4px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#57FF9A')}
          onMouseLeave={e => (e.currentTarget.style.color = '#666')}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
      <nav style={{ flex: 1, padding: collapsed ? '8px 4px' : '8px 8px', overflowY: 'auto' as const }}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} title={collapsed ? label : undefined} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 8,
            padding: collapsed ? '8px 0' : '7px 10px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 8, marginBottom: 2,
            fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? '#57FF9A' : '#888',
            background: isActive ? 'rgba(87,255,154,0.08)' : 'transparent', textDecoration: 'none',
            transition: 'all 0.12s', border: isActive ? '1px solid rgba(87,255,154,0.15)' : '1px solid transparent',
          })}>
            <Icon size={14} />
            {!collapsed && <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden' }}>{label}</span>}
          </NavLink>
        ))}
      </nav>
      {!collapsed && (
        <div style={{ padding: '12px 16px', borderTop: '1px solid #222', fontSize: 10, color: '#444' }}>OMM Technologies SA de CV</div>
      )}
    </aside>
  )
}
