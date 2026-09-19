// ═══════════════════════════════════════════════════════════════════════════
// Mi trabajo (beta) — el rediseño de Proyectos, vivo y con datos reales.
//
// Es el prototipo aprobado ("Mi trabajo", "La tarea", "El proyecto", "Tu
// tablero") montado sobre las tablas de hoy. No migra ni archiva nada: si algo
// se ve vacío o raro aquí, es porque así están los datos — 404 tareas sin
// dueño, 12 de 768 con fecha. La pantalla no lo esconde, lo enseña.
//
// La portada es la lista de CADA QUIEN. El tablero del DG es subproducto.
// ═══════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { cargarPlantilla, Persona } from '../lib/empleados'
import { ROLES_GABINETE } from '../lib/roles'
import { AREAS_TRABAJO, Paso, pasosDe } from '../lib/tareas'
import { Entregable, TipoEntregable, cargarTipos, entregablesDe } from '../lib/entregables'
import EntregablesTarea from '../components/EntregablesTarea'
import RevisarEntregable from '../components/RevisarEntregable'
import {
  TareaMT, ConteoPasos, CAJONES, COLOR_ESP, LABEL_ESP,
  tareasDePersona, tareasDeProyecto, tareasAbiertasDeTodos, conteoDePasos, ultimoEntregable,
  entregablesEnRevision, entregablesRevisados, proyectos as cargarProyectos, fasesDe,
  marcarPasoMT, sellarEntrega, sellarRevision,
  especialidadDe, revisorDe, directorDe, esDG, esDirectorP,
  cajonDe, etiquetaFecha, fechaCorta, diasHabiles, iniciales,
} from '../lib/miTrabajo'

