// Nómina → Analíticos: cómo ha cambiado la nómina, por área, plantilla,
// costo por persona, altas/bajas y transferencia vs efectivo.
// Solo lee (RPC nomina_analitica). No modifica periodos ni recibos.
import { useEffect, useMemo, useState } from 'react'
import { GraficaApilada, GraficaMensual, Leyenda, TooltipFila } from '../../components/finanzas/Graficas'
import { Tarjeta, Indicador, Rejilla, Nota, thS, tdS } from '../../components/finanzas/Piezas'
import { fmtM, fmt$, fmtPct } from '../../lib/finanzasTablero'
import {
  cargarAnaliticaNomina, AnaliticaNomina, MesNomina,
  ORDEN_LINEAS_NOMINA, NOMBRE_LINEA_NOMINA, COLOR_LINEA_NOMINA,
} from '../../lib/nominaAnalitica'

const AZUL = '#3987e5'
const AQUA = '#199e70'
const ROJO = '#e66767'
const AMARILLO = '#c98500'

function cambio(actual: number, antes: number): string {
  if (!(antes > 0)) return ''
  const p = actual / antes - 1
  return (p >= 0 ? '+' : '−') + Math.abs(p * 100).toFixed(1) + '%'
}

function nombreLinea(l: string): string {
  return NOMBRE_LINEA_NOMINA[l] || l
}

function lineasPresentes(meses: MesNomina[]): string[] {
  const hay: Record<string, boolean> = {}
  meses.forEach(m => Object.keys(m.porLinea).forEach(l => { if (m.porLinea[l] > 0) hay[l] = true }))
  const orden = ORDEN_LINEAS_NOMINA.filter(l => hay[l])
  Object.keys(hay).forEach(l => { if (orden.indexOf(l) < 0) orden.push(l) })
  return orden
}

function nombresTooltip(titulo: string, color: string, nombres: string[]): TooltipFila[] {
  if (nombres.length === 0) return []
  const max = 6
  const filas: TooltipFila[] = nombres.slice(0, max).map((n, k) => ({
    nombre: (k === 0 ? titulo + ': ' : '') + n.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()),
    color, valor: '',
  }))
  if (nombres.length > max) filas.push({ nombre: '… y ' + (nombres.length - max) + ' más', color, valor: '' })
  return filas
}

