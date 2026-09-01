import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/layout/Sidebar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import Cotizaciones from './pages/Cotizaciones'
import EstimacionEditor from './pages/EstimacionEditor'
import Proyectos from './pages/Proyectos'
import OtrosModulos from './pages/OtrosModulos'
import Contabilidad from './pages/Contabilidad'
import Clientes from './pages/Clientes'
import Catalogo from './pages/Catalogo'
import Compras from './pages/Compras'
import Obra from './pages/Obra'
import Entregas from './pages/Entregas'
import Facturacion from './pages/Facturacion'
import DesignRules from './pages/DesignRules'
import Nomina from './pages/Nomina'
import Finanzas from './pages/Finanzas'
import Empleados from './pages/Empleados'
import EmpleadoExpediente from './pages/EmpleadoExpediente'
import CotizacionPdf from './pages/CotizacionPdf'
import MemoriaTecnica from './pages/MemoriaTecnica'
import LeadDashboard from './pages/LeadDashboard'
import RadarVentas from './components/RadarVentas'
import Cobranza from './pages/Cobranza'
import Usuarios from './pages/Usuarios'
import Archivados from './pages/Archivados'
import Desempeno from './pages/Desempeno'
import Capacitaciones from './pages/Capacitaciones'
import Reclutamiento from './pages/Reclutamiento'
import Documentacion from './pages/Documentacion'
import Actividades from './pages/Actividades'
import Mantenimiento from './pages/Mantenimiento'
import ObraApp from './obra-app/ObraApp'
import ChatBot from './components/ChatBot'


export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Login — sin protección */}
          <Route path="/login" element={<Login />} />
          {/* Vista PDF — sin sidebar ni layout oscuro, abre en pestaña propia */}
          <Route path="/cotizacion/:id/pdf/:format" element={<CotizacionPdf />} />
          <Route path="/cotizacion/:id/memoria-tecnica" element={<MemoriaTecnica />} />
          {/* App móvil para instaladores — sin sidebar */}
          <Route path="/obra-app/*" element={<ObraApp />} />
          {/* Layout principal con sidebar para el resto */}
          <Route path="/*" element={
            <ProtectedRoute>
              <div style={{ display: 'flex', background: '#0a0a0a', color: '#ccc', minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" }}>
                <Sidebar />
                <main style={{ flex: 1, overflowX: 'hidden', overflowY: 'auto', minHeight: '100vh', width: 0 }}>
                  <Routes>
                    <Route path="/" element={<Dashboard />} />
                    <Route path="/radar-ventas" element={<RadarVentas mode="detail" />} />
                    <Route path="/crm" element={<CRM />} />
                    <Route path="/cobranza" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <Cobranza />
                      </ProtectedRoute>
                    } />
                    <Route path="/crm/:id" element={<LeadDashboard />} />
                    <Route path="/cotizaciones" element={<Cotizaciones />} />
                    <Route path="/estimacion/:id" element={<EstimacionEditor />} />
                    <Route path="/compras" element={<Compras />} />
                    <Route path="/proyectos" element={<Proyectos />} />
                    <Route path="/contabilidad" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <Contabilidad />
                      </ProtectedRoute>
                    } />
                    <Route path="/facturacion" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <Facturacion />
                      </ProtectedRoute>
                    } />
                    <Route path="/obra" element={<Obra />} />
                    <Route path="/nomina" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <Nomina />
                      </ProtectedRoute>
                    } />
                    <Route path="/nomina/empleado/:id" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <EmpleadoExpediente />
                      </ProtectedRoute>
                    } />
                    <Route path="/mantenimiento" element={<Mantenimiento />} />
                    <Route path="/entregas" element={<Entregas />} />
                    <Route path="/empleados" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <Empleados />
                      </ProtectedRoute>
                    } />
                    <Route path="/finanzas" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <Finanzas />
                      </ProtectedRoute>
                    } />
                    <Route path="/desempeno" element={<Desempeno />} />
                    <Route path="/capacitaciones" element={<Capacitaciones />} />
                    <Route path="/reclutamiento" element={<Reclutamiento />} />
                    <Route path="/actividades" element={<Actividades />} />
                    <Route path="/documentacion" element={<Documentacion />} />
                    <Route path="/archivados" element={<Archivados />} />
                    <Route path="/clientes" element={<Clientes />} />
                    <Route path="/catalogo" element={<Catalogo />} />
                    <Route path="/design-rules" element={<DesignRules />} />
                    <Route path="/usuarios" element={
                      <ProtectedRoute allowedAreas={[]}>
                        <Usuarios />
                      </ProtectedRoute>
                    } />
                  </Routes>
                </main>
                <ChatBot />
              </div>
            </ProtectedRoute>
          } />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
