// Edge Function: whatsapp-reportes — reportes diarios de obra por WhatsApp.
//
// La llama pg_cron (con la llave del vault en x-cron-key) o un DG/Admin desde
// el ERP (con su JWT). Acciones:
//   pedir     18:00  le pregunta a cada persona de reporte_diario_personas en qué
//                    obra estuvo, partiendo de su planeación del día
//                    (installer_daily_assignment). El reporte se pide después de
//                    que confirma la obra (whatsapp-webhook/reportes.ts).
//   insistir  19:30  a quien no ha contestado, una sola vez.
//   lecturas  c/2min lo que entendimos de cada reporte (avances, bloqueos,
//                    avisos), de regreso al instalador para que lo confirme. Sale
//                    cuando lleva 3 minutos sin mandar nada (lectura.ts).
//   resumen   21:00  procesa los reportes (process-obra-report), manda el
//                    resumen de cada obra a su lista, al jefe de cuadrilla el de
//                    su equipo con las actividades detectadas para que decida
//                    cuáles se suben y con qué fecha (supervisor.ts), y a Elias
//                    el cierre del día.
//   prueba           pedir/resumen sólo para una persona u obra, hacia el número
//                    de quien llama. Para probar sin molestar a nadie.
// Lo que contesta el instalador lo recibe whatsapp-webhook (reportes.ts).
//
// Deploy: verify_jwt=false (la función revisa x-cron-key o el JWT).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { hoyCDMX, telefonoDeEmpleado, avisar, primerNombre, alHistorial, ZONA, empleadoDeTelefono } from '../whatsapp-webhook/reportesComun.ts';
import { armarPropuestas, abiertasDe, textoPropuestas, fechaCorta, detectarComunicados, textoComunicados } from '../whatsapp-webhook/supervisor.ts';
import { contextoCoord, panorama, ejecutarCoord } from '../whatsapp-webhook/coordinador.ts';
import { preguntaObra } from '../whatsapp-webhook/reportes.ts';
import { enviarLectura } from '../whatsapp-webhook/lectura.ts';
import { graphGet, graphPost } from '../whatsapp-webhook/whatsapp.ts';
import { crearPlantillasFaltantes, estadoPlantillas } from '../_shared/waPlantillas.ts';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const sb = createClient(URL_SB, SERVICE_KEY);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function autorizado(req: Request): Promise<{ ok: boolean; telefono?: string | null; empleado?: any }> {
  const key = req.headers.get('x-cron-key');
  if (key) {
    const { data } = await sb.rpc('reportes_cron_ok', { p_key: key });
    return { ok: data === true };
  }
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false };
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return { ok: false };
  const { data: au } = await sb.from('app_users').select('permission_area, employee_id, activo').eq('auth_user_id', u.user.id).maybeSingle();
  if (!au?.activo || !['DG', 'Administracion'].includes(au.permission_area)) return { ok: false };
  const { data: e } = au.employee_id ? await sb.from('employees').select('id, nombre, telefono_personal, obra_app_phone, phone').eq('id', au.employee_id).maybeSingle() : { data: null };
  return { ok: true, telefono: await telefonoDeEmpleado(sb, e), empleado: e };
}

const saludoDe = (p: any, e: any) => (p?.alias || '').trim() || primerNombre(e?.nombre);
const lista = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1];

// ── pedir ───────────────────────────────────────────────────────────────────
async function pedir(opts: { soloEmpleado?: string; telefonoPrueba?: string | null; obraPrueba?: string }) {
  const fecha = hoyCDMX();
  let personas: any[] = [];
  if (opts.soloEmpleado) {
    personas = [{ employee_id: opts.soloEmpleado, alias: null }];
  } else {
    const { data } = await sb.from('reporte_diario_personas').select('employee_id, alias').eq('activo', true);
    personas = data || [];
  }
  if (!personas.length) return { fecha, pedidos: 0, nota: 'No hay nadie en la lista de reportes diarios.' };
  const ids = personas.map(p => p.employee_id);
  const [{ data: emps }, { data: asig }] = await Promise.all([
    sb.from('employees').select('id, nombre, telefono_personal, obra_app_phone, phone, activo').in('id', ids),
    opts.obraPrueba
      ? sb.from('obras').select('id, nombre').eq('id', opts.obraPrueba).then((r: any) => ({ data: (r.data || []).map((o: any) => ({ employee_id: ids[0], obra_id: o.id, obras: o })) }))
      : sb.from('installer_daily_assignment').select('employee_id, obra_id, obras(id, nombre)').eq('fecha', fecha).in('employee_id', ids).not('obra_id', 'is', null),
  ]);
  const res: any[] = [];
  for (const p of personas) {
    const e = (emps || []).find((x: any) => x.id === p.employee_id);
    if (!e || e.activo === false) { res.push({ persona: p.employee_id, omitido: 'inactivo' }); continue; }
    const tel = opts.telefonoPrueba || await telefonoDeEmpleado(sb, e);
    if (!tel) { res.push({ persona: e.nombre, omitido: 'sin teléfono' }); continue; }
    const obras = new Map<string, string>();
    for (const a of (asig || []).filter((x: any) => x.employee_id === e.id)) obras.set(a.obra_id, a.obras?.nombre || 'obra');
    if (!obras.size) { res.push({ persona: e.nombre, omitido: 'sin planeación hoy' }); continue; }

    const nuevas: string[] = [];
    for (const [obraId, nombre] of obras) {
      const { data: ya } = await sb.from('reporte_solicitudes').select('id').eq('fecha', fecha).eq('employee_id', e.id)
        .eq('obra_id', obraId).is('obra_texto', null).neq('estado', 'cancelado').maybeSingle();
      if (ya) continue;
      const { error } = await sb.from('reporte_solicitudes').insert({ fecha, employee_id: e.id, obra_id: obraId, telefono: tel, estado: 'pedido', pedido_at: new Date().toISOString(), origen: opts.obraPrueba ? 'prueba' : 'planeacion' });
      if (!error) nuevas.push(nombre);
    }
    if (!nuevas.length) { res.push({ persona: e.nombre, omitido: 'ya se le había pedido' }); continue; }
    const saludo = saludoDe(p, e);
    // Paso 1: primero que confirme en qué obra estuvo; la planeación no siempre se cumple.
    const { texto, compacto } = preguntaObra(saludo, nuevas);
    const r = await avisar(sb, tel, saludo, texto, compacto);
    res.push({ persona: e.nombre, obras: nuevas, enviado: r.ok, error: r.error });
  }
  return { fecha, pedidos: res.filter(r => r.enviado).length, detalle: res };
}

