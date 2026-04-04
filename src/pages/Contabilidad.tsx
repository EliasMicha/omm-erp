import { useState } from 'react'
import { SectionHeader, KpiCard, Table, Th, Td, Badge, Btn, EmptyState } from '../components/layout/UI'
import { F, formatDate } from '../lib/utils'
import { FileText, ArrowLeftRight, ShieldCheck, Banknote, Users, TrendingUp, Plus, Upload, AlertTriangle, CheckCircle, Clock, DollarSign, FolderOpen } from 'lucide-react'

type Tab = 'facturacion' | 'conciliacion' | 'supervision' | 'efectivo' | 'cobranza' | 'flujo'
type ISt = 'borrador' | 'timbrada' | 'enviada' | 'pagada' | 'cancelada' | 'error'
type CT = 'I' | 'E' | 'T' | 'P' | 'N'

const TABS: { key: Tab; label: string; icon: typeof FileText }[] = [
  { key: 'facturacion', label: 'Facturación', icon: FileText },
  { key: 'conciliacion', label: 'Conciliación', icon: ArrowLeftRight },
  { key: 'supervision', label: 'Supervisión', icon: ShieldCheck },
  { key: 'efectivo', label: 'Efectivo', icon: Banknote },
  { key: 'cobranza', label: 'Cobranza', icon: DollarSign },
  { key: 'flujo', label: 'Flujo de efectivo', icon: TrendingUp },
  ]

const ISC: Record<ISt, { label: string; color: string }> = {
    borrador: { label: 'Borrador', color: '#6B7280' },
    timbrada: { label: 'Timbrada', color: '#3B82F6' },
    enviada: { label: 'Enviada', color: '#8B5CF6' },
    pagada: { label: 'Pagada', color: '#57FF9A' },
    cancelada: { label: 'Cancelada', color: '#EF4444' },
    error: { label: 'Error', color: '#F59E0B' },
}

const CL: Record<CT, string> = { I: 'Ingreso', E: 'Egreso', T: 'Traslado', P: 'Pago', N: 'Nómina' }

const MI = [
  { id: '1', dir: 'emitida', s: 'FAC', f: '001', t: 'I' as CT, r: 'Alex Niz', e: 'OMM Tech', total: 116000, est: 'timbrada' as ISt, fecha: '2026-04-03', proy: 'Oasis' },
  { id: '2', dir: 'emitida', s: 'FAC', f: '002', t: 'I' as CT, r: 'Grupo Inmobiliario', e: 'OMM Tech', total: 290000, est: 'pagada' as ISt, fecha: '2026-04-01', proy: 'Reforma 222' },
  { id: '3', dir: 'emitida', s: 'NC', f: '001', t: 'E' as CT, r: 'Alex Niz', e: 'OMM Tech', total: 16000, est: 'timbrada' as ISt, fecha: '2026-04-02', proy: 'Oasis' },
  { id: '4', dir: 'recibida', s: '', f: 'A-4521', t: 'I' as CT, r: 'OMM Tech', e: 'Eléctricos Centro', total: 23456, est: 'timbrada' as ISt, fecha: '2026-04-01', proy: 'Oasis' },
  { id: '5', dir: 'recibida', s: '', f: 'B-892', t: 'I' as CT, r: 'OMM Tech', e: 'Ferretería Díaz', total: 8200, est: 'timbrada' as ISt, fecha: '2026-03-30', proy: 'Pachuca' },
  ]

const MC = [
  { id: '1', tipo: 'cobro_cliente', dir: 'ingreso', persona: 'Alex Niz', concepto: 'Pago Oasis', monto: 50000, fecha: '2026-03-29', proy: 'Oasis' },
  { id: '2', tipo: 'cobro_cliente', dir: 'ingreso', persona: 'Grupo Inmob.', concepto: 'Adelanto Reforma', monto: 85000, fecha: '2026-04-01', proy: 'Reforma 222' },
  { id: '3', tipo: 'pago_proveedor', dir: 'egreso', persona: 'Ferretería Díaz', concepto: 'Material', monto: 8500, fecha: '2026-04-01', proy: 'Pachuca' },
  { id: '4', tipo: 'nomina_efectivo', dir: 'egreso', persona: 'Ricardo Flores', concepto: 'Sem 14', monto: 12000, fecha: '2026-04-02', proy: '' },
  { id: '5', tipo: 'nomina_efectivo', dir: 'egreso', persona: 'Juan Pablo', concepto: 'Sem 14', monto: 12000, fecha: '2026-04-02', proy: '' },
  ]

