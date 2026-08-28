// ═══════════════════════════════════════════════════════════════════════════
// EstimacionEditor — el checklist de la cotización, periodo por periodo.
//
// Se captura UNA columna: cuánto se ejecutó en este periodo. Lo contratado, lo
// que ya se estimó antes, el acumulado, el % y el importe se calculan solos.
//
// Lo que esta pantalla protege:
//   · No deja aprobar una estimación con excedentes sin resolver. Si estaban
//     cotizados 5 contactos y se cobran 6, ese 6º tiene que salir como EXTRA
//     con nombre y precio, no diluido dentro del concepto. En eléctrico los
//     extras son la diferencia entre ganar y perder la obra.
//   · La cantidad contratada de cada renglón es una foto tomada al crear la
//     estimación: editar la cotización después no mueve un cobro aprobado.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Btn, Badge, Loading } from '../components/layout/UI'
import { ChevronLeft, Save, Plus, Trash2, AlertTriangle, CheckCircle2, Download } from 'lucide-react'
import {
  Estimacion, EstimacionItem, ESTADO_CFG, ESTIMACION_EN_FIRME,
  totalesDe, excedenteDe, disponibleDe, avanceDe,
  contratoEstimadoAntes, contextoDeContrato, borrarEstimacion,
  saldoDeAnticipo, guardarAnticipo, SaldoAnticipo,
  cuadreDeContrato, CuadreContrato,
} from '../lib/estimaciones'
import { generarEstimacionPdf } from '../lib/estimacionPdf'