const CSS = `
.mt{--ground:#0B0C0E;--surface:#131418;--surface-2:#1A1C21;--raised:#212429;--line:#2A2D34;--line-soft:#212429;
  --ink:#E9EAED;--ink-2:#A7AAB2;--ink-3:#6E7179;--verde:#10B981;--ilum:#A78BFA;--elec:#FFB347;--cyan:#67E8F9;
  --rojo:#E5484D;--ambar:#D9930A;--mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace;
  background:var(--ground);color:var(--ink);min-height:100vh;padding:28px 32px 80px;font-family:'Inter',system-ui,sans-serif;line-height:1.5}
@media(max-width:700px){.mt{padding:18px 14px 60px}}
.mt *{box-sizing:border-box}
.mt .mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.mt-top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.mt-top h1{font-size:24px;font-weight:800;letter-spacing:-.02em;margin:0}
.mt-top .beta{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--verde);
  border:1px solid color-mix(in srgb,var(--verde) 40%,transparent);border-radius:4px;padding:2px 6px;margin-left:10px;vertical-align:middle}
.mt-top .sub{font-size:13px;color:var(--ink-3);margin-top:4px;max-width:70ch}
.mt-seg{display:flex;gap:2px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:3px;flex-wrap:wrap}
.mt-seg button{appearance:none;border:0;background:transparent;color:var(--ink-2);font:600 12.5px 'Inter',sans-serif;padding:7px 13px;border-radius:6px;cursor:pointer}
.mt-seg button:hover{color:var(--ink)}
.mt-seg button.on{background:var(--raised);color:var(--ink)}
.mt-screen{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:20px}
@media(max-width:700px){.mt-screen{padding:14px}}
.mt-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px}
.mt-who{display:flex;align-items:center;gap:10px}
.mt-who .nm{font-size:14px;font-weight:700}
.mt-who .pu{font-size:11px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.mt-sel{background:var(--surface-2);color:var(--ink);border:1px solid var(--line);border-radius:7px;padding:7px 10px;font:500 12.5px 'Inter',sans-serif;max-width:320px}
.mt-av{border-radius:50%;display:grid;place-items:center;flex:0 0 auto;font-family:var(--mono);font-weight:600;color:#0B0C0E;width:28px;height:28px;font-size:10px}
.mt-chip{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;padding:3px 8px;border-radius:5px;border:1px solid var(--line);color:var(--ink-2);white-space:nowrap}
.mt-chip.rojo{color:var(--rojo);border-color:color-mix(in srgb,var(--rojo) 38%,transparent);background:color-mix(in srgb,var(--rojo) 10%,transparent)}
.mt-chip.ambar{color:var(--ambar);border-color:color-mix(in srgb,var(--ambar) 40%,transparent);background:color-mix(in srgb,var(--ambar) 12%,transparent)}
.mt-chip.verde{color:var(--verde);border-color:color-mix(in srgb,var(--verde) 35%,transparent);background:color-mix(in srgb,var(--verde) 10%,transparent)}
.mt-block{margin:16px 0 4px;border-radius:10px;padding:13px 15px;border:1px solid}
.mt-block .bh{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;margin-bottom:9px}
.mt-block.ambar{border-color:color-mix(in srgb,var(--ambar) 34%,transparent);background:color-mix(in srgb,var(--ambar) 7%,transparent)}
.mt-block.ambar .bh{color:var(--ambar)}
.mt-block.rojo{border-color:color-mix(in srgb,var(--rojo) 34%,transparent);background:color-mix(in srgb,var(--rojo) 6%,transparent)}
.mt-block.rojo .bh{color:var(--rojo)}
.mt-block.cyan{border-color:color-mix(in srgb,var(--cyan) 30%,transparent);background:color-mix(in srgb,var(--cyan) 5%,transparent)}
.mt-block.cyan .bh{color:var(--cyan)}
.mt-grp{margin-top:20px}
.mt-gh{display:flex;align-items:baseline;gap:10px;margin-bottom:7px}
.mt-gh .t{font-size:12.5px;font-weight:700}
.mt-gh .n{font-family:var(--mono);font-size:11px;color:var(--ink-3)}
.mt-gh .sp{flex:1;height:1px;background:var(--line-soft)}
.mt-rows{border:1px solid var(--line);border-radius:9px;overflow:hidden}
.mt-row{display:grid;grid-template-columns:20px minmax(0,1fr) minmax(0,220px) 84px 130px;gap:12px;align-items:center;padding:11px 13px;
  background:var(--surface);cursor:pointer;border:0;width:100%;text-align:left;font-family:inherit;color:inherit}
.mt-row + .mt-row{border-top:1px solid var(--line-soft)}
.mt-row:hover{background:var(--surface-2)}
.mt-row .bx{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;font-size:10px;color:#06251A;font-weight:800}
.mt-row.on .bx{background:var(--verde);border-color:var(--verde)}
.mt-row .nm{font-size:13.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-row .ctx{font-size:11.5px;color:var(--ink-3);display:flex;align-items:center;gap:6px;min-width:0}
.mt-row .ctx span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mt-row .ck{font-family:var(--mono);font-size:11px;color:var(--ink-2);display:flex;align-items:center;gap:7px;justify-content:flex-end}
.mt-row .dt{font-family:var(--mono);font-size:11px;text-align:right;white-space:nowrap}
.mt-pb{width:34px;height:4px;border-radius:2px;background:var(--raised);overflow:hidden;display:inline-block}
.mt-pb i{display:block;height:100%;background:var(--verde)}
.mt-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;display:inline-block}
@media(max-width:820px){
  .mt-row{grid-template-columns:20px minmax(0,1fr) auto;gap:6px 11px}
  .mt-row .ctx{grid-column:2;grid-row:2}
  .mt-row .ck{grid-column:3;grid-row:2}
  .mt-row .dt{grid-column:3;grid-row:1}
}
.mt-note{margin-top:15px;font-size:11.5px;color:var(--ink-3);max-width:80ch}
.mt-note b{color:var(--ink-2)}
.mt-empty{padding:22px;text-align:center;color:var(--ink-3);font-size:13px;border:1px dashed var(--line);border-radius:9px}
.mt-tk{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:18px}
@media(max-width:900px){.mt-tk{grid-template-columns:1fr}}
.mt-back{appearance:none;border:0;background:none;color:var(--ink-3);font:500 12px 'Inter',sans-serif;cursor:pointer;padding:0;margin-bottom:12px}
.mt-back:hover{color:var(--ink)}
.mt-crumb{font-family:var(--mono);font-size:10.5px;color:var(--ink-3);margin-bottom:7px}
.mt-tk h3{font-size:19px;font-weight:700;letter-spacing:-.014em;margin:0}
.mt-sect{margin-top:20px}
.mt-sect .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);margin-bottom:8px}
.mt-instr{font-size:13.5px;color:var(--ink-2);max-width:70ch;white-space:pre-wrap}
.mt-ck2{display:grid;grid-template-columns:20px 1fr;gap:11px;align-items:center;padding:11px 13px;background:var(--surface);cursor:pointer;border:0;width:100%;text-align:left;font-family:inherit;color:inherit}
.mt-ck2 + .mt-ck2{border-top:1px solid var(--line-soft)}
.mt-ck2:hover{background:var(--surface-2)}
.mt-ck2:disabled{cursor:wait;opacity:.7}
.mt-ck2 .bx{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--line);display:grid;place-items:center;font-size:10px;color:#06251A;font-weight:800}
.mt-ck2.on .bx{background:var(--verde);border-color:var(--verde)}
.mt-ck2 .tx{font-size:13px}
.mt-ck2.on .tx{color:var(--ink-3);text-decoration:line-through}
.mt-foot{display:flex;align-items:center;gap:13px;margin-top:12px;flex-wrap:wrap}
.mt-pbar{width:120px;height:5px;border-radius:3px;background:var(--raised);overflow:hidden;display:inline-block}
.mt-pbar i{display:block;height:100%;background:var(--verde);transition:width .2s}
.mt-side{border:1px solid var(--line);border-radius:10px;background:var(--surface-2);padding:14px;height:fit-content}
.mt-sf + .mt-sf{margin-top:13px;border-top:1px solid var(--line);padding-top:13px}
.mt-sf .k{font-family:var(--mono);font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.mt-sf .v{font-size:12.5px;margin-top:5px;font-weight:500;display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.mt-sf .x{font-size:11px;color:var(--ink-3);margin-top:6px;line-height:1.45}
.mt-thread{position:relative;padding-left:24px}
.mt-thread::before{content:'';position:absolute;left:9px;top:5px;bottom:8px;width:1px;background:var(--line)}
.mt-ent{position:relative;padding-bottom:14px}
.mt-ent::before{content:'';position:absolute;left:-19px;top:6px;width:8px;height:8px;border-radius:50%;background:var(--raised);box-shadow:0 0 0 1px var(--line)}
.mt-ent .eh{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mt-ent .w{font-size:12.5px;font-weight:600}
.mt-ent .ts{font-family:var(--mono);font-size:10.5px;color:var(--ink-3)}
.mt-ent .b{margin-top:4px;font-size:12.5px;color:var(--ink-2);max-width:64ch}
.mt-rail{display:flex;gap:6px;margin:6px 0;overflow-x:auto;padding-bottom:6px}
.mt-ph{flex:1 1 0;min-width:112px;background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:10px 11px}
.mt-ph .nm{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mt-ph .st{font-family:var(--mono);font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);margin-top:5px}
.mt-ph .pb{height:3px;border-radius:2px;background:var(--raised);margin-top:8px;overflow:hidden}
.mt-ph .pb i{display:block;height:100%;background:var(--ink-3)}
.mt-ph .ap{font-family:var(--mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase;margin-top:6px;color:var(--ink-3)}
.mt-ph.done{border-color:color-mix(in srgb,var(--verde) 32%,transparent)}
.mt-ph.done .st{color:var(--verde)} .mt-ph.done .pb i{background:var(--verde)}
.mt-ph.now{border-color:color-mix(in srgb,var(--ilum) 45%,transparent);background:color-mix(in srgb,var(--ilum) 7%,transparent)}
.mt-ph.now .st{color:var(--ilum)} .mt-ph.now .pb i{background:var(--ilum)}
.mt-lider{border:1px solid var(--line);border-radius:10px;background:var(--surface-2);padding:14px;margin-bottom:10px}
.mt-lh{display:flex;align-items:center;gap:11px;flex-wrap:wrap}
.mt-lh .nm{font-size:13.5px;font-weight:700}
.mt-lh .pu{font-size:10.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.mt-lh .score{margin-left:auto;text-align:right}
.mt-lh .big{font-family:var(--mono);font-size:19px;font-weight:600;line-height:1}
.mt-lh .cap{font-size:9px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.07em;margin-top:3px}
.mt-lm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;background:var(--line-soft);border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-top:12px}
.mt-lm{background:var(--surface);padding:9px 11px}
.mt-lm .k{font-family:var(--mono);font-size:8.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.mt-lm .v{font-family:var(--mono);font-size:15px;font-weight:600;margin-top:4px}
.mt-lm .v small{font-size:10px;color:var(--ink-3);font-weight:400}
.mt-err{color:var(--rojo);font-size:12px;margin-top:8px}
`

