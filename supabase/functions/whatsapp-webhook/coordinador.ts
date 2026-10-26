// Coordinador de obra — las herramientas del asistente de Alfredo (jefe de
// instaladores de Especiales).
//
// Elias: "quiero generar un mega coordinador, que realmente tenga una
// herramienta que lo exponencialice, le ayude a acordarse de cosas, que le dé
// información necesaria… que sea realmente inteligente, no solamente un lugar
// para poner cosas y que se pierdan."
//
// Por eso cada herramienta deja algo DONDE VIVE en el ERP:
//   - un pendiente de obra       → obra_actividades (lo ve la app de obra y el Gantt)
//   - un plan de la semana       → weekly_plans + weekly_plan_assignments, con el
//                                  espejo installer_daily_assignment (lo que usa
//                                  el reporte de las 6 pm para saber a quién pedir)
//   - un recordatorio            → coordinador_recordatorios (el cron lo manda)
//   - algo para Elias            → action_items en su tablero + WhatsApp
//   - algo para Logística        → project_tasks de Gabriel (Mi trabajo) + WhatsApp
//   - un reporte oficial         → PDF al chat de Alfredo (él lo reenvía)
//
// Corren con la llave de servicio, pero cada una se limita a las obras del
// coordinador o de su equipo. Cambiar al responsable de una actividad que ya
// existe NO se hace aquí: Elias pidió que eso se haga entrando al ERP.
import type { ToolDefinition, ToolExecutionContext, ToolResult } from './types.ts';
import { hoyCDMX, normalizar, primerNombre, avisar, alHistorial, telefonoDeEmpleado, mandarDocumento, ZONA } from './reportesComun.ts';
import { abiertasDe, aplicar, type Decision } from './supervisor.ts';
import { generarReporteOficialPdf, type FotoReporte } from '../_shared/reporteOficialPdf.ts';

const ACTIVAS = ['en_ejecucion', 'entrega_pendiente', 'pausada'];
const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
const NOMBRE_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const SISTEMAS = ['CCTV', 'Audio', 'Redes', 'Control', 'Acceso', 'Electrico', 'Humo', 'BMS', 'Telefonia', 'Celular', 'Persianas'];

const sumar = (fecha: string, dias: number) => { const d = new Date(fecha + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); };
const dow = (fecha: string) => new Date(fecha + 'T12:00:00Z').getUTCDay(); // 0 domingo
export function lunesDe(fecha: string): string { const d = dow(fecha); return sumar(fecha, d === 0 ? -6 : 1 - d); }
const fechaCorta = (f: string | null | undefined) => f ? new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(f + 'T12:00:00Z')).replace(/\./g, '') : 'sin fecha';
const ok = (data: unknown, extra: Partial<ToolResult> = {}): ToolResult => ({ success: true, data, ...extra });
const mal = (error: string, data?: unknown): ToolResult => ({ success: false, error, data });
const esFecha = (s: any) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

function semanaDe(arg: any): string {
  const hoy = hoyCDMX();
  const s = String(arg || 'esta').toLowerCase();
  if (esFecha(s)) return lunesDe(s);
  // En domingo, "esta semana" para planear es la que empieza mañana.
  const base = dow(hoy) === 0 ? sumar(hoy, 1) : hoy;
  if (s.startsWith('prox') || s.startsWith('próx') || s === 'siguiente') return sumar(lunesDe(base), 7);
  return lunesDe(base);
}

// ── Quién es el coordinador, su equipo y sus obras ──────────────────────────

export interface Coord { empId: string; nombre: string; areas: string[] | null; equipo: any[]; obras: any[] }

export async function contextoCoord(sb: any, empId: string): Promise<Coord> {
  const [{ data: e }, { data: sup }] = await Promise.all([
    sb.from('employees').select('id, nombre, area, puesto').eq('id', empId).maybeSingle(),
    sb.from('reporte_supervisores').select('areas').eq('employee_id', empId).maybeSingle(),
  ]);
  const areas: string[] | null = sup?.areas?.length ? sup.areas : (e?.area ? [e.area] : null);
  let qe = sb.from('employees').select('id, nombre, area, puesto').eq('activo', true);
  if (areas) qe = qe.in('area', areas);
  const { data: equipo } = await qe;
  const ids = (equipo || []).map((x: any) => x.id);
  const hoy = hoyCDMX();
  const { data: planes } = await sb.from('weekly_plans').select('id').gte('week_start', sumar(lunesDe(hoy), -14)).lte('week_start', sumar(lunesDe(hoy), 14));
  const { data: wpa } = ids.length && planes?.length
    ? await sb.from('weekly_plan_assignments').select('obra_id').in('plan_id', planes.map((p: any) => p.id)).in('employee_id', ids).not('obra_id', 'is', null)
    : { data: [] };
  const planeadas = [...new Set((wpa || []).map((w: any) => w.obra_id))];
  let qo = sb.from('obras').select('id, nombre, cliente, direccion, direccion_completa, status, avance_global, fecha_fin_plan, coordinador_id, quotation_id, quotation_ids, sistemas, project_id').in('status', ACTIVAS);
  qo = planeadas.length ? qo.or(`coordinador_id.eq.${empId},id.in.(${planeadas.join(',')})`) : qo.eq('coordinador_id', empId);
  const { data: obras } = await qo.order('nombre');
  return { empId, nombre: e?.nombre || '', areas, equipo: equipo || [], obras: obras || [] };
}

function puntuar(texto: string, nombre: string): number {
  const p = normalizar(texto).split(' ').filter(w => w.length >= 2);
  if (!p.length) return 0;
  const n = ' ' + normalizar(nombre) + ' ';
  return p.filter(w => n.includes(' ' + w) || (w.length >= 4 && n.includes(w))).length / p.length;
}

