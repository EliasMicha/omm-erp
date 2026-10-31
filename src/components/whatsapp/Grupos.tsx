import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Copy, Link2, Search, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { llamarGrupos } from '../../lib/whatsappSend'

// Grupos de WhatsApp del número de OMM (2026-10-30). Dos piezas que usa
// Conversaciones: el formulario para crear uno y el panel de un grupo abierto
// (participantes, liga, invitar, quitar, borrar).
//
// Meta: máximo 8 personas además de OMM, y sólo se entra con la liga. "Invitar"
// le manda la liga a esa persona por su chat individual; entra cuando la toca.

export interface GrupoWa {
  id: string; group_id: string | null; nombre: string; tipo: 'obra' | 'interno'; invite_link: string | null
  participantes: { wa_id: string }[]; estado: string; error: string | null; created_at: string
}
export interface Contacto { nombre: string; detalle?: string; tipo: 'equipo' | 'cliente' | 'desconocido' }

export const MAX_PARTICIPANTES = 8
const C = { panel: '#111b21', cabecera: '#202c33', borde: '#222d34', hover: '#202c33', texto: '#e9edef', tenue: '#8696a0', verde: '#25D366' }
const ult10 = (p: string) => (p || '').replace(/\D/g, '').slice(-10)
const telBonito = (t10: string) => t10.length === 10 ? `+52 ${t10.slice(0, 2)} ${t10.slice(2, 6)} ${t10.slice(6)}` : t10

