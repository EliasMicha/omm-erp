import { useState, useEffect } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FileText, ClipboardList, Users, Truck, FolderOpen, Users2, BookOpen, ShoppingCart, TrendingUp, Building2, Package, Receipt, BrainCircuit, ChevronLeft, ChevronRight, Menu, X, LogOut, Shield } from 'lucide-react'
import { useIsMobile } from '../../lib/useIsMobile'
import { useAuth, PermissionArea } from '../../contexts/AuthContext'

/* Cada ruta tiene áreas permitidas. Si no tiene allowedAreas, todos la ven. */
interface NavItem {
  to: string
  icon: any
  label: string
  allowedAreas?: PermissionArea[]
}

const NAV: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/crm', icon: Users2, label: 'CRM y Ventas' },
  { to: '/cotizaciones', icon: FileText, label: 'Cotizaciones' },
  { to: '/proyectos', icon: FolderOpen, label: 'Proyectos' },
  { to: '/compras', icon: ShoppingCart, label: 'Compras' },
  { to: '/obra', icon: ClipboardList, label: 'Obra' },
  { to: '/finanzas', icon: TrendingUp, label: 'Finanzas', allowedAreas: ['Administracion'] },
  { to: '/nomina', icon: Users, label: 'Nomina', allowedAreas: ['Administracion'] },
  { to: '/entregas', icon: Truck, label: 'Entregas' },
  { to: '/empleados', icon: BookOpen, label: 'Empleados', allowedAreas: ['Administracion'] },
  { to: '/catalogo', icon: Package, label: 'Catalogo' },
  { to: '/clientes', icon: Users2, label: 'Clientes' },
  { to: '/contabilidad', icon: Building2, label: 'Contabilidad', allowedAreas: ['Administracion'] },
  { to: '/facturacion', icon: Receipt, label: 'Facturacion', allowedAreas: ['Administracion'] },
  { to: '/design-rules', icon: BrainCircuit, label: 'Reglas AI' },
  { to: '/usuarios', icon: Shield, label: 'Usuarios', allowedAreas: [] as PermissionArea[] },
]

export default function Sidebar() {
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()

  // Close mobile menu on navigation
  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  // Filter nav based on permissions — DG sees everything
  const filteredNav = NAV.filter(item => {
    if (!item.allowedAreas) return true
    if (!user) return false
    if (user.permission_area === 'DG') return true
    return item.allowedAreas.includes(user.permission_area)
  })

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  // ─── MOBILE: hamburger + overlay ───
  if (isMobile) {
    return (
      <>
        {/* Hamburger button — fixed top-left */}
        <button
          onClick={() => setMobileOpen(true)}
          style={{
            position: 'fixed', top: 10, left: 10, zIndex: 1100,
            background: '#111', border: '1px solid #333', borderRadius: 8,
            padding: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#57FF9A', cursor: 'pointer',
          }}
        >
          <Menu size={20} />
        </button>

        {/* Overlay + Drawer */}
        {mobileOpen && (
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
              zIndex: 1200, display: 'flex',
            }}
          >
            <aside
              onClick={e => e.stopPropagation()}
              style={{
                width: 260, background: '#111', height: '100vh',
                display: 'flex', flexDirection: 'column',
                borderRight: '1px solid #222',
                animation: 'slideIn 0.2s ease',
              }}
            >
              {/* Header */}
              <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
                    <span style={{ color: '#57FF9A' }}>OMM</span> Tech
                  </div>
                  <div style={{ fontSize: 10, color: '#555', marginTop: 2, letterSpacing: '0.1em', textTransform: 'uppercase' }}>ERP Sistema</div>
                </div>
                <button onClick={() => setMobileOpen(false)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', padding: 4 }}>
                  <X size={20} />
                </button>
              </div>

              {/* Nav */}
              <nav style={{ flex: 1, padding: '8px 8px', overflowY: 'auto' }}>
                {filteredNav.map(({ to, icon: Icon, label }) => (
                  <NavLink key={to} to={to} end={to === '/'} style={({ isActive }) => ({
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px', borderRadius: 8, marginBottom: 2,
                    fontSize: 14, fontWeight: isActive ? 600 : 400,
                    color: isActive ? '#57FF9A' : '#888',
                    background: isActive ? 'rgba(87,255,154,0.08)' : 'transparent',
                    textDecoration: 'none',
                    border: isActive ? '1px solid rgba(87,255,154,0.15)' : '1px solid transparent',
                  })}>
                    <Icon size={18} />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </nav>

              {/* User + Sign out */}
              <div style={{ padding: '12px 16px', borderTop: '1px solid #222' }}>
                {user && (
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>{user.nombre}</div>
                )}
                <button onClick={handleSignOut} style={{
                  display: 'flex', alignItems: 'center', gap: 8, background: 'none',
                  border: 'none', color: '#666', cursor: 'pointer', fontSize: 12, padding: 0,
                }}>
                  <LogOut size={14} /> Cerrar sesión
                </button>
              </div>
            </aside>
          </div>
        )}
      </>
    )
  }

  // ─── DESKTOP: original collapsible sidebar ───
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
        {filteredNav.map(({ to, icon: Icon, label }) => (
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
        <div style={{ padding: '12px 16px', borderTop: '1px solid #222' }}>
          {user && (
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>{user.nombre}</div>
          )}
          <button onClick={handleSignOut} style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'none',
            border: 'none', color: '#555', cursor: 'pointer', fontSize: 10, padding: 0,
            transition: 'color 0.15s',
          }}
            onMouseEnter={e => (e.currentTarget.style.color = '#f66')}
            onMouseLeave={e => (e.currentTarget.style.color = '#555')}
          >
            <LogOut size={12} /> Cerrar sesión
          </button>
        </div>
      )}
    </aside>
  )
}
