import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Sidebar from './components/layout/Sidebar'
import Dashboard from './pages/Dashboard'
import CRM from './pages/CRM'
import Cotizaciones from './pages/Cotizaciones'
import Proyectos from './pages/Proyectos'
import OtrosModulos from './pages/OtrosModulos'
import Contabilidad from './pages/Contabilidad'

const Compras = () => <OtrosModulos title="Compras" />
const Reportes = () => <OtrosModulos title="Reportes de obra" />
const Cobranza = () => <OtrosModulos title="Cobranza" />
const Nomina = () => <OtrosModulos title="Nomina" />
const Entregas = () => <OtrosModulos title="Entregas" />
const Empleados = () => <OtrosModulos title="Empleados" />

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', background: '#0a0a0a', color: '#ccc', minHeight: '100vh', fontFamily: "'Inter', system-ui, sans-serif" }}>
        <Sidebar />
        <main style={{ flex: 1, overflowY: 'auto', minHeight: '100vh' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/cotizaciones" element={<Cotizaciones />} />
            <Route path="/compras" element={<Compras />} />
            <Route path="/proyectos" element={<Proyectos />} />
            <Route path="/contabilidad" element={<Contabilidad />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/nomina" element={<Nomina />} />
            <Route path="/entregas" element={<Entregas />} />
            <Route path="/empleados" element={<Empleados />} />
            <Route path="/cobranza" element={<Cobranza />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