// ── insistir ────────────────────────────────────────────────────────────────
async function insistir() {
  const fecha = hoyCDMX();
  const { data: sols } = await sb.from('reporte_solicitudes')
    .select('id, employee_id, telefono, obra_confirmada, obras(nombre), employees(nombre)')
    .eq('fecha', fecha).eq('estado', 'pedido');
  const porPersona = new Map<string, any[]>();
  for (const s of sols || []) porPersona.set(s.employee_id, [...(porPersona.get(s.employee_id) || []), s]);
  const { data: personas } = await sb.from('reporte_diario_personas').select('employee_id, alias');
  const res: any[] = [];
  for (const [empId, ss] of porPersona) {
    const p = (personas || []).find((x: any) => x.employee_id === empId);
    const saludo = saludoDe(p, ss[0].employees);
    const obras = ss.map((s: any) => s.obras?.nombre || 'la obra');
    // Si ni siquiera ha dicho en qué obra estuvo, se le vuelve a preguntar eso.
    const sinObra = ss.every((s: any) => !s.obra_confirmada);
    const q = preguntaObra(saludo, obras);
    const r = sinObra
      ? await avisar(sb, ss[0].telefono, saludo, `${saludo}, me falta tu reporte de hoy 🙏 ${q.texto.replace(/^Hola\s+\S+\s+👷 Antes de tu reporte: /, '')}`, `me falta tu reporte de hoy. ${q.compacto.replace(/^antes de tu reporte: /, '')}`)
      : await avisar(sb, ss[0].telefono, saludo,
        `${saludo}, me falta tu reporte de hoy de ${lista(obras.map((o: string) => `*${o}*`))}: qué avanzaste, bloqueos y avisos. Aunque sea corto o una nota de voz 🙏`,
        `me falta tu reporte de hoy de ${lista(obras)}. Aunque sea corto o una nota de voz`);
    if (r.ok) await sb.from('reporte_solicitudes').update({ estado: 'insistido', insistido_at: new Date().toISOString() }).in('id', ss.map((s: any) => s.id));
    res.push({ persona: ss[0].employees?.nombre, enviado: r.ok, error: r.error });
  }
  return { fecha, insistidos: res.filter(r => r.enviado).length, detalle: res };
}

// ── lecturas ────────────────────────────────────────────────────────────────
// Reportes que ya tienen texto y que llevan 3 minutos sin moverse: se procesan y
// se le manda al instalador lo que se entendió, para que lo confirme. La misma
// condición vive en el cron (wa-reportes-lecturas); si cambia aquí, allá también.
async function lecturas() {
  const limite = new Date(Date.now() - 3 * 60e3).toISOString();
  const { data } = await sb.from('reporte_solicitudes')
    .select('id, ultimo_mensaje_at, lectura_enviada_at, obra_reportes!reporte_solicitudes_reporte_id_fkey(texto_raw)')
    .eq('estado', 'recibiendo').eq('obra_confirmada', true).not('reporte_id', 'is', null)
    .gte('fecha', new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10))
    .lt('ultimo_mensaje_at', limite);
  const listas = (data || []).filter((s: any) =>
    (!s.lectura_enviada_at || s.lectura_enviada_at < s.ultimo_mensaje_at) && String(s.obra_reportes?.texto_raw || '').trim());
  const res: any[] = [];
  for (const s of listas) res.push({ solicitud: s.id, ...(await enviarLectura(sb, s.id)) });
  return { lecturas: res.filter(r => r.ok).length, detalle: res };
}