const MS = [
  { id: '1', cliente: 'Alex Niz', proy: 'Oasis', total: 490000, cobrado: 200000, fact: 290000, pend: 290000, pct: 41 },
  { id: '2', cliente: 'Grupo Inmob.', proy: 'Reforma 222', total: 850000, cobrado: 600000, fact: 600000, pend: 250000, pct: 71 },
  { id: '3', cliente: 'Des. Pachuca', proy: 'Pachuca', total: 320000, cobrado: 80000, fact: 160000, pend: 240000, pct: 25 },
  { id: '4', cliente: 'Chapultepec', proy: 'Chapultepec Uno', total: 680000, cobrado: 400000, fact: 680000, pend: 280000, pct: 59 },
  { id: '5', cliente: 'Alex Niz', proy: 'Oasis 6', total: 500000, cobrado: 320000, fact: 0, pend: 180000, pct: 64 },
  ]

const MP = [
  { n: 'Oasis', v: 490000, i: 200000, eg: 145000, u: 55000, m: 28 },
  { n: 'Reforma 222', v: 850000, i: 600000, eg: 380000, u: 220000, m: 37 },
  { n: 'Pachuca', v: 320000, i: 80000, eg: 95000, u: -15000, m: -19 },
  { n: 'Chapultepec Uno', v: 680000, i: 400000, eg: 310000, u: 90000, m: 23 },
  { n: 'Oasis 6', v: 500000, i: 320000, eg: 48000, u: 272000, m: 85 },
  ]

export default function Contabilidad() {
    const [tab, setTab] = useState<Tab>('facturacion')
    return (
          <div style={{ padding: '24px 28px', maxWidth: 1200 }}>
                  <SectionHeader title="Contabilidad" subtitle="Facturación, conciliación, cobranza y flujo de efectivo" />
                  <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid #222' }}>
                    {TABS.map(({ key, label, icon: Icon }) => (
                      <button key={key} onClick={() => setTab(key)} style={{
                                    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', fontSize: 12,
                                    fontWeight: tab === key ? 600 : 400, color: tab === key ? '#57FF9A' : '#666',
                                    background: tab === key ? 'rgba(87,255,154,0.08)' : 'transparent',
                                    border: 'none', borderBottom: tab === key ? '2px solid #57FF9A' : '2px solid transparent',
                                    cursor: 'pointer', fontFamily: 'inherit', borderRadius: '8px 8px 0 0',
                      }}><Icon size={13} />{label}</button>button>
                    ))}
                  </div>div>
            {tab === 'facturacion' && <TF />}
            {tab === 'conciliacion' && <TC />}
            {tab === 'supervision' && <TS />}
            {tab === 'efectivo' && <TE />}
            {tab === 'cobranza' && <TCo />}
            {tab === 'flujo' && <TFl />}
          </div>div>
        )
}

