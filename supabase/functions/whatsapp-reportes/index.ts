// Edge Function: whatsapp-reportes — reportes diarios de obra por WhatsApp.
//
// La llama pg_cron (con la llave del vault en x-cron-key) o un DG/Admin desde
// el ERP (con su JWT). Acciones:
//   pedir     18:00  le pide su reporte a cada persona de reporte_diario_personas
//                    según su planeación del día (installer_daily_assignment).
//   insistir  19:30  a quien no ha contestado, una sola vez.
//   resumen   21:00  procesa los reportes (process-obra-report), manda el
//                    resumen de cada obra a su lista y a Elias el cierre del día.
//   prueba           pedir/resumen sólo para una persona u obra, hacia el número
//                    de quien llama. Para probar sin molestar a nadie.
// Lo que contesta el instalador lo recibe whatsapp-webhook (reportes.ts).
//
// Deploy: verify_jwt=false (la función revisa x-cron-key o el JWT).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { hoyCDMX, telefonoDeEmpleado, avisar, primerNombre } from '../whatsapp-webhook/reportesComun.ts';

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
    const obrasTxt = lista(nuevas.map(n => `*${n}*`));
    const texto = `Hola ${saludo} 👷 ¿Cómo quedó hoy ${obrasTxt}? Mándame tu reporte del día: qué avanzaste, fotos y qué falta o qué necesitas. Puede ser por nota de voz.`;
    const compacto = `manda tu reporte de hoy de ${lista(nuevas)}: qué avanzaste, fotos y qué falta. Puede ser nota de voz`;
    const r = await avisar(sb, tel, saludo, texto, compacto);
    res.push({ persona: e.nombre, obras: nuevas, enviado: r.ok, error: r.error });
  }
  return { fecha, pedidos: res.filter(r => r.enviado).length, detalle: res };
}

// ── insistir ────────────────────────────────────────────────────────────────
async function insistir() {
  const fecha = hoyCDMX();
  const { data: sols } = await sb.from('reporte_solicitudes')
    .select('id, employee_id, telefono, obras(nombre), employees(nombre)')
    .eq('fecha', fecha).eq('estado', 'pedido');
  const porPersona = new Map<string, any[]>();
  for (const s of sols || []) porPersona.set(s.employee_id, [...(porPersona.get(s.employee_id) || []), s]);
  const { data: personas } = await sb.from('reporte_diario_personas').select('employee_id, alias');
  const res: any[] = [];
  for (const [empId, ss] of porPersona) {
    const p = (personas || []).find((x: any) => x.employee_id === empId);
    const saludo = saludoDe(p, ss[0].employees);
    const obras = ss.map((s: any) => s.obras?.nombre || 'la obra');
    const r = await avisar(sb, ss[0].telefono, saludo,
      `${saludo}, me falta tu reporte de hoy de ${lista(obras.map((o: string) => `*${o}*`))}. Aunque sea corto o una nota de voz 🙏`,
      `me falta tu reporte de hoy de ${lista(obras)}. Aunque sea corto o una nota de voz`);
    if (r.ok) await sb.from('reporte_solicitudes').update({ estado: 'insistido', insistido_at: new Date().toISOString() }).in('id', ss.map((s: any) => s.id));
    res.push({ persona: ss[0].employees?.nombre, enviado: r.ok, error: r.error });
  }
  return { fecha, insistidos: res.filter(r => r.enviado).length, detalle: res };
}