// ── resumen ─────────────────────────────────────────────────────────────────
// solo_proponer: los pendientes que detecte la IA NO se dan de alta solos; los
// aprueba el jefe de cuadrilla por WhatsApp (reporte_propuestas).
async function procesar(reporteId: string) {
  try {
    const r = await fetch(`${URL_SB}/functions/v1/process-obra-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
      body: JSON.stringify({ reporte_id: reporteId, solo_proponer: true }),
    });
    return r.ok;
  } catch { return false; }
}

const vineta = (xs: string[] | null | undefined, max = 4) => (xs || []).filter(Boolean).slice(0, max).map(x => `• ${x}`).join('\n');

let ALIAS = new Map<string, string>();
// Reportes de WhatsApp cuya lectura el instalador NO confirmó (o corrigió y no
// volvió a confirmar): en el resumen se marcan para que se lean con cuidado.
let SIN_CONFIRMAR = new Set<string>();
const nombreCorto = (id: string | null | undefined, nombre: string | null | undefined) => (id && ALIAS.get(id)) || primerNombre(nombre);

function bloqueObra(nombre: string, reps: any[], faltan: string[]): { texto: string; compacto: string } {
  const partes: string[] = [`🏗️ *${nombre}*`];
  const compacto: string[] = [`${nombre}:`];
  for (const r of reps) {
    const quien = nombreCorto(r.instalador_id, r.employees?.nombre);
    const sinConf = SIN_CONFIRMAR.has(r.id);
    partes.push(`_${quien}_${r.fotos?.length ? ` · ${r.fotos.length} foto${r.fotos.length > 1 ? 's' : ''}` : ''}${sinConf ? ' · ⚠️ no confirmó el resumen' : ''}`);
    if (r.ai_resumen) partes.push(r.ai_resumen);
    else if (r.texto_raw) partes.push(String(r.texto_raw).replace(/\[\d{2}:\d{2}\]\s*/g, '').slice(0, 500));
    if (r.ai_avances?.length) partes.push('Avances:\n' + vineta(r.ai_avances));
    if (r.ai_faltantes?.length) partes.push('Falta / necesita:\n' + vineta(r.ai_faltantes));
    if (r.ai_bloqueos?.length) partes.push('⚠️ Bloqueos:\n' + vineta(r.ai_bloqueos, 3));
    compacto.push(`${quien}: ${r.ai_resumen || String(r.texto_raw || '').replace(/\[\d{2}:\d{2}\]\s*/g, '').slice(0, 200)}` +
      (r.ai_bloqueos?.length ? ` Bloqueo: ${r.ai_bloqueos[0]}` : ''));
  }
  if (faltan.length) { partes.push(`❌ Sin reporte: ${lista(faltan)}`); compacto.push(`Sin reporte: ${lista(faltan)}`); }
  return { texto: partes.join('\n'), compacto: compacto.join(' ') };
}

async function resumen(opts: { soloObra?: string; soloA?: { telefono: string; saludo: string } | null; supervisorPrueba?: { employee_id: string; nombre: string; telefono: string } | null }) {
  const fecha = hoyCDMX();
  const { data: al } = await sb.from('reporte_diario_personas').select('employee_id, alias');
  ALIAS = new Map((al || []).filter((a: any) => a.alias).map((a: any) => [a.employee_id, a.alias]));
  // 1. Procesar con IA lo que llegó por WhatsApp y no se ha procesado (de hoy y
  //    de días anteriores que llegaron tarde). Lo de días anteriores no se reenvía.
  let q = sb.from('obra_reportes').select('id').eq('origen', 'whatsapp').eq('procesado', false).not('obra_id', 'is', null).gte('fecha', new Date(Date.now() - 4 * 86400e3).toISOString().slice(0, 10));
  if (opts.soloObra) q = q.eq('obra_id', opts.soloObra);
  const { data: pend } = await q;
  await Promise.all((pend || []).map((r: any) => procesar(r.id)));

  // 2. Lo de hoy, por obra.
  let qs = sb.from('reporte_solicitudes')
    .select('id, employee_id, obra_id, obra_texto, estado, reporte_id, confirmado_at, employees(nombre), obras(nombre, coordinador_id)')
    .eq('fecha', fecha).neq('estado', 'cancelado');
  if (opts.soloObra) qs = qs.eq('obra_id', opts.soloObra);
  const { data: sols } = await qs;
  let qr = sb.from('obra_reportes').select('id, obra_id, obra_texto, instalador_id, texto_raw, fotos, ai_resumen, ai_avances, ai_faltantes, ai_bloqueos, ai_pendientes, origen, employees:instalador_id(nombre)').eq('fecha', fecha);
  if (opts.soloObra) qr = qr.eq('obra_id', opts.soloObra);
  const { data: reps } = await qr;
  SIN_CONFIRMAR = new Set((sols || []).filter((x: any) => x.reporte_id && !x.confirmado_at && x.estado !== 'no_fue').map((x: any) => x.reporte_id));

  const obras = new Map<string, { nombre: string; coordinador: string | null; reps: any[]; faltan: string[] }>();
  for (const s of sols || []) {
    if (!s.obra_id) continue;
    const o = obras.get(s.obra_id) || { nombre: s.obras?.nombre || 'Obra', coordinador: s.obras?.coordinador_id || null, reps: [], faltan: [] };
    if (!s.reporte_id && ['pedido', 'insistido'].includes(s.estado)) o.faltan.push(nombreCorto(s.employee_id, s.employees?.nombre));
    obras.set(s.obra_id, o);
  }
  for (const r of reps || []) {
    if (!r.obra_id) continue;
    const o = obras.get(r.obra_id) || { nombre: '', coordinador: null, reps: [], faltan: [] };
    if (!o.nombre) {
      const { data: ob } = await sb.from('obras').select('nombre, coordinador_id').eq('id', r.obra_id).maybeSingle();
      o.nombre = ob?.nombre || 'Obra'; o.coordinador = ob?.coordinador_id || null;
    }
    o.reps.push(r);
    obras.set(r.obra_id, o);
  }

  // 3. Destinatarios: la lista de la obra, o coordinador. Elias (DG) recibe un
  //    solo cierre con todo, no uno por obra.
  const { data: dg } = await sb.from('employees').select('id, nombre, telefono_personal, obra_app_phone, phone').eq('puesto', 'DIRECTOR GENERAL').eq('activo', true).limit(1).maybeSingle();
  const telDG = await telefonoDeEmpleado(sb, dg);
  const enviados: any[] = [];

  // 3a. Jefes de cuadrilla: un solo mensaje con lo de su equipo (su área) y las
  //     actividades detectadas, numeradas, para que decida cuáles subir y con qué
  //     fecha. Los de la lista de cada obra no se le repiten.
  const telSupervisores = new Set<string>();
  const porDecidir: string[] = [];
  {
    let sups: any[] = [];
    if (opts.supervisorPrueba) sups = [{ employee_id: opts.supervisorPrueba.employee_id, areas: null, employees: { nombre: opts.supervisorPrueba.nombre }, tel: opts.supervisorPrueba.telefono }];
    else if (!opts.soloA) {
      const { data } = await sb.from('reporte_supervisores').select('employee_id, areas, employees(id, nombre, telefono_personal, obra_app_phone, phone, activo)').eq('activo', true);
      for (const x of data || []) if (x.employees?.activo !== false) sups.push({ ...x, tel: await telefonoDeEmpleado(sb, { ...(x.employees || {}), id: x.employee_id }) });
    }
    if (sups.length) {
      const ids = [...new Set([...(sols || []).map((x: any) => x.employee_id), ...(reps || []).map((x: any) => x.instalador_id)].filter(Boolean))];
      const { data: ar } = ids.length ? await sb.from('employees').select('id, area').in('id', ids) : { data: [] };
      const areaDe = new Map((ar || []).map((x: any) => [x.id, x.area]));
      const fechaTxt = fechaCorta(fecha);
      for (const sup of sups) {
        const mia = (empId: string | null | undefined) => !sup.areas?.length || sup.areas.includes(areaDe.get(empId || '') || '');
        const susReps = (reps || []).filter((r: any) => r.obra_id && mia(r.instalador_id));
        await armarPropuestas(sb, sup.employee_id, fecha, susReps);
        const ps = await abiertasDe(sb, sup.employee_id);
        const bloquesSup: string[] = [];
        for (const [obraId, o] of obras) {
          const rs = o.reps.filter((r: any) => mia(r.instalador_id));
          const fs = (sols || []).filter((x: any) => x.obra_id === obraId && !x.reporte_id && ['pedido', 'insistido'].includes(x.estado) && mia(x.employee_id))
            .map((x: any) => nombreCorto(x.employee_id, x.employees?.nombre));
          if (rs.length || fs.length) bloquesSup.push(bloqueObra(o.nombre, rs, fs).texto);
        }
        // Lo que convendría reportar a residente / segurista / cliente.
        const comunicados = await detectarComunicados(susReps.map((r: any) => ({ ...r, obra_nombre: obras.get(r.obra_id)?.nombre })), (r: any) => nombreCorto(r.instalador_id, r.employees?.nombre)).catch(() => []);
        if (!bloquesSup.length && !ps.length) continue;
        if (!sup.tel) { enviados.push({ obra: 'jefe de cuadrilla', a: primerNombre(sup.employees?.nombre), ok: false, error: 'sin teléfono' }); continue; }
        telSupervisores.add(sup.tel);
        const saludo = (ALIAS.get(sup.employee_id) || primerNombre(sup.employees?.nombre));
        const texto = [`📋 *Resumen de tu equipo* · ${fechaTxt}`, ...(bloquesSup.length ? bloquesSup : ['Hoy no llegaron reportes de tu equipo.']), textoPropuestas(ps, fecha), textoComunicados(comunicados)].filter(Boolean).join('\n\n');
        const compacto = `resumen de tu equipo de hoy (${bloquesSup.length} obra${bloquesSup.length === 1 ? '' : 's'})` +
          (ps.length ? ` y ${ps.length} actividad${ps.length === 1 ? '' : 'es'} detectada${ps.length === 1 ? '' : 's'} para que decidas si las subo y con qué fecha` : '');
        const r = await avisar(sb, sup.tel, saludo, texto, compacto, 'supervisor');
        // En su plática con el asistente, para que "la 2 el jueves" o "sí, la B" se entiendan.
        if (r.ok && !opts.soloA) await alHistorial(sb, sup.employee_id, texto);
        else if (r.ok && opts.supervisorPrueba) await alHistorial(sb, opts.supervisorPrueba.employee_id, texto);
        enviados.push({ obra: 'jefe de cuadrilla', a: saludo, ok: r.ok, error: r.error, propuestas: ps.length, diferido: r.diferido });
        if (ps.length) porDecidir.push(`${saludo}: ${ps.length}`);
      }
    }
  }
  const bloques: string[] = [];
  const compactos: string[] = [];
  for (const [obraId, o] of obras) {
    const b = bloqueObra(o.nombre, o.reps, o.faltan);
    bloques.push(b.texto); compactos.push(b.compacto);
    if (opts.soloA) continue;
    const { data: dest } = await sb.from('reporte_obra_destinatarios').select('employee_id, telefono, nombre, employees(nombre, telefono_personal, obra_app_phone, phone)').eq('obra_id', obraId);
    let gente: { tel: string; saludo: string }[] = [];
    if (dest?.length) {
      for (const d of dest) gente.push({
        tel: d.telefono ? '52' + String(d.telefono).replace(/\D/g, '').slice(-10) : (await telefonoDeEmpleado(sb, { ...(d.employees || {}), id: d.employee_id })) || '',
        saludo: primerNombre(d.nombre || d.employees?.nombre),
      });
    } else if (o.coordinador) {
      const { data: c } = await sb.from('employees').select('nombre, telefono_personal, obra_app_phone, phone').eq('id', o.coordinador).maybeSingle();
      if (c) gente = [{ tel: (await telefonoDeEmpleado(sb, { ...c, id: o.coordinador })) || '', saludo: primerNombre(c.nombre) }];
    }
    const vistos = new Set<string>([telDG || '', ...telSupervisores]);
    for (const g of gente) {
      if (!g.tel || vistos.has(g.tel)) continue;
      vistos.add(g.tel);
      const r = await avisar(sb, g.tel, g.saludo, `📋 Reporte del día\n\n${b.texto}`, `reporte del día de ${b.compacto}`);
      enviados.push({ obra: o.nombre, a: g.saludo, ok: r.ok, error: r.error });
    }
  }

  // 4. Cierre del día para Elias: todas las obras + lo que no cuadra.
  const sinObra = (reps || []).filter((r: any) => !r.obra_id);
  const sinRespuesta = (sols || []).filter((s: any) => !s.reporte_id && ['pedido', 'insistido'].includes(s.estado));
  const extra: string[] = [];
  if (sinObra.length) extra.push(`📌 *Reportes sin obra en el ERP*\n` + sinObra.map((r: any) => `• ${nombreCorto(r.instalador_id, r.employees?.nombre)}: ${r.obra_texto || 'sin nombre'}`).join('\n'));
  if (porDecidir.length) extra.push(`🛠️ *Actividades detectadas, esperando decisión del jefe de cuadrilla*\n` + porDecidir.map(x => `• ${x}`).join('\n'));
  const destDG = opts.soloA || (telDG ? { telefono: telDG, saludo: primerNombre(dg?.nombre) } : null);
  if (destDG && (bloques.length || extra.length)) {
    const cab = `📋 *Cierre del día* · ${obras.size} obra${obras.size === 1 ? '' : 's'}` +
      (sinRespuesta.length ? ` · ${sinRespuesta.length} sin reporte` : '');
    const texto = [cab, ...bloques, ...extra].join('\n\n');
    const compacto = `cierre del día: ${compactos.join(' | ')}${sinObra.length ? ` | Sin obra en ERP: ${sinObra.map((r: any) => r.obra_texto).join(', ')}` : ''}`;
    // avisar() parte lo que pase de 3,800 caracteres, y con la ventana cerrada
    // guarda el texto completo para entregarlo cuando conteste.
    const r = await avisar(sb, destDG.telefono, destDG.saludo, texto, compacto, 'cierre');
    if (r.ok && !opts.soloA && dg?.id) await alHistorial(sb, dg.id, texto);
    enviados.push({ obra: 'cierre del día', a: destDG.saludo, ok: r.ok, error: r.error, diferido: r.diferido });
  }

  // 5. Cerrar el día (en prueba no se toca nada).
  if (!opts.soloA) {
    const conReporte = (sols || []).filter((s: any) => s.reporte_id).map((s: any) => s.id);
    if (conReporte.length) await sb.from('reporte_solicitudes').update({ estado: 'cerrado', resumen_enviado_at: new Date().toISOString() }).in('id', conReporte).neq('estado', 'no_fue');
    if (sinRespuesta.length) await sb.from('reporte_solicitudes').update({ estado: 'sin_respuesta' }).in('id', sinRespuesta.map((s: any) => s.id));
  }
  return { fecha, obras: obras.size, procesados: pend?.length || 0, enviados };
}

// ── Domingo de planeación ───────────────────────────────────────────────────
// Elias: "los domingos que planea la semana, le escriba desde las 5 pm para
// preguntarle qué trae en mente, le recuerde los pendientes de las obras y
// analice el avance general para ayudar a pelotear". El mensaje lo arma el
// modelo con datos reales (panorama de sus obras); la plática que sigue la lleva
// el asistente del coordinador (whatsapp-webhook, modo coordinador).
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY') ?? '';

async function redactar(prompt: string, max = 3000): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  for (const model of ['claude-opus-5-5', 'claude-sonnet-4-6']) {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: max, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!res.ok) continue;
      const b = await res.json();
      let t = (b.content || []).map((x: any) => x.text || '').join('').trim();
      // Si se cortó por largo, se queda hasta la última línea completa: un
      // mensaje que termina a media palabra se ve roto.
      if (b.stop_reason === 'max_tokens' && t.includes('\n')) t = t.slice(0, t.lastIndexOf('\n')).trim() + '\n¿Qué traes en mente para la semana?';
      if (t) return t;
    } catch (_) { /* siguiente */ }
  }
  return null;
}

async function supervisoresActivos(soloId?: string | null) {
  let q = sb.from('reporte_supervisores').select('employee_id, employees(id, nombre, telefono_personal, obra_app_phone, phone, activo)').eq('activo', true);
  if (soloId) q = q.eq('employee_id', soloId);
  const { data } = await q;
  return (data || []).filter((x: any) => x.employees?.activo !== false);
}

async function domingo(opts: { soloA?: string | null; comoSupervisor?: string | null; soloTexto?: boolean }) {
  const { data: al } = await sb.from('reporte_diario_personas').select('employee_id, alias');
  ALIAS = new Map((al || []).filter((a: any) => a.alias).map((a: any) => [a.employee_id, a.alias]));
  const sups = await supervisoresActivos(opts.comoSupervisor);
  const res: any[] = [];
  for (const sup of opts.soloA ? sups.slice(0, 1) : sups) {
    const c = await contextoCoord(sb, sup.employee_id);
    const pan = await panorama(sb, c);
    const ps = await abiertasDe(sb, sup.employee_id);
    const { data: rec } = await sb.from('coordinador_recordatorios').select('cuando, texto').eq('employee_id', sup.employee_id)
      .is('enviado_at', null).eq('cancelado', false).lte('cuando', new Date(Date.now() + 7 * 86400e3).toISOString()).order('cuando');
    const saludo = ALIAS.get(sup.employee_id) || primerNombre(sup.employees?.nombre);
    const datos = {
      semana_que_empieza: (pan as any).semana_que_empieza,
      obras: ((pan as any).obras || []).map((o: any) => ({ obra: o.obra, estado: o.estado, actividades: o.actividades, vencidas_ejemplo: o.vencidas_mas_viejas, ultimo_reporte: o.ultimo_reporte?.fecha || null, bloqueos: o.bloqueos_recientes, faltantes: o.faltantes_recientes, gente_semana: o.gente_esta_semana, compras_por_llegar: o.compras_por_llegar })),
      equipo_sin_planeacion: (pan as any).equipo_sin_planeacion_esta_semana,
      actividades_por_aprobar: ps.map(p => `${p.numero}) ${p.obra}: ${p.descripcion}`),
      recordatorios_de_la_semana: (rec || []).map((r: any) => `${new Date(r.cuando).toLocaleString('es-MX', { timeZone: ZONA, weekday: 'short', hour: '2-digit', minute: '2-digit' })} ${r.texto}`),
    };
    const prompt = `Eres el asistente de coordinación de obra de OMM Technologies. Es domingo a las 5 pm y vas a escribirle por WhatsApp a ${saludo}, jefe de cuadrilla de Instalaciones Especiales, para planear la semana que empieza mañana.

Datos reales del ERP (JSON):
${JSON.stringify(datos).slice(0, 14000)}

Escribe SOLO el mensaje de WhatsApp (sin comillas ni explicación):
- Saludo corto con su nombre.
- 3 a 5 viñetas "•" con lo que MÁS importa para planear: obras con entregas o vencidas sin gente, bloqueos o faltantes que siguen, gente sin asignar, compras por llegar, actividades que tiene por aprobar, recordatorios de la semana. Con nombres de obra y números concretos. Si una obra tiene cientos de vencidas, dilo como "fechas que hay que actualizar", no como atraso.
- Cierra preguntando qué trae en mente para la semana y ofreciendo armar el plan por persona y día con él.
- Máximo 12 líneas. Español mexicano, directo, cálido sin exagerar. Usa *negritas* de WhatsApp sólo para nombres de obra. Nada de markdown con # ni tablas.`;
    const texto = (await redactar(prompt)) || [
      `Hola ${saludo} 👋 Es domingo de planeación.`,
      ...((pan as any).obras || []).slice(0, 4).map((o: any) => `• *${o.obra}*: ${o.actividades.vencidas} vencidas, ${o.actividades.vencen_7_dias} vencen esta semana${o.gente_esta_semana.length ? '' : ', sin gente planeada'}`),
      (pan as any).equipo_sin_planeacion_esta_semana?.length ? `• Sin asignar: ${(pan as any).equipo_sin_planeacion_esta_semana.join(', ')}` : '',
      ps.length ? `• Tienes ${ps.length} actividades detectadas por aprobar.` : '',
      '¿Qué traes en mente para esta semana? Armamos el plan por persona y día.',
    ].filter(Boolean).join('\n');
    if (opts.soloTexto) { res.push({ a: saludo, texto, datos }); continue; }
    const tel = opts.soloA || await telefonoDeEmpleado(sb, sup.employees);
    if (!tel) { res.push({ a: saludo, ok: false, error: 'sin teléfono' }); continue; }
    const r = await avisar(sb, tel, saludo, texto, 'es domingo de planeación: tengo el panorama de tus obras para la semana. ¿Qué traes en mente?', 'domingo');
    await alHistorial(sb, opts.soloA ? (await empleadoDelTelefono(opts.soloA)) : sup.employee_id, texto);
    res.push({ a: saludo, ok: r.ok, error: r.error, diferido: r.diferido });
  }
  return { domingo: res };
}

