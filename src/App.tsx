import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/layout/Sidebar'
import Login from './pages/Login'
import OAuthConsent from './pages/OAuthConsent'
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
import MiTrabajo from './pages/MiTrabajo'
import Mantenimiento from './pages/Mantenimiento'
import WhatsApp from './pages/WhatsApp'
import ObraApp from './obra-app/ObraApp'
import ExamenPublicoPage from './pages/ExamenPublico'
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
          {/* Examen de contratación: lo abre el candidato con su liga, sin
              cuenta. Va FUERA de ProtectedRoute a propósito: pedirle registrarse
              para contestar un examen mata la respuesta. */}
          <Route path="/examen/:token" element={<ExamenPublicoPage />} />
          {/* Consentimiento de OAuth: aqui se autoriza a una app externa a entrar
              al ERP. Va FUERA de ProtectedRoute a proposito — ProtectedRoute
              manda a /login con replace y PIERDE la URL, y con ella el
              authorization_id. La pantalla pide sesion por su cuenta y se
              regresa sola despues del login. */}
          <Route path="/oauth/consent" element={<OAuthConsent />} />
          {/* Layout principal con sidebar para el resto */}
          <Route path="/*" element={
            <ProtectedRoute>
              <div style={{ display: 'flex', background: '#0a0a0a', color: '#ccc', minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" }}>
                <Sidebar />
                <main style={{ flex: 1, overflowX: 'hidden', overflowY: 'auto', minHeight: '100vh', width: 0 }}>
                  <Routes>
                    <Route path="/" element={<Inicio />} />
                    <Route path="/tablero" element={<Dashboard />} />
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
                    {/* El menu ya lo limitaba a Administracion pero la ruta no, asi
                        que cualquiera entraba escribiendo la URL. Aqui viven CVs,
                        analisis de candidatos y referencias: datos de terceros. */}
                    <Route path="/reclutamiento" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <Reclutamiento />
                      </ProtectedRoute>
                    } />
                    <Route path="/actividades" element={<ActividadesODirectores />} />
                    <Route path="/mi-trabajo" element={<MiTrabajo />} />
                    <Route path="/documentacion" element={<Documentacion />} />
                    <Route path="/archivados" element={<Archivados />} />
                    <Route path="/clientes" element={<Clientes />} />
                    <Route path="/catalogo" element={<Catalogo />} />
                    <Route path="/design-rules" element={
                      <ProtectedRoute allowedAreas={['DG']}>
                        <DesignRules />
                      </ProtectedRoute>
                    } />
                    <Route path="/whatsapp" element={
                      <ProtectedRoute allowedAreas={['Administracion']}>
                        <WhatsApp />
                      </ProtectedRoute>
                    } />
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

// ── Sistema de trabajo por áreas, semana 3 (oct-2026) ─────────────────────
// La portada de quien trabaja en proyectos (diseñadores, dibujantes y sus
// directores) es SU lista: Mi trabajo. El tablero sigue en /tablero.
// Dirección, Administración y las áreas de campo conservan su Dashboard.
export const AREAS_CON_PORTADA_MI_TRABAJO = ['Operaciones', 'Ventas_Ingenieria']

function Inicio() {
  const { user } = useAuth()
  if (user && AREAS_CON_PORTADA_MI_TRABAJO.includes(user.permission_area)) return <MiTrabajo />
  return <Dashboard />
}

// Actividades se queda sólo para quien manda (Mi equipo, Nuevo encargo): a
// quien no dirige se le manda a Mi trabajo, que es donde está lo suyo.
function ActividadesODirectores() {
  const { user } = useAuth()
  if (user && user.permission_area !== 'DG' && user.nivel !== 'director') return <Navigate to="/mi-trabajo" replace />
  return <Actividades />
}