async function resolverObra(sb: any, c: Coord, texto: any): Promise<{ obra?: any; candidatas?: any[]; error?: string }> {
  const t = String(texto || '').trim();
  if (!t) return { error: '¿De qué obra?' };
  if (/^[0-9a-f-]{36}$/i.test(t)) {
    const o = c.obras.find(x => x.id === t) || (await sb.from('obras').select('*').eq('id', t).maybeSingle()).data;
    return o ? { obra: o } : { error: 'No encontré esa obra.' };
  }
  const elegir = (lista: any[]) => {
    const s = lista.map(o => ({ o, s: puntuar(t, `${o.nombre} ${o.cliente || ''}`) })).filter(x => x.s >= 0.5).sort((a, b) => b.s - a.s);
    if (!s.length) return null;
    const top = s.filter(x => x.s >= s[0].s - 0.001);
    return top.length === 1 ? { obra: top[0].o } : { candidatas: top.slice(0, 6).map(x => ({ obra_id: x.o.id, nombre: x.o.nombre })) };
  };
  const r = elegir(c.obras);
  if (r) return r;
  const { data } = await sb.from('obras').select('id, nombre, cliente, direccion, direccion_completa, status, avance_global, fecha_fin_plan, coordinador_id, quotation_id, quotation_ids, sistemas, project_id').in('status', ACTIVAS);
  return elegir(data || []) || { error: `No encontré una obra activa que se llame como "${t}".` };
}

async function resolverPersona(sb: any, c: Coord, texto: any): Promise<{ emp?: any; candidatas?: any[]; error?: string }> {
  const t = String(texto || '').trim();
  if (!t) return { error: '¿Quién?' };
  const { data: al } = await sb.from('reporte_diario_personas').select('employee_id, alias');
  const alias = new Map((al || []).map((a: any) => [a.employee_id, a.alias || '']));
  const { data: todos } = await sb.from('employees').select('id, nombre, area, puesto').eq('activo', true);
  const lista = (todos || []).map((e: any) => ({ e, s: Math.max(puntuar(t, e.nombre), puntuar(t, String(alias.get(e.id) || ''))) + (c.equipo.some(x => x.id === e.id) ? 0.01 : 0) }))
    .filter((x: any) => x.s >= 0.5).sort((a: any, b: any) => b.s - a.s);
  if (!lista.length) return { error: `No encontré a nadie activo que se llame "${t}".` };
  const top = lista.filter((x: any) => x.s >= lista[0].s - 0.001);
  if (top.length > 1) return { candidatas: top.slice(0, 6).map((x: any) => ({ id: x.e.id, nombre: x.e.nombre, area: x.e.area })) };
  return { emp: top[0].e };
}

// ── Panorama: lo que el coordinador tiene que traer en la cabeza ────────────

export async function panorama(sb: any, c: Coord, soloObra?: string) {
  const hoy = hoyCDMX();
  const obras = soloObra ? c.obras.filter(o => o.id === soloObra) : c.obras;
  if (!obras.length) return { obras: [], nota: 'No tienes obras activas a tu cargo ni con tu equipo planeado.' };
  const ids = obras.map(o => o.id);
  const lun = semanaDe('esta'), lunProx = sumar(lun, 7);
  const [{ data: acts }, { data: reps }, { data: planes }, { data: props }] = await Promise.all([
    sb.from('obra_actividades').select('id, obra_id, descripcion, sistema, fecha_fin_plan, instalador_id, status, porcentaje').in('obra_id', ids).neq('status', 'completada').limit(5000),
    sb.from('obra_reportes').select('obra_id, fecha, instalador_id, ai_resumen, ai_bloqueos, ai_faltantes').in('obra_id', ids).gte('fecha', sumar(hoy, -10)).order('fecha', { ascending: false }),
    sb.from('weekly_plans').select('id, week_start').in('week_start', [lun, lunProx]),
    sb.from('reporte_propuestas').select('obra_id').eq('supervisor_id', c.empId).eq('estado', 'propuesta').gte('fecha', sumar(hoy, -7)),
  ]);
  const planId = new Map((planes || []).map((p: any) => [p.week_start, p.id]));
  const { data: wpa } = (planes || []).length
    ? await sb.from('weekly_plan_assignments').select('plan_id, employee_id, obra_id, day_of_week').in('plan_id', (planes || []).map((p: any) => p.id))
    : { data: [] };
  const qids = [...new Set(obras.flatMap(o => [o.quotation_id, ...(o.quotation_ids || [])]).filter(Boolean))];
  const { data: ocs } = qids.length
    ? await sb.from('purchase_orders').select('folio, po_number, status, quotation_id, supplier:suppliers(name)').in('quotation_id', qids).in('status', ['aprobada', 'pedida', 'parcial']).neq('tipo', 'servicio')
    : { data: [] };
  const nombres = new Map<string, string>();
  const { data: emps } = await sb.from('employees').select('id, nombre').eq('activo', true);
  for (const e of emps || []) nombres.set(e.id, primerNombre(e.nombre));
  const { data: al } = await sb.from('reporte_diario_personas').select('employee_id, alias');
  for (const a of al || []) if (a.alias) nombres.set(a.employee_id, a.alias);

  const salida = obras.map(o => {
    const a = (acts || []).filter((x: any) => x.obra_id === o.id);
    const vencidas = a.filter((x: any) => x.fecha_fin_plan && x.fecha_fin_plan < hoy);
    const semana = a.filter((x: any) => x.fecha_fin_plan && x.fecha_fin_plan >= hoy && x.fecha_fin_plan <= sumar(hoy, 7));
    const r = (reps || []).filter((x: any) => x.obra_id === o.id);
    const gente = (wk: string) => [...new Set((wpa || []).filter((w: any) => w.obra_id === o.id && w.plan_id === planId.get(wk)).map((w: any) => nombres.get(w.employee_id) || '¿?'))];
    const misQ = new Set([o.quotation_id, ...(o.quotation_ids || [])].filter(Boolean));
    const o_ocs = (ocs || []).filter((x: any) => misQ.has(x.quotation_id));
    return {
      obra_id: o.id, obra: o.nombre, estado: o.status, avance: o.avance_global ?? 0, entrega_plan: o.fecha_fin_plan,
      actividades: { abiertas: a.length, vencidas: vencidas.length, vencen_7_dias: semana.length, sin_fecha: a.filter((x: any) => !x.fecha_fin_plan).length, bloqueadas: a.filter((x: any) => x.status === 'bloqueada').length },
      vencidas_mas_viejas: vencidas.sort((x: any, y: any) => String(x.fecha_fin_plan).localeCompare(String(y.fecha_fin_plan))).slice(0, 3).map((x: any) => `${x.descripcion} (${fechaCorta(x.fecha_fin_plan)}${x.instalador_id ? ', ' + (nombres.get(x.instalador_id) || '') : ''})`),
      ultimo_reporte: r[0] ? { fecha: r[0].fecha, de: nombres.get(r[0].instalador_id) || null, resumen: r[0].ai_resumen } : null,
      bloqueos_recientes: [...new Set(r.flatMap((x: any) => x.ai_bloqueos || []))].slice(0, 4),
      faltantes_recientes: [...new Set(r.flatMap((x: any) => x.ai_faltantes || []))].slice(0, 4),
      gente_esta_semana: gente(lun), gente_proxima_semana: gente(lunProx),
      compras_por_llegar: o_ocs.slice(0, 4).map((x: any) => `${x.folio || x.po_number} ${x.supplier?.name || ''} (${x.status})`),
      actividades_por_aprobar: (props || []).filter((x: any) => x.obra_id === o.id).length,
    };
  });
  const planeados = new Set((wpa || []).filter((w: any) => w.plan_id === planId.get(lun)).map((w: any) => w.employee_id));
  const sinPlan = c.equipo.filter(e => !planeados.has(e.id) && e.id !== c.empId).map(e => nombres.get(e.id) || primerNombre(e.nombre));
  return {
    hoy, semana_que_empieza: lun,
    obras: salida.sort((a, b) => b.actividades.vencidas - a.actividades.vencidas || b.actividades.vencen_7_dias - a.actividades.vencen_7_dias),
    equipo_sin_planeacion_esta_semana: sinPlan,
    nota: 'Las vencidas grandes (cientos) suelen ser fechas que nadie actualizó, no trabajo atrasado de verdad: pregunta antes de alarmar.',
  };
}