async function empleadoDelTelefono(tel: string): Promise<string | null> {
  return (await empleadoDeTelefono(sb, tel))?.id || null;
}

async function domingoInsistir() {
  const { data: al } = await sb.from('reporte_diario_personas').select('employee_id, alias');
  ALIAS = new Map((al || []).filter((a: any) => a.alias).map((a: any) => [a.employee_id, a.alias]));
  const res: any[] = [];
  for (const sup of await supervisoresActivos()) {
    const tel = await telefonoDeEmpleado(sb, sup.employees);
    if (!tel) continue;
    const desde = new Date(Date.now() - 2.5 * 3600e3).toISOString();
    const { data: escribio } = await sb.from('whatsapp_messages').select('id').eq('direction', 'in').ilike('phone_e164', '%' + tel.slice(-10)).gte('created_at', desde).limit(1);
    if (escribio?.length) { res.push({ a: sup.employee_id, ya_contesto: true }); continue; }
    const saludo = ALIAS.get(sup.employee_id) || primerNombre(sup.employees?.nombre);
    const texto = `${saludo}, ¿le damos 5 minutos a la semana? Dime qué obras traes como prioridad y quién va a cada una, y yo te armo el plan por día para que lo confirmes.`;
    const r = await avisar(sb, tel, saludo, texto, 'le damos 5 minutos a planear la semana? Dime prioridades y armo el plan', 'domingo');
    await alHistorial(sb, sup.employee_id, texto);
    res.push({ a: saludo, ok: r.ok, error: r.error });
  }
  return { insistidos: res };
}