// ── resumen ─────────────────────────────────────────────────────────────────
async function procesar(reporteId: string) {
  try {
    const r = await fetch(`${URL_SB}/functions/v1/process-obra-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
      body: JSON.stringify({ reporte_id: reporteId }),
    });
    return r.ok;
  } catch { return false; }
}

const vineta = (xs: string[] | null | undefined, max = 4) => (xs || []).filter(Boolean).slice(0, max).map(x => `• ${x}`).join('\n');

let ALIAS = new Map<string, string>();
const nombreCorto = (id: string | null | undefined, nombre: string | null | undefined) => (id && ALIAS.get(id)) || primerNombre(nombre);

function bloqueObra(nombre: string, reps: any[], faltan: string[]): { texto: string; compacto: string } {
  const partes: string[] = [`🏗️ *${nombre}*`];
  const compacto: string[] = [`${nombre}:`];
  for (const r of reps) {
    const quien = nombreCorto(r.instalador_id, r.employees?.nombre);
    partes.push(`_${quien}_${r.fotos?.length ? ` · ${r.fotos.length} foto${r.fotos.length > 1 ? 's' : ''}` : ''}`);
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

async function resumen(opts: { soloObra?: string; soloA?: { telefono: string; saludo: string } | null }) {
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
    .select('id, employee_id, obra_id, obra_texto, estado, reporte_id, employees(nombre), obras(nombre, coordinador_id)')
    .eq('fecha', fecha).neq('estado', 'cancelado');
  if (opts.soloObra) qs = qs.eq('obra_id', opts.soloObra);
  const { data: sols } = await qs;
  let qr = sb.from('obra_reportes').select('id, obra_id, obra_texto, instalador_id, texto_raw, fotos, ai_resumen, ai_avances, ai_faltantes, ai_bloqueos, origen, employees:instalador_id(nombre)').eq('fecha', fecha);
  if (opts.soloObra) qr = qr.eq('obra_id', opts.soloObra);
  const { data: reps } = await qr;

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
    const vistos = new Set<string>([telDG || '']);
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
  const destDG = opts.soloA || (telDG ? { telefono: telDG, saludo: primerNombre(dg?.nombre) } : null);
  if (destDG && (bloques.length || extra.length)) {
    const cab = `📋 *Cierre del día* · ${obras.size} obra${obras.size === 1 ? '' : 's'}` +
      (sinRespuesta.length ? ` · ${sinRespuesta.length} sin reporte` : '');
    const texto = [cab, ...bloques, ...extra].join('\n\n');
    const compacto = `cierre del día: ${compactos.join(' | ')}${sinObra.length ? ` | Sin obra en ERP: ${sinObra.map((r: any) => r.obra_texto).join(', ')}` : ''}`;
    // WhatsApp corta en 4096: si no cabe, se manda en partes.
    const partes: string[] = [];
    let actual = '';
    for (const trozo of texto.split('\n\n')) {
      if ((actual + '\n\n' + trozo).length > 3800 && actual) { partes.push(actual); actual = trozo; } else actual = actual ? actual + '\n\n' + trozo : trozo;
    }
    if (actual) partes.push(actual);
    for (let i = 0; i < partes.length; i++) {
      const r = await avisar(sb, destDG.telefono, destDG.saludo, partes[i], i === 0 ? compacto : `continuación del cierre`);
      enviados.push({ obra: 'cierre del día', a: destDG.saludo, ok: r.ok, error: r.error });
      if (!r.ok) break;
    }
  }

  // 5. Cerrar el día (en prueba no se toca nada).
  if (!opts.soloA) {
    const conReporte = (sols || []).filter((s: any) => s.reporte_id).map((s: any) => s.id);
    if (conReporte.length) await sb.from('reporte_solicitudes').update({ estado: 'cerrado', resumen_enviado_at: new Date().toISOString() }).in('id', conReporte).neq('estado', 'no_fue');
    if (sinRespuesta.length) await sb.from('reporte_solicitudes').update({ estado: 'sin_respuesta' }).in('id', sinRespuesta.map((s: any) => s.id));
  }
  return { fecha, obras: obras.size, procesados: pend?.length || 0, enviados };
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
        return json({ ok: true, ...(await resumen({ soloObra: p.obra_id, soloA: { telefono: quien.telefono, saludo: primerNombre(quien.empleado?.nombre) } })) });
      }
      default: return json({ ok: false, error: `Acción desconocida: ${p.accion}` }, 400);
    }
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
