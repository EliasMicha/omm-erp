// Finanzas → Ciclo de cobranza.
// Del primer cobro de un lead a su finiquito: cuánto tarda, cómo paga, quién
// va atrasado y cuánto entraría si el ciclo se acorta. Todo en % del contrato
// para que el tamaño de la obra no pese. Usa toda la historia (no el periodo
// elegido arriba).
import { useEffect, useMemo, useState } from 'react'
import { GraficaCurvas, GraficaMensual, Leyenda } from './Graficas'
import { Tarjeta, Indicador, Rejilla, Nota, Pildora, ESTADO_COLOR, thS, tdS } from './Piezas'
import { fmtM, fmtPct, etiquetaMes } from '../../lib/finanzasTablero'
import {
  cargarCiclo, DatosCiclo, LeadCiclo, PuntoCurva, Pronostico,
  curvaTipica, curvaMeta, valorEn, mesesHasta, pronosticar, cobranzaEsperada, patronPagos,
  FINIQUITO, NOMBRE_ESPECIALIDAD,
} from '../../lib/cicloCobranza'

const AZUL = '#3987e5'
const VERDE = '#199e70'
const NARANJA = '#d95926'
const AMARILLO = '#c98500'
const COLOR_COHORTE: Record<string, string> = { '2024': NARANJA, '2025': AMARILLO, '2026': VERDE, '2027': '#9085e9' }
const CLAVE_META = 'fin_meta_ciclo_meses'
const META_DEFAULT = 12

type Segmento = 'obras' | 'todas' | 'esp' | 'elec' | 'ilum' | 'cort' | 'proy' | 'dist'

const ESTADO_TXT: Record<string, { t: string; c: string }> = {
  arrancando: { t: 'Arrancando', c: '#9085e9' },
  adelantado: { t: 'Adelantado', c: ESTADO_COLOR.bueno },
  al_ritmo: { t: 'Al ritmo', c: ESTADO_COLOR.neutro },
  atrasado: { t: 'Atrasado', c: ESTADO_COLOR.critico },
  en_finiquito: { t: 'En finiquito', c: '#3987e5' },
}

function fmtMeses(v: number | null): string {
  if (v === null || !isFinite(v)) return '—'
  return (Math.round(v * 10) / 10).toFixed(v < 10 ? 1 : 0) + ' meses'
}

function fechaCorta(f: string | null): string {
  if (!f) return '—'
  return etiquetaMes(f.slice(0, 7))
}

function leerMeta(): number {
  try {
    const v = Number(window.localStorage.getItem(CLAVE_META))
    return v >= 3 && v <= 36 ? v : META_DEFAULT
  } catch (e) {
    return META_DEFAULT
  }
}

function filtrar(leads: LeadCiclo[], seg: Segmento): LeadCiclo[] {
  if (seg === 'todas') return leads
  if (seg === 'obras') return leads.filter(l => l.principal !== 'dist')
  return leads.filter(l => l.principal === seg)
}

// Recorrido escalonado de un lead: % acumulado después de cada cobro.
function recorrido(l: LeadCiclo): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  let acum = 0
  l.cobros.forEach((c, i) => {
    if (i > 0) pts.push({ x: c.k, y: Math.min(1, acum / l.vendido) })
    acum += c.monto
    pts.push({ x: c.k, y: Math.min(1, acum / l.vendido) })
  })
  pts.push({ x: l.edad, y: Math.min(1, acum / l.vendido) })
  return pts
}

function aValores(curva: PuntoCurva[], hasta: number): number[] {
  const out: number[] = []
  for (let k = 0; k <= hasta; k++) out.push(k < curva.length ? curva[k].valor : NaN)
  return out
}