// ── Recordatorios ───────────────────────────────────────────────────────────
async function recordatorios() {
  const { data } = await sb.from('coordinador_recordatorios').select('id, employee_id, texto, cuando, obras(nombre), employees(id, nombre, telefono_personal, obra_app_phone, phone)')
    .is('enviado_at', null).eq('cancelado', false).lte('cuando', new Date().toISOString()).order('cuando').limit(50);
  const res: any[] = [];
  for (const r of data || []) {
    // Reclamar primero: dos corridas del cron no lo mandan dos veces.
    const { data: tomado } = await sb.from('coordinador_recordatorios').update({ enviado_at: new Date().toISOString() }).eq('id', r.id).is('enviado_at', null).select('id');
    if (!tomado?.length) continue;
    const tel = await telefonoDeEmpleado(sb, r.employees);
    const saludo = primerNombre(r.employees?.nombre);
    const texto = `⏰ *Recordatorio*${r.obras?.nombre ? ' · ' + r.obras.nombre : ''}\n${r.texto}`;
    const env = tel ? await avisar(sb, tel, saludo, texto, `recordatorio${r.obras?.nombre ? ' de ' + r.obras.nombre : ''}: ${r.texto}`, 'recordatorio') : { ok: false, error: 'sin teléfono' };
    if (!env.ok && tel) await sb.from('coordinador_recordatorios').update({ enviado_at: null }).eq('id', r.id);
    else await alHistorial(sb, r.employee_id, texto);
    res.push({ id: r.id, ok: env.ok, error: env.error });
  }
  return { recordatorios: res };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST' }, 405);
  const quien = await autorizado(req);
  if (!quien.ok) return json({ ok: false, error: 'No autorizado' }, 401);
  const p = await req.json().catch(() => ({}));
  try {
    switch (p.accion) {
      case 'pedir': return json({ ok: true, ...(await pedir({})) });
      case 'insistir': return json({ ok: true, ...(await insistir()) });
      case 'lecturas': return json({ ok: true, ...(await lecturas()) });
      case 'domingo': case 'domingo_insistir': case 'recordatorios': {
        const f = p.accion === 'domingo' ? () => domingo({}) : p.accion === 'domingo_insistir' ? domingoInsistir : recordatorios;
        if (req.headers.get('x-cron-key')) {
          EdgeRuntime.waitUntil(f().then(r => console.log(p.accion, JSON.stringify(r))).catch(e => console.error(p.accion, e)));
          return json({ ok: true, en_proceso: true });
        }
        return json({ ok: true, ...(await f()) });
      }
      case 'plantillas': {
        // Crea en Meta las plantillas de OMM que falten y devuelve su estado.
        // Con la llave del cron o un DG/Administración. Sólo crea las que no
        // existen: no toca ni reenvía las aprobadas.
        const wabaId = Deno.env.get('WHATSAPP_WABA_ID') || '';
        if (!wabaId) return json({ ok: false, error: 'Falta WHATSAPP_WABA_ID' }, 400);
        const creadas = p.solo_estado ? [] : await crearPlantillasFaltantes(graphGet, graphPost, wabaId);
        return json({ ok: true, creadas, estado: await estadoPlantillas(graphGet, wabaId) });
      }
      case 'diagnostico': {
        // Sólo con la llave del cron (se llama desde SQL): corre herramientas de
        // LECTURA del coordinador o arma el mensaje del domingo sin mandarlo.
        if (!req.headers.get('x-cron-key')) return json({ ok: false, error: 'Sólo cron' }, 403);
        if (p.herramienta === 'domingo') return json({ ok: true, ...(await domingo({ comoSupervisor: p.empleado, soloTexto: true })) });
        const LECTURA = new Set(['panorama_obras', 'pendientes_obra', 'ver_planeacion', 'propuestas_pendientes']);
        if (!LECTURA.has(p.herramienta)) return json({ ok: false, error: 'Sólo herramientas de lectura' }, 400);
        const ctx: any = { supabase: sb, contact: { id: 'diagnostico', employee_id: p.empleado, phone_e164: '', role: 'interno' }, conversation: { id: null }, sesion: null };
        return json(await ejecutarCoord(p.herramienta, p.args || {}, ctx));
      }
      case 'prueba_domingo': {
        // Lo que recibe el jefe de cuadrilla el domingo, armado con SUS obras, a tu número.
        if (!quien.telefono) return json({ ok: false, error: 'Tu usuario no tiene teléfono.' }, 400);
        return json({ ok: true, ...(await domingo({ soloA: quien.telefono, comoSupervisor: p.supervisor_id || null })) });
      }
      case 'resumen': {
        // Desde el cron se contesta al momento y se trabaja en segundo plano
        // (procesar con IA tarda); desde el ERP se espera el resultado.
        if (req.headers.get('x-cron-key')) {
          EdgeRuntime.waitUntil(resumen({}).then(r => console.log('resumen', JSON.stringify(r))).catch(e => console.error('resumen', e)));
          return json({ ok: true, en_proceso: true });
        }
        return json({ ok: true, ...(await resumen({})) });
      }
      case 'prueba_pedir': {
        // Pide el reporte de UNA obra a quien llama, a su propio número.
        if (!quien.empleado || !quien.telefono) return json({ ok: false, error: 'Tu usuario no tiene empleado con teléfono.' }, 400);
        if (!p.obra_id) return json({ ok: false, error: 'obra_id requerido' }, 400);
        return json({ ok: true, ...(await pedir({ soloEmpleado: quien.empleado.id, telefonoPrueba: quien.telefono, obraPrueba: p.obra_id })) });
      }
      case 'prueba_resumen': {
        if (!quien.telefono) return json({ ok: false, error: 'Tu usuario no tiene teléfono.' }, 400);
        // supervisor=true: además te llega lo que recibe el jefe de cuadrilla, con
        // las actividades detectadas a tu nombre. Si contestas "todas para el
        // viernes", SÍ se dan de alta en la obra (es la prueba completa).
        const sp = p.supervisor && quien.empleado ? { employee_id: quien.empleado.id, nombre: quien.empleado.nombre, telefono: quien.telefono } : null;
        return json({ ok: true, ...(await resumen({ soloObra: p.obra_id, soloA: { telefono: quien.telefono, saludo: primerNombre(quien.empleado?.nombre) }, supervisorPrueba: sp })) });
      }
      default: return json({ ok: false, error: `Acción desconocida: ${p.accion}` }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
