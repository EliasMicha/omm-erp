import { Navigate } from 'react-router-dom'
import { useAuth, PermissionArea } from '../contexts/AuthContext'

interface Props {
  children: React.ReactNode
  allowedAreas?: PermissionArea[]
}

export default function ProtectedRoute({ children, allowedAreas }: Props) {
  const { user, loading, signOut } = useAuth()

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