function Selector(props: { nombres: Record<string, Contacto>; elegidos: string[]; setElegidos: (x: string[]) => void; max: number; tamTexto: number }) {
  const { nombres, elegidos, setElegidos, max, tamTexto } = props
  const [q, setQ] = useState('')
  const dig = q.replace(/\D/g, '')
  const lista = useMemo(() => Object.entries(nombres)
    .filter(([k, v]) => !q.trim() || v.nombre.toLowerCase().includes(q.trim().toLowerCase()) || (v.detalle || '').toLowerCase().includes(q.trim().toLowerCase()) || (dig.length >= 3 && k.includes(dig)))
    .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, 'es')).slice(0, 60), [nombres, q])
  const toggle = (k: string) => setElegidos(elegidos.includes(k) ? elegidos.filter(x => x !== k) : elegidos.length >= max ? elegidos : [...elegidos, k])
  const tecleado = dig.slice(-10)
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: C.cabecera, borderRadius: 20, padding: '8px 14px', margin: '0 10px 6px' }}>
        <Search size={16} color={C.tenue} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nombre, obra o número de 10 dígitos"
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: C.texto, fontSize: tamTexto }} />
      </div>
      {elegidos.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '2px 12px 8px' }}>
          {elegidos.map(k => (
            <span key={k} onClick={() => toggle(k)} style={{ background: '#103529', color: C.verde, borderRadius: 14, padding: '3px 10px', fontSize: 12.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {nombres[k]?.nombre || telBonito(k)} <X size={12} />
            </span>
          ))}
        </div>
      )}
      {tecleado.length === 10 && !nombres[tecleado] && (
        <div onClick={() => toggle(tecleado)} style={{ padding: '9px 16px', cursor: 'pointer', color: C.texto, fontSize: 14.5 }}>
          {elegidos.includes(tecleado) ? '✓ ' : '+ '}Agregar {telBonito(tecleado)}
        </div>
      )}
      {lista.map(([k, v]) => {
        const on = elegidos.includes(k)
        return (
          <div key={k} onClick={() => toggle(k)} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 16px', cursor: 'pointer', opacity: !on && elegidos.length >= max ? 0.4 : 1 }}
            onMouseEnter={e => { e.currentTarget.style.background = C.hover }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
            <span style={{ width: 20, height: 20, borderRadius: 4, border: `1.5px solid ${on ? C.verde : C.tenue}`, background: on ? C.verde : 'transparent', display: 'grid', placeItems: 'center', flexShrink: 0 }}>{on && <Check size={14} color="#0b141a" />}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: C.texto, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nombre}</div>
              <div style={{ color: C.tenue, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{telBonito(k)}{v.detalle ? ` · ${v.detalle}` : ''}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

async function invitarVarios(groupId: string, tels: string[], nombres: Record<string, Contacto>) {
  const malos: string[] = []
  for (const t of tels) {
    try {
      const r = await llamarGrupos({ action: 'invitar', group_id: groupId, to: t, nombre: nombres[t]?.tipo !== 'desconocido' ? nombres[t]?.nombre : undefined })
      if (r?.ok === false) malos.push(`${nombres[t]?.nombre || telBonito(t)}: ${r.error}`)
    } catch (e) { malos.push(`${nombres[t]?.nombre || telBonito(t)}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  return malos
}

// ── Crear grupo ─────────────────────────────────────────────────────────────
export function NuevoGrupo(props: { nombres: Record<string, Contacto>; onCerrar: () => void; onCreado: (groupId: string | null) => void; app: boolean; tamTexto: number }) {
  const { nombres, onCerrar, onCreado, app, tamTexto } = props
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('obra' as 'obra' | 'interno')
  const [elegidos, setElegidos] = useState([] as string[])
  const [trabajando, setTrabajando] = useState(false)
  const [msg, setMsg] = useState('')

  async function crear() {
    if (!nombre.trim()) { setMsg('Ponle nombre al grupo.'); return }
    setTrabajando(true); setMsg('Creando el grupo en WhatsApp…')
    try {
      const r = await llamarGrupos({ action: 'crear', nombre: nombre.trim(), tipo })
      if (r?.ok === false) { setMsg(r.error); return }
      if (!r.group_id) { setMsg(r.nota || 'Meta está creando el grupo; aparece en la lista en unos segundos. Invita a la gente desde el menú del grupo.'); setTimeout(() => onCreado(null), 2500); return }
      if (elegidos.length) {
        setMsg(`Grupo creado. Mandando la liga a ${elegidos.length} persona${elegidos.length === 1 ? '' : 's'}…`)
        const malos = await invitarVarios(r.group_id, elegidos, nombres)
        if (malos.length) { setMsg('Grupo creado. No le llegó la liga a: ' + malos.join(' · ')); setTimeout(() => onCreado(r.group_id), 4000); return }
      }
      onCreado(r.group_id)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    finally { setTrabajando(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, background: C.panel }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: `calc(${app ? 'env(safe-area-inset-top)' : '0px'} + 10px) 10px 6px 4px`, background: C.cabecera }}>
        <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'none', border: 0, color: C.texto, padding: 6, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><ArrowLeft size={22} /></button>
        <div style={{ color: C.texto, fontSize: 17, fontWeight: 600 }}>Nuevo grupo</div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        <div style={{ padding: '12px 14px 4px' }}>
          <input autoFocus value={nombre} onChange={e => setNombre(e.target.value.slice(0, 100))} placeholder="Nombre del grupo (ej. OMM · Cero5cien L202)"
            style={{ width: '100%', boxSizing: 'border-box', background: C.cabecera, border: 0, outline: 'none', borderRadius: 8, padding: '10px 12px', color: C.texto, fontSize: tamTexto }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {([['obra', 'Obra con cliente'], ['interno', 'Interno (cuadrilla)']] as const).map(([k, t]) => (
              <button key={k} onClick={() => setTipo(k)} style={{ flex: 1, border: `1px solid ${tipo === k ? C.verde : C.borde}`, background: tipo === k ? '#103529' : 'transparent', color: tipo === k ? C.verde : C.tenue, borderRadius: 8, padding: '8px 6px', fontSize: 13.5, cursor: 'pointer' }}>{t}</button>
            ))}
          </div>
          <div style={{ color: C.tenue, fontSize: 12.5, marginTop: 10, lineHeight: 1.4 }}>
            El asistente no participa: lo que escriban en el grupo lo ves aquí y contestas tú. WhatsApp deja hasta {MAX_PARTICIPANTES} personas además de OMM, y sólo entran con la liga: a quien elijas le llega por su chat y entra cuando la toca.
          </div>
        </div>
        <div style={{ color: C.tenue, fontSize: 12, padding: '12px 16px 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Invitar ({elegidos.length}/{MAX_PARTICIPANTES})</div>
        <Selector nombres={nombres} elegidos={elegidos} setElegidos={setElegidos} max={MAX_PARTICIPANTES} tamTexto={tamTexto} />
      </div>
      {msg && <div style={{ background: '#1f2c33', color: '#d1d7db', fontSize: 13, padding: '8px 14px' }}>{msg}</div>}
      <div style={{ padding: '10px 14px calc(env(safe-area-inset-bottom) + 10px)', background: C.cabecera }}>
        <button onClick={crear} disabled={trabajando || !nombre.trim()} style={{ width: '100%', border: 0, borderRadius: 22, padding: '12px', background: C.verde, color: '#0b141a', fontWeight: 700, fontSize: 15, cursor: 'pointer', opacity: trabajando || !nombre.trim() ? 0.5 : 1 }}>
          {trabajando ? 'Creando…' : elegidos.length ? `Crear y mandar la liga a ${elegidos.length}` : 'Crear grupo'}
        </button>
      </div>
    </div>
  )
}

// ── Panel de un grupo ───────────────────────────────────────────────────────
export function PanelGrupo(props: { grupo: GrupoWa; nombres: Record<string, Contacto>; onCerrar: () => void; onCambio: () => void; tamTexto: number }) {
  const { grupo, nombres, onCerrar, onCambio, tamTexto } = props
  const [info, setInfo] = useState(null as null | { participantes: { wa_id: string }[]; invite_link: string | null; solicitudes: any[]; suspendido: boolean })
  const [msg, setMsg] = useState('')
  const [invitando, setInvitando] = useState(false)
  const [elegidos, setElegidos] = useState([] as string[])
  const [trabajando, setTrabajando] = useState(false)
  const gid = grupo.group_id!

  async function cargar() {
    try {
      const r = await llamarGrupos({ action: 'info', group_id: gid })
      if (r?.ok === false) setMsg(r.error); else setInfo(r)
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => { cargar() }, [gid])

  async function hacer(payload: Record<string, unknown>, okMsg: string) {
    setTrabajando(true); setMsg('')
    try {
      const r = await llamarGrupos({ ...payload, group_id: gid })
      if (r?.ok === false) setMsg(r.error)
      else { setMsg(okMsg); if (r.participantes) setInfo(r); else await cargar(); onCambio() }
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    finally { setTrabajando(false) }
  }

  const parts = info?.participantes || grupo.participantes || []
  const libres = MAX_PARTICIPANTES - parts.length
  const liga = info?.invite_link || grupo.invite_link

  return (
    <div style={{ position: 'absolute', inset: 0, background: C.panel, zIndex: 30, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px 8px 4px', background: C.cabecera }}>
        <button onClick={onCerrar} aria-label="Cerrar" style={{ background: 'none', border: 0, color: C.texto, padding: 6, cursor: 'pointer', display: 'grid', placeItems: 'center' }}><ArrowLeft size={22} /></button>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.texto, fontSize: 16.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{grupo.nombre}</div>
          <div style={{ color: C.tenue, fontSize: 12.5 }}>{grupo.tipo === 'interno' ? 'Grupo interno' : 'Grupo de obra con cliente'} · {parts.length}/{MAX_PARTICIPANTES} personas{info?.suspendido ? ' · SUSPENDIDO por WhatsApp' : ''}</div>
        </div>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {invitando ? (<>
          <div style={{ color: C.tenue, fontSize: 12, padding: '12px 16px 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Mandar la liga ({elegidos.length}/{Math.max(0, libres)})</div>
          <Selector nombres={nombres} elegidos={elegidos} setElegidos={setElegidos} max={Math.max(0, libres)} tamTexto={tamTexto} />
        </>) : (<>
          <div style={{ padding: '12px 16px' }}>
            <div style={{ color: C.tenue, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Liga de invitación</div>
            {liga ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ flex: 1, minWidth: 0, color: '#9de1cf', fontSize: 13, overflowWrap: 'anywhere' }}>{liga}</span>
                <button onClick={() => { navigator.clipboard?.writeText(liga); setMsg('Liga copiada.') }} title="Copiar" style={{ background: 'none', border: 0, color: C.texto, cursor: 'pointer' }}><Copy size={17} /></button>
              </div>
            ) : <div style={{ color: C.tenue, fontSize: 13 }}>{info ? 'Sin liga' : 'Cargando…'}</div>}
          </div>
          <Accion icono={<UserPlus size={18} />} t={libres > 0 ? 'Invitar a alguien' : `El grupo está lleno (${MAX_PARTICIPANTES})`} onClick={() => { if (libres > 0) { setInvitando(true); setElegidos([]) } }} />
          <Accion icono={<Link2 size={18} />} t="Hacer una liga nueva (la anterior deja de servir)" onClick={() => { if (confirm('La liga actual deja de funcionar. ¿Hacer una nueva?')) hacer({ action: 'nueva_liga' }, 'Liga nueva lista.') }} />
          {(info?.solicitudes || []).length > 0 && (<>
            <div style={{ color: C.tenue, fontSize: 12, padding: '14px 16px 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Quieren entrar</div>
            {info!.solicitudes.map((s: any) => (
              <div key={s.join_request_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', color: C.texto, fontSize: 14 }}>
                <span style={{ flex: 1 }}>{nombres[ult10(s.wa_id)]?.nombre || telBonito(ult10(s.wa_id))}</span>
                <button onClick={() => hacer({ action: 'solicitud', ids: [s.join_request_id], aprobar: true }, 'Aprobado.')} style={{ background: '#103529', color: C.verde, border: 0, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>Aceptar</button>
                <button onClick={() => hacer({ action: 'solicitud', ids: [s.join_request_id], aprobar: false }, 'Rechazado.')} style={{ background: 'none', color: C.tenue, border: `1px solid ${C.borde}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>No</button>
              </div>
            ))}
          </>)}
          <div style={{ color: C.tenue, fontSize: 12, padding: '14px 16px 6px', textTransform: 'uppercase', letterSpacing: 0.4 }}>Participantes</div>
          {!info && <div style={{ color: C.tenue, fontSize: 13, padding: '4px 16px' }}>Cargando…</div>}
          {info && parts.length === 0 && <div style={{ color: C.tenue, fontSize: 13, padding: '4px 16px' }}>Todavía nadie entra. Invita a la gente: entran al tocar la liga.</div>}
          {parts.map(p => {
            const k = ult10(p.wa_id)
            return (
              <div key={p.wa_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px' }}>
                <Users size={16} color={C.tenue} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.texto, fontSize: 14.5 }}>{nombres[k]?.nombre || telBonito(k)}</div>
                  {nombres[k] && <div style={{ color: C.tenue, fontSize: 12 }}>{telBonito(k)}</div>}
                </div>
                <button onClick={() => { if (confirm(`¿Sacar a ${nombres[k]?.nombre || telBonito(k)} del grupo?`)) hacer({ action: 'quitar', telefono: p.wa_id }, 'Lo saqué del grupo.') }} title="Sacar del grupo" style={{ background: 'none', border: 0, color: C.tenue, cursor: 'pointer' }}><UserMinus size={17} /></button>
              </div>
            )
          })}
          <div style={{ height: 12 }} />
          <Accion icono={<Trash2 size={18} color="#f87171" />} t="Borrar el grupo (saca a todos)" rojo onClick={() => { if (confirm(`¿Borrar «${grupo.nombre}»? WhatsApp saca a todos y no se puede deshacer.`)) hacer({ action: 'borrar' }, 'Grupo borrado.').then(onCerrar) }} />
        </>)}
      </div>
      {msg && <div style={{ background: '#1f2c33', color: '#d1d7db', fontSize: 13, padding: '8px 14px' }} onClick={() => setMsg('')}>{msg}</div>}
      {invitando && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 14px', background: C.cabecera }}>
          <button onClick={() => setInvitando(false)} style={{ flex: 1, border: `1px solid ${C.borde}`, borderRadius: 22, padding: 11, background: 'transparent', color: C.tenue, cursor: 'pointer' }}>Cancelar</button>
          <button disabled={!elegidos.length || trabajando} onClick={async () => {
            setTrabajando(true); setMsg('Mandando la liga…')
            const malos = await invitarVarios(gid, elegidos, nombres)
            setTrabajando(false); setInvitando(false)
            setMsg(malos.length ? 'No le llegó a: ' + malos.join(' · ') : `Liga enviada a ${elegidos.length}. Entran cuando la toquen.`)
          }} style={{ flex: 2, border: 0, borderRadius: 22, padding: 11, background: C.verde, color: '#0b141a', fontWeight: 700, cursor: 'pointer', opacity: !elegidos.length || trabajando ? 0.5 : 1 }}>
            {trabajando ? 'Mandando…' : `Mandar liga a ${elegidos.length}`}
          </button>
        </div>
      )}
    </div>
  )
}

function Accion(props: { icono: ReactNode; t: string; onClick: () => void; rojo?: boolean }) {
  return (
    <div onClick={props.onClick} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', cursor: 'pointer', color: props.rojo ? '#f87171' : C.texto, fontSize: 14.5 }}
      onMouseEnter={e => { e.currentTarget.style.background = C.hover }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      {props.icono}<span>{props.t}</span>
    </div>
  )
}
