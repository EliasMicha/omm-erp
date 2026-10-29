import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Sidebar from './components/layout/Sidebar'
import Login from './pages/Login'

// ── Carga por demanda (oct-2026) ──────────────────────────────────────────
// Antes todas las páginas iban en UN archivo de 4.4 MB: abrir el CRM bajaba e
// interpretaba también Contabilidad, Nómina, los PDFs, etc. Ahora cada página
// se baja cuando se abre por primera vez.
//
// Gotcha de Vercel: cada deploy cambia el nombre de los archivos. Quien tenía
// el ERP abierto desde antes pide un archivo que ya no existe y React truena
// con "Failed to fetch dynamically imported module". Ahí se recarga la página
// UNA vez (la marca en sessionStorage evita un ciclo si el error es otro).
function cargarPagina(importar: () => Promise<any>) {
  return lazy(() => importar().then((m: any) => {
    try { sessionStorage.removeItem('omm_recarga_chunk') } catch { /* sin storage */ }
    return m
  }).catch((err: any) => {
    let yaRecargo = false
    try { yaRecargo = sessionStorage.getItem('omm_recarga_chunk') === '1' } catch { /* sin storage */ }
    if (!yaRecargo) {
      try { sessionStorage.setItem('omm_recarga_chunk', '1') } catch { /* sin storage */ }
      window.location.reload()
      return new Promise(() => { /* la página se está recargando */ })
    }
    throw err
  }))
}

function Cargando() {
  return (
    <div style={{ padding: 40, color: '#666', fontSize: 13, fontFamily: "'Inter', system-ui, sans-serif" }}>
      Cargando…
    </div>
  )
}

const OAuthConsent = cargarPagina(() => import('./pages/OAuthConsent'))
const Dashboard = cargarPagina(() => import('./pages/Dashboard'))
const CRM = cargarPagina(() => import('./pages/CRM'))
const Cotizaciones = cargarPagina(() => import('./pages/Cotizaciones'))
const EstimacionEditor = cargarPagina(() => import('./pages/EstimacionEditor'))
const Proyectos = cargarPagina(() => import('./pages/Proyectos'))
const Contabilidad = cargarPagina(() => import('./pages/Contabilidad'))
const Clientes = cargarPagina(() => import('./pages/Clientes'))
const Catalogo = cargarPagina(() => import('./pages/Catalogo'))
const Compras = cargarPagina(() => import('./pages/Compras'))
const Obra = cargarPagina(() => import('./pages/Obra'))
const Entregas = cargarPagina(() => import('./pages/Entregas'))
const Facturacion = cargarPagina(() => import('./pages/Facturacion'))
const DesignRules = cargarPagina(() => import('./pages/DesignRules'))
const Nomina = cargarPagina(() => import('./pages/Nomina'))
const Finanzas = cargarPagina(() => import('./pages/Finanzas'))
const Empleados = cargarPagina(() => import('./pages/Empleados'))
const EmpleadoExpediente = cargarPagina(() => import('./pages/EmpleadoExpediente'))
const CotizacionPdf = cargarPagina(() => import('./pages/CotizacionPdf'))
const MemoriaTecnica = cargarPagina(() => import('./pages/MemoriaTecnica'))
const LeadDashboard = cargarPagina(() => import('./pages/LeadDashboard'))
const RadarVentas = cargarPagina(() => import('./components/RadarVentas'))
const Cobranza = cargarPagina(() => import('./pages/Cobranza'))
const Usuarios = cargarPagina(() => import('./pages/Usuarios'))
const Archivados = cargarPagina(() => import('./pages/Archivados'))
const Desempeno = cargarPagina(() => import('./pages/Desempeno'))
const Capacitaciones = cargarPagina(() => import('./pages/Capacitaciones'))
const Reclutamiento = cargarPagina(() => import('./pages/Reclutamiento'))
const Documentacion = cargarPagina(() => import('./pages/Documentacion'))
const MiTrabajo = cargarPagina(() => import('./pages/MiTrabajo'))
const Mantenimiento = cargarPagina(() => import('./pages/Mantenimiento'))
const WhatsApp = cargarPagina(() => import('./pages/WhatsApp'))
const WhatsAppApp = cargarPagina(() => import('./pages/WhatsAppApp'))
const Privacidad = cargarPagina(() => import('./pages/Privacidad'))
const ObraApp = cargarPagina(() => import('./obra-app/ObraApp'))
const ExamenPublicoPage = cargarPagina(() => import('./pages/ExamenPublico'))
const ChatBot = cargarPagina(() => import('./components/ChatBot'))

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Suspense fallback={<Cargando />}>
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
          {/* WhatsApp como app del celular: pantalla completa, sin sidebar.
              Misma regla de acceso que /whatsapp. */}
          <Route path="/wa" element={
            <ProtectedRoute allowedAreas={['Administracion']}>
              <WhatsAppApp />
            </ProtectedRoute>
          } />
          {/* Aviso de privacidad público: lo pide Meta para publicar la app de WhatsApp. */}
          <Route path="/privacidad" element={<Privacidad />} />
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
                  <Suspense fallback={<Cargando />}>
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
                    <Route path="/actividades" element={<ActividadesRetirada />} />
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
                  </Suspense>
                </main>
                <Suspense fallback={null}><ChatBot /></Suspense>
              </div>
            </ProtectedRoute>
          } />
        </Routes>
        </Suspense>
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

// Actividades se retiró (sistema de trabajo por áreas): "Mi equipo" y "Nuevo
// encargo" viven ahora en Mi trabajo. La ruta vieja manda ahí, a "Mi equipo";
// quien no dirige cae en su lista.
function ActividadesRetirada() {
  return <Navigate to="/mi-trabajo?vista=equipo" replace />
}
