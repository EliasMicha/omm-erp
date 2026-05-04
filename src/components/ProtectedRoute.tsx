import { Navigate } from 'react-router-dom'
import { useAuth, PermissionArea } from '../contexts/AuthContext'

interface Props {
  children: React.ReactNode
  allowedAreas?: PermissionArea[]
}

export default function ProtectedRoute({ children, allowedAreas }: Props) {
  const { user, profile, loading, signOut } = useAuth()

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

  // If profile not loaded yet or user inactive
  if (!profile || !profile.activo) {
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
  if (profile.permission_area === 'DG') {
    return <>{children}</>
  }

  // Check specific area permissions
  if (allowedAreas && !allowedAreas.includes(profile.permission_area)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#f66' }}>
        No tienes permisos para ver esta sección.
      </div>
    )
  }

  return <>{children}</>
}
