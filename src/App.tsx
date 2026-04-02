import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
  import Sidebar from './components/layout/Sidebar'
    import Dashboard from './pages/Dashboard'
      import CRM from './pages/CRM'
        import Cotizaciones from './pages/Cotizaciones'
          import Proyectos from './pages/Proyectos'
            import { Reportes, Nomina, Entregas } from './pages/OtrosModulos'
              
export default function App() {
    return (
          <BrowserRouter>
                <div style={{
                    display: 'flex',
                    minHeight: '100vh',
                    background: '#0a0a0a',
                    color: '#ccc',
                    fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif",
          }}>
                        <Sidebar />
                        <main style={{ flex: 1, overflowY: 'auto' }}>
                                  <Routes>
                                              <Route path="/" element={<Dashboard />} />
                                              <Route path="/crm" element={<CRM />} />
                                              <Route path="/cotizaciones" element={<Cotizaciones />} />
                                              <Route path="/proyectos" element={<Proyectos />} />
                                              <Route path="/reportes" element={<Reportes />} />
                                              <Route path="/nomina" element={<Nomina />} />
                                              <Route path="/entregas" element={<Entregas />} />
                                  </Routes>Routes>
                        </main>main>
                </div>div>
          </BrowserRouter>BrowserRouter>
        )
}</BrowserRouter>import Sidebar from './components/layout/Sidebar'
import Dashboard from './pages/Dashboard'
import Cotizaciones from './pages/Cotizaciones'
import Proyectos from './pages/Proyectos'
import { Reportes, Nomina, Entregas } from './pages/OtrosModulos'

export default function App() {
  return (
    <BrowserRouter>
      <div style={{
        display: 'flex',
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#ccc',
        fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif",
      }}>
        <Sidebar />
        <main style={{ flex: 1, overflowY: 'auto' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cotizaciones" element={<Cotizaciones />} />
            <Route path="/proyectos" element={<Proyectos />} />
            <Route path="/reportes" element={<Reportes />} />
            <Route path="/nomina" element={<Nomina />} />
            <Route path="/entregas" element={<Entregas />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
