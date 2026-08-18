// ═══════════════════════════════════════════════════════════════════════════
// AvisosEntregas — la campana del módulo de Entregas e Inventario.
//
// Junta lo que le tiene que llegar al almacén sin que nadie se lo diga:
//   · solicitudes de material nuevas desde la app de obra
//   · órdenes de compra que Compras acaba de confirmar (pedida/aprobada)
//   · OC que ya deberían haber llegado (expected_delivery vencida)
//   · entregas programadas para hoy
//   · extras nuevos por cotizar
//
// Qué cuenta como "nuevo": todo lo creado después de la última vez que este
// usuario abrió el panel. Esa marca vive en `entregas_visto` (una fila por
// usuario), no en localStorage, para que sea la misma en cualquier navegador.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from 'react'
import { Bell, Package, ShoppingCart, Truck, Clock, Sparkles, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'

export interface Aviso {
  id: string
  tipo: 'solicitud' | 'oc' | 'oc_retrasada' | 'entrega_hoy' | 'extra'
  titulo: string
  detalle: string
  fecha: string
  nuevo: boolean
  irA?: 'solicitudes' | 'agenda' | 'compras'
}

const CFG: Record<Aviso['tipo'], { color: string; Icon: any; label: string }> = {
  solicitud:     { color: '#A78BFA', Icon: Package,      label: 'Solicitud de obra' },
  oc:            { color: '#10B981', Icon: ShoppingCart, label: 'OC confirmada' },
  oc_retrasada:  { color: '#DC2626', Icon: Clock,        label: 'OC retrasada' },
  entrega_hoy:   { color: '#60A5FA', Icon: Truck,        label: 'Entrega de hoy' },
  extra:         { color: '#D97706', Icon: Sparkles,     label: 'Extra por cotizar' },
}

const hoyISO = () => new Date().toISOString().slice(0, 10)

export default function AvisosEntregas({ userKey, onIr }: {
  userKey: string
  onIr?: (destino: 'solicitudes' | 'agenda' | 'compras') => void
}) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [abierto, setAbierto] = useState(false)
  const [visto, setVisto] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  async function cargar() {
    // Marca de "ya lo vi". Si el usuario nunca ha abierto el panel, tomamos
    // los últimos 7 días para no enterrarlo en avisos viejos el primer día.
    const { data: v } = await supabase.from('entregas_visto')
      .select('visto_at').eq('user_key', userKey).maybeSingle()
    const desde = (v as any)?.visto_at || new Date(Date.now() - 7 * 86400000).toISOString()
    setVisto(desde)

    const hoy = hoyISO()
    const [sols, ocs, dels, extras] = await Promise.all([
      supabase.from('obra_material_solicitudes')
        .select('id,folio,fecha,created_at,status,solicitante_nombre,requerido_para,obras(nombre)')
        .in('status', ['solicitada', 'aprobada', 'surtida_parcial'])
        .order('created_at', { ascending: false }).limit(40),
      supabase.from('purchase_orders')
        .select('id,po_number,status,created_at,updated_at,expected_delivery,total,currency,suppliers(name)')
        .in('status', ['pedida', 'aprobada'])
        .order('updated_at', { ascending: false }).limit(40),
      supabase.from('deliveries')
        .select('id,folio,delivery_date,scheduled_time,status,created_at,obras(nombre)')
        .in('status', ['pendiente', 'en_ruta']).eq('delivery_date', hoy).limit(20),
      supabase.from('obra_extras')
        .select('id,descripcion,cantidad,detectado_at,detectado_por,status,obras(nombre)')
        .eq('status', 'pendiente_revision')
        .order('detectado_at', { ascending: false }).limit(30),
    ])

    const out: Aviso[] = []
    const esNuevo = (t?: string | null) => !!t && t > desde

    ;(((sols as any).data || []) as any[]).forEach(s => out.push({
      id: 'sol-' + s.id, tipo: 'solicitud',
      titulo: `${s.folio || 'Solicitud'} · ${s.obras?.nombre || 'Obra'}`,
      detalle: `${s.solicitante_nombre || 'Obra'} pidió material${s.requerido_para ? ` para el ${s.requerido_para}` : ''}`,
      fecha: s.created_at, nuevo: esNuevo(s.created_at), irA: 'solicitudes',
    }))

    ;(((ocs as any).data || []) as any[]).forEach(p => {
      const retrasada = p.expected_delivery && p.expected_delivery < hoy
      out.push({
        id: 'oc-' + p.id, tipo: retrasada ? 'oc_retrasada' : 'oc',
        titulo: `${p.po_number || 'OC'} · ${p.suppliers?.name || 'Proveedor'}`,
        detalle: retrasada
          ? `Se esperaba el ${p.expected_delivery} y no se ha recibido`
          : `Confirmada${p.expected_delivery ? ` · llega ~${p.expected_delivery}` : ''}`,
        fecha: p.updated_at || p.created_at,
        nuevo: retrasada || esNuevo(p.updated_at || p.created_at),
        irA: 'compras',
      })
    })

    ;(((dels as any).data || []) as any[]).forEach(d => out.push({
      id: 'del-' + d.id, tipo: 'entrega_hoy',
      titulo: `${d.obras?.nombre || 'Obra'}${d.scheduled_time ? ` · ${String(d.scheduled_time).slice(0, 5)}` : ''}`,
      detalle: d.status === 'en_ruta' ? 'Ya va en camino' : 'Programada para hoy',
      fecha: d.created_at, nuevo: true, irA: 'agenda',
    }))

    ;(((extras as any).data || []) as any[]).forEach(e => out.push({
      id: 'ext-' + e.id, tipo: 'extra',
      titulo: `${e.obras?.nombre || 'Obra'} · ${e.cantidad || 1} × ${String(e.descripcion || '').slice(0, 60)}`,
      detalle: e.detectado_por === 'app_obra' ? 'Pedido desde la app de obra' : 'Detectado en un reporte',
      fecha: e.detectado_at, nuevo: esNuevo(e.detectado_at), irA: 'solicitudes',
    }))

    out.sort((a, b) => Number(b.nuevo) - Number(a.nuevo) || String(b.fecha || '').localeCompare(String(a.fecha || '')))
    setAvisos(out)
  }

  useEffect(() => {
    cargar()
    // Refresco cada 2 minutos: el almacén deja esta pantalla abierta todo el día.
    const t = setInterval(cargar, 120000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userKey])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    return () => document.removeEventListener('mousedown', fuera)
  }, [abierto])

  async function marcarVisto() {
    const ahora = new Date().toISOString()
    await supabase.from('entregas_visto')
      .upsert({ user_key: userKey, visto_at: ahora, updated_at: ahora }, { onConflict: 'user_key' })
    setVisto(ahora)
    setAvisos(a => a.map(x => x.tipo === 'entrega_hoy' ? x : { ...x, nuevo: false }))
  }

  const nuevos = avisos.filter(a => a.nuevo).length

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setAbierto(v => !v)} title="Avisos del almacén"
        style={{
          position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', borderRadius: 9, cursor: 'pointer', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 600,
          border: `1px solid ${nuevos ? '#A78BFA55' : '#262626'}`,
          background: nuevos ? '#A78BFA18' : '#111',
          color: nuevos ? '#C4B5FD' : '#888',
        }}>
        <Bell size={14} />
        Avisos
        {nuevos > 0 && (
          <span style={{
            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
            background: '#DC2626', color: '#fff', fontSize: 10, fontWeight: 800,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{nuevos}</span>
        )}
      </button>

      {abierto && (
        <div style={{
          position: 'absolute', right: 0, top: 40, zIndex: 90, width: 420, maxWidth: '92vw',
          maxHeight: 520, overflowY: 'auto',
          background: '#101010', border: '1px solid #262626', borderRadius: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,.7)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '11px 13px',
            borderBottom: '1px solid #1f1f1f', position: 'sticky', top: 0, background: '#101010',
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', flex: 1 }}>
              Avisos del almacén {nuevos > 0 && <span style={{ color: '#C4B5FD' }}>· {nuevos} sin ver</span>}
            </span>
            {nuevos > 0 && (
              <button onClick={marcarVisto} style={{
                fontSize: 11, fontWeight: 600, color: '#4ADE80', background: 'transparent',
                border: '1px solid #10B98144', borderRadius: 7, padding: '4px 9px',
                cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4,
              }}><Check size={11} /> Marcar visto</button>
            )}
          </div>

          {avisos.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: '#666', fontSize: 12 }}>
              Nada pendiente por ahora.
            </div>
          ) : avisos.map(a => {
            const c = CFG[a.tipo]
            return (
              <div key={a.id} onClick={() => { if (a.irA && onIr) { onIr(a.irA); setAbierto(false) } }}
                style={{
                  display: 'flex', gap: 10, padding: '10px 13px', borderBottom: '1px solid #191919',
                  cursor: a.irA ? 'pointer' : 'default',
                  background: a.nuevo ? c.color + '0d' : 'transparent',
                }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: c.color + '1a', border: `1px solid ${c.color}33`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <c.Icon size={14} color={c.color} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: c.color, textTransform: 'uppercase', letterSpacing: .5 }}>
                      {c.label}
                    </span>
                    {a.nuevo && (
                      <span style={{
                        fontSize: 8, fontWeight: 800, color: '#fff', background: '#DC2626',
                        padding: '1px 6px', borderRadius: 6,
                      }}>NUEVO</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#ddd', fontWeight: 600, lineHeight: 1.3, marginTop: 1 }}>
                    {a.titulo}
                  </div>
                  <div style={{ fontSize: 11, color: '#777', lineHeight: 1.35 }}>{a.detalle}</div>
                </div>
              </div>
            )
          })}

          {visto && (
            <div style={{ padding: '8px 13px', fontSize: 10, color: '#555', textAlign: 'center' }}>
              «Nuevo» = después del {new Date(visto).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
