import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import Cotizaciones from './pages/Cotizaciones'
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
import LeadDashboard from './pages/LeadDashboard'
import ObraApp from './obra-app/ObraApp'


export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Vista PDF — sin sidebar ni layout oscuro, abre en pestaña propia */}
        <Route path="/cotizacion/:id/pdf/:format" element={<CotizacionPdf />} />
        {/* App móvil para instaladores — sin sidebar */}
        <Route path="/obra-app/*" element={<ObraApp />} />
        {/* Layout principal con sidebar para el resto */}
        <Route path="/*" element={
          <div style={{ display: 'flex', background: '#0a0a0a', color: '#ccc', minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" }}>
            <Sidebar />
            <main style={{ flex: 1, overflowY: 'auto', minHeight: '100vh' }}>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/crm" element={<CRM />} />
                <Route path="/crm/:id" element={<LeadDashboard />} />
                <Route path="/cotizaciones" element={<Cotizaciones />} />
                <Route path="/compras" element={<Compras />} />
                <Route path="/proyectos" element={<Proyectos />} />
                <Route path="/contabilidad" element={<Contabilidad />} />
                <Route path="/facturacion" element={<Facturacion />} />
                <Route path="/obra" element={<Obra />} />
                <Route path="/nomina" element={<Nomina />} />
        <Route path="/nomina/empleado/:id" element={<EmpleadoExpediente />} />
                <Route path="/entregas" element={<Entregas />} />
                <Route path="/empleados" element={<Empleados />} />
                <Route path="/finanzas" element={<Finanzas />} />
                <Route path="/clientes" element={<Clientes />} />
                <Route path="/catalogo" element={<Catalogo />} />
                <Route path="/design-rules" element={<DesignRules />} />
              </Routes>
            </main>
          </div>
        } />
      </Routes>
    </BrowserRouter>
  )
}