const titulo = (s?: string | null) => (s || '').toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase())
const colorDe = (esp?: string | null) => COLOR_ESP[esp || 'admin'] || '#94A3B8'
const hoyCorto = () => fechaCorta(new Date().toISOString())

type Vista = 'lista' | 'proyecto' | 'tablero'

export default function MiTrabajo() {
  const { user } = useAuth()
  const [gente, setGente] = useState<Persona[]>([])
  const [genteLista, setGenteLista] = useState(false)
  const [tipos, setTipos] = useState<TipoEntregable[]>([])
  const [vista, setVista] = useState<Vista>('lista')
  const [personaId, setPersonaId] = useState<string>('')
  const [abierta, setAbierta] = useState<TareaMT | null>(null)
  const [proyectoId, setProyectoId] = useState<string>('')

  useEffect(() => {
    cargarPlantilla().then(ps => { setGente(ps.filter(p => ROLES_GABINETE.includes(p.rol))); setGenteLista(true) })
    cargarTipos().then(setTipos)
  }, [])

  const yo = useMemo(() => gente.find(p => p.id === user?.employee_id) || null, [gente, user])
  const soyDG = user?.permission_area === 'DG' || esDG(yo)
  const soyDirector = esDirectorP(yo)

  // A quién puedo ver: el DG a todos, un director a su área, los demás a sí mismos.
  const visibles = useMemo(() => {
    const areas = AREAS_TRABAJO.map(a => a.area)
    const gab = gente.filter(p => areas.includes(p.area.toUpperCase() as any))
    if (soyDG) return gab
    if (soyDirector && yo) return gab.filter(p => p.area === yo.area)
    return yo ? [yo] : []
  }, [gente, soyDG, soyDirector, yo])

  useEffect(() => {
    if (!personaId && user?.employee_id) setPersonaId(user.employee_id)
  }, [user, personaId])

  const persona = gente.find(p => p.id === personaId) || null

  const abrir = (t: TareaMT) => { setAbierta(t); if (t.project_id) setProyectoId(t.project_id); window.scrollTo({ top: 0 }) }

  return (
    <div className="mt">
      <style>{CSS}</style>
      <div className="mt-top">
        <div>
          <h1>Mi trabajo <span className="beta">beta</span></h1>
          <div className="sub">El rediseño de Proyectos con los datos de hoy, sin migrar nada. Lo que se vea vacío es porque así está la base.</div>
        </div>
        <div className="mt-seg" role="tablist">
          <button className={vista === 'lista' && !abierta ? 'on' : ''} onClick={() => { setAbierta(null); setVista('lista') }}>Mi trabajo</button>
          <button className={vista === 'proyecto' && !abierta ? 'on' : ''} onClick={() => { setAbierta(null); setVista('proyecto') }}>El proyecto</button>
          {soyDG && <button className={vista === 'tablero' && !abierta ? 'on' : ''} onClick={() => { setAbierta(null); setVista('tablero') }}>Tu tablero</button>}
        </div>
      </div>

      <section className="mt-screen">
        {!genteLista ? <div className="mt-empty">Cargando…</div> : abierta ? (
          <LaTarea key={abierta.id} tarea={abierta} gente={gente} tipos={tipos} yoId={user?.employee_id || null} soyDG={soyDG}
            onVolver={() => setAbierta(null)}
            onProyecto={pid => { setAbierta(null); setProyectoId(pid); setVista('proyecto') }} />
        ) : vista === 'lista' ? (
          <Lista persona={persona} visibles={visibles} setPersonaId={setPersonaId} gente={gente} onAbrir={abrir} />
        ) : vista === 'proyecto' ? (
          <ElProyecto proyectoId={proyectoId} setProyectoId={setProyectoId} gente={gente} onAbrir={abrir} />
        ) : (
          <Tablero gente={gente} />
        )}
      </section>
    </div>
  )
}

// ── Pieza común: un renglón de tarea ───────────────────────────────────────

function Renglon({ t, pasos, ctx, derecha, onClick }: {
  t: TareaMT; pasos?: ConteoPasos; ctx: React.ReactNode; derecha?: { txt: string; color: string }; onClick: () => void
}) {
  const lista = !!pasos && pasos.total > 0 && pasos.hechos === pasos.total
  const f = derecha || etiquetaFecha(t)
  return (
    <button className={'mt-row' + (lista ? ' on' : '')} type="button" onClick={onClick}>
      <span className="bx">{lista ? '✓' : ''}</span>
      <span className="nm" title={t.name}>{t.name}</span>
      <span className="ctx">{ctx}</span>
      <span className="ck">
        {pasos && pasos.total > 0
          ? <><span className="mt-pb"><i style={{ width: `${pasos.hechos / pasos.total * 100}%` }} /></span>{pasos.hechos}/{pasos.total}</>
          : <span style={{ color: 'var(--ink-3)' }}>sin pasos</span>}
      </span>
      <span className="dt" style={{ color: f.color }}>{f.txt}</span>
    </button>
  )
}