function TF() {
    const [fl, setFl] = useState<'todas' | 'emitidas' | 'recibidas'>('todas')
    const inv = MI.filter(i => fl === 'todas' ? true : fl === 'emitidas' ? i.dir === 'emitida' : i.dir === 'recibida')
    const emi = MI.filter(i => i.dir === 'emitida')
    const rec = MI.filter(i => i.dir === 'recibida')
    const tE = emi.reduce((s, i) => s + (i.t === 'I' ? i.total : 0), 0)
    const tR = rec.reduce((s, i) => s + i.total, 0)
    return (
          <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                        <KpiCard label="Emitidas" value={emi.length} icon={<FileText size={16} />} />
                        <KpiCard label="Facturado" value={F(tE)} color="#3B82F6" icon={<DollarSign size={16} />} />
                        <KpiCard label="Recibidas" value={rec.length} color="#F59E0B" icon={<FileText size={16} />} />
                        <KpiCard label="Por pagar" value={F(tR)} color="#EF4444" icon={<DollarSign size={16} />} />
                </div>div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {(['todas', 'emitidas', 'recibidas'] as const).map(f => (
                        <Btn key={f} size="sm" variant={fl === f ? 'primary' : 'default'} onClick={() => setFl(f)}>
                          {f === 'todas' ? 'Todas' : f === 'emitidas' ? 'Emitidas' : 'Recibidas'}
                        </Btn>Btn>
                      ))}
                        </div>div>
                        <div style={{ display: 'flex', gap: 8 }}>
                                  <Btn size="sm" variant="default"><Upload size={12} /> Subir XML</Btn>Btn>
                                  <Btn size="sm" variant="primary"><Plus size={12} /> Nueva factura</Btn>Btn>
                        </div>div>
                </div>div>
                <Table>
                        <thead><tr><Th>Folio</Th>Th><Th>Dir.</Th>Th><Th>Tipo</Th>Th><Th>Cliente/Prov</Th>Th><Th>Proyecto</Th>Th><Th right>Total</Th>Th><Th>Estado</Th>Th><Th>Fecha</Th>Th></tr>tr></thead>thead>
                        <tbody>
                          {inv.map(i => {
                        const c = ISC[i.est]
                                      return (
                                                      <tr key={i.id}>
                                                                      <Td><span style={{ fontWeight: 600, color: '#fff' }}>{i.s ? i.s + '-' + i.f : i.f}</span>span></Td>Td>
                                                                      <Td><span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: i.dir === 'emitida' ? '#3B82F622' : '#F59E0B22', color: i.dir === 'emitida' ? '#3B82F6' : '#F59E0B' }}>{i.dir === 'emitida' ? '↑ EMI' : '↓ REC'}</span>span></Td>Td>
                                                                      <Td muted>{CL[i.t]}</Td>Td>
                                                                      <Td>{i.dir === 'emitida' ? i.r : i.e}</Td>Td>
                                                                      <Td muted>{i.proy}</Td>Td>
                                                                      <Td right style={{ fontWeight: 600, color: '#fff' }}>{F(i.total)}</Td>Td>
                                                                      <Td><Badge label={c.label} color={c.color} /></Td>Td>
                                                                      <Td muted>{formatDate(i.fecha)}</Td>Td>
                                                      </tr>tr>
                                                    )
                          })}
                        </tbody>tbody>
                </Table>Table>
          </div>div>
        )
}

function TC() {
    return (
          <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                        <KpiCard label="Movimientos" value="0" icon={<ArrowLeftRight size={16} />} />
                        <KpiCard label="Conciliados" value="0" color="#57FF9A" icon={<CheckCircle size={16} />} />
                        <KpiCard label="Pendientes" value="0" color="#F59E0B" icon={<Clock size={16} />} />
                        <KpiCard label="Sin factura" value="0" color="#EF4444" icon={<AlertTriangle size={16} />} />
                </div>div>
                <Btn size="sm" variant="primary"><Upload size={12} /> Subir estado de cuenta</Btn>Btn>
                <EmptyState message="Sube un estado de cuenta CSV de Banorte o BBVA para conciliar" />
          </div>div>
        )
}

function TS() {
    return (
          <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                        <KpiCard label="Vigentes" value={MI.filter(i => i.est !== 'cancelada').length} icon={<CheckCircle size={16} />} />
                        <KpiCard label="Cancelados" value="0" color="#EF4444" icon={<ShieldCheck size={16} />} />
                        <KpiCard label="Compl. pago" value="1" color="#3B82F6" icon={<FileText size={16} />} />
                        <KpiCard label="Alertas" value="2" color="#F59E0B" icon={<AlertTriangle size={16} />} />
                </div>div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#fff', marginBottom: 10 }}>Alertas activas</div>div>
            {[
            { t: 'Anticipo sin egreso', d: 'Riesgo deducibilidad', s: '#EF4444' },
            { t: '2 facturas sin validar SAT', d: 'Verificar UUID', s: '#F59E0B' },
                  ].map((a, i) => (
                            <div key={i} style={{ background: '#141414', border: '1px solid #222', borderRadius: 10, padding: '12px 16px', marginBottom: 8, borderLeft: '3px solid ' + a.s }}>
                                      <div style={{ fontSize: 12, fontWeight: 600, color: '#fff' }}>{'⚠️'} {a.t}</div>div>
                                      <div style={{ fontSize: 11, color: '#666' }}>{a.d}</div>div>
                            </div>div>
                          ))}
          </div>div>
        )
}