export default function TabAnaliticos() {
  const [datos, setDatos] = useState<AnaliticaNomina | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let vivo = true
    cargarAnaliticaNomina()
      .then(d => { if (vivo) setDatos(d) })
      .catch((e: any) => { if (vivo) setError(e?.message || String(e)) })
    return () => { vivo = false }
  }, [])

  const calc = useMemo(() => {
    if (!datos || datos.meses.length === 0 || datos.ultimoCompleto < 0) return null
    const meses = datos.meses
    const U = datos.ultimoCompleto
    const u = meses[U]
    const hace12 = U >= 12 ? meses[U - 12] : null
    const ventana = meses.slice(Math.max(0, U - 11), U + 1)
    const totalVentana = ventana.reduce((s, m) => s + m.total, 0)

    // Acumulado del año del último mes cerrado vs los mismos meses del año anterior.
    const anio = u.mes.slice(0, 4)
    const anioAnt = String(Number(anio) - 1)
    const mesTope = u.mes.slice(5, 7)
    const ytd = meses.filter(m => m.mes.slice(0, 4) === anio && m.mes.slice(5, 7) <= mesTope && !m.enCurso)
    const ytdAnt = meses.filter(m => m.mes.slice(0, 4) === anioAnt && m.mes.slice(5, 7) <= mesTope)
    const ytdTot = ytd.reduce((s, m) => s + m.total, 0)
    const ytdAntTot = ytdAnt.length === ytd.length ? ytdAnt.reduce((s, m) => s + m.total, 0) : 0

    // Rotación: bajas de los últimos 12 meses cerrados ÷ plantilla promedio.
    const ventanaRot = meses.slice(Math.max(1, U - 11), U + 1)
    const bajas12 = ventanaRot.reduce((s, m) => s + m.bajas.length, 0)
    const altas12 = ventanaRot.reduce((s, m) => s + m.altas.length, 0)
    const plantillaProm = ventanaRot.length ? ventanaRot.reduce((s, m) => s + m.personas, 0) / ventanaRot.length : 0

    const ult3 = meses.slice(Math.max(0, U - 2), U + 1)
    const efvo3 = ult3.reduce((s, m) => s + m.efectivo, 0)
    const tot3 = ult3.reduce((s, m) => s + m.total, 0)

    const lineas = lineasPresentes(meses)
    const porArea = lineas.map(l => {
      const tot12 = ventana.reduce((s, m) => s + (m.porLinea[l] || 0), 0)
      const pers = u.personasPorLinea[l] || 0
      const montoU = u.porLinea[l] || 0
      const montoAnt = hace12 ? (hace12.porLinea[l] || 0) : 0
      return {
        linea: l, tot12, pct: totalVentana > 0 ? tot12 / totalVentana : 0,
        promedio: ventana.length ? tot12 / ventana.length : 0,
        personas: pers, porPersona: pers > 0 ? montoU / pers : 0,
        montoU, montoAnt, personasAnt: hace12 ? (hace12.personasPorLinea[l] || 0) : 0,
      }
    }).filter(a => a.tot12 > 0 || a.montoU > 0)

    return { meses, U, u, hace12, ventana, totalVentana, anio, anioAnt, ytd, ytdTot, ytdAntTot, bajas12, altas12, plantillaProm, efvo3, tot3, lineas, porArea }
  }, [datos])

  if (error) return <Nota>No se pudieron cargar los analíticos: {error}</Nota>
  if (!datos) return <div style={{ padding: 40, color: '#777', fontSize: 13 }}>Cargando analíticos…</div>
  if (!calc) return <Nota>Todavía no hay meses de nómina cerrados ni historial para analizar (o tu usuario no tiene acceso a la nómina).</Nota>

  const { meses, U, u, hace12, ventana, totalVentana, anio, anioAnt, ytd, ytdTot, ytdAntTot, bajas12, altas12, plantillaProm, efvo3, tot3, lineas, porArea } = calc
  const etiquetas = meses.map(m => m.etiqueta)
  const tenues = meses.map(m => m.enCurso)
  const hastaU = meses.slice(0, U + 1)
  const etqU = hastaU.map(m => m.etiqueta)
  const costoPersona = (m: MesNomina) => (m.personas > 0 ? m.total / m.personas : 0)
  const rangoTexto = meses[0].etiqueta + ' a ' + meses[meses.length - 1].etiqueta

  return (
    <div>
      <Rejilla cols={5}>
        <Indicador etiqueta={'Nómina de ' + u.etiqueta} valor={fmtM(u.total)}
          detalle={hace12 ? <>{cambio(u.total, hace12.total)} vs {hace12.etiqueta} ({fmtM(hace12.total)})</> : 'Último mes cerrado'} />
        <Indicador etiqueta={'Acumulado ' + anio} valor={fmtM(ytdTot)}
          detalle={ytdAntTot > 0
            ? <>{cambio(ytdTot, ytdAntTot)} vs mismos {ytd.length} meses de {anioAnt} ({fmtM(ytdAntTot)})</>
            : <>{ytd.length} mes{ytd.length === 1 ? '' : 'es'} cerrados</>} />
        <Indicador etiqueta={'Plantilla en ' + u.etiqueta} valor={String(u.personas) + ' personas'}
          detalle={hace12 ? <>{hace12.personas} en {hace12.etiqueta}</> : undefined} />
        <Indicador etiqueta="Costo promedio por persona" valor={fmt$(costoPersona(u))}
          detalle={hace12 ? <>{cambio(costoPersona(u), costoPersona(hace12))} vs {hace12.etiqueta} ({fmt$(costoPersona(hace12))})</> : 'Al mes, neto (transferencia + efectivo)'} />
        <Indicador etiqueta="Rotación, últimos 12 meses" estado={plantillaProm > 0 && bajas12 / plantillaProm > 0.5 ? 'alerta' : undefined} estadoTexto={plantillaProm > 0 && bajas12 / plantillaProm > 0.5 ? 'Más de la mitad de la plantilla' : undefined} valor={fmtPct(plantillaProm > 0 ? bajas12 / plantillaProm : NaN, 0)}
          detalle={<>{bajas12} bajas y {altas12} altas · plantilla promedio {Math.round(plantillaProm)}</>} />
      </Rejilla>

      <Tarjeta titulo="Nómina mensual por área"
        subtitulo={`${rangoTexto}. Neto pagado (transferencia + efectivo), sin cuotas patronales ni impuestos. El mes en curso va atenuado porque todavía no se paga completo. Los bonos y aguinaldos que el Excel no reparte por persona (oct y dic 2025) van aparte en gris claro.`}>
        <Leyenda items={lineas.map(l => ({ nombre: nombreLinea(l), color: COLOR_LINEA_NOMINA[l] || '#6f6e69' }))} />
        <GraficaApilada etiquetas={etiquetas} formato={fmtM} tenues={tenues} alto={300}
          series={lineas.map(l => ({ nombre: nombreLinea(l), color: COLOR_LINEA_NOMINA[l] || '#6f6e69', valores: meses.map(m => m.porLinea[l] || 0) }))}
          extraTooltip={i => [
            { nombre: 'Personas', color: '#444', valor: String(meses[i].personas) },
            { nombre: 'Fuente', color: '#444', valor: meses[i].fuente === 'modulo' ? 'Módulo' : 'Historial (Excel)' },
          ]} />
      </Tarjeta>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <Tarjeta titulo="Plantilla por mes" subtitulo="Personas distintas que cobraron en el mes. Pasa el cursor para ver quién entró por primera vez y quién dejó de cobrar.">
          <GraficaMensual etiquetas={etqU} formato={v => String(Math.round(v))} alto={220}
            barras={[{ nombre: 'Personas', color: AZUL, valores: hastaU.map(m => m.personas) }]} lineas={[]}
            extraTooltip={i => [
              ...nombresTooltip('Entró', AQUA, i > 0 ? hastaU[i].altas : []),
              ...nombresTooltip('Salió', ROJO, i > 0 ? hastaU[i].bajas : []),
            ]} />
        </Tarjeta>
        <Tarjeta titulo="Costo promedio por persona" subtitulo="Nómina del mes ÷ personas que cobraron. Sube con aumentos, bonos o cuando salen puestos de sueldo bajo.">
          <GraficaMensual etiquetas={etqU} formato={fmtM} alto={220} barras={[]}
            lineas={[{ nombre: 'Por persona', color: AMARILLO, valores: hastaU.map(costoPersona) }]} />
        </Tarjeta>
      </div>

      <Tarjeta titulo="Altas y bajas por mes"
        subtitulo="Alta: el primer mes que la persona cobra. Baja: el mes siguiente al último que cobró, si no ha vuelto. Quien falta un mes y regresa no cuenta. Las bajas van hacia abajo.">
        <Leyenda items={[{ nombre: 'Altas', color: AQUA }, { nombre: 'Bajas', color: ROJO }]} />
        <GraficaMensual etiquetas={etqU.slice(1)} formato={v => String(Math.abs(Math.round(v)))} alto={200} lineas={[]}
          barras={[
            { nombre: 'Altas', color: AQUA, valores: hastaU.slice(1).map(m => m.altas.length) },
            { nombre: 'Bajas', color: ROJO, valores: hastaU.slice(1).map(m => -m.bajas.length) },
          ]}
          extraTooltip={i => [
            ...nombresTooltip('Entró', AQUA, hastaU[i + 1].altas),
            ...nombresTooltip('Salió', ROJO, hastaU[i + 1].bajas),
          ]} />
      </Tarjeta>

      <Tarjeta titulo={'Por área · ' + ventana[0].etiqueta + ' a ' + ventana[ventana.length - 1].etiqueta}
        subtitulo={`Últimos ${ventana.length} meses cerrados. Personas y costo por persona son de ${u.etiqueta}${hace12 ? '; la comparación es contra ' + hace12.etiqueta : ''}.`}>
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: 'left' }}>Área</th>
                <th style={thS}>Nómina {ventana.length} meses</th>
                <th style={thS}>% del total</th>
                <th style={thS}>Promedio mensual</th>
                <th style={thS}>Personas</th>
                <th style={thS}>Costo por persona</th>
                <th style={thS}>{u.etiqueta}</th>
                {hace12 && <th style={thS}>vs {hace12.etiqueta}</th>}
              </tr>
            </thead>
            <tbody>
              {porArea.map(a => (
                <tr key={a.linea}>
                  <td style={{ ...tdS, textAlign: 'left', color: '#e8e7e3' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: COLOR_LINEA_NOMINA[a.linea] || '#6f6e69', marginRight: 8 }} />
                    {nombreLinea(a.linea)}
                  </td>
                  <td style={tdS}>{fmtM(a.tot12)}</td>
                  <td style={tdS}>{fmtPct(a.pct, 0)}</td>
                  <td style={tdS}>{fmtM(a.promedio)}</td>
                  <td style={tdS}>{a.personas || '—'}{hace12 && a.personasAnt !== a.personas ? <span style={{ color: '#77766f' }}> ({a.personasAnt})</span> : null}</td>
                  <td style={tdS}>{a.porPersona > 0 ? fmt$(a.porPersona) : '—'}</td>
                  <td style={tdS}>{a.montoU > 0 ? fmtM(a.montoU) : '—'}</td>
                  {hace12 && <td style={tdS}>{a.montoAnt > 0 ? cambio(a.montoU, a.montoAnt) : a.montoU > 0 ? 'nueva' : '—'}</td>}
                </tr>
              ))}
              <tr style={{ background: '#1a1a1a' }}>
                <td style={{ ...tdS, textAlign: 'left', fontWeight: 700, color: '#fff' }}>Total</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtM(totalVentana)}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>100%</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtM(ventana.length ? totalVentana / ventana.length : 0)}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{u.personas}{hace12 ? <span style={{ color: '#77766f', fontWeight: 400 }}> ({hace12.personas})</span> : null}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmt$(costoPersona(u))}</td>
                <td style={{ ...tdS, fontWeight: 700 }}>{fmtM(u.total)}</td>
                {hace12 && <td style={{ ...tdS, fontWeight: 700 }}>{cambio(u.total, hace12.total)}</td>}
              </tr>
            </tbody>
          </table>
        </div>
        <Nota>Entre paréntesis, las personas que tenía el área en {hace12 ? hace12.etiqueta : 'el mismo mes del año anterior'}. El área es la que tenía cada persona en ese mes.</Nota>
      </Tarjeta>

      <Tarjeta titulo="Transferencia vs efectivo"
        subtitulo={`Cómo se paga la nómina. En los últimos 3 meses cerrados, ${fmtPct(tot3 > 0 ? efvo3 / tot3 : NaN, 0)} se pagó en efectivo.`}>
        <Leyenda items={[{ nombre: 'Transferencia', color: AZUL }, { nombre: 'Efectivo', color: AMARILLO }]} />
        <GraficaApilada etiquetas={etiquetas} formato={fmtM} tenues={tenues} alto={240}
          series={[
            { nombre: 'Transferencia', color: AZUL, valores: meses.map(m => m.transferencia) },
            { nombre: 'Efectivo', color: AMARILLO, valores: meses.map(m => m.efectivo) },
          ]} />
      </Tarjeta>

      <Nota>
        De dónde salen los números: si un mes tiene un periodo cerrado en Períodos, se usa el módulo de nómina; si no, el historial
        cargado del Excel de nómina (enero 2025 a junio 2026). Es el mismo criterio que Finanzas. Esta pestaña solo lee: no cambia
        periodos ni recibos. Los bonos y aguinaldos de oct y dic 2025 que el Excel no asigna a una persona suman al monto pero no cuentan como persona
        ni como área. Una persona que ya no está en Empleados se reconoce por su nombre en el Excel: si el Excel la escribió de dos formas, cuenta como dos.
      </Nota>
    </div>
  )
}