function Grupo({ titulo, n, color, children }: { titulo: string; n: number; color?: string; children: React.ReactNode }) {
  return (
    <div className="mt-grp">
      <div className="mt-gh"><span className="t" style={color ? { color } : undefined}>{titulo}</span><span className="n">{n}</span><span className="sp" /></div>
      <div className="mt-rows">{children}</div>
    </div>
  )
}

// ── 1 · MI TRABAJO ─────────────────────────────────────────────────────────

function Lista({ persona, visibles, setPersonaId, gente, onAbrir }: {
  persona: Persona | null; visibles: Persona[]; setPersonaId: (id: string) => void; gente: Persona[]; onAbrir: (t: TareaMT) => void
}) {
  const [modo, setModo] = useState<'fecha' | 'proyecto'>('fecha')
  const [tareas, setTareas] = useState<TareaMT[]>([])
  const [pasos, setPasos] = useState<Record<string, ConteoPasos>>({})
  const [ultimo, setUltimo] = useState<Record<string, Entregable>>({})
  const [porRevisar, setPorRevisar] = useState<{ e: Entregable; t: TareaMT }[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!persona) { setCargando(false); return }
    let vivo = true
    ;(async () => {
      setCargando(true)
      const ts = await tareasDePersona(persona.id)
      const ids = ts.map(t => t.id)
      const [ps, ul, enRev] = await Promise.all([conteoDePasos(ids), ultimoEntregable(ids), entregablesEnRevision()])
      // Lo que otros entregaron y le toca revisar a esta persona.
      const idsRev = [...new Set(enRev.map(e => e.task_id).filter(Boolean) as string[])]
      const tsRev = await tareasPorIds(idsRev)
      const mios = enRev
        .map(e => ({ e, t: tsRev.find(t => t.id === e.task_id)! }))
        .filter(x => x.t && revisorDe(x.t, gente)?.id === persona.id)
      if (!vivo) return
      setTareas(ts); setPasos(ps); setUltimo(ul); setPorRevisar(mios); setCargando(false)
    })()
    return () => { vivo = false }
  }, [persona?.id, gente.length])

  const devueltas = tareas.filter(t => ultimo[t.id]?.estado === 'corregir')
  const esperando = tareas.filter(t => ultimo[t.id]?.estado === 'en_revision')
  const resto = tareas.filter(t => !devueltas.includes(t) && !esperando.includes(t))

  const ctxProyecto = (t: TareaMT) => (
    <><i className="mt-dot" style={{ background: colorDe(especialidadDe(t)) }} /><span>{t.project?.name || t.titulo_cliente || 'Encargo suelto'}</span></>
  )
  const ctxFase = (t: TareaMT) => <span>{t.phase ? `Fase ${t.phase.name}` : 'Sin fase'}</span>

  let cuerpo: React.ReactNode
  if (modo === 'fecha') {
    cuerpo = CAJONES.map(c => {
      const xs = resto.filter(t => cajonDe(t) === c.k).sort((a, b) =>
        String(a.due_date || '').localeCompare(String(b.due_date || '')) ||
        String(a.project?.name || '').localeCompare(String(b.project?.name || ''), 'es') ||
        (a.phase?.order_index ?? 999) - (b.phase?.order_index ?? 999))
      if (!xs.length) return null
      return <Grupo key={c.k} titulo={c.t} n={xs.length} color={c.color}>
        {xs.map(t => <Renglon key={t.id} t={t} pasos={pasos[t.id]} ctx={ctxProyecto(t)} onClick={() => onAbrir(t)} />)}
      </Grupo>
    })
  } else {
    const porPj = new Map<string, TareaMT[]>()
    for (const t of resto) {
      const k = t.project?.name || t.titulo_cliente || 'Encargos sueltos'
      porPj.set(k, [...(porPj.get(k) || []), t])
    }
    cuerpo = [...porPj.entries()].sort((a, b) => a[0].localeCompare(b[0], 'es')).map(([k, xs]) => (
      <Grupo key={k} titulo={k} n={xs.length} color={colorDe(especialidadDe(xs[0]))}>
        {xs.sort((a, b) => (a.phase?.order_index ?? 99) - (b.phase?.order_index ?? 99))
          .map(t => <Renglon key={t.id} t={t} pasos={pasos[t.id]} ctx={ctxFase(t)} onClick={() => onAbrir(t)} />)}
      </Grupo>
    ))
  }

  const sinFecha = resto.filter(t => !t.due_date).length

  return (
    <>
      <div className="mt-bar">
        <div className="mt-who">
          <span className="mt-av" style={{ background: persona ? colorDe(AREAS_TRABAJO.find(a => a.area === persona.area.toUpperCase())?.specialty) : '#555' }}>{iniciales(persona?.nombre)}</span>
          <div>
            <div className="nm">{persona ? titulo(persona.nombre) : 'Sin persona ligada a tu usuario'}</div>
            <div className="pu">{persona?.puesto || ''}</div>
          </div>
        </div>
        {visibles.length > 1 && (
          <select className="mt-sel" value={persona?.id || ''} onChange={e => setPersonaId(e.target.value)} aria-label="Ver el trabajo de">
            {AREAS_TRABAJO.map(a => {
              const ps = visibles.filter(p => p.area.toUpperCase() === a.area)
              if (!ps.length) return null
              return <optgroup key={a.area} label={a.label}>
                {ps.map(p => <option key={p.id} value={p.id}>{titulo(p.nombre)} · {titulo(p.puesto)}</option>)}
              </optgroup>
            })}
          </select>
        )}
        <div className="mt-seg" style={{ marginLeft: 'auto' }}>
          <button className={modo === 'fecha' ? 'on' : ''} onClick={() => setModo('fecha')}>Por fecha</button>
          <button className={modo === 'proyecto' ? 'on' : ''} onClick={() => setModo('proyecto')}>Por proyecto</button>
        </div>
      </div>

      {cargando ? <div className="mt-empty">Cargando…</div> : !persona ? (
        <div className="mt-empty">Tu usuario no está ligado a un empleado, así que no hay lista que mostrar.</div>
      ) : (
        <>
          {porRevisar.length > 0 && (
            <div className="mt-block cyan">
              <div className="bh">Te toca revisar · el reloj corre a tu nombre</div>
              <div className="mt-rows">
                {porRevisar.map(({ e, t }) => {
                  const d = diasHabiles(e.subido_at)
                  return <Renglon key={e.id} t={t} pasos={undefined} onClick={() => onAbrir(t)}
                    ctx={<><i className="mt-dot" style={{ background: colorDe(especialidadDe(t)) }} /><span>{titulo(gente.find(p => p.id === e.subido_por_id)?.nombre) || 'Alguien'} · {t.project?.name || ''}</span></>}
                    derecha={{ txt: `${d} d háb. esperando`, color: d >= 4 ? '#E5484D' : d >= 2 ? '#D9930A' : '#A7AAB2' }} />
                })}
              </div>
            </div>
          )}
          {devueltas.length > 0 && (
            <div className="mt-block rojo">
              <div className="bh">Te la devolvieron · hay algo que corregir</div>
              <div className="mt-rows">
                {devueltas.map(t => <Renglon key={t.id} t={t} pasos={pasos[t.id]} ctx={ctxProyecto(t)} onClick={() => onAbrir(t)} />)}
              </div>
            </div>
          )}
          {esperando.length > 0 && (
            <div className="mt-block ambar">
              <div className="bh">⏸ Esperando respuesta · no es tuyo hasta que contesten</div>
              <div className="mt-rows">
                {esperando.map(t => {
                  const e = ultimo[t.id]
                  const d = diasHabiles(e.subido_at)
                  const rev = revisorDe(t, gente)
                  return <Renglon key={t.id} t={t} pasos={pasos[t.id]} ctx={ctxProyecto(t)} onClick={() => onAbrir(t)}
                    derecha={{ txt: `${d} d · ${titulo(rev?.nombre?.split(' ')[0]) || 'revisor'}`, color: d >= 4 ? '#E5484D' : d >= 2 ? '#D9930A' : '#A7AAB2' }} />
                })}
              </div>
            </div>
          )}

          {resto.length === 0 && devueltas.length === 0 && esperando.length === 0
            ? <div className="mt-empty" style={{ marginTop: 18 }}>No hay ninguna tarea abierta a nombre de {titulo(persona.nombre)}.</div>
            : cuerpo}

          <div className="mt-note">
            <b>{tareas.length} tareas abiertas</b>{sinFecha > 0 && <> · <b>{sinFecha}</b> sin fecha de entrega</>}. “Sin fecha” se muestra a propósito: es la lista de lo que nadie ha comprometido.
            Por fecha para saber qué urge hoy; por proyecto para despachar una obra completa.
          </div>
        </>
      )}
    </>
  )
}