const n = (v: any) => Number(v) || 0
const F = (v: number, mon = 'MXN') =>
  (mon === 'USD' ? 'US$' : '$') + n(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const Q = (v: number) => {
  const x = n(v)
  return Number.isInteger(x) ? String(x) : x.toFixed(2)
}

export default function EstimacionEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [est, setEst] = useState<Estimacion | null>(null)
  const [items, setItems] = useState<EstimacionItem[]>([])
  const [contrato, setContrato] = useState<{ id: string; name: string; total_final: number; anticipo_monto?: number | null } | null>(null)
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [sucio, setSucio] = useState(false)
  const [colapsadas, setColapsadas] = useState<Set<string>>(new Set())
  const [soloConAvance, setSoloConAvance] = useState(false)
  const [exportando, setExportando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [saldo, setSaldo] = useState<SaldoAnticipo | null>(null)
  const [anticipoTxt, setAnticipoTxt] = useState('')
  const [cuadre, setCuadre] = useState<CuadreContrato | null>(null)

  async function cargar() {
    if (!id) return
    setCargando(true)
    const { data: e } = await supabase.from('estimaciones').select('*').eq('id', id).maybeSingle()
    if (!e) { setCargando(false); return }
    setEst(e as any)
    const [{ data: its }, { data: q }] = await Promise.all([
      supabase.from('estimacion_items').select('*').eq('estimacion_id', id).order('order_index'),
      supabase.from('quotations').select('id,name,total_final,anticipo_monto').eq('id', (e as any).quotation_id).maybeSingle(),
    ])
    setItems(((its as any[]) || []).map(x => ({ ...x, precio_unitario: n(x.precio_unitario), cant_contratada: n(x.cant_contratada), cant_anterior: n(x.cant_anterior), cant_periodo: n(x.cant_periodo) })))
    setContrato(q as any)
    setCargando(false)
  }
  useEffect(() => { cargar() }, [id])

  // Aviso al salir con cambios sin guardar: una estimación a medio capturar
  // son horas de trabajo de alguien.
  useEffect(() => {
    if (!sucio) return
    const h = (ev: BeforeUnloadEvent) => { ev.preventDefault(); ev.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sucio])

  const bloqueada = !!est && ESTIMACION_EN_FIRME.includes(est.estado)
  const moneda = est?.moneda || 'MXN'

  const deContrato = useMemo(() => items.filter(i => i.origen === 'contrato'), [items])
  const deExtras = useMemo(() => items.filter(i => i.origen !== 'contrato'), [items])
  const excedentes = useMemo(() => deContrato.filter(i => excedenteDe(i) > 0), [deContrato])
  const T = useMemo(() => totalesDe(items, {
    amortizacionPct: est?.amortizacion_pct, ivaPct: est?.iva_pct, descuentoPct: est?.descuento_pct,
    amortizacionModo: est?.amortizacion_modo, amortizacionFija: est?.amortizacion_fija,
  }), [items, est])

  // El saldo del anticipo se recalcula con el subtotal vivo, para que el
  // "sugerido" sea lo que de verdad cabe amortizar hoy.
  //
  // OJO: va DESPUÉS de `T`. Estaba arriba y el arreglo de dependencias
  // ([... T.subtotal]) se evalúa durante el render, cuando `T` todavía no
  // existe: ReferenceError y pantalla en blanco al abrir cualquier
  // estimación. esbuild compila esto sin quejarse — es zona muerta temporal,
  // no un error de sintaxis.
  useEffect(() => {
    if (!est) return
    saldoDeAnticipo(est.quotation_id, est.numero, T.subtotal).then(s => {
      setSaldo(s)
      setAnticipoTxt(s.anticipo ? String(s.anticipo) : '')
    })
    cuadreDeContrato(est.quotation_id).then(setCuadre)
  }, [est?.quotation_id, est?.numero, T.subtotal])

  const porArea = useMemo(() => {
    const m = new Map<string, EstimacionItem[]>()
    for (const it of deContrato) {
      const a = it.area || 'GENERAL'
      const arr = m.get(a); if (arr) arr.push(it); else m.set(a, [it])
    }
    return Array.from(m.entries())
  }, [deContrato])

  const setCampo = (itemId: string, campo: keyof EstimacionItem, valor: any) => {
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, [campo]: valor } as EstimacionItem : i))
    setSucio(true)
  }

  async function guardar() {
    if (!est) return
    setGuardando(true)
    try {
      for (let i = 0; i < items.length; i += 50) {
        await Promise.all(items.slice(i, i + 50).map(it =>
          supabase.from('estimacion_items').update({
            cant_periodo: n(it.cant_periodo),
            concepto: it.concepto,
            precio_unitario: n(it.precio_unitario),
            unidad: it.unidad || null,
            area: it.area || null,
            notas: it.notas || null,
          }).eq('id', it.id)
        ))
      }
      await supabase.from('estimaciones').update({
        subtotal_contrato: T.contrato, subtotal_extras: T.extras, subtotal_deductivas: T.deductivas,
        subtotal: T.subtotal, amortizacion_monto: T.amortizacion, iva: T.iva, total: T.total,
        descuento_pct: n(est.descuento_pct),
        amortizacion_modo: est.amortizacion_modo || 'pct',
        amortizacion_fija: est.amortizacion_modo === 'monto' ? n(est.amortizacion_fija) : null,
        periodo_inicio: est.periodo_inicio || null, periodo_fin: est.periodo_fin || null,
        amortizacion_pct: n(est.amortizacion_pct), notas: est.notas || null,
        updated_at: new Date().toISOString(),
      }).eq('id', est.id)
      setSucio(false)
    } finally { setGuardando(false) }
  }

  /** Saca el excedente de un concepto y lo abre como renglón de extra. */
  async function pasarAExtra(it: EstimacionItem) {
    const exc = excedenteDe(it)
    if (exc <= 0) return
    const dentro = Math.max(0, disponibleDe(it))
    const { data, error } = await supabase.from('estimacion_items').insert({
      estimacion_id: it.estimacion_id,
      quotation_item_id: it.quotation_item_id,
      origen: 'extra',
      area: it.area,
      concepto: it.concepto,
      unidad: it.unidad,
      precio_unitario: it.precio_unitario,
      cant_contratada: 0,
      cant_anterior: 0,
      cant_periodo: exc,
      order_index: it.order_index,
      notas: 'Excedente sobre lo contratado',
    }).select().single()
    if (error) { alert('No se pudo crear el extra: ' + error.message); return }
    await supabase.from('estimacion_items').update({ cant_periodo: dentro }).eq('id', it.id)
    setItems(prev => [...prev.map(x => x.id === it.id ? { ...x, cant_periodo: dentro } : x), data as any])
  }

  async function pasarTodos() {
    for (const it of excedentes) await pasarAExtra(it)
  }

  async function agregarRenglon(origen: 'extra' | 'deductiva') {
    if (!est) return
    const { data, error } = await supabase.from('estimacion_items').insert({
      estimacion_id: est.id, origen, area: 'EXTRAS', concepto: '',
      unidad: 'pza', precio_unitario: 0, cant_contratada: 0, cant_anterior: 0, cant_periodo: 0,
      order_index: 999999 + deExtras.length,
    }).select().single()
    if (error) { alert(error.message); return }
    setItems(prev => [...prev, data as any])
  }

  async function borrarRenglon(itemId: string) {
    const it = items.find(x => x.id === itemId)
    if (it && it.origen === 'contrato') { alert('Los conceptos del contrato no se borran: déjalos en cero si no se ejecutaron.'); return }
    if (!confirm('¿Quitar este renglón?')) return
    await supabase.from('estimacion_items').delete().eq('id', itemId)
    setItems(prev => prev.filter(x => x.id !== itemId))
  }

  async function cambiarEstado(nuevo: string) {
    if (!est) return
    if (nuevo === 'aprobada' && excedentes.length > 0) {
      alert(`No se puede aprobar: hay ${excedentes.length} concepto(s) donde se está cobrando más de lo contratado.\n\nEse excedente tiene que salir como EXTRA, con su nombre y su precio. Usa "Pasar todos a extras".`)
      return
    }
    if (sucio) await guardar()
    const upd: any = { estado: nuevo, updated_at: new Date().toISOString() }
    if (nuevo === 'aprobada') upd.aprobada_at = new Date().toISOString()
    const { error } = await supabase.from('estimaciones').update(upd).eq('id', est.id)
    if (error) { alert(error.message); return }
    setEst({ ...est, estado: nuevo as any })
  }

  /**
   * Borrar una estimación. Solo mientras sea borrador o esté en revisión: una
   * aprobada o facturada ya salió del edificio y ahí se cancela, no se borra.
   * Al borrar, los folios posteriores se recorren para no dejar hueco.
   */
  async function borrar() {
    if (!est) return
    const cuantos = items.filter(i => n(i.cant_periodo) !== 0).length
    const aviso = cuantos > 0
      ? `Esta estimación tiene ${cuantos} concepto(s) con avance capturado. Al borrarla se pierde esa captura y el avance vuelve a quedar disponible para la siguiente estimación.`
      : 'Esta estimación no tiene avance capturado.'
    if (!confirm(`¿Borrar la estimación ${est.numero}?\n\n${aviso}\n\nEsto no se puede deshacer.`)) return
    setBorrando(true)
    const r = await borrarEstimacion(est)
    setBorrando(false)
    if (!r.ok) { alert(r.error); return }
    if (r.renumeradas) alert(`Listo. Se recorrieron ${r.renumeradas} folio(s) posteriores para no dejar hueco en la numeración.`)
    navigate(-1)
  }

  /**
   * El PDF que se le entrega al cliente. Solo lleva lo EJECUTADO: los conceptos
   * del contrato en cero no aportan nada y entierran lo que sí se cobra. El
   * saldo por ejecutar se resume arriba, en el bloque de avance.
   */
  async function exportarPdf() {
    if (!est) return
    setExportando(true)
    try {
      if (sucio) await guardar()
      const [ctx, antes] = await Promise.all([
        contextoDeContrato(est.quotation_id),
        contratoEstimadoAntes(est.quotation_id, est.numero),
      ])
      const doc = generarEstimacionPdf({
        numero: est.numero,
        fecha: est.fecha,
        periodoInicio: est.periodo_inicio,
        periodoFin: est.periodo_fin,
        estado: est.estado,
        moneda,
        ivaPct: n(est.iva_pct),
        amortizacionPct: T.subtotal > 0 ? Math.abs(T.amortizacion) / T.subtotal * 100 : 0,
        amortizacionMonto: T.amortizacion,
        descuentoPct: n(est.descuento_pct),
        contrato: { nombre: ctx.nombre, total: ctx.total },
        cliente: ctx.cliente,
        obra: ctx.obra,
        estimadoAnterior: antes,
        notas: est.notas || null,
        items: items as any,
      })
      const limpio = (ctx.obra || 'obra').replace(/[^\w]+/g, '_')
      doc.save(`Estimacion_${est.numero}_${limpio}.pdf`)
    } catch (e: any) {
      alert('No se pudo generar el PDF: ' + (e?.message || e))
    } finally { setExportando(false) }
  }

  if (cargando) return <div style={{ padding: 24 }}><Loading /></div>
  if (!est) return <div style={{ padding: 24, color: '#888' }}>No encontré esa estimación.</div>

  const cfg = ESTADO_CFG[est.estado] || ESTADO_CFG.borrador
  const th: React.CSSProperties = { padding: '7px 8px', fontSize: 9, fontWeight: 600, color: '#555', textTransform: 'uppercase', textAlign: 'left', borderBottom: '1px solid #222', whiteSpace: 'nowrap' }
  const td: React.CSSProperties = { padding: '5px 8px', fontSize: 11, color: '#ccc', borderBottom: '1px solid #161616' }
  const inp: React.CSSProperties = { width: 70, background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 4, padding: '3px 6px', fontSize: 11, fontFamily: 'inherit', textAlign: 'right', outline: 'none' }

  const Kpi = ({ label, valor, color, nota }: { label: string; valor: string; color: string; nota?: string }) => (
    <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 3 }}>{valor}</div>
      {nota && <div style={{ fontSize: 9, color: '#555', marginTop: 2 }}>{nota}</div>}
    </div>
  )

  return (
    <div style={{ padding: '20px 24px' }}>
      <button onClick={() => navigate(-1)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', marginBottom: 10 }}>
        <ChevronLeft size={14} /> Volver
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff' }}>Estimación {est.numero}</div>
          <div style={{ fontSize: 12, color: '#888' }}>{contrato?.name || 'Contrato'}</div>
        </div>
        <Badge label={cfg.label} color={cfg.color} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {!bloqueada && <Btn size="sm" variant="primary" onClick={guardar} disabled={guardando}><Save size={12} /> {guardando ? 'Guardando…' : sucio ? 'Guardar cambios' : 'Guardado'}</Btn>}
          <Btn size="sm" onClick={exportarPdf} disabled={exportando}><Download size={12} /> {exportando ? 'Generando…' : 'Exportar PDF'}</Btn>
          {est.estado === 'borrador' && <Btn size="sm" onClick={() => cambiarEstado('revision')}>Mandar a revisión</Btn>}
          {(est.estado === 'borrador' || est.estado === 'revision') && <Btn size="sm" variant="primary" onClick={() => cambiarEstado('aprobada')}><CheckCircle2 size={12} /> Aprobar</Btn>}
          {est.estado === 'aprobada' && <Btn size="sm" onClick={() => cambiarEstado('revision')}>Reabrir</Btn>}
          {!bloqueada && (
            <Btn size="sm" variant="danger" onClick={borrar} disabled={borrando}>
              <Trash2 size={12} /> {borrando ? 'Borrando…' : 'Borrar'}
            </Btn>
          )}
        </div>
      </div>

      {/* Periodo y amortización */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14, padding: '10px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 8 }}>
        {([['periodo_inicio', 'Periodo desde'], ['periodo_fin', 'Periodo hasta']] as const).map(([campo, label]) => (
          <div key={campo}>
            <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
            <input type="date" disabled={bloqueada} value={(est as any)[campo] || ''}
              onChange={e => { setEst({ ...est, [campo]: e.target.value } as any); setSucio(true) }}
              style={{ ...inp, width: 130, textAlign: 'left' }} />
          </div>
        ))}
        {/* Amortización: por MONTO o por %. El anticipo es dinero y se devuelve
            hasta agotarse; el % es solo una comodidad cuando se quiere repartir
            parejo. Por eso el saldo va a la vista. */}
        <div>
          <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }}>Amortización</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select disabled={bloqueada} value={est.amortizacion_modo || 'pct'}
              onChange={e => { setEst({ ...est, amortizacion_modo: e.target.value as any }); setSucio(true) }}
              style={{ ...inp, width: 78, textAlign: 'left' }}>
              <option value="monto">Monto</option>
              <option value="pct">%</option>
            </select>
            {(est.amortizacion_modo || 'pct') === 'monto' ? (
              <input type="number" disabled={bloqueada} value={est.amortizacion_fija ?? 0}
                onChange={e => { setEst({ ...est, amortizacion_fija: Number(e.target.value) }); setSucio(true) }}
                style={{ ...inp, width: 110 }} />
            ) : (
              <input type="number" disabled={bloqueada} value={est.amortizacion_pct ?? 0}
                onChange={e => { setEst({ ...est, amortizacion_pct: Number(e.target.value) }); setSucio(true) }}
                style={inp} />
            )}
          </div>
        </div>
        {/* Descuento e IVA vienen del contrato, no de fábrica. Se pueden
            corregir aquí, pero se heredan al crear la estimación para que
            nadie tenga que acordarse. */}
        <div>
          <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }} title="El descuento pactado al cerrar. Aplica a lo contratado, no a los extras.">Descuento de contrato %</div>
          <input type="number" disabled={bloqueada} value={est.descuento_pct ?? 0}
            onChange={e => { setEst({ ...est, descuento_pct: Number(e.target.value) }); setSucio(true) }}
            style={inp} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }} title="El de la cotización de cierre: 8% en frontera, 16% en el resto">IVA %</div>
          <input type="number" disabled={bloqueada} value={est.iva_pct ?? 16}
            onChange={e => { setEst({ ...est, iva_pct: Number(e.target.value) }); setSucio(true) }}
            style={inp} />
        </div>
        <div>
          <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', marginBottom: 3 }} title="Solo el dinero recibido POR ADELANTADO. Los pagos de estimaciones anteriores no van aquí: eso ya se cobró contra obra ejecutada.">Anticipo recibido</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="number" disabled={bloqueada} value={anticipoTxt}
              onChange={e => setAnticipoTxt(e.target.value)}
              onBlur={async e => {
                if (!est) return
                const v = Number(e.target.value) || 0
                if (v === n(saldo?.anticipo)) return
                await guardarAnticipo(est.quotation_id, v, saldo?.conIva)
                setSaldo(await saldoDeAnticipo(est.quotation_id, est.numero, T.subtotal))
                setCuadre(await cuadreDeContrato(est.quotation_id))
              }}
              placeholder="0.00" style={{ ...inp, width: 120 }} />
            {/* La amortización va antes del IVA, así que hay que saber si el
                monto capturado es efectivo (con IVA) o ya es subtotal. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, color: '#888', cursor: 'pointer', maxWidth: 92, lineHeight: 1.3 }}
              title="Marca esto si capturaste el dinero que entró al banco. El sistema le quita el IVA para amortizar el subtotal, que es lo correcto.">
              <input type="checkbox" disabled={bloqueada} checked={!!saldo?.conIva}
                onChange={async e => {
                  if (!est) return
                  await guardarAnticipo(est.quotation_id, Number(anticipoTxt) || 0, e.target.checked)
                  setSaldo(await saldoDeAnticipo(est.quotation_id, est.numero, T.subtotal))
                  setCuadre(await cuadreDeContrato(est.quotation_id))
                }}
                style={{ accentColor: '#A78BFA' }} />
              ya incluye IVA
            </label>
          </div>
        </div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#888', cursor: 'pointer' }}>
          <input type="checkbox" checked={soloConAvance} onChange={e => setSoloConAvance(e.target.checked)} style={{ accentColor: '#10B981' }} />
          Ver solo lo que se ejecutó
        </label>
      </div>

      {/* Saldo del anticipo: lo que falta por devolver. Sin esto, el error
          clásico es amortizar de menos y darse cuenta al final de la obra. */}
      {saldo && saldo.anticipo > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 8, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          {([
            [saldo.conIva ? 'Anticipo recibido (con IVA)' : 'Anticipo recibido', saldo.anticipo, '#A78BFA'],
            ...(saldo.conIva ? [['Amortizable (sin IVA)', saldo.amortizable, '#8B7FD4'] as const] : []),
            ['Amortizado antes', -saldo.amortizadoAntes, '#888'],
            ['Amortizando aquí', T.amortizacion, '#A78BFA'],
            ['Saldo después de ésta', Math.max(0, saldo.saldo - Math.abs(T.amortizacion)), saldo.saldo - Math.abs(T.amortizacion) > 0.5 ? '#D9A441' : '#10B981'],
          ] as const).map(([l, v, c], i) => (
            <div key={i}>
              <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '.05em' }}>{l}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: c as string }}>{F(v as number, moneda)}</div>
            </div>
          ))}
          {!bloqueada && saldo.sugerido > 0 && Math.abs(Math.abs(T.amortizacion) - saldo.sugerido) > 0.5 && (
            <Btn size="sm" variant="primary" style={{ marginLeft: 'auto' }}
              onClick={() => { setEst({ ...est, amortizacion_modo: 'monto', amortizacion_fija: Math.round(saldo.sugerido * 100) / 100 } as any); setSucio(true) }}>
              Amortizar {F(saldo.sugerido, moneda)}
            </Btn>
          )}
          {saldo.saldo - Math.abs(T.amortizacion) > 0.5 && (
            <div style={{ width: '100%', fontSize: 10, color: '#997', lineHeight: 1.6 }}>
              Quedan {F(saldo.saldo - Math.abs(T.amortizacion), moneda)} de anticipo por devolver. Si no se amortizan en
              estimaciones siguientes, al cerrar la obra ya no hay contra qué descontarlos.
            </div>
          )}
        </div>
      )}

      {/* Cuadre del contrato: si se ejecuta el 100%, ¿la suma da lo pactado?
          Debe dar exacto. Si no da, hay un supuesto mal puesto y la diferencia
          es dinero que no se va a cobrar — visible ahora, no al cerrar la obra. */}
      {cuadre && cuadre.lista > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 8,
          background: cuadre.cuadra ? '#0d1410' : '#1a1210',
          border: `1px solid ${cuadre.cuadra ? '#1d3326' : '#4a2320'}` }}>
          <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 7 }}>
            Si se ejecuta el 100% del contrato
          </div>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
            {([
              ['Anticipo (efectivo)', cuadre.anticipoEfectivo, '#A78BFA'],
              ['+ Todas las estimaciones', cuadre.sumaEstimaciones, '#60A5FA'],
              ['= Total a cobrar', cuadre.totalProyectado, cuadre.cuadra ? '#10B981' : '#DC2626'],
              ['Contrato pactado', cuadre.contratoConIva, '#ccc'],
            ] as const).map(([l, v, c], i) => (
              <div key={i}>
                <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: '.05em' }}>{l}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: c as string }}>{F(v as number, moneda)}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: cuadre.cuadra ? '#6b9e7f' : '#e08a80', marginTop: 8, lineHeight: 1.6 }}>
            {cuadre.cuadra
              ? `Cuadra al centavo: ${F(cuadre.lista, moneda)} de lista − ${cuadre.descuentoPct}% de descuento + ${cuadre.ivaPct}% de IVA = ${F(cuadre.contratoConIva, moneda)}.`
              : `Faltan ${F(Math.abs(cuadre.diferencia), moneda)} para llegar al contrato. ` +
                (cuadre.anticipoCapturado > 0 && !cuadre.anticipoConIva
                  ? 'Lo más probable: el anticipo capturado es el efectivo que entró al banco (con IVA) y se está amortizando como si fuera subtotal. Marca «ya incluye IVA» arriba.'
                  : 'Revisa el anticipo, el descuento y el IVA del contrato.')}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 14 }}>
        <Kpi label="Contrato (esta estim.)" valor={F(T.contrato, moneda)} color="#60A5FA" />
        <Kpi label="Extras" valor={F(T.extras, moneda)} color={T.extras > 0 ? '#D9A441' : '#666'} nota={`${deExtras.filter(i => i.origen === 'extra').length} renglón(es)`} />
        <Kpi label="Deductivas" valor={F(T.deductivas, moneda)} color={T.deductivas < 0 ? '#DC2626' : '#666'} />
        <Kpi label="Amortización" valor={F(T.amortizacion, moneda)} color={T.amortizacion < 0 ? '#A78BFA' : '#666'}
          nota={(est.amortizacion_modo || 'pct') === 'monto' ? 'monto fijo del anticipo' : `${n(est.amortizacion_pct)}% del subtotal`} />
        <Kpi label="Subtotal a cobrar" valor={F(T.baseIva, moneda)} color="#ccc" />
        <Kpi label="Total con IVA" valor={F(T.total, moneda)} color="#10B981" />
      </div>

      {excedentes.length > 0 && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: '#D9A44111', border: '1px solid #D9A44166', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <AlertTriangle size={16} style={{ color: '#D9A441' }} />
          <div style={{ fontSize: 12, color: '#D9A441', fontWeight: 600 }}>
            {excedentes.length} concepto(s) con más ejecutado que lo contratado.
          </div>
          <div style={{ fontSize: 11, color: '#997' }}>
            Eso es trabajo extra y se cobra aparte: si se queda escondido dentro del concepto, nadie lo va a ver en la factura.
          </div>
          {!bloqueada && <Btn size="sm" variant="primary" onClick={pasarTodos} style={{ marginLeft: 'auto' }}>Pasar todos a extras</Btn>}
        </div>
      )}

      {/* Conceptos del contrato, por área */}
      {porArea.map(([area, renglones]) => {
        const visibles = soloConAvance ? renglones.filter(r => n(r.cant_periodo) !== 0) : renglones
        if (visibles.length === 0) return null
        const cerrada = colapsadas.has(area)
        const subArea = renglones.reduce((s, r) => s + n(r.cant_periodo) * n(r.precio_unitario), 0)
        return (
          <div key={area} style={{ marginBottom: 12 }}>
            <div onClick={() => setColapsadas(p => { const x = new Set(p); x.has(area) ? x.delete(area) : x.add(area); return x })}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: '#161616', borderRadius: '6px 6px 0 0', cursor: 'pointer', border: '1px solid #222', borderBottom: 'none' }}>
              <span style={{ fontSize: 11, color: '#888' }}>{cerrada ? '▸' : '▾'}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{area}</span>
              <span style={{ fontSize: 10, color: '#555' }}>{renglones.length} conceptos</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: subArea > 0 ? '#10B981' : '#444' }}>{F(subArea, moneda)}</span>
            </div>
            {!cerrada && (
              <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: '0 0 6px 6px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: '#121212' }}>
                    {['Concepto', 'P.U.', 'Contratado', 'Anterior', 'Esta estim.', 'Acumulado', 'Avance', 'Importe', ''].map((h, i) => (
                      <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : i === 8 ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {visibles.map(it => {
                      const exc = excedenteDe(it)
                      const disp = disponibleDe(it)
                      const acum = n(it.cant_anterior) + n(it.cant_periodo)
                      const av = avanceDe(it)
                      const imp = n(it.cant_periodo) * n(it.precio_unitario)
                      return (
                        <tr key={it.id} style={{ background: exc > 0 ? '#241d0e' : 'transparent' }}>
                          <td style={{ ...td, maxWidth: 380 }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.concepto}</div>
                            {exc > 0 && (
                              <div style={{ fontSize: 10, color: '#D9A441', marginTop: 2 }}>
                                Se pasa {Q(exc)} {it.unidad} de lo contratado ·{' '}
                                {!bloqueada && <span onClick={() => pasarAExtra(it)} style={{ textDecoration: 'underline', cursor: 'pointer' }}>pasarlo a extra</span>}
                              </div>
                            )}
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: '#888', whiteSpace: 'nowrap' }}>{F(it.precio_unitario, moneda)}</td>
                          <td style={{ ...td, textAlign: 'right', color: '#888' }}>{Q(it.cant_contratada)}</td>
                          <td style={{ ...td, textAlign: 'right', color: n(it.cant_anterior) > 0 ? '#A78BFA' : '#444' }}>{Q(it.cant_anterior)}</td>
                          <td style={{ ...td, textAlign: 'right' }}>
                            <input type="number" step="any" disabled={bloqueada}
                              value={it.cant_periodo === 0 ? '' : it.cant_periodo}
                              placeholder={disp > 0 ? Q(disp) : '0'}
                              onChange={e => setCampo(it.id, 'cant_periodo', e.target.value === '' ? 0 : Number(e.target.value))}
                              style={{ ...inp, borderColor: exc > 0 ? '#D9A441' : '#2a2a2a' }} />
                          </td>
                          <td style={{ ...td, textAlign: 'right', color: acum > n(it.cant_contratada) ? '#D9A441' : '#ccc' }}>{Q(acum)}</td>
                          <td style={{ ...td, textAlign: 'right', width: 90 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <div style={{ flex: 1, height: 5, borderRadius: 3, background: '#1a1a1a', overflow: 'hidden' }}>
                                <div style={{ width: `${Math.min(av * 100, 100)}%`, height: '100%', background: av > 1 ? '#D9A441' : av >= 1 ? '#10B981' : '#2563EB' }} />
                              </div>
                              <span style={{ fontSize: 9, color: '#666', minWidth: 26 }}>{Math.round(av * 100)}%</span>
                            </div>
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: imp > 0 ? '#ccc' : '#444', whiteSpace: 'nowrap' }}>{F(imp, moneda)}</td>
                          <td style={td}></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}

      {/* Extras y deductivas */}
      <div style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#D9A441' }}>Extras y deductivas</div>
          <div style={{ fontSize: 10, color: '#666' }}>Lo que no estaba en la cotización. El neteo se hace con deductivas (cantidad negativa), nunca borrando renglones.</div>
          {!bloqueada && <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <Btn size="sm" onClick={() => agregarRenglon('extra')}><Plus size={12} /> Extra</Btn>
            <Btn size="sm" onClick={() => agregarRenglon('deductiva')}><Plus size={12} /> Deductiva</Btn>
          </div>}
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid #222', borderRadius: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#121212' }}>
              {['Tipo', 'Área', 'Concepto', 'Unidad', 'P.U.', 'Cantidad', 'Importe', ''].map((h, i) => (
                <th key={i} style={{ ...th, textAlign: i >= 4 && i <= 6 ? 'right' : 'left' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {deExtras.map(it => {
                const imp = n(it.cant_periodo) * n(it.precio_unitario)
                const esDed = it.origen === 'deductiva'
                return (
                  <tr key={it.id}>
                    <td style={td}><Badge label={esDed ? 'Deductiva' : 'Extra'} color={esDed ? '#DC2626' : '#D9A441'} /></td>
                    <td style={td}>
                      <input disabled={bloqueada} value={it.area || ''} onChange={e => setCampo(it.id, 'area', e.target.value)}
                        style={{ ...inp, width: 110, textAlign: 'left' }} />
                    </td>
                    <td style={td}>
                      <input disabled={bloqueada} value={it.concepto} placeholder="Qué se hizo de más" onChange={e => setCampo(it.id, 'concepto', e.target.value)}
                        style={{ ...inp, width: 320, textAlign: 'left' }} />
                      {it.notas && <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>{it.notas}</div>}
                    </td>
                    <td style={td}>
                      <input disabled={bloqueada} value={it.unidad || ''} onChange={e => setCampo(it.id, 'unidad', e.target.value)}
                        style={{ ...inp, width: 60, textAlign: 'left' }} />
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <input type="number" step="any" disabled={bloqueada} value={it.precio_unitario || ''}
                        onChange={e => setCampo(it.id, 'precio_unitario', Number(e.target.value))} style={inp} />
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <input type="number" step="any" disabled={bloqueada} value={it.cant_periodo || ''}
                        onChange={e => setCampo(it.id, 'cant_periodo', Number(e.target.value))}
                        title={esDed ? 'En una deductiva la cantidad va en negativo' : undefined} style={inp} />
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, color: imp < 0 ? '#DC2626' : '#D9A441', whiteSpace: 'nowrap' }}>{F(imp, moneda)}</td>
                    <td style={td}>
                      {!bloqueada && <button onClick={() => borrarRenglon(it.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer' }}><Trash2 size={13} /></button>}
                    </td>
                  </tr>
                )
              })}
              {deExtras.length === 0 && <tr><td colSpan={8} style={{ padding: 20, textAlign: 'center', color: '#555', fontSize: 12 }}>Sin extras en esta estimación.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cierre */}
      <div style={{ marginTop: 18, padding: '12px 14px', background: '#0f0f0f', border: '1px solid #222', borderRadius: 8, maxWidth: 420, marginLeft: 'auto' }}>
        {([['Obra contratada ejecutada', T.contrato, '#ccc'], ['Deductivas', T.deductivas, '#DC2626'],
           [`Descuento de contrato (${n(est.descuento_pct)}%)`, T.descuento, '#DC2626'], ['Extras', T.extras, '#D9A441'],
           ['Subtotal', T.subtotal, '#ccc'],
           [(est.amortizacion_modo || 'pct') === 'monto'
             ? `Amortización de anticipo (${T.subtotal > 0 ? (Math.abs(T.amortizacion) / T.subtotal * 100).toFixed(2) : '0'}%)`
             : `Amortización de anticipo (${n(est.amortizacion_pct)}%)`, T.amortizacion, '#A78BFA'],
           ['Base gravable', T.baseIva, '#ccc'], [`IVA ${n(est.iva_pct)}%`, T.iva, '#888']] as const).map(([l, v, c], i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '3px 0', color: '#888' }}>
            <span>{l}</span><span style={{ color: c as string, fontWeight: 600 }}>{F(v as number, moneda)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, marginTop: 8, paddingTop: 8, borderTop: '1px solid #222', color: '#fff' }}>
          <span>Total de esta estimación</span><span style={{ color: '#10B981' }}>{F(T.total, moneda)}</span>
        </div>
      </div>
      <div style={{ height: 40 }} />
    </div>
  )
}
