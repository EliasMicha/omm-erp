// Finanzas — tablero de la salud del negocio.
//
// Reescrito el 24-oct-2026. El módulo anterior medía con CFDI emitidos (que
// inflan el ingreso ~50%: cuenta nómina timbrada y complementos de pago) y con
// projects.contract_value (que se queda viejo). Este lee las fuentes vivas a
// través de UNA función SQL (finanzas_tablero) y responde una pregunta:
// ¿cuánto vendemos, cuánto cobramos, cuánto nos cuesta la nómina y cuánto
// debemos — y cómo se relacionan?
import { useEffect, useMemo, useState } from 'react'
import { SectionHeader } from '../components/layout/UI'
import { useIsMobile } from '../lib/useIsMobile'
import {
  cargarTablero, convertirMes, sumar, fmtM, fmtPct, fmt$, mesActual,
  TableroRaw, Mes, Totales,
} from '../lib/finanzasTablero'
import { GraficaMensual, GraficaFlujo, Leyenda, COLOR } from '../components/finanzas/Graficas'
import { Tarjeta, Indicador, Rejilla, Nota, thS, tdS } from '../components/finanzas/Piezas'
import { TabCartera, TabCxp, TabAreas, TabDatos } from '../components/finanzas/FinanzasDetalle'

type Periodo = 'mes' | '3m' | '6m' | '12m' | 'anio' | 'anio_ant'
type Pestana = 'resumen' | 'flujo' | 'cartera' | 'cxp' | 'areas' | 'datos'

const PERIODOS: { id: Periodo; label: string }[] = [
  { id: 'mes', label: 'Este mes' },
  { id: '3m', label: '3 meses' },
  { id: '6m', label: '6 meses' },
  { id: '12m', label: '12 meses' },
  { id: 'anio', label: 'Año en curso' },
  { id: 'anio_ant', label: 'Año anterior' },
]

const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'resumen', label: 'Resumen' },
  { id: 'flujo', label: 'Flujo de efectivo' },
  { id: 'cartera', label: 'Cartera por cobrar' },
  { id: 'cxp', label: 'Cuentas por pagar' },
  { id: 'areas', label: 'Por área' },
  { id: 'datos', label: 'Calidad de datos' },
]

// Regla de Elias: la nómina no debe pasar del 20% de la cobranza (con IVA).
// 17% es la zona segura: el 20% sobre bruto equivale a ~23% sobre neto.
const TOPE_NOMINA = 0.20
const ZONA_SEGURA = 0.17

function sumarMeses(ym: string, k: number): string {
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7)) - 1 + k
  const d = new Date(y, m, 1)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

function rangoDe(p: Periodo): { desde: string; hasta: string } {
  const hoy = mesActual()
  const y = Number(hoy.slice(0, 4))
  if (p === 'mes') return { desde: hoy, hasta: hoy }
  if (p === '3m') return { desde: sumarMeses(hoy, -2), hasta: hoy }
  if (p === '6m') return { desde: sumarMeses(hoy, -5), hasta: hoy }
  if (p === '12m') return { desde: sumarMeses(hoy, -11), hasta: hoy }
  if (p === 'anio') return { desde: y + '-01', hasta: hoy }
  return { desde: (y - 1) + '-01', hasta: (y - 1) + '-12' }
}

function deltaTxt(actual: number, previo: number, masEsMejor: boolean): { texto: string; bueno: boolean } | null {
  if (!previo || Math.abs(previo) < 1) return null
  const d = (actual - previo) / Math.abs(previo)
  if (!isFinite(d)) return null
  const flecha = d >= 0 ? '▲' : '▼'
  return { texto: `${flecha} ${Math.abs(d * 100).toFixed(0)}% vs periodo anterior`, bueno: masEsMejor ? d >= 0 : d <= 0 }
}