const COLS_T = 'id,name,description,instrucciones,status,progress,due_date,assignee_id,solicitada_por_id,delegada_por_id,specialty,rol,project_id,phase_id,tipo_entregable_id,lead_id,titulo_cliente,entregado_at,entregado_ultimo_at,aceptado_at,rondas_revision,asignada_at,created_at,project:projects(id,name,client_name,specialty),phase:project_phases(id,name,order_index)'

/** Tareas por id, con su proyecto y fase (para lo que hay que revisar). */
async function tareasPorIds(ids: string[]): Promise<TareaMT[]> {
  if (!ids.length) return []
  const { data } = await supabase.from('project_tasks').select(COLS_T).in('id', ids.slice(0, 200))
  return ((data as any[]) || []) as TareaMT[]
}

async function tareaPorId(id: string): Promise<TareaMT | null> {
  const { data } = await supabase.from('project_tasks').select(COLS_T).eq('id', id).maybeSingle()
  return (data as any) || null
}

// ── 2 · LA TAREA ───────────────────────────────────────────────────────────

function LaTarea({ tarea, gente, tipos, yoId, soyDG, onVolver, onProyecto }: {
  tarea: TareaMT; gente: Persona[]; tipos: TipoEntregable[]; yoId: string | null; soyDG: boolean
  onVolver: () => void; onProyecto: (pid: string) => void
}) {
  const [t, setT] = useState<TareaMT>(tarea)
  const [pasos, setPasos] = useState<Paso[]>([])
  const [historial, setHistorial] = useState<Entregable[]>([])
  const [ocupado, setOcupado] = useState('')
  const [fasesPj, setFasesPj] = useState<{ id: string }[]>([])
  const previo = useRef<Entregable | null>(null)

  const nombre = (id?: string | null) => titulo(gente.find(p => p.id === id)?.nombre) || '—'
  const responsable = gente.find(p => p.id === t.assignee_id) || null
  const revisor = revisorDe(t, gente)
  const puedeRevisar = !!yoId && (yoId === revisor?.id || soyDG) && yoId !== t.assignee_id

  async function recargar() {
    const [ps, hs, fresca] = await Promise.all([pasosDe(t.id), entregablesDe(t.id), tareaPorId(t.id)])
    setPasos(ps); setHistorial(hs)
    if (fresca) setT(fresca)
    return { hs, fresca }
  }
  useEffect(() => {
    recargar().then(({ hs }) => { previo.current = hs[0] || null })
    if (t.project_id) fasesDe(t.project_id).then(setFasesPj)
  }, [t.id])

  async function toggle(p: Paso) {
    setOcupado(p.id)
    setPasos(ps => ps.map(x => x.id === p.id ? { ...x, completed: !p.completed } : x))
    await marcarPasoMT(p.id, t.id, !p.completed)
    await recargar()
    setOcupado('')
  }

  // EntregablesTarea avisa que algo cambió: una entrega nueva o una revisión.
  // Se compara contra lo que había para sellar las fechas correctas en la tarea.
  async function alCambiar() {
    const { hs, fresca } = await recargar()
    const antes = previo.current
    const ahora = hs[0] || null
    const base = fresca || t
    if (ahora && (!antes || ahora.id !== antes.id)) await sellarEntrega(base)
    else if (ahora && antes && ahora.id === antes.id && antes.estado === 'en_revision' && ahora.estado !== 'en_revision')
      await sellarRevision(base, ahora.estado as 'aceptado' | 'corregir')
    previo.current = ahora
    await recargar()
  }

  const hechos = pasos.filter(p => p.completed).length
  const pct = pasos.length ? Math.round(hechos / pasos.length * 100) : 0
  const ult = historial[0]
  const estado = t.status === 'completada' ? { txt: 'Aceptada', cls: 'verde' }
    : ult?.estado === 'en_revision' ? { txt: `Entregada · esperando a ${nombre(revisor?.id).split(' ')[0]}`, cls: 'ambar' }
    : ult?.estado === 'corregir' ? { txt: 'Devuelta · corregir', cls: 'rojo' }
    : pasos.length && pct === 100 ? { txt: 'Lista para entregar · 100%', cls: 'verde' }
    : { txt: !pasos.length ? 'Sin pasos definidos' : pct === 0 ? 'Sin empezar · 0%' : `En progreso · ${pct}%`, cls: '' }
  const f = etiquetaFecha(t)
  const esp = especialidadDe(t)
  const posFase = fasesPj.findIndex(x => x.id === t.phase_id) + 1

  return (
    <>
      <button className="mt-back" onClick={onVolver}>← Volver</button>
      <div className="mt-tk">
        <div>
          <div className="mt-crumb">
            {t.project ? <a style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted' }} onClick={() => onProyecto(t.project!.id)}>{t.project.name}</a> : (t.titulo_cliente || 'Encargo suelto')}
            {t.phase && <> · Fase {t.phase.name}</>}
          </div>
          <h3>{t.name}</h3>

          <div className="mt-sect">
            <div className="k">Qué se espera</div>
            {t.instrucciones || t.description
              ? <p className="mt-instr">{t.instrucciones || t.description}</p>
              : <p className="mt-instr" style={{ color: 'var(--ink-3)' }}>Nadie escribió qué se espera de esta tarea. Los pasos de abajo son la única definición de terminado.</p>}
          </div>

          <div className="mt-sect">
            <div className="k">Pasos · definen terminado</div>
            {pasos.length === 0 ? (
              <div className="mt-empty">Esta tarea no tiene pasos. Sin pasos no hay forma de medir el avance: queda en 0% hasta que alguien la entregue.</div>
            ) : (
              <div className="mt-rows">
                {pasos.map(p => (
                  <button key={p.id} className={'mt-ck2' + (p.completed ? ' on' : '')} type="button" disabled={!!ocupado} onClick={() => toggle(p)}>
                    <span className="bx">{p.completed ? '✓' : ''}</span>
                    <span className="tx">{p.text}</span>
                  </button>
                ))}
              </div>
            )}
            {pasos.length > 0 && (
              <div className="mt-foot">
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{hechos} de {pasos.length}</span>
                <span className="mt-pbar"><i style={{ width: `${pct}%` }} /></span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                  {pct === 100 ? `Lista. Entrégala abajo a ${nombre(revisor?.id)}.` : 'Palomear el último paso no la cierra: se cierra cuando quien revisa la acepta.'}
                </span>
              </div>
            )}
          </div>

          <div className="mt-sect">
            <div className="k">Entregar y revisar</div>
            <EntregablesTarea
              tarea={{ id: t.id, name: t.name, tipo_entregable_id: t.tipo_entregable_id, instrucciones: t.instrucciones, specialty: esp, project_id: t.project_id, lead_id: t.lead_id, titulo_cliente: t.titulo_cliente }}
              employeeId={yoId} puedeRevisar={puedeRevisar} nombreDe={nombre} onCambio={alCambiar} />
            {puedeRevisar && ult?.estado === 'en_revision' && (
              <div style={{ marginTop: 12 }}>
                <RevisarEntregable e={ult} tipos={tipos} employeeId={yoId} nombreDe={nombre} onResuelto={alCambiar} />
              </div>
            )}
          </div>

          <div className="mt-sect">
            <div className="k">Historial</div>
            <div className="mt-thread">
              {historial.map(e => (
                <div key={e.id}>
                  {e.revisado_at && (
                    <div className="mt-ent">
                      <div className="eh"><span className="w">{nombre(e.revisado_por_id)}</span><span className="ts">{fechaCorta(e.revisado_at)}</span>
                        <span className={'mt-chip ' + (e.estado === 'aceptado' ? 'verde' : 'rojo')}>{e.estado === 'aceptado' ? 'aceptó' : 'pidió cambios'}</span></div>
                      {(e.correcciones || (e.fallas || []).length > 0) && <div className="b">{[...(e.fallas || []), e.correcciones].filter(Boolean).join(' · ')}</div>}
                    </div>
                  )}
                  <div className="mt-ent">
                    <div className="eh"><span className="w">{nombre(e.subido_por_id)}</span><span className="ts">{fechaCorta(e.subido_at)}</span><span className="mt-chip">entregó v{e.version}</span></div>
                    <div className="b">{e.nombre}{e.notas ? ` — ${e.notas}` : ''}</div>
                  </div>
                </div>
              ))}
              {t.asignada_at && <div className="mt-ent"><div className="eh"><span className="ts">{fechaCorta(t.asignada_at)}</span></div><div className="b">Asignada a {nombre(t.assignee_id)}{t.delegada_por_id ? ` por ${nombre(t.delegada_por_id)}` : ''}.</div></div>}
              {t.created_at && <div className="mt-ent"><div className="eh"><span className="ts">{fechaCorta(t.created_at)}</span></div><div className="b">Tarea creada.</div></div>}
            </div>
            <div className="mt-note">Los comentarios entre personas llegan cuando se cree su tabla; hoy el historial se arma de las entregas y revisiones.</div>
          </div>
        </div>

        <aside className="mt-side">
          <div className="mt-sf"><div className="k">Responsable</div>
            <div className="v">{responsable
              ? <><span className="mt-av" style={{ background: colorDe(esp), width: 22, height: 22, fontSize: 9 }}>{iniciales(responsable.nombre)}</span>{titulo(responsable.nombre)}</>
              : <span className="mt-chip rojo">Sin responsable</span>}</div></div>
          <div className="mt-sf"><div className="k">Aprueba</div>
            <div className="v">{revisor ? <>{titulo(revisor.nombre)} <span className="mt-chip">interno</span></> : '—'}</div>
            <div className="x">Por ahora siempre interno. Cuando definas quién aprueba cada fase, aquí aparecerá el despacho o el proveedor.</div></div>
          <div className="mt-sf"><div className="k">Fase</div>
            <div className="v">{t.phase ? <>{t.phase.name} {posFase > 0 ? <span className="mt-chip" style={{ color: colorDe(esp) }}>{posFase} de {fasesPj.length}</span> : null}</> : 'Sin fase'}</div></div>
          <div className="mt-sf"><div className="k">Compromiso</div>
            <div className="v">{t.due_date ? <>{fechaCorta(t.due_date)} <span className="mt-chip" style={{ color: f.color }}>{f.txt}</span></> : <span className="mt-chip rojo">Sin fecha</span>}</div></div>
          {(t.rondas_revision || 0) > 0 && <div className="mt-sf"><div className="k">Rondas de revisión</div><div className="v mono">{t.rondas_revision}</div></div>}
          <div className="mt-sf"><div className="k">Estado</div><div className="v"><span className={'mt-chip ' + estado.cls}>{estado.txt}</span></div></div>
        </aside>
      </div>
    </>
  )
}

// ── 3 · EL PROYECTO ────────────────────────────────────────────────────────

function ElProyecto({ proyectoId, setProyectoId, gente, onAbrir }: {
  proyectoId: string; setProyectoId: (id: string) => void; gente: Persona[]; onAbrir: (t: TareaMT) => void
}) {
  const [lista, setLista] = useState<{ id: string; name: string; client_name?: string | null; specialty?: string | null }[]>([])
  const [fases, setFases] = useState<{ id: string; name: string; order_index: number }[]>([])
  const [tareas, setTareas] = useState<TareaMT[]>([])
  const [pasos, setPasos] = useState<Record<string, ConteoPasos>>({})
  const [cargando, setCargando] = useState(true)

  useEffect(() => { cargarProyectos().then(ps => { setLista(ps); if (!proyectoId && ps[0]) setProyectoId(ps[0].id) }) }, [])
  useEffect(() => {
    if (!proyectoId) return
    let vivo = true
    ;(async () => {
      setCargando(true)
      const [fs, ts] = await Promise.all([fasesDe(proyectoId), tareasDeProyecto(proyectoId)])
      const ps = await conteoDePasos(ts.map(t => t.id))
      if (!vivo) return
      setFases(fs); setTareas(ts); setPasos(ps); setCargando(false)
    })()
    return () => { vivo = false }
  }, [proyectoId])

  const pj = lista.find(p => p.id === proyectoId)
  const esp = pj?.specialty || 'admin'
  const director = directorDe(esp, gente)

  // Avance real: pasos cerrados sobre pasos totales. Una tarea aceptada cuenta completa.
  const avance = (ts: TareaMT[]) => {
    let h = 0, n = 0
    for (const t of ts) {
      const c = pasos[t.id]
      if (t.status === 'completada') { const k = c?.total || 1; h += k; n += k }
      else if (c) { h += c.hechos; n += c.total }
      else n += 1
    }
    return n ? Math.round(h / n * 100) : 0
  }
  const total = avance(tareas)
  const sinDueno = tareas.filter(t => !t.assignee_id && t.status !== 'completada').length
  const enDirector = tareas.filter(t => director && t.assignee_id === director.id && t.status !== 'completada').length
  const abiertas = tareas.filter(t => t.status !== 'completada').length

  const primeraAbierta = fases.find(f => tareas.some(t => t.phase_id === f.id && t.status !== 'completada'))

  return (
    <>
      <div className="mt-bar" style={{ marginBottom: 14 }}>
        <select className="mt-sel" style={{ maxWidth: 460 }} value={proyectoId} onChange={e => setProyectoId(e.target.value)} aria-label="Proyecto">
          {(['ilum', 'elec', 'esp'] as const).map(s => (
            <optgroup key={s} label={LABEL_ESP[s]}>
              {lista.filter(p => p.specialty === s).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
          {pj?.client_name || 'sin cliente'} · {director ? titulo(director.nombre) : 'sin director'} · <b style={{ color: 'var(--ink)' }}>{total}%</b> avance real
        </span>
      </div>

      {cargando ? <div className="mt-empty">Cargando…</div> : (
        <>
          <div className="mt-rail">
            {fases.map(f => {
              const ts = tareas.filter(t => t.phase_id === f.id)
              const v = avance(ts)
              const cerrada = ts.length > 0 && ts.every(t => t.status === 'completada')
              const cls = cerrada ? 'done' : primeraAbierta?.id === f.id ? 'now' : ''
              return (
                <div key={f.id} className={'mt-ph ' + cls}>
                  <div className="nm" title={f.name}>{f.name}</div>
                  <div className="st">{cerrada ? 'Cerrada' : primeraAbierta?.id === f.id ? 'En curso' : 'Por abrir'} · {ts.length}</div>
                  <div className="pb"><i style={{ width: `${v}%` }} /></div>
                  <div className="ap">aprueba: por definir</div>
                </div>
              )
            })}
          </div>

          {fases.map(f => {
            const ts = tareas.filter(t => t.phase_id === f.id)
            if (!ts.length) return null
            return (
              <Grupo key={f.id} titulo={f.name} n={ts.length}>
                {ts.map(t => {
                  const r = gente.find(p => p.id === t.assignee_id)
                  return <Renglon key={t.id} t={t} pasos={pasos[t.id]} onClick={() => onAbrir(t)}
                    ctx={r
                      ? <><span className="mt-av" style={{ background: colorDe(esp), width: 19, height: 19, fontSize: 8 }}>{iniciales(r.nombre)}</span><span>{titulo(r.nombre)}</span></>
                      : <span style={{ color: 'var(--rojo)' }}>Sin responsable</span>} />
                })}
              </Grupo>
            )
          })}

          <div className="mt-note">
            <b>{abiertas} tareas abiertas</b> · <b style={{ color: sinDueno ? 'var(--rojo)' : undefined }}>{sinDueno} sin responsable</b>
            {director && <> · <b>{enDirector}</b> a nombre de {titulo(director.nombre).split(' ')[0]}</>}.
            El avance no se teclea: sale de los pasos cerrados de cada tarea.
          </div>
        </>
      )}
    </>
  )
}

// ── 4 · TU TABLERO ─────────────────────────────────────────────────────────

function Tablero({ gente }: { gente: Persona[] }) {
  const [ts, setTs] = useState<TareaMT[]>([])
  const [enRev, setEnRev] = useState<Entregable[]>([])
  const [revisados, setRevisados] = useState<Entregable[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    Promise.all([tareasAbiertasDeTodos(), entregablesEnRevision(), entregablesRevisados()])
      .then(([a, b, c]) => { setTs(a); setEnRev(b); setRevisados(c); setCargando(false) })
  }, [])

  if (cargando) return <div className="mt-empty">Cargando…</div>

  const areas = AREAS_TRABAJO.filter(a => a.specialty !== 'admin')
  return (
    <>
      <div className="mt-bar" style={{ marginBottom: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Qué está detenido, y en manos de quién</h3>
        <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>Solo tú ves esta pantalla · {hoyCorto()}</span>
      </div>

      {areas.map(a => {
        const dir = directorDe(a.specialty, gente)
        const equipo = gente.filter(p => p.area.toUpperCase() === a.area && p.id !== dir?.id)
        const delArea = ts.filter(t => especialidadDe(t) === a.specialty)
        const sinDueno = delArea.filter(t => !t.assignee_id).length
        const enEl = dir ? delArea.filter(t => t.assignee_id === dir.id).length : 0
        const enEquipo = delArea.filter(t => equipo.some(p => p.id === t.assignee_id)).length
        const sinFecha = delArea.filter(t => !t.due_date).length
        const esperan = enRev.filter(e => e.specialty === a.specialty)
        const maxEspera = esperan.reduce((m, e) => Math.max(m, diasHabiles(e.subido_at)), 0)
        const suyos = revisados.filter(e => dir && e.revisado_por_id === dir.id && e.revisado_at)
        const tarda = suyos.length ? suyos.reduce((s, e) => s + diasHabiles(e.subido_at, e.revisado_at!), 0) / suyos.length : null
        const colorBig = maxEspera >= 4 ? 'var(--rojo)' : maxEspera >= 2 ? 'var(--ambar)' : 'var(--verde)'
        return (
          <div key={a.specialty} className="mt-lider">
            <div className="mt-lh">
              <span className="mt-av" style={{ background: colorDe(a.specialty) }}>{iniciales(dir?.nombre)}</span>
              <div><div className="nm">{dir ? titulo(dir.nombre) : 'Sin director'}</div><div className="pu">{a.label} · equipo de {equipo.length}</div></div>
              <div className="score">
                <div className="big" style={{ color: esperan.length ? colorBig : 'var(--ink-3)' }}>{esperan.length ? `${maxEspera} d` : '—'}</div>
                <div className="cap">Trabajo ajeno detenido</div>
              </div>
            </div>
            <div className="mt-lm-grid">
              <div className="mt-lm"><div className="k">Esperando su respuesta</div><div className="v">{esperan.length} <small>entregas</small></div></div>
              <div className="mt-lm"><div className="k">Tarda en revisar</div><div className="v">{tarda === null ? <small>sin datos aún</small> : <>{tarda.toFixed(1)} <small>días háb.</small></>}</div></div>
              <div className="mt-lm"><div className="k">Tareas abiertas</div><div className="v">{delArea.length}</div></div>
              <div className="mt-lm"><div className="k">A su nombre</div><div className="v" style={{ color: enEl > enEquipo ? 'var(--ambar)' : undefined }}>{enEl}</div></div>
              <div className="mt-lm"><div className="k">En su equipo</div><div className="v">{enEquipo}</div></div>
              <div className="mt-lm"><div className="k">Sin responsable</div><div className="v" style={{ color: sinDueno ? 'var(--rojo)' : undefined }}>{sinDueno}</div></div>
              <div className="mt-lm"><div className="k">Sin fecha</div><div className="v">{sinFecha}</div></div>
            </div>
          </div>
        )
      })}

      <div className="mt-grp">
        <div className="mt-gh"><span className="t">Detenido con el cliente · no es de tu gente</span><span className="sp" /></div>
        <div className="mt-empty">Todavía no se puede medir: <b>client_contact</b> está vacío en los 27 proyectos y ninguna fase dice todavía si aprueba el despacho. En cuanto se capturen, aquí sale cuántos días cuesta cada despacho.</div>
      </div>

      <div className="mt-note">
        <b>“Tarda en delegar” no aparece a propósito.</b> 302 de las 362 asignaciones de hoy se hicieron el mismo día (25 ago, carga masiva): cualquier promedio saldría de ahí y no de la conducta de nadie.
        Se va a poder medir con las asignaciones que se hagan de aquí en adelante. Todo lo demás sale de restar fechas que el flujo entregar-revisar genera solo; nadie lo captura.
      </div>
    </>
  )
}
