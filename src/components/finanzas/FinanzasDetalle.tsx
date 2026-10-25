// Pestañas de detalle de Finanzas: cartera, cuentas por pagar, por área y
// calidad de datos.
import { useEffect, useMemo, useState, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { tcForYear } from '../../lib/fx'
import {
  TableroRaw, Mes, LineaRaw, CarteraLead, CxpOc, PorConfirmar,
  cargarTablero, fmtM, fmt$, fmtPct, NOMBRE_LINEA,
} from '../../lib/finanzasTablero'
import { BarrasH, Leyenda, COLOR } from './Graficas'
import { Tarjeta, Indicador, Rejilla, Nota, Pildora, ESTADO_COLOR, thS, tdS } from './Piezas'

const TC_HOY = tcForYear(new Date().getFullYear())

function eq(v: number, cur: string): number {
  return cur === 'usd' ? v * TC_HOY : v
}

function diasDesde(f: string | null): number | null {
  if (!f) return null
  const d = new Date(f + 'T12:00:00')
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

function fechaCorta(f: string | null): string {
  if (!f) return '—'
  const d = new Date(f + 'T12:00:00')
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: '2-digit' })
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontWeight: 600,
      border: '1px solid ' + (activo ? '#10B981' : '#2a2a2a'), background: activo ? '#10B98118' : 'transparent',
      color: activo ? '#10B981' : '#a9a8a1',
    }}>{children}</button>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// CARTERA POR COBRAR
// ═══════════════════════════════════════════════════════════════════════
const ESTADOS_CARTERA: { id: string; nombre: string; color: string; desc: string }[] = [
  { id: 'al_corriente', nombre: 'Al corriente', color: ESTADO_COLOR.bueno, desc: 'cobro en los últimos 90 días' },
  { id: 'lenta', nombre: 'Lenta', color: ESTADO_COLOR.alerta, desc: '3 a 6 meses sin cobrar' },
  { id: 'parada', nombre: 'Parada', color: ESTADO_COLOR.critico, desc: 'más de 6 meses sin cobrar' },
  { id: 'sin_cobro', nombre: 'Sin cobro aún', color: ESTADO_COLOR.neutro, desc: 'contrato sin ningún pago registrado' },
]