// ── Definiciones ────────────────────────────────────────────────────────────

const obraProp = { type: 'string', description: 'Nombre (o parte) de la obra, o su id.' };

export const DEF_COORD: ToolDefinition[] = [
  {
    name: 'panorama_obras',
    description: 'Cómo va cada obra del coordinador: actividades abiertas/vencidas/por vencer, último reporte, bloqueos y faltantes recientes, gente planeada esta semana y la próxima, compras por llegar y actividades por aprobar. Úsala antes de opinar sobre avance o de planear.',
    input_schema: { type: 'object', properties: { obra: obraProp } },
  },
  {
    name: 'pendientes_obra',
    description: 'Lista actividades abiertas de UNA obra (con su id para poder actualizarlas). filtro: vencidas | semana (vencen en 7 días) | sin_fecha | bloqueadas | todas.',
    input_schema: { type: 'object', properties: { obra: obraProp, filtro: { type: 'string', enum: ['vencidas', 'semana', 'sin_fecha', 'bloqueadas', 'todas'] }, sistema: { type: 'string' }, buscar: { type: 'string', description: 'Texto dentro de la descripción.' }, limite: { type: 'integer' } }, required: ['obra'] },
  },
  {
    name: 'actualizar_actividad',
    description: 'Cambia estado, avance o fecha de UNA actividad de obra (por su id), y le agrega una nota. NO cambia al responsable: eso se hace en el ERP (Obra → Actividades).',
    input_schema: { type: 'object', properties: { id: { type: 'string' }, estado: { type: 'string', enum: ['pendiente', 'en_progreso', 'bloqueada', 'completada'] }, porcentaje: { type: 'integer' }, fecha_inicio: { type: 'string', description: 'AAAA-MM-DD' }, fecha: { type: 'string', description: 'Fecha compromiso AAAA-MM-DD.' }, nota: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'crear_actividades',
    description: 'Da de alta actividades en una obra (lo que falta hacer), con sistema, fecha compromiso y, si se sabe, quién la hace. Con más de 5 pide confirmar=true después de enseñar la lista.',
    input_schema: { type: 'object', properties: { obra: obraProp, actividades: { type: 'array', items: { type: 'object', properties: { descripcion: { type: 'string' }, sistema: { type: 'string', enum: SISTEMAS }, area: { type: 'string', description: 'Área de la casa/edificio (recámara, rack, lobby…).' }, fecha: { type: 'string', description: 'AAAA-MM-DD' }, responsable: { type: 'string', description: 'Nombre del instalador.' } }, required: ['descripcion'] } }, confirmar: { type: 'boolean' } }, required: ['obra', 'actividades'] },
  },
  {
    name: 'ver_planeacion',
    description: 'La planeación de la cuadrilla por persona y día (lunes a sábado) de esta semana o la próxima, y quién de su equipo no tiene nada asignado. En domingo, "esta" es la que empieza mañana.',
    input_schema: { type: 'object', properties: { semana: { type: 'string', description: '"esta", "proxima" o una fecha AAAA-MM-DD.' } } },
  },
  {
    name: 'planear',
    description: 'Asigna gente a obras por día (lo mismo que la Planeación semanal del ERP). Esto es lo que ve cada instalador y a quién le pido reporte a las 6 pm. SIN confirmar=true sólo devuelve la vista previa: enséñala y espera el sí.',
    input_schema: { type: 'object', properties: { semana: { type: 'string' }, asignaciones: { type: 'array', items: { type: 'object', properties: { persona: { type: 'string' }, obra: { type: 'string' }, dias: { type: 'array', items: { type: 'string', enum: DIAS }, description: 'lun..sab. Omitir = lunes a viernes.' }, tarea: { type: 'string', description: 'Qué va a hacer.' } }, required: ['persona', 'obra'] } }, confirmar: { type: 'boolean' } }, required: ['asignaciones'] },
  },
  {
    name: 'quitar_planeacion',
    description: 'Quita a una persona de una obra (o de todo) en un día. SIN confirmar=true sólo enseña qué se quitaría.',
    input_schema: { type: 'object', properties: { persona: { type: 'string' }, fecha: { type: 'string', description: 'AAAA-MM-DD' }, obra: { type: 'string', description: 'Omitir = todo lo de ese día.' }, confirmar: { type: 'boolean' } }, required: ['persona', 'fecha'] },
  },
  {
    name: 'recordatorio',
    description: 'Recordatorios para el coordinador: crear ("acuérdame el martes a las 9 de…"), listar los que vienen o cancelar uno. Se le manda por WhatsApp a esa hora.',
    input_schema: { type: 'object', properties: { accion: { type: 'string', enum: ['crear', 'listar', 'cancelar'] }, cuando: { type: 'string', description: 'Fecha y hora local CDMX, AAAA-MM-DDTHH:MM. Si sólo dicen el día, 08:00.' }, texto: { type: 'string' }, obra: obraProp, id: { type: 'string' } }, required: ['accion'] },
  },
  {
    name: 'pedir_a',
    description: 'Le pide algo a Elias (un pago, una autorización) o a Logística/Gabriel (comprar, recoger, entregar material). Queda como pendiente en el ERP de esa persona y le llega por WhatsApp. SIN confirmar=true sólo enseña cómo saldría: enséñalo y espera el sí.',
    input_schema: { type: 'object', properties: { destino: { type: 'string', enum: ['elias', 'logistica'] }, tipo: { type: 'string', enum: ['pago', 'compra', 'recoger', 'entregar', 'otro'] }, obra: obraProp, detalle: { type: 'string', description: 'Qué se necesita, de quién, cuánto, dónde.' }, monto: { type: 'number' }, moneda: { type: 'string', enum: ['MXN', 'USD'] }, fecha_limite: { type: 'string', description: 'AAAA-MM-DD' }, urgente: { type: 'boolean' }, confirmar: { type: 'boolean' } }, required: ['destino', 'detalle'] },
  },
  {
    name: 'reporte_oficial',
    description: 'Genera el PDF de un reporte oficial de obra dirigido al residente, al segurista o al cliente (hechos, lo que se solicita y fotos de los reportes recientes de esa obra) y se lo manda AL COORDINADOR para que él lo reenvíe. No se manda a nadie más. Redacta hechos y solicitudes en tono profesional, concreto y sin culpar.',
    input_schema: { type: 'object', properties: { obra: obraProp, para: { type: 'string', enum: ['residente', 'segurista', 'cliente', 'otro'] }, dirigido_a: { type: 'string', description: 'Nombre y cargo, si se sabe.' }, asunto: { type: 'string' }, hechos: { type: 'array', items: { type: 'string' } }, solicitudes: { type: 'array', items: { type: 'string' } }, fotos_de_los_ultimos_dias: { type: 'integer', description: 'Por omisión 2. 0 = sin fotos.' }, max_fotos: { type: 'integer', description: 'Por omisión 6.' } }, required: ['obra', 'para', 'asunto', 'hechos'] },
  },
  {
    name: 'propuestas_pendientes',
    description: 'Las actividades que detecté en los reportes del equipo y que el coordinador no ha decidido si se suben (numeradas, como se las mandé a las 9 pm).',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'decidir_propuestas',
    description: 'Sube a su obra (con fecha compromiso, asignadas a quien las reportó) o descarta actividades detectadas, por número. "todas para el viernes" = todos los números con esa fecha.',
    input_schema: { type: 'object', properties: { decisiones: { type: 'array', items: { type: 'object', properties: { numeros: { type: 'array', items: { type: 'integer' } }, accion: { type: 'string', enum: ['subir', 'descartar'] }, fecha: { type: 'string', description: 'AAAA-MM-DD, obligatoria para subir.' } }, required: ['numeros', 'accion'] } } }, required: ['decisiones'] },
  },
];

export const NOMBRES_COORD = new Set(DEF_COORD.map(d => d.name));

// ── Ejecución ───────────────────────────────────────────────────────────────

function empIdDe(ctx: ToolExecutionContext): string | null {
  return ctx.contact.employee_id || ctx.sesion?.quien?.employee_id || null;
}

export async function ejecutarCoord(nombre: string, input: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const sb = ctx.supabase;
  const empId = empIdDe(ctx);
  if (!empId) return mal('Este número no está ligado a un empleado: no sé de qué obras eres coordinador.');
  const c = await contextoCoord(sb, empId);
  const hoy = hoyCDMX();
  try {
    switch (nombre) {
      case 'panorama_obras': {
        let soloObra: string | undefined;
        if (input?.obra) { const r = await resolverObra(sb, c, input.obra); if (r.error) return mal(r.error); if (r.candidatas) return ok({ necesita_elegir: true, candidatas: r.candidatas }); soloObra = r.obra.id; if (!c.obras.some(o => o.id === soloObra)) c.obras.push(r.obra); }
        return ok(await panorama(sb, c, soloObra));
      }

      case 'pendientes_obra': {
        const r = await resolverObra(sb, c, input?.obra);
        if (r.error) return mal(r.error); if (r.candidatas) return ok({ necesita_elegir: true, candidatas: r.candidatas });
        let q = sb.from('obra_actividades').select('id, descripcion, sistema, area, fase, status, porcentaje, fecha_inicio, fecha_fin_plan, instalador_id, notas').eq('obra_id', r.obra.id).neq('status', 'completada');
        const f = input?.filtro || 'vencidas';
        if (f === 'vencidas') q = q.lt('fecha_fin_plan', hoy);
        if (f === 'semana') q = q.gte('fecha_fin_plan', hoy).lte('fecha_fin_plan', sumar(hoy, 7));
        if (f === 'sin_fecha') q = q.is('fecha_fin_plan', null);
        if (f === 'bloqueadas') q = q.eq('status', 'bloqueada');
        if (input?.sistema) q = q.ilike('sistema', String(input.sistema));
        if (input?.buscar) q = q.ilike('descripcion', `%${String(input.buscar).replace(/[%,()]/g, ' ')}%`);
        const lim = Math.min(Math.max(Number(input?.limite) || 25, 1), 80);
        const { data, error, count } = await q.order('fecha_fin_plan', { ascending: true, nullsFirst: false }).limit(lim);
        if (error) return mal(error.message);
        const { data: emps } = await sb.from('employees').select('id, nombre');
        const nom = new Map((emps || []).map((e: any) => [e.id, primerNombre(e.nombre)]));
        return ok({ obra: r.obra.nombre, filtro: f, mostradas: data?.length || 0, actividades: (data || []).map((a: any) => ({ id: a.id, descripcion: a.descripcion, sistema: a.sistema, area: a.area, estado: a.status, avance: a.porcentaje, fecha: a.fecha_fin_plan, responsable: a.instalador_id ? nom.get(a.instalador_id) : null })), total_aprox: count ?? undefined });
      }

      case 'actualizar_actividad': {
        const id = String(input?.id || '');
        const { data: a } = await sb.from('obra_actividades').select('id, obra_id, descripcion, notas, status, fecha_fin_plan').eq('id', id).maybeSingle();
        if (!a) return mal('No encontré esa actividad (usa pendientes_obra para ver los ids).');
        const cambios: Record<string, unknown> = {};
        if (input?.estado) { cambios.status = input.estado; if (input.estado === 'completada') { cambios.porcentaje = 100; cambios.fecha_fin_real = hoy; } }
        if (input?.porcentaje != null) cambios.porcentaje = Math.max(0, Math.min(100, Number(input.porcentaje) || 0));
        if (input?.fecha) { if (!esFecha(input.fecha)) return mal('fecha va como AAAA-MM-DD'); cambios.fecha_fin_plan = input.fecha; }
        if (input?.fecha_inicio) { if (!esFecha(input.fecha_inicio)) return mal('fecha_inicio va como AAAA-MM-DD'); cambios.fecha_inicio = input.fecha_inicio; }
        if (input?.nota) cambios.notas = [a.notas, `${hoy} ${primerNombre(c.nombre)}: ${String(input.nota).slice(0, 500)}`].filter(Boolean).join('\n');
        if (!Object.keys(cambios).length) return mal('No me dijiste qué cambiar.');
        const { error } = await sb.from('obra_actividades').update(cambios).eq('id', id);
        if (error) return mal(error.message);
        return ok({ actualizada: a.descripcion, cambios }, { affected_entity_type: 'obra_actividad', affected_entity_id: id });
      }

      case 'crear_actividades': {
        const r = await resolverObra(sb, c, input?.obra);
        if (r.error) return mal(r.error); if (r.candidatas) return ok({ necesita_elegir: true, candidatas: r.candidatas });
        const lista = (Array.isArray(input?.actividades) ? input.actividades : []).filter((x: any) => String(x?.descripcion || '').trim());
        if (!lista.length) return mal('No hay actividades que dar de alta.');
        const filas: any[] = [];
        const dudas: any[] = [];
        for (const x of lista) {
          let instalador: string | null = null;
          if (x.responsable) {
            const p = await resolverPersona(sb, c, x.responsable);
            if (p.emp) instalador = p.emp.id; else dudas.push({ actividad: x.descripcion, responsable: x.responsable, ...(p.candidatas ? { candidatas: p.candidatas } : { error: p.error }) });
          }
          if (x.fecha && !esFecha(x.fecha)) return mal(`La fecha de "${x.descripcion}" va como AAAA-MM-DD.`);
          const sistema = SISTEMAS.find(s => s.toLowerCase() === String(x.sistema || '').toLowerCase()) || (r.obra.sistemas?.length === 1 ? r.obra.sistemas[0] : 'Redes');
          filas.push({ obra_id: r.obra.id, descripcion: String(x.descripcion).trim().slice(0, 400), sistema, area: x.area || null, fecha_fin_plan: x.fecha || null, instalador_id: instalador, status: 'pendiente', porcentaje: 0, origen: 'manual', order_index: 950, notas: `Alta por WhatsApp (${primerNombre(c.nombre)}, ${hoy}).` });
        }
        if (dudas.length) return ok({ creadas: 0, motivo: 'Hay responsables que no pude identificar. Pregunta y vuelve a llamar.', dudas });
        if (filas.length > 5 && !input?.confirmar) return ok({ creadas: 0, requiere_confirmacion: true, obra: r.obra.nombre, se_darian_de_alta: filas.map(f => `${f.descripcion} · ${f.sistema}${f.fecha_fin_plan ? ' · ' + fechaCorta(f.fecha_fin_plan) : ''}`), instruccion: 'Enséñalas y pregunta. Con el sí, repite con confirmar=true.' });
        const { data, error } = await sb.from('obra_actividades').insert(filas).select('id, descripcion, fecha_fin_plan');
        if (error) return mal(error.message);
        return ok({ obra: r.obra.nombre, creadas: data?.length || 0, actividades: data }, { affected_entity_type: 'obra', affected_entity_id: r.obra.id });
      }

      case 'ver_planeacion': {
        const lun = semanaDe(input?.semana);
        const { data: plan } = await sb.from('weekly_plans').select('id').eq('week_start', lun).limit(1).maybeSingle();
        const { data: wpa } = plan ? await sb.from('weekly_plan_assignments').select('employee_id, obra_id, day_of_week, tareas, obras(nombre)').eq('plan_id', plan.id) : { data: [] };
        const { data: emps } = await sb.from('employees').select('id, nombre').eq('activo', true);
        const nom = new Map((emps || []).map((e: any) => [e.id, e.nombre]));
        const porPersona: Record<string, any> = {};
        for (const w of wpa || []) {
          const k = nom.get(w.employee_id) || w.employee_id;
          const p = porPersona[k] || (porPersona[k] = {});
          const d = NOMBRE_DIA[(w.day_of_week || 1) - 1] || '?';
          (p[d] = p[d] || []).push(`${w.obras?.nombre || 'sin obra'}${w.tareas ? ' — ' + w.tareas : ''}`);
        }
        const planeados = new Set((wpa || []).map((w: any) => w.employee_id));
        return ok({ semana_del: lun, al: sumar(lun, 5), por_persona: porPersona, de_tu_equipo_sin_nada: c.equipo.filter(e => !planeados.has(e.id)).map(e => e.nombre) });
      }

      case 'planear': {
        const lun = semanaDe(input?.semana);
        const asig = Array.isArray(input?.asignaciones) ? input.asignaciones : [];
        if (!asig.length) return mal('No hay asignaciones.');
        const filas: any[] = [];
        const dudas: any[] = [];
        for (const a of asig) {
          const p = await resolverPersona(sb, c, a.persona);
          const o = await resolverObra(sb, c, a.obra);
          if (!p.emp || !o.obra) { dudas.push({ persona: a.persona, obra: a.obra, persona_opciones: p.candidatas, obra_opciones: o.candidatas, error: p.error || o.error }); continue; }
          const dias = (Array.isArray(a.dias) && a.dias.length ? a.dias : DIAS.slice(0, 5)).map((d: string) => DIAS.indexOf(String(d).slice(0, 3).toLowerCase().replace('mié', 'mie').replace('sáb', 'sab'))).filter((i: number) => i >= 0);
          for (const i of dias) filas.push({ emp: p.emp, obra: o.obra, i, fecha: sumar(lun, i), tarea: String(a.tarea || '').trim() });
        }
        if (dudas.length) return ok({ guardado: false, motivo: 'No identifiqué a alguien o alguna obra. Pregunta y vuelve a llamar.', dudas });
        const vista = filas.map(f => `${primerNombre(f.emp.nombre)} · ${NOMBRE_DIA[f.i]} ${fechaCorta(f.fecha)} · ${f.obra.nombre}${f.tarea ? ' — ' + f.tarea : ''}`);
        if (!input?.confirmar) return ok({ guardado: false, requiere_confirmacion: true, semana_del: lun, quedaria: vista, instruccion: 'Enséñalo (agrupado por persona) y pregunta. Con el sí, repite con confirmar=true.' });
        let { data: plan } = await sb.from('weekly_plans').select('id').eq('week_start', lun).limit(1).maybeSingle();
        if (!plan) {
          const r = await sb.from('weekly_plans').upsert({ week_start: lun }, { onConflict: 'week_start' }).select('id').limit(1);
          plan = r.data?.[0] || (await sb.from('weekly_plans').select('id').eq('week_start', lun).limit(1).maybeSingle()).data;
        }
        if (!plan) return mal('No pude crear el plan de esa semana.');
        const { data: ya } = await sb.from('weekly_plan_assignments').select('employee_id, obra_id, day_of_week').eq('plan_id', plan.id);
        const existe = new Set((ya || []).map((w: any) => `${w.employee_id}|${w.obra_id}|${w.day_of_week}`));
        const nuevas = filas.filter(f => !existe.has(`${f.emp.id}|${f.obra.id}|${f.i + 1}`));
        if (nuevas.length) {
          const { error } = await sb.from('weekly_plan_assignments').insert(nuevas.map(f => ({ plan_id: plan.id, employee_id: f.emp.id, obra_id: f.obra.id, project_id: f.obra.project_id || null, day_of_week: f.i + 1, tareas: f.tarea || null, urgencia: 'normal' })));
          if (error) return mal('No se guardó la planeación: ' + error.message);
          // Espejo diario (una fila por persona y día), igual que la pantalla de Planeación.
          for (const f of nuevas) {
            await sb.from('installer_daily_assignment').delete().eq('employee_id', f.emp.id).eq('fecha', f.fecha);
            await sb.from('installer_daily_assignment').insert({ employee_id: f.emp.id, fecha: f.fecha, obra_id: f.obra.id, project_id: f.obra.project_id || null, tareas: f.tarea || null, urgencia: 'normal' });
          }
        }
        return ok({ guardado: true, semana_del: lun, nuevas: nuevas.length, ya_estaban: filas.length - nuevas.length, detalle: vista });
      }

      case 'quitar_planeacion': {
        const p = await resolverPersona(sb, c, input?.persona);
        if (!p.emp) return p.candidatas ? ok({ necesita_elegir: true, candidatas: p.candidatas }) : mal(p.error || '¿Quién?');
        if (!esFecha(input?.fecha)) return mal('fecha va como AAAA-MM-DD');
        const lun = lunesDe(input.fecha);
        const d = (dow(input.fecha) + 6) % 7 + 1;
        const { data: plan } = await sb.from('weekly_plans').select('id').eq('week_start', lun).limit(1).maybeSingle();
        if (!plan) return ok({ quitado: 0, nota: 'Esa semana no tiene planeación.' });
        let obraId: string | null = null;
        if (input?.obra) { const o = await resolverObra(sb, c, input.obra); if (!o.obra) return o.candidatas ? ok({ necesita_elegir: true, candidatas: o.candidatas }) : mal(o.error!); obraId = o.obra.id; }
        let q = sb.from('weekly_plan_assignments').select('id, obra_id, obras(nombre)').eq('plan_id', plan.id).eq('employee_id', p.emp.id).eq('day_of_week', d);
        if (obraId) q = q.eq('obra_id', obraId);
        const { data: filas } = await q;
        if (!filas?.length) return ok({ quitado: 0, nota: 'No tenía nada asignado ese día.' });
        if (!input?.confirmar) return ok({ requiere_confirmacion: true, se_quitaria: filas.map((f: any) => `${primerNombre(p.emp.nombre)} · ${fechaCorta(input.fecha)} · ${f.obras?.nombre}`) });
        await sb.from('weekly_plan_assignments').delete().in('id', filas.map((f: any) => f.id));
        let qd = sb.from('installer_daily_assignment').delete().eq('employee_id', p.emp.id).eq('fecha', input.fecha);
        if (obraId) qd = qd.eq('obra_id', obraId);
        await qd;
        return ok({ quitado: filas.length });
      }

      case 'recordatorio': {
        const accion = input?.accion;
        if (accion === 'listar') {
          const { data } = await sb.from('coordinador_recordatorios').select('id, cuando, texto, obras(nombre)').eq('employee_id', empId).is('enviado_at', null).eq('cancelado', false).order('cuando').limit(30);
          return ok({ recordatorios: (data || []).map((r: any) => ({ id: r.id, cuando: new Date(r.cuando).toLocaleString('es-MX', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), texto: r.texto, obra: r.obras?.nombre })) });
        }
        if (accion === 'cancelar') {
          const { data, error } = await sb.from('coordinador_recordatorios').update({ cancelado: true }).eq('id', String(input?.id || '')).eq('employee_id', empId).select('texto');
          if (error) return mal(error.message);
          return data?.length ? ok({ cancelado: data[0].texto }) : mal('No encontré ese recordatorio.');
        }
        const texto = String(input?.texto || '').trim();
        if (!texto) return mal('¿Qué te recuerdo?');
        const m = String(input?.cuando || '').match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
        if (!m) return mal('cuando va como AAAA-MM-DDTHH:MM (hora de CDMX).');
        // CDMX es UTC-6 todo el año (sin horario de verano desde 2022).
        const cuando = new Date(`${m[1]}T${(m[2] || '08').padStart(2, '0')}:${m[3] || '00'}:00-06:00`);
        if (cuando.getTime() < Date.now() - 60e3) return mal('Esa hora ya pasó.');
        let obraId: string | null = null;
        if (input?.obra) { const o = await resolverObra(sb, c, input.obra); obraId = o.obra?.id || null; }
        const { data, error } = await sb.from('coordinador_recordatorios').insert({ employee_id: empId, cuando: cuando.toISOString(), texto: texto.slice(0, 800), obra_id: obraId }).select('id').single();
        if (error) return mal(error.message);
        return ok({ creado: true, id: data.id, te_aviso: cuando.toLocaleString('es-MX', { timeZone: ZONA, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) });
      }

      case 'pedir_a':
        return await pedirA(sb, c, input, ctx);

      case 'reporte_oficial':
        return await reporteOficial(sb, c, input, ctx);

      case 'propuestas_pendientes': {
        const ps = await abiertasDe(sb, empId);
        return ok({ por_decidir: ps.map(p => ({ numero: p.numero, obra: p.obra, actividad: p.descripcion, reporto: p.quien, del: p.fecha })) });
      }

      case 'decidir_propuestas': {
        const ps = await abiertasDe(sb, empId);
        if (!ps.length) return ok({ nota: 'No hay actividades pendientes de decidir.' });
        const validos = new Set(ps.map(p => p.numero));
        const decisiones: Decision[] = (Array.isArray(input?.decisiones) ? input.decisiones : []).map((d: any) => ({
          numeros: (d.numeros || []).map(Number).filter((n: number) => validos.has(n)),
          accion: d.accion === 'descartar' ? 'descartar' : 'subir',
          fecha: esFecha(d.fecha) ? d.fecha : null,
        })).filter((d: Decision) => d.numeros.length);
        if (!decisiones.length) return mal('Ningún número corresponde a las pendientes.', { pendientes: ps.map(p => p.numero) });
        const { data: e } = await sb.from('employees').select('id, nombre').eq('id', empId).maybeSingle();
        const r = await aplicar(sb, e, ps, decisiones);
        return ok({
          subidas: r.subidas.map(s => ({ numero: s.p.numero, obra: s.p.obra, actividad: s.p.descripcion, asignada_a: s.p.quien, fecha: s.fecha })),
          descartadas: r.descartadas.map(p => p.numero), sin_fecha_falta_preguntar: r.sinFecha, fecha_ya_paso: r.pasadas,
          siguen_pendientes: (await abiertasDe(sb, empId)).map(p => p.numero),
        });
      }
    }
    return mal(`Herramienta desconocida: ${nombre}`);
  } catch (e) {
    return mal(`Falló ${nombre}: ${(e as Error)?.message || e}`);
  }
}

// ── Pedidos a Elias y a Logística ───────────────────────────────────────────

async function pedirA(sb: any, c: Coord, input: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const destino = input?.destino === 'logistica' ? 'logistica' : input?.destino === 'elias' ? 'elias' : null;
  if (!destino) return mal('destino es elias o logistica.');
  const detalle = String(input?.detalle || '').trim();
  if (!detalle) return mal('¿Qué se necesita?');
  const tipo = ['pago', 'compra', 'recoger', 'entregar', 'otro'].includes(input?.tipo) ? input.tipo : (destino === 'elias' ? 'pago' : 'compra');
  let obra: any = null;
  if (input?.obra) { const r = await resolverObra(sb, c, input.obra); if (r.candidatas) return ok({ necesita_elegir: true, candidatas: r.candidatas }); obra = r.obra || null; }
  if (input?.fecha_limite && !esFecha(input.fecha_limite)) return mal('fecha_limite va como AAAA-MM-DD');

  const persona = destino === 'elias'
    ? (await sb.from('employees').select('id, nombre, telefono_personal, obra_app_phone, phone').eq('puesto', 'DIRECTOR GENERAL').eq('activo', true).limit(1).maybeSingle()).data
    : (await sb.from('employees').select('id, nombre, telefono_personal, obra_app_phone, phone').ilike('puesto', '%LOGIST%').eq('activo', true).limit(1).maybeSingle()).data;
  if (!persona) return mal(`No encontré a ${destino === 'elias' ? 'Elias' : 'Logística'} en el padrón.`);
  const yo = primerNombre(c.nombre);
  const etiqueta: Record<string, string> = { pago: '💳 Pago', compra: '🛒 Compra', recoger: '📦 Recoger', entregar: '🚚 Entregar', otro: '📌 Pendiente' };
  const monto = input?.monto ? ` · $${Number(input.monto).toLocaleString('es-MX', { minimumFractionDigits: 2 })} ${input.moneda || 'MXN'}` : '';
  const titulo = `${etiqueta[tipo].replace(/^\S+ /, '')}${obra ? ' · ' + obra.nombre : ''}: ${detalle}`.slice(0, 180);
  const texto = [
    `${etiqueta[tipo]} — te lo pide ${yo}${input?.urgente ? ' ⚠️ URGENTE' : ''}`,
    obra ? `Obra: *${obra.nombre}*` : null,
    detalle + monto,
    input?.fecha_limite ? `Para: ${fechaCorta(input.fecha_limite)}` : null,
    destino === 'elias' ? 'Quedó en tus pendientes del ERP.' : 'Quedó en tu Mi trabajo del ERP.',
  ].filter(Boolean).join('\n');

  if (!input?.confirmar) return ok({ requiere_confirmacion: true, para: persona.nombre, como_sale: texto, queda_en: destino === 'elias' ? 'pendientes del tablero de Elias' : 'Mi trabajo de ' + primerNombre(persona.nombre), instruccion: 'Enséñalo y pregunta "¿Lo mando?". Con el sí, repite con confirmar=true.' });

  let actionItemId: string | null = null, taskId: string | null = null;
  if (destino === 'elias') {
    const { data: au } = await sb.from('app_users').select('id').eq('employee_id', persona.id).limit(1).maybeSingle();
    const { data, error } = await sb.from('action_items').insert({
      title: titulo, description: texto, area: 'DG', source_type: 'dashboard', status: 'pendiente',
      priority: input?.urgente ? 3 : 2, due_date: input?.fecha_limite || null, owner_user_id: au?.id || null,
      tags: ['whatsapp', 'coordinador', tipo], source_meta: { de: c.nombre, obra: obra?.nombre || null, monto: input?.monto || null, moneda: input?.moneda || null },
    }).select('id').single();
    if (error) return mal('No se pudo crear el pendiente: ' + error.message);
    actionItemId = data.id;
  } else {
    const { data, error } = await sb.from('project_tasks').insert({
      name: titulo, description: texto, tipo: 'interna', specialty: 'admin', urgencia: input?.urgente ? 'urgente' : 'alta',
      priority: input?.urgente ? 3 : 2, due_date: input?.fecha_limite || null, assignee_id: persona.id,
      solicitada_por: `${c.nombre} (WhatsApp)`, solicitada_por_id: c.empId, status: 'pendiente', progress: 0, order_index: 0,
      asignada_at: new Date().toISOString(),
    }).select('id').single();
    if (error) return mal('No se pudo crear la tarea: ' + error.message);
    taskId = data.id;
  }
  const tel = await telefonoDeEmpleado(sb, persona);
  const r = tel ? await avisar(sb, tel, primerNombre(persona.nombre), texto, `${yo} te pide: ${titulo}${input?.fecha_limite ? ' para ' + fechaCorta(input.fecha_limite) : ''}`, 'pedido') : { ok: false, error: 'sin teléfono' };
  await alHistorial(sb, persona.id, texto);
  await sb.from('coordinador_pedidos').insert({ de_employee_id: c.empId, destino, tipo, obra_id: obra?.id || null, detalle, monto: input?.monto || null, moneda: input?.moneda || null, fecha_limite: input?.fecha_limite || null, action_item_id: actionItemId, project_task_id: taskId, aviso_ok: r.ok, aviso_error: r.error || null });
  return ok({ enviado: r.ok, a: persona.nombre, queda_en_erp: true, aviso_whatsapp: r.ok ? (('diferido' in r && r.diferido) ? 'le llegó el aviso; el detalle se le entrega cuando conteste' : 'enviado') : `no salió (${r.error}); pero el pendiente sí quedó en el ERP` });
}

// ── Reporte oficial ─────────────────────────────────────────────────────────

async function reporteOficial(sb: any, c: Coord, input: any, ctx: ToolExecutionContext): Promise<ToolResult> {
  const r = await resolverObra(sb, c, input?.obra);
  if (r.error) return mal(r.error); if (r.candidatas) return ok({ necesita_elegir: true, candidatas: r.candidatas });
  const obra = r.obra;
  const hechos = (Array.isArray(input?.hechos) ? input.hechos : []).map(String).filter(Boolean);
  if (!hechos.length) return mal('Faltan los hechos del reporte.');
  const hoy = hoyCDMX();
  const dias = input?.fotos_de_los_ultimos_dias == null ? 2 : Math.max(0, Number(input.fotos_de_los_ultimos_dias) || 0);
  const maxF = Math.min(Math.max(Number(input?.max_fotos) || 6, 0), 8);
  const fotos: FotoReporte[] = [];
  if (dias > 0 && maxF > 0) {
    const { data: reps } = await sb.from('obra_reportes').select('fecha, fotos, instalador_id').eq('obra_id', obra.id).gte('fecha', sumar(hoy, -dias)).order('fecha', { ascending: false });
    for (const rep of reps || []) for (const path of rep.fotos || []) {
      if (fotos.length >= maxF) break;
      const ext = String(path).split('.').pop()?.toLowerCase();
      if (!['jpg', 'jpeg', 'png'].includes(ext || '')) continue;
      const { data: blob } = await sb.storage.from('obra-reportes').download(path);
      if (!blob || blob.size > 6_000_000) continue;
      fotos.push({ data: new Uint8Array(await blob.arrayBuffer()), formato: ext === 'png' ? 'PNG' : 'JPEG', pie: `Foto del ${fechaCorta(rep.fecha)}` });
    }
  }
  const { count } = await sb.from('agent_documents').select('id', { count: 'exact', head: true }).eq('kind', 'reporte_oficial');
  const folio = `RO-${hoy.slice(2).replace(/-/g, '')}-${String((count || 0) + 1).padStart(3, '0')}`;
  const { data: yo } = await sb.from('employees').select('nombre, puesto').eq('id', c.empId).maybeSingle();
  const titulo = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (m: string) => m.toUpperCase());
  const doc = generarReporteOficialPdf({
    folio, fecha: hoy, para: input.para, dirigido_a: input.dirigido_a || null,
    obra: { nombre: obra.nombre, direccion: obra.direccion_completa || obra.direccion || null, cliente: obra.cliente || null },
    asunto: String(input.asunto || '').slice(0, 300), hechos, solicitudes: (Array.isArray(input?.solicitudes) ? input.solicitudes : []).map(String).filter(Boolean),
    fotos, elaboro: { nombre: titulo(yo?.nombre || c.nombre), puesto: yo?.puesto ? titulo(yo.puesto) : null },
  });
  const bytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const archivo = `${folio} ${obra.nombre}`.replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_').slice(0, 80) + '.pdf';
  const path = `reportes-oficiales/${obra.id}/${archivo}`;
  await sb.storage.from('agent-documents').upload(path, bytes, { contentType: 'application/pdf', upsert: true });
  await sb.from('agent_documents').insert({ conversation_id: ctx.conversation.id, direction: 'outbound', kind: 'reporte_oficial', storage_path: path, mime_type: 'application/pdf', size_bytes: bytes.length });
  const env = await mandarDocumento(sb, ctx.contact.phone_e164, { bytes, filename: archivo, mime: 'application/pdf', caption: `${folio} · ${obra.nombre} · para ${input.para}. Revísalo y reenvíalo tú.` }, { agent_contact_id: ctx.contact.id });
  if (!env.ok) return mal('El PDF se generó pero WhatsApp no lo aceptó: ' + env.error);
  return ok({ enviado_a_ti: true, folio, paginas: doc.getNumberOfPages(), fotos: fotos.length, guardado_en: path });
}