function TE() {
    const tC = MC.filter(m => m.tipo === 'cobro_cliente').reduce((s, m) => s + m.monto, 0)
        const tP = MC.filter(m => m.tipo === 'pago_proveedor').reduce((s, m) => s + m.monto, 0)
            const tN = MC.filter(m => m.tipo === 'nomina_efectivo').reduce((s, m) => s + m.monto, 0)
                return (
                      <div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                                    <KpiCard label="Cobros cash" value={F(tC)} color="#57FF9A" icon={<DollarSign size={16} />} />
                                    <KpiCard label="Pagos cash" value={F(tP)} color="#F59E0B" icon={<Banknote size={16} />} />
                                    <KpiCard label="Nómina cash" value={F(tN)} color="#C084FC" icon={<Users size={16} />} />
                            </div>div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                                    <span style={{ fontSize: 13, color: '#666' }}>Neto: <span style={{ color: tC - tP - tN >= 0 ? '#57FF9A' : '#EF4444', fontWeight: 700 }}>{F(tC - tP - tN)}</span>span></span>span>
                                    <Btn size="sm" variant="primary"><Plus size={12} /> Registrar</Btn>Btn>
                            </div>div>
                            <Table>
                                    <thead><tr><Th>Fecha</Th>Th><Th>Tipo</Th>Th><Th>Persona</Th>Th><Th>Proyecto</Th>Th><Th right>Monto</Th>Th></tr>tr></thead>thead>
                                    <tbody>
                                      {MC.map(m => (
                                    <tr key={m.id}>
                                                  <Td muted>{formatDate(m.fecha)}</Td>Td>
                                                  <Td><Badge label={m.tipo === 'cobro_cliente' ? 'Cobro' : m.tipo === 'pago_proveedor' ? 'Pago' : 'Nómina'} color={m.tipo === 'cobro_cliente' ? '#57FF9A' : m.tipo === 'pago_proveedor' ? '#F59E0B' : '#C084FC'} /></Td>Td>
                                                  <Td><span style={{ color: '#fff', fontWeight: 500 }}>{m.persona}</span>span></Td>Td>
                                                  <Td muted>{m.proy || '—'}</Td>Td>
                                                  <Td right style={{ fontWeight: 600, color: m.dir === 'ingreso' ? '#57FF9A' : '#ccc' }}>{m.dir === 'ingreso' ? '+' : '-'}{F(m.monto)}</Td>Td>
                                    </tr>tr>
                                  ))}
                                    </tbody>tbody>
                            </Table>Table>
                      </div>div>
                    )
}

function TCo() {
    const tV = MS.reduce((s, v) => s + v.total, 0)
        const tC = MS.reduce((s, v) => s + v.cobrado, 0)
            const tP = MS.reduce((s, v) => s + v.pend, 0)
                return (
                      <div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
                                    <KpiCard label="Vendido" value={F(tV)} icon={<FolderOpen size={16} />} />
                                    <KpiCard label="Cobrado" value={F(tC)} color="#57FF9A" icon={<CheckCircle size={16} />} />
                                    <KpiCard label="Pendiente" value={F(tP)} color="#EF4444" icon={<AlertTriangle size={16} />} />
                            </div>div>
                            <Table>
                                    <thead><tr><Th>Proyecto</Th>Th><Th right>Venta</Th>Th><Th right>Cobrado</Th>Th><Th right>Pendiente</Th>Th><Th>Avance</Th>Th></tr>tr></thead>thead>
                                    <tbody>
                                      {MS.map(s => (
                                    <tr key={s.id}>
                                                  <Td><div style={{ fontWeight: 600, color: '#fff' }}>{s.proy}</div>div><div style={{ fontSize: 10, color: '#555' }}>{s.cliente}</div>div></Td>Td>
                                                  <Td right muted>{F(s.total)}</Td>Td>
                                                  <Td right style={{ color: '#57FF9A', fontWeight: 600 }}>{F(s.cobrado)}</Td>Td>
                                                  <Td right style={{ color: '#EF4444', fontWeight: 600 }}>{F(s.pend)}</Td>Td>
                                                  <Td>
                                                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 120 }}>
                                                                                    <div style={{ flex: 1, height: 8, background: '#2a2a2a', borderRadius: 4, overflow: 'hidden' }}>
                                                                                                        <div style={{ width: s.pct + '%', height: '100%', background: '#1D9E75' }} />
                                                                                      </div>div>
                                                                                    <span style={{ fontSize: 11, color: '#666' }}>{s.pct}%</span>span>
                                                                  </div>div>
                                                  </Td>Td>
                                    </tr>tr>
                                  ))}
                                    </tbody>tbody>
                            </Table>Table>
                      </div>div>
                    )
}