export function TabCiclo() {
  const [datos, setDatos] = useState<DatosCiclo | null>(null)
  const [error, setError] = useState('')
  const [seg, setSeg] = useState<Segmento>('obras')
  const [meta, setMeta] = useState<number>(leerMeta())
  const [resaltar, setResaltar] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    cargarCiclo()
      .then(d => { if (vivo) setDatos(d) })
      .catch((e: any) => { if (vivo) setError(e?.message || String(e)) })
    return () => { vivo = false }
  }, [])

  const cambiarMeta = (v: number) => {
    const x = Math.max(3, Math.min(36, Math.round(v)))
    setMeta(x)
    try { window.localStorage.setItem(CLAVE_META, String(x)) } catch (e) { /* sin almacenamiento: solo esta sesión */ }
  }

  const calc = useMemo(() => {
    if (!datos) return null
    const leads = filtrar(datos.leads, seg)
    const curva = curvaTipica(leads, 4)
    const ciclo = mesesHasta(curva, FINIQUITO)
    const ultK = curva.length ? curva[curva.length - 1].k : 0
    const maxX = Math.max(12, Math.min(36, Math.ceil(Math.max(ultK, ...leads.map(l => l.edad), meta))))
    const cicloBase = ciclo !== null ? ciclo : ultK
    const metaCurva = curvaMeta(curva, cicloBase, meta, maxX)
    const factor = meta > 0 && cicloBase > 0 ? cicloBase / meta : 1
    const pron: Pronostico[] = leads.filter(l => l.pct < 0.999).map(l => pronosticar(l, curva, ciclo, datos.hoy))
      .sort((a, b) => b.saldo - a.saldo)
    const atrasados = pron.filter(p => p.estado === 'atrasado')
    const esperadaTipica = cobranzaEsperada(leads, curva, 1, 12)
    const esperadaMeta = cobranzaEsperada(leads, curva, Math.max(1, factor), 12)
    const patron = patronPagos(leads)

    // Cohortes por año del primer cobro.
    const anios: Record<string, LeadCiclo[]> = {}
    leads.forEach(l => {
      const a = (l.primerCobro || '').slice(0, 4)
      if (!a) return
      if (!anios[a]) anios[a] = []
      anios[a].push(l)
    })
    const cohortes = Object.keys(anios).sort().map(a => ({ anio: a, n: anios[a].length, curva: curvaTipica(anios[a], 3) }))
      .filter(c => c.n >= 3 && c.curva.length > 1)

    // Por especialidad principal (siempre sobre todos los leads con cobro).
    const esp = ['esp', 'elec', 'ilum', 'cort', 'proy', 'dist'].map(s => {
      const ls = datos.leads.filter(l => l.principal === s)
      if (ls.length === 0) return null
      const c = curvaTipica(ls, 3)
      const p = patronPagos(ls)
      const saldo = ls.reduce((t, l) => t + Math.max(0, l.vendido - l.cobrado), 0)
      return {
        esp: s, n: ls.length, m6: c.length > 6 ? c[6].valor : NaN, m12: c.length > 12 ? c[12].valor : NaN,
        ciclo: mesesHasta(c, FINIQUITO), ultK: c.length ? c[c.length - 1].k : 0, anticipo: p.anticipo, dias: p.diasEntrePagos, saldo,
      }
    }).filter(x => x !== null)

    const saldoAbierto = pron.reduce((t, p) => t + p.saldo, 0)
    return { leads, curva, ciclo, ultK, maxX, metaCurva, factor, pron, atrasados, esperadaTipica, esperadaMeta, patron, cohortes, esp, saldoAbierto }
  }, [datos, seg, meta])

  if (error) return <Nota>No se pudo cargar el ciclo de cobranza: {error}</Nota>
  if (!datos || !calc) return <div style={{ padding: 30, color: '#555', fontSize: 12 }}>Calculando el ciclo de cobranza…</div>

  const { leads, curva, ciclo, ultK, maxX, metaCurva, pron, atrasados, esperadaTipica, esperadaMeta, patron, cohortes, esp, saldoAbierto } = calc
  const v6 = curva.length > 6 ? curva[6].valor : NaN
  const v12 = curva.length > 12 ? curva[12].valor : NaN
  const m6 = valorEn(metaCurva, 6)
  const m12 = valorEn(metaCurva, 12)
  const estadoCiclo: 'bueno' | 'alerta' | 'critico' = ciclo === null ? 'critico' : ciclo <= meta ? 'bueno' : ciclo <= meta * 1.5 ? 'alerta' : 'critico'
  const totTipica = esperadaTipica.reduce((s, v) => s + v, 0)
  const totMeta = esperadaMeta.reduce((s, v) => s + v, 0)
  const hoyMes = datos.hoy.slice(0, 7)
  const etqFuturo = esperadaTipica.map((_, j) => {
    const y = Number(hoyMes.slice(0, 4))
    const mm = Number(hoyMes.slice(5, 7)) - 1 + j + 1
    return etiquetaMes((y + Math.floor(mm / 12)) + '-' + String((mm % 12) + 1).padStart(2, '0'))
  })
  const idxResaltar = resaltar ? leads.findIndex(l => l.leadId === resaltar) : -1
  interface OpcionSegmento { id: Segmento; label: string; n: number }
  const segmentos: OpcionSegmento[] = [
    { id: 'obras', label: 'Obras (sin distribución)', n: filtrar(datos.leads, 'obras').length },
    { id: 'todas', label: 'Todo', n: datos.leads.length },
  ]
  const porEsp: Segmento[] = ['esp', 'elec', 'ilum', 'cort', 'proy', 'dist']
  porEsp.forEach(x => { segmentos.push({ id: x, label: NOMBRE_ESPECIALIDAD[x], n: filtrar(datos.leads, x).length }) })
  const segmentosVisibles = segmentos.filter(x => x.n > 0)
  const sinCobro = datos.sinCobro.filter(l => seg === 'todas' || (seg === 'obras' ? l.principal !== 'dist' : l.principal === seg))
  const cobertura = datos.cobertura

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {segmentosVisibles.map(s => (
          <button key={s.id} onClick={() => setSeg(s.id)} style={{
            padding: '5px 11px', borderRadius: 20, fontSize: 11.5, cursor: 'pointer', fontFamily: 'inherit',
            border: '1px solid ' + (seg === s.id ? '#10B981' : '#2a2a2a'), background: seg === s.id ? '#10B98118' : 'transparent',
            color: seg === s.id ? '#e8e7e3' : '#a9a8a1',
          }}>{s.label} <span style={{ color: '#77766f' }}>{s.n}</span></button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#a9a8a1' }}>
          Meta de ciclo
          <input type="number" min={3} max={36} value={meta} onChange={e => cambiarMeta(Number(e.target.value))}
            style={{ width: 52, background: '#141414', border: '1px solid #333', borderRadius: 6, color: '#fff', padding: '4px 6px', fontSize: 12, fontFamily: 'inherit' }} />
          meses
        </div>
      </div>

      <Rejilla cols={5}>
        <Indicador etiqueta="Ciclo típico (al 90%)" valor={ciclo !== null ? fmtMeses(ciclo) : 'Más de ' + ultK + ' meses'}
          detalle={<>Del primer cobro a tener el 90% del contrato cobrado. Meta: {meta} meses.</>}
          estado={estadoCiclo} estadoTexto={ciclo !== null && ciclo <= meta ? 'En meta' : ciclo !== null ? (Math.round((ciclo - meta) * 10) / 10) + ' meses arriba de la meta' : 'No llega al 90% con los datos'} />
        <Indicador etiqueta="Cobrado al mes 6" valor={fmtPct(v6, 0)}
          detalle={<>Con la meta: {fmtPct(m6, 0)}</>} estado={isFinite(v6) && v6 >= m6 - 0.01 ? 'bueno' : 'alerta'} estadoTexto={isFinite(v6) ? (v6 >= m6 - 0.01 ? 'En meta' : Math.round((m6 - v6) * 100) + ' pts abajo') : undefined} />
        <Indicador etiqueta="Cobrado al mes 12" valor={fmtPct(v12, 0)}
          detalle={<>Con la meta: {fmtPct(m12, 0)}</>} estado={isFinite(v12) && v12 >= m12 - 0.01 ? 'bueno' : 'alerta'} estadoTexto={isFinite(v12) ? (v12 >= m12 - 0.01 ? 'En meta' : Math.round((m12 - v12) * 100) + ' pts abajo') : undefined} />
        <Indicador etiqueta="Anticipo típico" valor={fmtPct(patron.anticipo, 0)}
          detalle={<>Primer cobro como % del contrato (mediana). Después, un pago cada {isFinite(patron.diasEntrePagos) ? Math.round(patron.diasEntrePagos) : '—'} días de {fmtPct(patron.pagoTipico, 0)} típico.</>} />
        <Indicador etiqueta="Saldo de leads atrasados" valor={fmtM(atrasados.reduce((t, p) => t + p.saldo, 0))}
          detalle={<>{atrasados.length} de {pron.length} leads abiertos (de 2+ meses) van 15+ puntos abajo de la curva típica. Saldo abierto total {fmtM(saldoAbierto)}.</>}
          estado={atrasados.length ? 'critico' : 'bueno'} estadoTexto={atrasados.length ? 'Apretar cobranza' : 'Todos al ritmo'} />
      </Rejilla>

      <Tarjeta titulo="Curva de cobranza: % del contrato cobrado vs meses desde el primer cobro"
        subtitulo={`Cada línea gris es un lead (${leads.length}); termina en el punto donde va hoy. La línea azul es la curva típica: el avance promedio de los leads que ya llegaron a ese mes, sin importar el monto. La verde punteada es la misma forma llegando al 90% en ${meta} meses.`}>
        <Leyenda items={[
          { nombre: 'Curva típica', color: AZUL, forma: 'linea' },
          { nombre: 'Meta ' + meta + ' meses', color: VERDE, forma: 'punteada' },
          { nombre: 'Un lead', color: '#6f6e69', forma: 'linea' },
        ]} />
        <GraficaCurvas maxX={maxX} alto={340} formatoY={v => Math.round(v * 100) + '%'} etiquetaX={k => k === 0 ? '1er cobro' : 'Mes ' + k}
          resaltar={idxResaltar >= 0 ? idxResaltar : null}
          fondo={leads.map(l => ({ puntos: recorrido(l), color: idxResaltar >= 0 && leads[idxResaltar].leadId === l.leadId ? '#e8e7e3' : undefined }))}
          series={[
            { nombre: 'Curva típica', color: AZUL, valores: aValores(curva, maxX) },
            { nombre: 'Meta ' + meta + ' meses', color: VERDE, valores: metaCurva.map(p => p.valor), punteada: true },
          ]}
          extraTooltip={k => [{ nombre: 'Leads que ya llegaron a este mes', color: '#444', valor: String(k < curva.length ? curva[k].n : leads.filter(l => l.edad >= k).length) }]} />
        <Nota>
          La curva se deja de dibujar cuando menos de 4 leads han llegado a ese mes. Un lead puede bajar de % si después firma otra cotización
          (crece el contrato). Lo cobrado de más (p. ej. un depósito ligado al lead equivocado) se topa en 100%.
        </Nota>
      </Tarjeta>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 16 }}>
        <Tarjeta titulo="¿Estamos cobrando más rápido?" subtitulo="La curva típica según el año en que el lead hizo su primer pago. Si la de un año va arriba de la anterior, se está apretando.">
          <Leyenda items={cohortes.map(c => ({ nombre: c.anio + ' (' + c.n + ' leads)', color: COLOR_COHORTE[c.anio] || '#9085e9', forma: 'linea' as const }))} />
          <GraficaCurvas maxX={Math.max(...cohortes.map(c => c.curva.length - 1), 6)} alto={240} formatoY={v => Math.round(v * 100) + '%'}
            etiquetaX={k => k === 0 ? '1er cobro' : 'Mes ' + k} fondo={[]}
            series={cohortes.map(c => ({ nombre: c.anio, color: COLOR_COHORTE[c.anio] || '#9085e9', valores: c.curva.map(p => p.valor) }))} />
          <Nota>En 2024–2025 una parte grande de los cobros no está ligada a su lead (ver Cobertura abajo), así que esas curvas se ven más lentas de lo que fueron.</Nota>
        </Tarjeta>
        <Tarjeta titulo="Cobranza esperada de la cartera actual, próximos 12 meses"
          subtitulo={`Si cada lead abierto sigue la curva típica desde donde va (barras) contra si el ciclo bajara a ${meta} meses (línea). No incluye contratos sin primer cobro ni ventas nuevas.`}>
          <Leyenda items={[{ nombre: 'Curva típica', color: AZUL }, { nombre: 'Con la meta', color: VERDE, forma: 'linea' }]} />
          <GraficaMensual etiquetas={etqFuturo} formato={fmtM} alto={220}
            barras={[{ nombre: 'Curva típica', color: AZUL, valores: esperadaTipica }]}
            lineas={[{ nombre: 'Con la meta', color: VERDE, valores: esperadaMeta }]} />
          <Nota>
            12 meses: {fmtM(totTipica)} al ritmo actual contra {fmtM(totMeta)} con la meta{totMeta > totTipica ? <> — <b style={{ color: '#e8e7e3' }}>{fmtM(totMeta - totTipica)} más</b> de la misma cartera, sin vender nada nuevo</> : null}.
          </Nota>
        </Tarjeta>
      </div>

      <Tarjeta titulo="Leads abiertos: dónde va cada uno y cuándo termina"
        subtitulo={`"Esperado" es lo que la curva típica tiene a la edad del lead. Atrasado = 15 puntos o más abajo (a partir del mes 2; antes es "Arrancando"). El finiquito estimado supone que, desde donde va, avanza al ritmo de la curva típica. Pasa el cursor por un renglón para verlo en la curva.`}>
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10, maxHeight: 520, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1040 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                <th style={{ ...thS, textAlign: 'left' }}>Lead</th>
                <th style={{ ...thS, textAlign: 'left' }}>Especialidad</th>
                <th style={thS}>Contratado</th>
                <th style={{ ...thS, textAlign: 'left' }}>Cobrado</th>
                <th style={thS}>Meses desde 1er cobro</th>
                <th style={thS}>Esperado</th>
                <th style={{ ...thS, textAlign: 'left' }}>Estado</th>
                <th style={thS}>Último cobro</th>
                <th style={thS}>Finiquito estimado</th>
                <th style={thS}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {pron.map(p => {
                const l = p.lead
                const e = ESTADO_TXT[p.estado]
                return (
                  <tr key={l.leadId} onMouseEnter={() => setResaltar(l.leadId)} onMouseLeave={() => setResaltar(null)}
                    style={{ background: resaltar === l.leadId ? '#1c1c1c' : undefined }}>
                    <td style={{ ...tdS, textAlign: 'left', color: '#e8e7e3', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.lead}>{l.lead}</td>
                    <td style={{ ...tdS, textAlign: 'left', color: '#a9a8a1' }}>{NOMBRE_ESPECIALIDAD[l.principal] || l.principal}</td>
                    <td style={tdS}>{fmtM(l.vendido)}</td>
                    <td style={{ ...tdS, textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 70, height: 6, background: '#262626', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.round(l.pct * 100) + '%', background: AZUL, borderRadius: 3 }} />
                          <div style={{ position: 'absolute', top: -1, bottom: -1, left: Math.round(Math.min(1, p.esperado) * 100) + '%', width: 2, background: '#e8e7e3' }} title="Esperado" />
                        </div>
                        {fmtPct(l.pct, 0)}
                      </div>
                    </td>
                    <td style={tdS}>{(Math.round(l.edad * 10) / 10).toFixed(1)}</td>
                    <td style={tdS}>{fmtPct(p.esperado, 0)}</td>
                    <td style={{ ...tdS, textAlign: 'left' }}><Pildora texto={e.t + (p.estado === 'atrasado' || p.estado === 'adelantado' ? ' ' + (p.desvio > 0 ? '+' : '−') + Math.abs(Math.round(p.desvio * 100)) + ' pts' : '')} color={e.c} /></td>
                    <td style={tdS}>{fechaCorta(l.ultimoCobro)}</td>
                    <td style={tdS}>{p.estado === 'en_finiquito' ? 'Ya en finiquito' : p.finiquitoEstimado ? fechaCorta(p.finiquitoEstimado) : 'No llega al 90% a este ritmo'}</td>
                    <td style={{ ...tdS, fontWeight: 600 }}>{fmtM(p.saldo)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {sinCobro.length > 0 && (
          <Nota>
            Además, {sinCobro.length} lead{sinCobro.length === 1 ? '' : 's'} con contrato y sin un solo cobro todavía ({fmtM(sinCobro.reduce((t, l) => t + l.vendido, 0))}):{' '}
            {sinCobro.sort((a, b) => b.vendido - a.vendido).slice(0, 8).map(l => l.lead + ' (' + fmtM(l.vendido) + ')').join(', ')}{sinCobro.length > 8 ? '…' : ''}.
            Su ciclo empieza cuando llegue el anticipo.
          </Nota>
        )}
      </Tarjeta>

      <Tarjeta titulo="Cómo paga cada especialidad"
        subtitulo="Por especialidad principal del lead (la de mayor contrato). Todos los leads con al menos un cobro, sin importar el filtro de arriba.">
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
            <thead><tr>
              <th style={{ ...thS, textAlign: 'left' }}>Especialidad</th>
              <th style={thS}>Leads</th>
              <th style={thS}>Anticipo típico</th>
              <th style={thS}>Cobrado al mes 6</th>
              <th style={thS}>Cobrado al mes 12</th>
              <th style={thS}>Ciclo al 90%</th>
              <th style={thS}>Días entre pagos</th>
              <th style={thS}>Saldo abierto</th>
            </tr></thead>
            <tbody>
              {esp.map(x => x && (
                <tr key={x.esp}>
                  <td style={{ ...tdS, textAlign: 'left', color: '#e8e7e3' }}>{NOMBRE_ESPECIALIDAD[x.esp] || x.esp}</td>
                  <td style={tdS}>{x.n}</td>
                  <td style={tdS}>{fmtPct(x.anticipo, 0)}</td>
                  <td style={tdS}>{fmtPct(x.m6, 0)}</td>
                  <td style={tdS}>{fmtPct(x.m12, 0)}</td>
                  <td style={tdS}>{x.ciclo !== null ? fmtMeses(x.ciclo) : (x.ultK > 0 ? '+' + x.ultK + ' meses' : '—')}</td>
                  <td style={tdS}>{isFinite(x.dias) ? Math.round(x.dias) : '—'}</td>
                  <td style={tdS}>{fmtM(x.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Nota>
          "—" en mes 6 o 12: menos de 3 leads de esa especialidad han llegado a ese mes. De los que ya llegaron al 90% ({patron.llegaron} en el filtro
          de arriba), la mediana fue {fmtMeses(patron.mesesAlFiniquito)} y {isFinite(patron.pagosAlFiniquito) ? Math.round(patron.pagosAlFiniquito) : '—'} pagos —
          ojo: ese número solo ve a los que ya terminaron, que suelen ser los rápidos; la curva típica es la medida justa.
        </Nota>
      </Tarjeta>

      <Tarjeta titulo="Cobertura: qué tanto de la cobranza entra en este análisis"
        subtitulo="Solo cuentan los cobros ligados a un lead con contrato (directo, por cotización o por reparto en Conciliación). Lo demás no se puede asignar a ningún ciclo.">
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead><tr>
              <th style={{ ...thS, textAlign: 'left' }}>Año</th>
              <th style={thS}>Cobranza de clientes</th>
              <th style={thS}>Ligada a un lead</th>
              <th style={{ ...thS, textAlign: 'left' }}>Cobertura</th>
            </tr></thead>
            <tbody>
              {cobertura.map(c => {
                const p = c.total > 0 ? Math.min(1, c.ligado / c.total) : 0
                return (
                  <tr key={c.anio}>
                    <td style={{ ...tdS, textAlign: 'left', color: '#e8e7e3' }}>{c.anio}</td>
                    <td style={tdS}>{fmtM(c.total)}</td>
                    <td style={tdS}>{fmtM(Math.min(c.ligado, c.total))}</td>
                    <td style={{ ...tdS, textAlign: 'left' }}><Pildora texto={fmtPct(p, 0)} color={p >= 0.85 ? ESTADO_COLOR.bueno : p >= 0.6 ? ESTADO_COLOR.alerta : ESTADO_COLOR.critico} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Nota>
          Mientras más cobros se liguen a su lead en Contabilidad → Conciliación, más real es la curva: un cobro sin liga hace que su obra
          se vea más atrasada de lo que va. Datos de banco desde {fechaCorta(datos.datosDesde)}. Dólares a {datos.tc.toFixed(2)} para contrato y cobros (el % no cambia por tipo de cambio).
          La meta se guarda en este navegador.
        </Nota>
      </Tarjeta>
    </div>
  )
}

