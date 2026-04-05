import { NavLink } from 'react-router-dom'
import { LayoutDashboard, FileText, ClipboardList, Users, Truck, FolderOpen, Users2, BookOpen, ShoppingCart, CreditCard, Building2 } from 'lucide-react'

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/crm', icon: Users2, label: 'CRM y Ventas' },
  { to: '/cotizaciones', icon: FileText, label: 'Cotizaciones' },
  { to: '/proyectos', icon: FolderOpen, label: 'Proyectos' },
  { to: '/compras', icon: ShoppingCart, label: 'Compras' },
  { to: '/reportes', icon: ClipboardList, label: 'Reportes de obra' },
  { to: '/cobranza', icon: CreditCard, label: 'Cobranza' },
  { to: '/nomina', icon: Users, label: 'Nomina' },
  { to: '/entregas', icon: Truck, label: 'Entregas' },
  { to: '/empleados', icon: BookOpen, label: 'Empleados' },
  { to: '/catalogo', icon: Package, label: 'Catalogo' },
  { to: '/clientes', icon: Users2, label: 'Clientes' },
  { to: '/contabilidad', icon: Building2, label: 'Contabilidad' },
]

export default function Sidebar() {
  return (
    <aside style={{ width: 200, minWidth: 200, background: '#111', borderRight: '1px solid #222', display: 'flex', flexDirection: 'column' as const, height: '100vh', position: 'sticky' as const, top: 0 }}>
      <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #222' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' }}>
          <span style={{ color: '#57FF9A' }}>OMM</span> Tech
        </div>
        <div style={{ fontSize: 10, color: '#555', marginTop: 2, letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>ERP Sistema</div>
      </div>
      <nav style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' as const }}>
        {NAV.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
            display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, marginBottom: 2,
            fontSize: 12, fontWeight: isActive ? 600 : 400, color: isActive ? '#57FF9A' : '#888',
            background: isActive ? 'rgba(87,255,154,0.08)' : 'transparent', textDecoration: 'none',
            transition: 'all 0.12s', border: isActive ? '1px solid rgba(87,255,154,0.15)' : '1px solid transparent',
          })}>
            <Icon size={14} />
            <span style={{ flex: 1 }}>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div style={{ padding: '12px 16px', borderTop: '1px solid #222', fontSize: 10, color: '#444' }}>OMM Technologies SA de CV</div>
    </aside>
  )
}