export default function Finanzas() {
  const isMobile = useIsMobile()
  const [periodo, setPeriodo] = useState<Periodo>('12m')
  const [pestana, setPestana] = useState<Pestana>('resumen')
  const [raw, setRaw] = useState<TableroRaw | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [recarga, setRecarga] = useState(0)

  const rango = useMemo(() => rangoDe(periodo), [periodo])
  const nMeses = useMemo(() => {
    const a = Number(rango.desde.slice(0, 4)) * 12 + Number(rango.desde.slice(5, 7))
    const b = Number(rango.hasta.slice(0, 4)) * 12 + Number(rango.hasta.slice(5, 7))
    return b - a + 1
  }, [rango])

  // Se trae el periodo, el periodo anterior de la misma duración (para
  // comparar) y al menos 12 meses para las gráficas.
  const desdeConsulta = useMemo(() => {
    const previo = sumarMeses(rango.desde, -nMeses)
    const doce = sumarMeses(rango.hasta, -11)
    return previo < doce ? previo : doce
  }, [rango, nMeses])

  useEffect(() => {
    let vivo = true
    setCargando(true)
    setError('')
    cargarTablero(desdeConsulta + '-01', rango.hasta + '-01')
      .then(r => { if (vivo) setRaw(r) })
      .catch((e: any) => { if (vivo) setError(e?.message || String(e)) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [desdeConsulta, rango.hasta, recarga])

  const todos: Mes[] = useMemo(() => (raw ? raw.meses.map(convertirMes) : []), [raw])
  const delPeriodo = useMemo(() => todos.filter(m => m.mes >= rango.desde && m.mes <= rango.hasta), [todos, rango])
  const previos = useMemo(() => {
    const d = sumarMeses(rango.desde, -nMeses)
    const h = sumarMeses(rango.desde, -1)
    return todos.filter(m => m.mes >= d && m.mes <= h)
  }, [todos, rango, nMeses])
  // Gráficas: el periodo, o los últimos 12 meses si el periodo es más corto.
  const grafica = useMemo(() => {
    const d = nMeses >= 12 ? rango.desde : sumarMeses(rango.hasta, -11)
    return todos.filter(m => m.mes >= d && m.mes <= rango.hasta)
  }, [todos, rango, nMeses])

  const T = useMemo(() => sumar(delPeriodo), [delPeriodo])
  // La razón nómina ÷ cobranza solo se calcula con meses de nómina COMPLETA
  // (y cerrados): en los meses con solo la transferencia registrada la nómina
  // sale a la mitad y la razón se ve sana cuando no lo es.
  const nominaReal = useMemo(() => {
    const ok = delPeriodo.filter(m => m.nominaCompleta && !m.enCurso)
    const base = ok.length ? ok : delPeriodo
    const nom = base.reduce((a, m) => a + m.nomina, 0)
    const cob = base.reduce((a, m) => a + m.cobrado, 0)
    return { meses: ok.length, total: delPeriodo.length, porMes: base.length ? nom / base.length : 0, cobroPorMes: base.length ? cob / base.length : 0, pct: cob > 0 ? nom / cob : NaN }
  }, [delPeriodo])
  const P = useMemo(() => sumar(previos), [previos])
  // Una comparación solo vale si el periodo anterior tiene datos completos de
  // ese concepto. Los contratos se capturan en el ERP desde 2026; la nómina
  // está completa solo en ciertos meses; y antes de jul-2026 muchos pagos a
  // proveedor están "sin clasificar".
  const comparable = useMemo(() => {
    const lleno = previos.length === nMeses
    return {
      vendido: lleno && previos.every(m => m.mes >= '2026-01'),
      cobrado: lleno,
      nomina: lleno && previos.every(m => m.nominaCompleta),
      proveedores: lleno && previos.every(m => m.egresosOperativos > 0 && m.sinClasificar / m.egresosOperativos < 0.2),
    }
  }, [previos, nMeses])

  return (
    <div style={{ padding: isMobile ? '16px' : '24px 28px', maxWidth: 1400 }}>
      <SectionHeader title="Finanzas"
        subtitle="Venta, cobranza, nómina y lo que debemos — de las fuentes vivas del ERP (banco, efectivo, nómina, contratos y órdenes de compra)" />

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {PERIODOS.map(p => (
          <button key={p.id} onClick={() => setPeriodo(p.id)} style={{
            padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600,
            border: '1px solid ' + (periodo === p.id ? '#10B981' : '#2a2a2a'),
            background: periodo === p.id ? '#10B98118' : '#141414', color: periodo === p.id ? '#10B981' : '#a9a8a1',
          }}>{p.label}</button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid #222', marginBottom: 16, overflowX: 'auto' }}>
        {PESTANAS.map(t => (
          <button key={t.id} onClick={() => setPestana(t.id)} style={{
            padding: '9px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', whiteSpace: 'nowrap',
            color: pestana === t.id ? '#fff' : '#77766f', borderBottom: '2px solid ' + (pestana === t.id ? '#10B981' : 'transparent'),
          }}>
            {t.label}
            {t.id === 'datos' && raw && raw.por_confirmar.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, background: '#fab21933', color: '#fab219', borderRadius: 10, padding: '1px 6px' }}>{raw.por_confirmar.length}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#d03b3b22', border: '1px solid #d03b3b55', color: '#f2b8b8', borderRadius: 10, padding: 12, fontSize: 12, marginBottom: 16 }}>
          No se pudo cargar Finanzas: {error}
          <button onClick={() => setRecarga(x => x + 1)} style={{ marginLeft: 12, background: 'none', border: '1px solid #d03b3b88', color: '#f2b8b8', borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>Reintentar</button>
        </div>
      )}

      {cargando && !raw && <div style={{ padding: 40, textAlign: 'center', color: '#555', fontSize: 13 }}>Cargando finanzas…</div>}

      {raw && (
        <div style={{ opacity: cargando ? 0.5 : 1, transition: 'opacity .15s' }}>
          {pestana === 'resumen' && <TabResumen T={T} P={P} meses={grafica} raw={raw} nMeses={nMeses} comparable={comparable} nominaReal={nominaReal} />}
          {pestana === 'flujo' && <TabFlujo meses={delPeriodo} grafica={grafica} T={T} />}
          {pestana === 'cartera' && <TabCartera raw={raw} nominaMensual={nominaReal.porMes} />}
          {pestana === 'cxp' && <TabCxp raw={raw} />}
          {pestana === 'areas' && <TabAreas meses={todos} desde={rango.desde} hasta={rango.hasta} />}
          {pestana === 'datos' && <TabDatos raw={raw} meses={grafica} onCambio={() => setRecarga(x => x + 1)} />}
          <Nota>
            Montos con IVA, como se cobran y se pagan. Los dólares se convierten a pesos con el tipo de cambio del año
            ({Array.from(new Set(grafica.map(m => m.mes.slice(0, 4) + ': ' + m.tc.toFixed(2)))).join(' · ')}), que es el costo real de compra de dólares de OMM.
            El mes en curso se muestra atenuado: todavía no cierra.
          </Nota>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════════════════════════════════
interface Comparable { vendido: boolean; cobrado: boolean; nomina: boolean; proveedores: boolean }
interface NominaReal { meses: number; total: number; porMes: number; cobroPorMes: number; pct: number }

function TabResumen({ T, P, meses, raw, nMeses, comparable, nominaReal }: { T: Totales; P: Totales; meses: Mes[]; raw: TableroRaw; nMeses: number; comparable: Comparable; nominaReal: NominaReal }) {
  const tcHoy = meses.length ? meses[meses.length - 1].tc : 18

  const nomPct = nominaReal.pct
  const provPct = T.cobrado > 0 ? T.proveedores / T.cobrado : NaN
  const conv = T.vendido > 0 ? T.cobrado / T.vendido : NaN
  const nominaMes = nominaReal.porMes
  const cobroMes = T.meses ? T.cobrado / T.meses : 0
  const cobroMesBase = nominaReal.cobroPorMes
  const necesaria = nominaMes / TOPE_NOMINA
  const brecha = cobroMesBase - necesaria
  const baseNomina = nominaReal.meses === nominaReal.total
    ? ''
    : nominaReal.meses > 0
      ? ` Calculado con los ${nominaReal.meses} meses de nómina completa del periodo (de ${nominaReal.total}).`
      : ' Ningún mes del periodo tiene la nómina completa: el % está subestimado.'

  // Cartera y CxP de hoy (no dependen del periodo)
  let carteraMxn = 0, carteraUsd = 0
  raw.cartera.resumen.forEach(r => { if (r.cur === 'usd') carteraUsd += r.saldo; else carteraMxn += r.saldo })
  const cartera = carteraMxn + carteraUsd * tcHoy
  let cxpMxn = 0, cxpUsd = 0, vencMxn = 0, vencUsd = 0, porAprobar = 0
  raw.cxp.resumen.forEach(r => {
    if (r.bucket === 'por_aprobar') { porAprobar += r.cur === 'usd' ? r.saldo * tcHoy : r.saldo; return }
    if (r.cur === 'usd') cxpUsd += r.saldo; else cxpMxn += r.saldo
    if (r.bucket === 'vencida') { if (r.cur === 'usd') vencUsd += r.saldo; else vencMxn += r.saldo }
  })
  const cxp = cxpMxn + cxpUsd * tcHoy
  const vencidas = vencMxn + vencUsd * tcHoy

  const estadoNomina: 'bueno' | 'alerta' | 'critico' = !isFinite(nomPct) ? 'critico' : nomPct <= ZONA_SEGURA ? 'bueno' : nomPct <= TOPE_NOMINA ? 'alerta' : 'critico'
  const dispAnual = T.meses ? T.disposiciones * 12 / T.meses : 0
  const estadoRev: 'bueno' | 'alerta' | 'critico' = dispAnual < 4 ? 'bueno' : dispAnual <= 16 ? 'alerta' : 'critico'

  // Serie para la gráfica de nómina ÷ cobranza
  const pctMes = meses.map(m => m.cobrado > 0 ? m.nomina / m.cobrado : 0)
  const pctMovil = meses.map((_, i) => {
    const v = meses.slice(Math.max(0, i - 2), i + 1)
    const c = v.reduce((s, x) => s + x.cobrado, 0)
    const nn = v.reduce((s, x) => s + x.nomina, 0)
    return c > 0 ? nn / c : 0
  })
  const recorte = 1.2 // un mes sin cobranza no debe aplastar la escala
  const etiquetas = meses.map(m => m.etiqueta)
  const tenues = meses.map(m => m.enCurso)
  const nomIncompleta = meses.map(m => !m.nominaCompleta)

  // Acumulados
  let aV = 0, aC = 0, aP = 0
  const acV: number[] = [], acC: number[] = [], acP: number[] = []
  meses.forEach(m => { aV += m.vendido; aC += m.cobrado; aP += m.nomina + m.proveedores; acV.push(aV); acC.push(aC); acP.push(aP) })

  return (
    <div>
      <Rejilla cols={4}>
        <Indicador etiqueta="Vendido (contratado)" valor={fmtM(T.vendido)}
          detalle={`${T.contratos} contratos · ${fmtM(T.meses ? T.vendido / T.meses : 0)} al mes`}
          delta={comparable.vendido ? deltaTxt(T.vendido, P.vendido, true) : null} />
        <Indicador etiqueta="Cobrado" valor={fmtM(T.cobrado)}
          detalle={<>{fmtPct(conv, 0)} de lo vendido en el periodo · {fmtM(cobroMes)} al mes</>}
          delta={comparable.cobrado ? deltaTxt(T.cobrado, P.cobrado, true) : null} />
        <Indicador etiqueta="Nómina" valor={fmtM(T.nomina)}
          detalle={<><b style={{ color: '#fff' }}>{fmtPct(nomPct)}</b> de lo cobrado · tope 20%, zona segura 17% · {fmtM(nominaMes)} al mes.{baseNomina}</>}
          estado={estadoNomina}
          estadoTexto={estadoNomina === 'bueno' ? 'En zona segura' : estadoNomina === 'alerta' ? 'Cerca del tope' : 'Arriba del tope'}
          delta={comparable.nomina ? deltaTxt(T.nomina, P.nomina, false) : null} />
        <Indicador etiqueta="Pagado a proveedores" valor={fmtM(T.proveedores)}
          detalle={<>{fmtPct(provPct)} de lo cobrado</>}
          delta={comparable.proveedores ? deltaTxt(T.proveedores, P.proveedores, false) : null} />
      </Rejilla>

      <Rejilla cols={4}>
        <Indicador etiqueta="Flujo operativo" valor={fmtM(T.flujoOperativo)}
          detalle={T.cobrado > 0 ? <>Por cada $100 cobrados salieron ${(T.egresosOperativos / T.cobrado * 100).toFixed(0)}</> : 'Sin cobranza en el periodo'}
          estado={T.flujoOperativo >= 0 ? 'bueno' : 'critico'}
          estadoTexto={T.flujoOperativo >= 0 ? 'El negocio se paga solo' : 'Sale más de lo que entra'} />
        <Indicador etiqueta="Cobranza que pide la nómina" valor={fmtM(necesaria) + ' / mes'}
          detalle={<>Para que la nómina sea el 20%. Se cobran {fmtM(cobroMesBase)} al mes: {brecha >= 0 ? 'sobran ' : 'faltan '}<b style={{ color: '#fff' }}>{fmtM(Math.abs(brecha))}</b> al mes.{baseNomina}</>}
          estado={brecha >= 0 ? 'bueno' : 'critico'} estadoTexto={brecha >= 0 ? 'Cubierta' : 'Brecha'} />
        <Indicador etiqueta="Cartera por cobrar (hoy)" valor={fmtM(cartera)}
          detalle={<>{fmt$(carteraMxn)} MXN + {fmt$(carteraUsd)} USD{nominaMes > 0 ? <> · equivale a {(cartera / nominaMes).toFixed(1)} meses de nómina</> : null}</>} />
        <Indicador etiqueta="Cuentas por pagar (hoy)" valor={fmtM(cxp)}
          detalle={<>Órdenes de compra emitidas sin pagar · {vencidas > 0 ? <b style={{ color: '#e66767' }}>{fmtM(vencidas)} vencidas</b> : 'nada vencido'} · {fmtM(porAprobar)} más por aprobar</>} />
      </Rejilla>

      <Rejilla cols={3}>
        <Indicador etiqueta="Cartera menos lo que debemos" valor={fmtM(cartera - cxp)}
          detalle="Lo que nos deben los clientes menos las OC por pagar. Es el colchón que la obra ya generó." />
        <Indicador etiqueta="Revolvente de la tarjeta" valor={`${T.disposiciones} disposiciones`}
          detalle={<>Neto del periodo {fmtM(T.revolventeNeto)} · ritmo de {dispAnual.toFixed(0)} al año (meta: menos de 4)</>}
          estado={estadoRev} estadoTexto={estadoRev === 'bueno' ? 'Uso ocasional' : estadoRev === 'alerta' ? 'Uso frecuente' : 'Dependencia del revolvente'} />
        <Indicador etiqueta="Aportaciones de socio" valor={fmtM(T.aportaciones)}
          detalle="Capital que entró para cubrir flujo. No es venta ni cobranza." />
      </Rejilla>

      <Tarjeta titulo="Vendido, cobrado, nómina y proveedores — por mes"
        subtitulo="La relación central del negocio. Lo vendido se cobra en ~18 meses, por eso las barras no empatan mes a mes; lo que importa es la tendencia y que la cobranza alcance para la nómina y los proveedores.">
        <Leyenda items={[
          { nombre: 'Vendido', color: COLOR.vendido },
          { nombre: 'Cobrado', color: COLOR.cobrado },
          { nombre: 'Nómina', color: COLOR.nomina, forma: 'linea' },
          { nombre: 'Proveedores', color: COLOR.proveedores, forma: 'linea' },
        ]} />
        <GraficaMensual etiquetas={etiquetas} formato={fmtM} tenues={tenues}
          barras={[
            { nombre: 'Vendido', color: COLOR.vendido, valores: meses.map(m => m.vendido) },
            { nombre: 'Cobrado', color: COLOR.cobrado, valores: meses.map(m => m.cobrado) },
          ]}
          lineas={[
            { nombre: 'Nómina', color: COLOR.nomina, valores: meses.map(m => m.nomina), incompletos: nomIncompleta },
            { nombre: 'Proveedores', color: COLOR.proveedores, valores: meses.map(m => m.proveedores) },
          ]}
          extraTooltip={i => [{ nombre: 'Contratos firmados', color: 'transparent', valor: String(meses[i].contratos) }]} />
      </Tarjeta>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: 16 }}>
        <Tarjeta titulo="Nómina como % de lo cobrado"
          subtitulo="Tu regla: la nómina no debe pasar del 20% de la cobranza con IVA. El promedio de 3 meses quita el ruido de los meses de cobranza baja. Punto hueco = nómina incompleta ese mes.">
          <Leyenda items={[
            { nombre: 'Mes', color: COLOR.nomina, forma: 'linea' },
            { nombre: 'Promedio 3 meses', color: COLOR.nomina, forma: 'punteada' },
            { nombre: 'Tope 20%', color: COLOR.critico, forma: 'punteada' },
            { nombre: 'Zona segura 17%', color: COLOR.bueno, forma: 'punteada' },
          ]} />
          <GraficaMensual etiquetas={etiquetas} formato={v => fmtPct(v, 0)} tenues={tenues} alto={230}
            barras={[]}
            lineas={[
              { nombre: 'Mes', color: COLOR.nomina, valores: pctMes.map(v => Math.min(v, recorte)), incompletos: nomIncompleta },
              { nombre: 'Promedio 3 meses', color: COLOR.nomina, valores: pctMovil.map(v => Math.min(v, recorte)), punteada: true },
            ]}
            refs={[
              { valor: TOPE_NOMINA, etiqueta: 'Tope 20%', color: COLOR.critico },
              { valor: ZONA_SEGURA, etiqueta: 'Zona segura 17%', color: COLOR.bueno },
            ]} />
        </Tarjeta>

        <Tarjeta titulo="Acumulado"
          subtitulo="Cuánto se ha vendido, cobrado y pagado en nómina + proveedores desde el primer mes de la gráfica. La distancia entre cobrado y pagado es lo que queda para impuestos, gastos y utilidad.">
          <Leyenda items={[
            { nombre: 'Vendido', color: COLOR.vendido, forma: 'linea' },
            { nombre: 'Cobrado', color: COLOR.cobrado, forma: 'linea' },
            { nombre: 'Nómina + proveedores', color: COLOR.nomina, forma: 'linea' },
          ]} />
          <GraficaMensual etiquetas={etiquetas} formato={fmtM} alto={230} barras={[]}
            lineas={[
              { nombre: 'Vendido', color: COLOR.vendido, valores: acV },
              { nombre: 'Cobrado', color: COLOR.cobrado, valores: acC },
              { nombre: 'Nómina + proveedores', color: COLOR.nomina, valores: acP },
            ]} />
        </Tarjeta>
      </div>

      {nMeses === 1 && <Nota>Con «Este mes» los indicadores son del mes en curso (incompleto); las gráficas muestran los últimos 12 meses para dar contexto.</Nota>}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// FLUJO DE EFECTIVO
// ═══════════════════════════════════════════════════════════════════════
interface FilaFlujo { nombre: string; valor: (m: Mes) => number; signo: number; total?: boolean; color?: string; sub?: boolean }

function TabFlujo({ meses, grafica, T }: { meses: Mes[]; grafica: Mes[]; T: Totales }) {
  const etiquetas = grafica.map(m => m.etiqueta)
  const filas: FilaFlujo[] = [
    { nombre: 'Cobranza en banco', valor: m => m.cobrado - m.cobradoEfectivo, signo: 1, sub: true },
    { nombre: 'Cobranza en efectivo', valor: m => m.cobradoEfectivo, signo: 1, sub: true },
    { nombre: 'Otros ingresos', valor: m => m.otrosIngresos, signo: 1, sub: true },
    { nombre: 'Entradas', valor: m => m.cobrado + m.otrosIngresos, signo: 1, total: true, color: COLOR.cobrado },
    { nombre: 'Proveedores', valor: m => m.proveedores, signo: -1, color: COLOR.proveedores, sub: true },
    { nombre: 'Nómina (banco + efectivo)', valor: m => m.nominaCaja, signo: -1, color: COLOR.nomina, sub: true },
    { nombre: 'Impuestos', valor: m => m.impuestos, signo: -1, color: COLOR.impuestos, sub: true },
    { nombre: 'Gastos generales', valor: m => m.gastos, signo: -1, color: COLOR.gastos, sub: true },
    { nombre: 'Salidas sin clasificar', valor: m => m.sinClasificar, signo: -1, color: COLOR.sinClasificar, sub: true },
    { nombre: 'Salidas operativas', valor: m => m.egresosOperativos, signo: -1, total: true },
    { nombre: 'FLUJO OPERATIVO', valor: m => m.flujoOperativo, signo: 1, total: true },
    { nombre: 'Revolvente dispuesto', valor: m => m.revolventeDispuesto, signo: 1, sub: true },
    { nombre: 'Revolvente pagado', valor: m => m.revolventePagado, signo: -1, sub: true },
    { nombre: 'Aportaciones de socio', valor: m => m.aportaciones, signo: 1, sub: true },
    { nombre: 'FLUJO DESPUÉS DE FINANCIAMIENTO', valor: m => m.flujoTotal, signo: 1, total: true },
  ]
  const cob = T.cobrado || 1
  return (
    <div>
      <Tarjeta titulo="Entradas y salidas por mes"
        subtitulo="Arriba lo cobrado; abajo, apilado, todo lo que salió para operar. La línea blanca es el flujo operativo: arriba de cero el mes se pagó solo.">
        <Leyenda items={[
          { nombre: 'Cobrado', color: COLOR.cobrado },
          { nombre: 'Proveedores', color: COLOR.proveedores },
          { nombre: 'Nómina', color: COLOR.nomina },
          { nombre: 'Impuestos', color: COLOR.impuestos },
          { nombre: 'Gastos', color: COLOR.gastos },
          { nombre: 'Sin clasificar', color: COLOR.sinClasificar },
          { nombre: 'Flujo operativo', color: '#e8e7e3', forma: 'linea' },
        ]} />
        <GraficaFlujo etiquetas={etiquetas} formato={fmtM} tenues={grafica.map(m => m.enCurso)}
          entradas={{ nombre: 'Cobrado', color: COLOR.cobrado, valores: grafica.map(m => m.cobrado + m.otrosIngresos) }}
          salidas={[
            { nombre: 'Proveedores', color: COLOR.proveedores, valores: grafica.map(m => m.proveedores) },
            { nombre: 'Nómina', color: COLOR.nomina, valores: grafica.map(m => m.nominaCaja) },
            { nombre: 'Impuestos', color: COLOR.impuestos, valores: grafica.map(m => m.impuestos) },
            { nombre: 'Gastos', color: COLOR.gastos, valores: grafica.map(m => m.gastos) },
            { nombre: 'Sin clasificar', color: COLOR.sinClasificar, valores: grafica.map(m => m.sinClasificar) },
          ]}
          neto={{ nombre: 'Flujo operativo', color: '#e8e7e3', valores: grafica.map(m => m.flujoOperativo) }} />
      </Tarjeta>

      <Tarjeta titulo="Estado de flujo de efectivo"
        subtitulo="Lo que realmente entró y salió de banco y caja. Los traspasos entre cuentas propias no cuentan. El revolvente se muestra aparte: es financiamiento, no gasto.">
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 300 + meses.length * 92 }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: 'left', position: 'sticky', left: 0, zIndex: 1 }}>Concepto</th>
                {meses.map(m => <th key={m.mes} style={{ ...thS, color: m.enCurso ? '#555' : '#77766f' }}>{m.etiqueta}{m.enCurso ? '*' : ''}</th>)}
                <th style={thS}>Total</th>
                <th style={thS}>Por $100 cobrados</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(f => {
                const tot = meses.reduce((s, m) => s + f.valor(m), 0)
                const fuerte = !!f.total
                const clave = fuerte && f.nombre.startsWith('FLUJO')
                return (
                  <tr key={f.nombre} style={{ background: clave ? '#1a1a1a' : undefined }}>
                    <td style={{ ...tdS, textAlign: 'left', position: 'sticky', left: 0, background: clave ? '#1a1a1a' : '#141414', fontWeight: fuerte ? 700 : 400, color: fuerte ? '#fff' : '#a9a8a1', paddingLeft: f.sub ? 18 : 10 }}>
                      {f.color && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: f.color, marginRight: 7 }} />}
                      {f.nombre}
                    </td>
                    {meses.map(m => {
                      const v = f.valor(m) * f.signo
                      return <td key={m.mes} style={{ ...tdS, fontWeight: fuerte ? 700 : 400, color: clave ? (v < 0 ? '#e66767' : '#7fd17f') : v === 0 ? '#444' : '#d6d5d0', opacity: m.enCurso ? 0.6 : 1 }}>{v === 0 ? '—' : fmtM(v)}</td>
                    })}
                    <td style={{ ...tdS, fontWeight: 700, color: clave ? (tot * f.signo < 0 ? '#e66767' : '#7fd17f') : '#fff' }}>{fmtM(tot * f.signo)}</td>
                    <td style={{ ...tdS, color: '#a9a8a1' }}>{(tot * f.signo / cob * 100).toFixed(1)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Nota>
          * Mes en curso. «Salidas sin clasificar» son cargos del banco con categoría «otro»: antes de julio de 2026 ahí vive buena parte
          de los pagos a proveedores y de la nómina, por eso esos meses se ven con proveedores bajos. Se clasifican en Contabilidad → Conciliación.
          La nómina aquí es lo que salió por banco y caja; en Resumen se usa el módulo de nómina cuando el mes está cerrado y, antes, el historial del Excel de nómina (ene-2025 a jun-2026).
        </Nota>
      </Tarjeta>
    </div>
  )
}