function TFl() {
    const [vw, setVw] = useState<'proyecto' | 'mensual'>('proyecto')
        const gf = 362000
            const oc = 216456
                const fp = 24000
                    const tEg = gf + oc + fp
                        const hc = 320000
                            const fc = 201000
                                const ee = 50000
                                    const tIn = hc + fc + ee
                                        const gap = tIn - tEg
                                            const sub = MP.reduce((s, p) => s + p.u, 0)
                                                return (
                                                      <div>
                                                            <div style={{ display: 'flex', gap: 6, marginBottom: 20 }}>
                                                                    <Btn size="sm" variant={vw === 'proyecto' ? 'primary' : 'default'} onClick={() => setVw('proyecto')}>
                                                                              <FolderOpen size={12} /> Por proyecto
                                                                    </Btn>Btn>
                                                                    <Btn size="sm" variant={vw === 'mensual' ? 'primary' : 'default'} onClick={() => setVw('mensual')}>
                                                                              <TrendingUp size={12} /> Mensual
                                                                    </Btn>Btn>
                                                            </div>div>
                                                        {vw === 'proyecto' ? (
                                                                <Table>
                                                                          <thead><tr><Th>Proyecto</Th>Th><Th right>Venta</Th>Th><Th right>Cobrado</Th>Th><Th right>Gastado</Th>Th><Th right>Utilidad</Th>Th><Th right>Margen</Th>Th></tr>tr></thead>thead>
                                                                          <tbody>
                                                                            {MP.map((p, i) => (
                                                                                <tr key={i}>
                                                                                                <Td><span style={{ fontWeight: 600, color: '#fff' }}>{p.n}</span>span></Td>Td>
                                                                                                <Td right muted>{F(p.v)}</Td>Td>
                                                                                                <Td right style={{ color: '#57FF9A' }}>{F(p.i)}</Td>Td>
                                                                                                <Td right style={{ color: '#F59E0B' }}>{F(p.eg)}</Td>Td>
                                                                                                <Td right style={{ fontWeight: 700, color: p.u >= 0 ? '#57FF9A' : '#EF4444' }}>{p.u >= 0 ? '+' : ''}{F(p.u)}</Td>Td>
                                                                                                <Td right><span style={{ fontWeight: 700, color: p.m >= 30 ? '#57FF9A' : p.m >= 0 ? '#F59E0B' : '#EF4444' }}>{p.m}%</span>span></Td>Td>
                                                                                </tr>tr>
                                                                              ))}
                                                                                      <tr style={{ background: '#1a1a1a' }}>
                                                                                                    <Td><span style={{ fontWeight: 700, color: '#666', fontSize: 11 }}>SUBTOTAL</span>span></Td>Td>
                                                                                                    <Td right style={{ fontWeight: 700, color: '#fff' }}>{F(MP.reduce((s, p) => s + p.v, 0))}</Td>Td>
                                                                                                    <Td right style={{ fontWeight: 700, color: '#57FF9A' }}>{F(MP.reduce((s, p) => s + p.i, 0))}</Td>Td>
                                                                                                    <Td right style={{ fontWeight: 700, color: '#F59E0B' }}>{F(MP.reduce((s, p) => s + p.eg, 0))}</Td>Td>
                                                                                                    <Td right style={{ fontWeight: 700, color: '#57FF9A' }}>+{F(sub)}</Td>Td>
                                                                                                    <Td right style={{ fontWeight: 700, color: '#57FF9A' }}>{Math.round(sub / MP.reduce((s, p) => s + p.i, 0) * 100)}%</Td>Td>
                                                                                      </tr>tr>
                                                                                      <tr>
                                                                                                    <Td><span style={{ color: '#666' }}>OMM — Gastos generales</span>span></Td>Td>
                                                                                                    <Td right muted>—</Td>Td><Td right muted>—</Td>Td>
                                                                                                    <Td right style={{ color: '#F59E0B' }}>{F(gf)}</Td>Td>
                                                                                                    <Td right style={{ fontWeight: 700, color: '#EF4444' }}>-{F(gf)}</Td>Td>
                                                                                                    <Td right muted>—</Td>Td>
                                                                                      </tr>tr>
                                                                                      <tr style={{ background: '#1a1a1a' }}>
                                                                                                    <Td><span style={{ fontWeight: 700, color: '#fff', fontSize: 13 }}>TOTAL EMPRESA</span>span></Td>Td>
                                                                                                    <Td colSpan={3}></Td>Td>
                                                                                                    <Td right style={{ fontSize: 16, fontWeight: 700, color: sub - gf >= 0 ? '#57FF9A' : '#EF4444' }}>{sub - gf >= 0 ? '+' : ''}{F(sub - gf)}</Td>Td>
                                                                                                    <Td></Td>Td>
                                                                                      </tr>tr>
                                                                          </tbody>tbody>
                                                                </Table>Table>
                                                              ) : (
                                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 20 }}>
                                                                          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
                                                                                      <div style={{ fontSize: 14, fontWeight: 600, color: '#EF4444', marginBottom: 12 }}>Debo pagar</div>div>
                                                                            {[{ l: 'Gastos fijos', v: gf }, { l: 'OC materiales', v: oc }, { l: 'Fact. por pagar', v: fp }].map((x, i) => (
                                                                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
                                                                                                <span style={{ fontSize: 12, color: '#888' }}>{x.l}</span>span>
                                                                                                <span style={{ fontSize: 12, color: '#ccc' }}>{F(x.v)}</span>span>
                                                                                </div>div>
                                                                              ))}
                                                                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                                                                                                    <span style={{ fontWeight: 700, color: '#EF4444' }}>Total</span>span>
                                                                                                    <span style={{ fontWeight: 700, color: '#EF4444' }}>{F(tEg)}</span>span>
                                                                                      </div>div>
                                                                          </div>div>
                                                                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: gap >= 0 ? '#57FF9A11' : '#EF444411', border: '1px solid ' + (gap >= 0 ? '#57FF9A33' : '#EF444433'), borderRadius: 12, padding: '16px 24px', minWidth: 140 }}>
                                                                                      <div style={{ fontSize: 11, color: '#666' }}>GAP</div>div>
                                                                                      <div style={{ fontSize: 22, fontWeight: 700, color: gap >= 0 ? '#57FF9A' : '#EF4444' }}>{gap >= 0 ? '+' : ''}{F(gap)}</div>div>
                                                                          </div>div>
                                                                          <div style={{ background: '#141414', border: '1px solid #222', borderRadius: 12, padding: 16 }}>
                                                                                      <div style={{ fontSize: 14, fontWeight: 600, color: '#57FF9A', marginBottom: 12 }}>Debo cobrar</div>div>
                                                                            {[{ l: 'Hitos cobro', v: hc }, { l: 'Fact. pendientes', v: fc }, { l: 'Efectivo esp.', v: ee }].map((x, i) => (
                                                                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #1a1a1a' }}>
                                                                                                <span style={{ fontSize: 12, color: '#888' }}>{x.l}</span>span>
                                                                                                <span style={{ fontSize: 12, color: '#ccc' }}>{F(x.v)}</span>span>
                                                                                </div>div>
                                                                              ))}
                                                                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                                                                                                    <span style={{ fontWeight: 700, color: '#57FF9A' }}>Total</span>span>
                                                                                                    <span style={{ fontWeight: 700, color: '#57FF9A' }}>{F(tIn)}</span>span>
                                                                                      </div>div>
                                                                          </div>div>
                                                                </div>div>
                                                            )}
                                                      </div>div>
                                                    )
                                                  }</div>
