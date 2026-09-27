import { Navigate, useLocation } from 'react-router-dom'
import { useAuth, PermissionArea, RESTRICTED_AREA_ROUTES, RESTRICTED_AREA_HOME } from '../contexts/AuthContext'

interface Props {
  children: React.ReactNode
  allowedAreas?: PermissionArea[]
}

export default function ProtectedRoute({ children, allowedAreas }: Props) {
  const { user, loading, signOut } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#666' }}>
        Cargando...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (!user.activo) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#f66', flexDirection: 'column', gap: 12 }}>
        <div>Tu cuenta no tiene acceso al sistema.</div>
        <button onClick={() => signOut()} style={{ background: '#333', border: 'none', color: '#ccc', padding: '8px 16px', borderRadius: 6, cursor: 'pointer' }}>
          Cerrar sesión
        </button>
      </div>
    )
  }

  // DG has access to everything
  if (user.permission_area === 'DG') {
    return <>{children}</>
  }

  // Roles restringidos (ej. Mantenimiento): solo pueden abrir rutas de su whitelist.
  // Si intentan cualquier otra ruta por URL directa, se redirigen a su home.
  //
  // OJO con el orden: antes esto hacia `return children` aqui mismo, asi que un
  // area con whitelist se saltaba por completo el chequeo de allowedAreas de
  // abajo. Hoy ningun whitelist se cruza con una ruta que tenga allowedAreas,
  // pero quedaba a UNA ruta nueva de volverse un hueco real — por ejemplo si
  // /catalogo (que esta en el whitelist de Mantenimiento) llegara a limitarse a
  // Administracion. Ahora la whitelist decide si la ruta esta permitida y el
  // allowedAreas se sigue evaluando despues.
  const whitelist = RESTRICTED_AREA_ROUTES[user.permission_area]
  if (whitelist) {
    const path = location.pathname
    const permitido = whitelist.some(p => path === p || path.startsWith(p + '/'))
    if (!permitido) {
      return <Navigate to={RESTRICTED_AREA_HOME[user.permission_area] || whitelist[0]} replace />
    }
  }

  // Check specific area permissions
  if (allowedAreas && !allowedAreas.includes(user.permission_area)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#f66' }}>
        No tienes permisos para ver esta sección.
      </div>
    )
  }

  return <>{children}</>
}