export function TabCartera({ raw, nominaMensual }: { raw: TableroRaw; nominaMensual: number }) {
  const [filtro, setFiltro] = useState('todos')
  const leads = raw.cartera.leads
  const porEstado = ESTADOS_CARTERA.map(e => {
    let mxn = 0, usd = 0, n = 0
    raw.cartera.resumen.filter(r => r.estado === e.id).forEach(r => {
      if (r.cur === 'usd') usd += r.saldo; else mxn += r.saldo
      n += r.leads
    })
    return { ...e, mxn, usd, n, total: mxn + usd * TC_HOY }
  })
  const total = porEstado.reduce((s, e) => s + e.total, 0)
  const ordenados = useMemo(() => leads.slice().sort((a, b) => eq(b.saldo, b.cur) - eq(a.saldo, a.cur)), [leads])
  const visibles = filtro === 'todos' ? ordenados : ordenados.filter(l => l.estado === filtro)
  const colorDe = (estado: string) => (ESTADOS_CARTERA.find(e => e.id === estado) || ESTADOS_CARTERA[3]).color

  return (
    <div>
      <Rejilla cols={4}>
        {porEstado.map(e => (
          <Indicador key={e.id} etiqueta={e.nombre} valor={fmtM(e.total)}
            detalle={<>{fmtPct(total ? e.total / total : 0, 0)} de la cartera · {e.n} cliente{e.n === 1 ? '' : 's'} · {e.desc}<br />{fmt$(e.mxn)} MXN + {fmt$(e.usd)} USD</>} />
        ))}
      </Rejilla>

      <Tarjeta titulo={`Cartera por cobrar: ${fmtM(total)}`}
        subtitulo={`Lo contratado menos lo cobrado, por cliente y moneda. Se mide por cliente (lead), no por cotización: muchos pagos se registran contra la obra y no contra una cotización en particular.${nominaMensual > 0 ? ` Equivale a ${(total / nominaMensual).toFixed(1)} meses de nómina.` : ''}`}>
        <Leyenda items={ESTADOS_CARTERA.map(e => ({ nombre: e.nombre, color: e.color }))} />
        <BarrasH formato={fmtM}
          filas={ordenados.slice(0, 15).map(l => ({
            etiqueta: l.lead + (l.cur === 'usd' ? ' (USD)' : ''),
            valor: eq(l.saldo, l.cur),
            color: colorDe(l.estado),
            nota: `${fmtPct(l.vendido ? l.cobrado / l.vendido : 0, 0)} cobrado · último cobro ${fechaCorta(l.ultimo_cobro)}`,
          }))} />
      </Tarjeta>

      <Tarjeta titulo="Detalle por cliente" accion={
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip activo={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos ({leads.length})</Chip>
          {ESTADOS_CARTERA.map(e => (
            <Chip key={e.id} activo={filtro === e.id} onClick={() => setFiltro(e.id)}>{e.nombre}</Chip>
          ))}
        </div>
      }>
        <TablaCartera filas={visibles} />
      </Tarjeta>
    </div>
  )
}

function TablaCartera({ filas }: { filas: CarteraLead[] }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
        <thead>
          <tr>
            <th style={{ ...thS, textAlign: 'left' }}>Cliente</th>
            <th style={thS}>Contratos</th>
            <th style={thS}>Vendido</th>
            <th style={thS}>Cobrado</th>
            <th style={thS}>% cobrado</th>
            <th style={thS}>Por cobrar</th>
            <th style={thS}>Último cobro</th>
            <th style={{ ...thS, textAlign: 'left' }}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(l => {
            const e = ESTADOS_CARTERA.find(x => x.id === l.estado) || ESTADOS_CARTERA[3]
            const dias = diasDesde(l.ultimo_cobro)
            return (
              <tr key={l.lead_id + l.cur}>
                <td style={{ ...tdS, textAlign: 'left', whiteSpace: 'normal' }}>
                  <Link to={'/crm/' + l.lead_id} style={{ color: '#e8e7e3', textDecoration: 'none' }}>{l.lead}</Link>
                  {l.clave && <span style={{ color: '#77766f', fontSize: 10.5, marginLeft: 6 }}>{l.clave}</span>}
                </td>
                <td style={tdS}>{l.contratos}</td>
                <td style={tdS}>{fmt$(l.vendido)} <span style={{ color: '#77766f', fontSize: 10 }}>{l.cur.toUpperCase()}</span></td>
                <td style={tdS}>{fmt$(l.cobrado)}</td>
                <td style={tdS}>{fmtPct(l.vendido ? l.cobrado / l.vendido : 0, 0)}</td>
                <td style={{ ...tdS, fontWeight: 700, color: '#fff' }}>{fmt$(l.saldo)}</td>
                <td style={{ ...tdS, color: '#a9a8a1' }}>{l.ultimo_cobro ? `${fechaCorta(l.ultimo_cobro)} · hace ${dias} d` : '—'}</td>
                <td style={{ ...tdS, textAlign: 'left' }}><Pildora texto={e.nombre} color={e.color} /></td>
              </tr>
            )
          })}
          {filas.length === 0 && <tr><td colSpan={8} style={{ ...tdS, textAlign: 'center', color: '#555', padding: 24 }}>Nada en este filtro.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// CUENTAS POR PAGAR
// ═══════════════════════════════════════════════════════════════════════
const BUCKETS_CXP: { id: string; nombre: string; color: string; desc: string }[] = [
  { id: 'vencida', nombre: 'Vencidas', color: ESTADO_COLOR.critico, desc: 'ya pasó su fecha límite de pago' },
  { id: 'semana', nombre: 'Esta semana', color: ESTADO_COLOR.alerta, desc: 'vencen en 7 días o menos' },
  { id: 'mes', nombre: 'Este mes', color: COLOR.proveedores, desc: 'vencen en 8 a 30 días' },
  { id: 'despues', nombre: 'Después', color: COLOR.vendido, desc: 'vencen en más de 30 días' },
  { id: 'sin_fecha', nombre: 'Sin fecha límite', color: ESTADO_COLOR.neutro, desc: 'OC emitida sin fecha máxima de pago' },
  { id: 'por_aprobar', nombre: 'Por aprobar', color: '#55544f', desc: 'OC en borrador: todavía no es deuda' },
]

export function TabCxp({ raw }: { raw: TableroRaw }) {
  const [verBorradores, setVerBorradores] = useState(false)
  const porBucket = BUCKETS_CXP.map(b => {
    let mxn = 0, usd = 0, n = 0
    raw.cxp.resumen.filter(r => r.bucket === b.id).forEach(r => { if (r.cur === 'usd') usd += r.saldo; else mxn += r.saldo; n += r.n })
    return { ...b, mxn, usd, n, total: mxn + usd * TC_HOY }
  })
  const emitidas = porBucket.filter(b => b.id !== 'por_aprobar').reduce((s, b) => s + b.total, 0)
  const ocs = raw.cxp.ocs.filter(o => verBorradores || o.bucket !== 'por_aprobar')
    .slice().sort((a, b) => BUCKETS_CXP.findIndex(x => x.id === a.bucket) - BUCKETS_CXP.findIndex(x => x.id === b.bucket) || eq(b.saldo, b.cur) - eq(a.saldo, a.cur))
  const porProveedor: Record<string, number> = {}
  raw.cxp.ocs.filter(o => o.bucket !== 'por_aprobar').forEach(o => {
    const k = o.proveedor || 'Sin proveedor'
    porProveedor[k] = (porProveedor[k] || 0) + eq(o.saldo, o.cur)
  })
  const topProv = Object.keys(porProveedor).map(k => ({ etiqueta: k, valor: porProveedor[k] })).sort((a, b) => b.valor - a.valor).slice(0, 10)

  return (
    <div>
      <Rejilla cols={3}>
        {porBucket.map(b => (
          <Indicador key={b.id} etiqueta={b.nombre} valor={fmtM(b.total)}
            detalle={<>{b.n} OC · {b.desc}<br />{fmt$(b.mxn)} MXN + {fmt$(b.usd)} USD</>}
            estado={b.id === 'vencida' && b.total > 0 ? 'critico' : undefined}
            estadoTexto={b.id === 'vencida' && b.total > 0 ? 'Pagar ya' : undefined} />
        ))}
      </Rejilla>

      <Tarjeta titulo={`Deuda con proveedores: ${fmtM(emitidas)}`}
        subtitulo="Órdenes de compra aprobadas, pedidas o recibidas cuyo saldo no se ha pagado (total de la OC menos los pagos registrados en ella). Las OC en borrador se muestran aparte porque todavía no son compromiso.">
        <BarrasH formato={fmtM} filas={topProv.map(p => ({ ...p, color: COLOR.proveedores }))} />
      </Tarjeta>

      <Tarjeta titulo="Órdenes de compra por pagar" accion={
        <div style={{ display: 'flex', gap: 6 }}>
          <Chip activo={!verBorradores} onClick={() => setVerBorradores(false)}>Solo emitidas</Chip>
          <Chip activo={verBorradores} onClick={() => setVerBorradores(true)}>Incluir borradores</Chip>
          <Link to="/compras" style={{ fontSize: 11, color: '#10B981', alignSelf: 'center', marginLeft: 6 }}>Ir a Compras →</Link>
        </div>
      }>
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: 'left' }}>Folio</th>
                <th style={{ ...thS, textAlign: 'left' }}>Proveedor</th>
                <th style={{ ...thS, textAlign: 'left' }}>Obra</th>
                <th style={thS}>Total</th>
                <th style={thS}>Pagado</th>
                <th style={thS}>Saldo</th>
                <th style={thS}>Fecha límite</th>
                <th style={{ ...thS, textAlign: 'left' }}>Situación</th>
              </tr>
            </thead>
            <tbody>
              {ocs.map((o: CxpOc) => {
                const b = BUCKETS_CXP.find(x => x.id === o.bucket) || BUCKETS_CXP[4]
                return (
                  <tr key={o.id}>
                    <td style={{ ...tdS, textAlign: 'left', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{o.folio || '—'}</td>
                    <td style={{ ...tdS, textAlign: 'left', whiteSpace: 'normal' }}>{o.proveedor || '—'}</td>
                    <td style={{ ...tdS, textAlign: 'left', whiteSpace: 'normal', color: '#a9a8a1' }}>{o.lead || '—'}</td>
                    <td style={tdS}>{fmt$(o.total)} <span style={{ color: '#77766f', fontSize: 10 }}>{o.cur.toUpperCase()}</span></td>
                    <td style={tdS}>{fmt$(o.pagado)}</td>
                    <td style={{ ...tdS, fontWeight: 700, color: '#fff' }}>{fmt$(o.saldo)}</td>
                    <td style={tdS}>{fechaCorta(o.fecha_maxima_pago)}</td>
                    <td style={{ ...tdS, textAlign: 'left' }}><Pildora texto={b.nombre} color={b.color} /></td>
                  </tr>
                )
              })}
              {ocs.length === 0 && <tr><td colSpan={8} style={{ ...tdS, textAlign: 'center', color: '#555', padding: 24 }}>Sin OC por pagar.</td></tr>}
            </tbody>
          </table>
        </div>
        <Nota>
          Solo cuenta lo que pasa por órdenes de compra. Los pagos a proveedor que se hacen sin OC no generan deuda aquí; si una OC aparece
          con saldo pero ya se pagó, registra el pago en la OC (Compras) o márcala como pagada.
        </Nota>
      </Tarjeta>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// POR ÁREA (línea de negocio)
// ═══════════════════════════════════════════════════════════════════════
const ORDEN_LINEAS = ['esp', 'elec', 'ilum', 'cort', 'dist', 'proy_esp', 'proy_elec', 'sin_liga', 'estructura', 'otras_empresas']

export function TabAreas({ meses, desde, hasta }: { meses: Mes[]; desde: string; hasta: string }) {
  // La contribución resta la nómina de cada área, y la nómina por empleado
  // solo existe en los meses cerrados del módulo de nómina. Si se tomara el
  // periodo completo, la cobranza de 12 meses se compararía contra 4 meses de
  // nómina y todas las áreas saldrían infladas. Por eso la ventana se recorta
  // a los meses del periodo con nómina cerrada (y sin el mes en curso).
  const ventana = useMemo(() => {
    const ok = meses.filter(m => m.mes >= desde && m.mes <= hasta && m.nominaCerrada && !m.enCurso)
    if (ok.length === 0) return null
    return { desde: ok[0].mes, hasta: ok[ok.length - 1].mes, n: ok.length, etiqueta: ok[0].etiqueta + (ok.length > 1 ? ' a ' + ok[ok.length - 1].etiqueta : '') }
  }, [meses, desde, hasta])
  const [lineas, setLineas] = useState<LineaRaw[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!ventana) return
    let vivo = true
    setLineas(null)
    setError('')
    cargarTablero(ventana.desde + '-01', ventana.hasta + '-01')
      .then(r => { if (vivo) setLineas(r.lineas) })
      .catch((e: any) => { if (vivo) setError(e?.message || String(e)) })
    return () => { vivo = false }
  }, [ventana && ventana.desde, ventana && ventana.hasta])

  if (!ventana) return (
    <Tarjeta titulo="Contribución por área">
      <Nota>El periodo elegido no tiene meses con la nómina cerrada en el módulo de nómina, así que no se puede restar la nómina de cada área. Elige «6 meses», «12 meses» o «Año en curso».</Nota>
    </Tarjeta>
  )
  if (error) return <Nota>No se pudo cargar: {error}</Nota>
  if (!lineas) return <div style={{ padding: 30, color: '#555', fontSize: 12 }}>Cargando áreas…</div>

  const tc = tcForYear(Number(ventana.hasta.slice(0, 4)))
  const filas = lineas.map(l => {
    const cobrado = l.cobrado_mxn + l.cobrado_usd * tc
    const proveedores = l.proveedores_mxn + l.proveedores_usd * tc
    const vendido = l.vendido_mxn + l.vendido_usd * tc
    return { linea: l.linea, nombre: NOMBRE_LINEA[l.linea] || l.linea, vendido, cobrado, proveedores, nomina: l.nomina, personas: l.personas, contribucion: cobrado - proveedores - l.nomina }
  }).sort((a, b) => {
    const ia = ORDEN_LINEAS.indexOf(a.linea), ib = ORDEN_LINEAS.indexOf(b.linea)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  const tot = filas.reduce((s, f) => ({
    vendido: s.vendido + f.vendido, cobrado: s.cobrado + f.cobrado, proveedores: s.proveedores + f.proveedores,
    nomina: s.nomina + f.nomina, personas: s.personas + f.personas, contribucion: s.contribucion + f.contribucion,
  }), { vendido: 0, cobrado: 0, proveedores: 0, nomina: 0, personas: 0, contribucion: 0 })

  return (
    <div>
      <Tarjeta titulo={`Contribución por área · ${ventana.etiqueta}`}
        subtitulo={`Lo que cobró cada área menos lo que pagó a sus proveedores y su propia nómina. Si un área queda en negativo, la están financiando las demás. Calculado sobre ${ventana.n} mes${ventana.n === 1 ? '' : 'es'} (${ventana.etiqueta}): solo los meses con la nómina cerrada en el módulo, para comparar cobranza y nómina del mismo periodo. Entre más meses, más confiable: la cobranza no es lineal y el gasto llega antes que el cobro.`}>
        <BarrasH formato={fmtM}
          filas={filas.map(f => ({
            etiqueta: f.nombre, valor: f.contribucion,
            nota: `Cobrado ${fmtM(f.cobrado)} − proveedores ${fmtM(f.proveedores)} − nómina ${fmtM(f.nomina)}`,
          }))} />
      </Tarjeta>

      <Tarjeta titulo="Detalle por área">
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: 'left' }}>Área</th>
                <th style={thS}>Vendido</th>
                <th style={thS}>Cobrado</th>
                <th style={thS}>Proveedores</th>
                <th style={thS}>Nómina</th>
                <th style={thS} title="Personas distintas que cobraron nómina en el periodo, incluidas altas y bajas">Personas*</th>
                <th style={thS}>Contribución</th>
                <th style={thS}>Nómina ÷ cobrado</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.linea}>
                  <td style={{ ...tdS, textAlign: 'left', color: '#e8e7e3' }}>{f.nombre}</td>
                  <td style={tdS}>{f.vendido ? fmtM(f.vendido) : '—'}</td>
                  <td style={tdS}>{f.cobrado ? fmtM(f.cobrado) : '—'}</td>
                  <td style={tdS}>{f.proveedores ? fmtM(f.proveedores) : '—'}</td>
                  <td style={tdS}>{f.nomina ? fmtM(f.nomina) : '—'}</td>
                  <td style={tdS}>{f.personas || '—'}</td>
                  <td style={{ ...tdS, fontWeight: 700, color: f.contribucion < 0 ? '#e66767' : '#7fd17f' }}>{fmtM(f.contribucion)}</td>
                  <td style={tdS}>{f.cobrado > 0 && f.nomina > 0 ? fmtPct(f.nomina / f.cobrado, 0) : '—'}</td>
                </tr>
              ))}
              <tr style={{ background: '#1a1a1a' }}>
                <td style={{ ...tdS, textAlign: 'left', fontWeight: 700, color: '#fff' }}>Total</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtM(tot.vendido)}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtM(tot.cobrado)}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtM(tot.proveedores)}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtM(tot.nomina)}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{tot.personas}</td>
                <td style={{ ...tdS, fontWeight: 700, color: tot.contribucion < 0 ? '#e66767' : '#7fd17f' }}>{fmtM(tot.contribucion)}</td>
                <td style={tdS}>{tot.cobrado > 0 ? fmtPct(tot.nomina / tot.cobrado, 0) : '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <Nota>
          Cobros y pagos se asignan al área por la cotización a la que están ligados. «Sin liga a cotización» es dinero que no trae
          cotización (se puede ligar en Conciliación). La nómina sale del módulo de nómina según el área de cada empleado, así que solo
          cubre los meses cerrados ahí (desde julio de 2026). Proyecto de iluminación va junto con Iluminación
          porque es el mismo equipo. «Nómina de NULED / Casa Luce» son personas pagadas por OMM que trabajan para esas empresas.
          *Personas = distintas que cobraron en el periodo, con altas y bajas; por eso suma más que la plantilla de un mes.
          Un depósito de cliente ligado a una cotización cuenta como cobro aunque en Conciliación esté como «pago a proveedor».
          Si un área se ve con margen muy alto (p. ej. Distribución), revisa que sus pagos a proveedor estén ligados a su cotización:
          los que no, caen en «Sin liga».
        </Nota>
      </Tarjeta>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// CALIDAD DE DATOS
// ═══════════════════════════════════════════════════════════════════════
const NOMBRE_CUENTA: Record<string, string> = {
  '0118270236': 'BBVA pesos',
  '0119196919': 'BBVA dólares',
  '1263311182': 'Banorte pesos',
}

export function TabDatos({ raw, meses, onCambio }: { raw: TableroRaw; meses: Mes[]; onCambio: () => void }) {
  const fuentes = [
    ...raw.frescura.cuentas.map(c => ({ nombre: (NOMBRE_CUENTA[c.cuenta] || c.cuenta) + ' · ' + c.cuenta.slice(-4), ultimo: c.ultimo, que: 'Estado de cuenta cargado en Conciliación' })),
    { nombre: 'Caja (efectivo)', ultimo: raw.frescura.efectivo, que: 'Movimientos de efectivo en Contabilidad' },
    { nombre: 'Nómina', ultimo: raw.frescura.nomina, que: 'Último periodo en el módulo de nómina' },
  ]
  return (
    <div>
      <Tarjeta titulo="¿Qué tan al día está la información?"
        subtitulo="Finanzas solo es tan bueno como lo que está cargado. Si una cuenta lleva días sin movimientos, sus cobros y pagos no aparecen en el tablero.">
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
            <thead><tr>
              <th style={{ ...thS, textAlign: 'left' }}>Fuente</th>
              <th style={thS}>Último dato</th>
              <th style={{ ...thS, textAlign: 'left' }}>Estado</th>
              <th style={{ ...thS, textAlign: 'left' }}>De dónde viene</th>
            </tr></thead>
            <tbody>
              {fuentes.map(f => {
                const d = diasDesde(f.ultimo)
                const est = d === null ? 'critico' : d <= 7 ? 'bueno' : d <= 15 ? 'alerta' : 'critico'
                const txt = d === null ? 'Sin datos' : d < 0 ? 'Al día' : d <= 7 ? `Al día (hace ${d} d)` : `${d} días sin cargar`
                return (
                  <tr key={f.nombre}>
                    <td style={{ ...tdS, textAlign: 'left', color: '#e8e7e3' }}>{f.nombre}</td>
                    <td style={tdS}>{fechaCorta(f.ultimo)}</td>
                    <td style={{ ...tdS, textAlign: 'left' }}><Pildora texto={txt} color={ESTADO_COLOR[est]} /></td>
                    <td style={{ ...tdS, textAlign: 'left', color: '#77766f' }}>{f.que}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Clasificación de las salidas, mes por mes"
        subtitulo="Cuánto de lo que salió del banco no tiene categoría. Mientras más alto, menos confiables son los indicadores de proveedores y nómina de ese mes (el flujo total sí es correcto). Meta: menos de 1%.">
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
            <thead><tr>
              <th style={{ ...thS, textAlign: 'left' }}>Mes</th>
              <th style={thS}>Salidas operativas</th>
              <th style={thS}>Sin clasificar</th>
              <th style={thS}>%</th>
              <th style={thS}>Nómina (módulo)</th>
              <th style={thS}>Nómina (banco + caja)</th>
              <th style={{ ...thS, textAlign: 'left' }}>Nómina</th>
            </tr></thead>
            <tbody>
              {meses.slice().reverse().map(m => {
                const pct = m.egresosOperativos > 0 ? m.sinClasificar / m.egresosOperativos : 0
                const est = pct < 0.01 ? 'bueno' : pct < 0.1 ? 'alerta' : 'critico'
                return (
                  <tr key={m.mes}>
                    <td style={{ ...tdS, textAlign: 'left', color: '#e8e7e3' }}>{m.etiqueta}{m.enCurso ? ' (en curso)' : ''}</td>
                    <td style={tdS}>{fmtM(m.egresosOperativos)}</td>
                    <td style={tdS}>{fmtM(m.sinClasificar)}</td>
                    <td style={tdS}><Pildora texto={fmtPct(pct, 0)} color={ESTADO_COLOR[est]} /></td>
                    <td style={tdS}>{m.nominaModulo > 0 ? fmtM(m.nominaModulo) : '—'}</td>
                    <td style={tdS}>{fmtM(m.nominaCaja)}</td>
                    <td style={{ ...tdS, textAlign: 'left' }}>{m.nominaCompleta ? <Pildora texto="Completa" color={ESTADO_COLOR.bueno} /> : <Pildora texto="Solo transferencias" color={ESTADO_COLOR.alerta} />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <PorConfirmarTabla filas={raw.por_confirmar} onCambio={onCambio} />
    </div>
  )
}

function PorConfirmarTabla({ filas, onCambio }: { filas: PorConfirmar[]; onCambio: () => void }) {
  const [fechas, setFechas] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState('')
  const [error, setError] = useState('')

  async function guardar(f: PorConfirmar) {
    const fecha = fechas[f.id] || f.fecha_contrato
    if (!fecha) return
    setGuardando(f.id)
    setError('')
    try {
      const { error: e } = await supabase.from('quotations')
        .update({ fecha_contrato: fecha, fecha_contrato_fuente: 'manual' }).eq('id', f.id)
      if (e) throw new Error(e.message)
      onCambio()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setGuardando('')
    }
  }

  return (
    <Tarjeta titulo={`Fechas de contrato por confirmar (${filas.length})`}
      subtitulo="Estas cotizaciones se capturaron ya como contrato entre abril y junio de 2026 y no tienen un anticipo que delate cuándo se firmaron, así que su fecha es la de captura. Corrígela para que «Vendido por mes» sea exacto. Las demás se fecharon con el día que pasaron a contrato o con su primer anticipo.">
      {error && <div style={{ color: '#e66767', fontSize: 12, marginBottom: 8 }}>No se guardó: {error}</div>}
      {filas.length === 0 ? <Nota>Nada pendiente. Todas las fechas de contrato están confirmadas.</Nota> : (
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <thead><tr>
              <th style={{ ...thS, textAlign: 'left' }}>Cotización</th>
              <th style={{ ...thS, textAlign: 'left' }}>Cliente</th>
              <th style={thS}>Monto</th>
              <th style={thS}>Fecha de contrato</th>
              <th style={thS}></th>
            </tr></thead>
            <tbody>
              {filas.map(f => (
                <tr key={f.id}>
                  <td style={{ ...tdS, textAlign: 'left', whiteSpace: 'normal', color: '#e8e7e3' }}>
                    {f.folio && <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10.5, color: '#77766f', marginRight: 6 }}>{f.folio}</span>}
                    {f.name}
                  </td>
                  <td style={{ ...tdS, textAlign: 'left', whiteSpace: 'normal', color: '#a9a8a1' }}>{f.lead || '—'}</td>
                  <td style={tdS}>{fmt$(Number(f.vendido) || 0, f.moneda)}</td>
                  <td style={tdS}>
                    <input type="date" value={fechas[f.id] || f.fecha_contrato || ''}
                      onChange={e => { const v = e.target.value; setFechas(p => ({ ...p, [f.id]: v })) }}
                      style={{ background: '#0f0f0f', border: '1px solid #2a2a2a', borderRadius: 6, color: '#e8e7e3', padding: '4px 6px', fontSize: 12, colorScheme: 'dark' }} />
                  </td>
                  <td style={tdS}>
                    <button onClick={() => guardar(f)} disabled={guardando === f.id} style={{
                      padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      border: '1px solid #10B98166', background: '#10B98118', color: '#10B981',
                    }}>{guardando === f.id ? 'Guardando…' : fechas[f.id] ? 'Guardar' : 'Confirmar'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Tarjeta>
  )
}
