// La "lectura" del reporte: lo que el bot entendió, de regreso al instalador para
// que lo confirme (2026-10-29).
//
// Elias: "me gustaría que les mandes a ellos un mensaje de regreso de lo que
// captes, avances, bloqueos y avisos. Para que ellos confirmen que está bien el
// reporte. Si no siento que estamos confundiendo todo."
//
// La usan dos lugares:
//   - whatsapp-reportes (acción 'lecturas', cron cada 2 min): cuando el
//     instalador lleva 3 minutos sin mandar nada, se procesa y se le manda.
//   - reportes.ts: cuando corrige ("no, eso no, fueron 3 cámaras"), se vuelve a
//     procesar con la corrección y se le manda la lectura nueva al momento.
import { avisar, primerNombre } from './reportesComun.ts';

const URL_SB = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

export async function procesarReporte(reporteId: string): Promise<boolean> {
  try {
    const r = await fetch(`${URL_SB}/functions/v1/process-obra-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
      body: JSON.stringify({ reporte_id: reporteId, solo_proponer: true }),
    });
    return r.ok;
  } catch { return false; }
}

const vinetas = (xs: string[] | null | undefined, max = 8) => {
  const l = (xs || []).map(x => String(x || '').trim()).filter(Boolean).slice(0, max);
  return l.length ? l.map(x => `• ${x}`).join('\n') : '• Ninguno';
};

/** Texto de la lectura. Exportado para poderlo revisar impreso en pruebas. */
export function textoLectura(p: { obra: string; avances?: string[] | null; bloqueos?: string[] | null; avisos?: string[] | null; fotos?: number; corregida?: boolean }): string {
  const cab = p.corregida
    ? `Corregido. Así queda tu reporte de *${p.obra}* 👇`
    : `Esto es lo que entendí de tu reporte de *${p.obra}* 👇`;
  return [
    cab,
    `✅ *Avances*\n${vinetas(p.avances)}`,
    `⛔ *Bloqueos*\n${vinetas(p.bloqueos)}`,
    `📣 *Avisos y lo que falta*\n${vinetas(p.avisos)}`,
    p.fotos ? `📷 ${p.fotos} foto${p.fotos === 1 ? '' : 's'}` : null,
    '¿Está bien? Contesta *sí*, o dime qué corregir (puede ser nota de voz).',
  ].filter(Boolean).join('\n\n');
}

/**
 * Procesa el reporte de una solicitud y le manda la lectura al instalador.
 * Deja la solicitud en 'por_confirmar'. Si el procesamiento falla no manda nada
 * (no se le pide confirmar algo que no se leyó) y marca lectura_enviada_at para
 * que el cron no lo reintente en bucle; el reporte sigue entrando al resumen.
 */
export async function enviarLectura(sb: any, solicitudId: string, opts: { corregida?: boolean } = {}): Promise<{ ok: boolean; error?: string }> {
  const { data: s } = await sb.from('reporte_solicitudes')
    .select('id, employee_id, telefono, reporte_id, obra_texto, ultimo_mensaje_at, obras(nombre), employees(nombre)')
    .eq('id', solicitudId).maybeSingle();
  if (!s?.reporte_id || !s.telefono) return { ok: false, error: 'sin reporte o sin teléfono' };
  const marca = new Date().toISOString();
  const ok = await procesarReporte(s.reporte_id);
  const { data: r } = await sb.from('obra_reportes')
    .select('ai_avances, ai_bloqueos, ai_faltantes, fotos, procesado').eq('id', s.reporte_id).maybeSingle();
  if (!ok || !r?.procesado) {
    await sb.from('reporte_solicitudes').update({ lectura_enviada_at: marca }).eq('id', s.id);
    return { ok: false, error: 'no se pudo procesar el reporte' };
  }
  const obra = s.obras?.nombre || String(s.obra_texto || 'tu obra').replace(/^Sin obra:\s*/i, '');
  const texto = textoLectura({ obra, avances: r.ai_avances, bloqueos: r.ai_bloqueos, avisos: r.ai_faltantes, fotos: (r.fotos || []).length, corregida: opts.corregida });
  const { data: p } = await sb.from('reporte_diario_personas').select('alias').eq('employee_id', s.employee_id).maybeSingle();
  const saludo = (p?.alias || '').trim() || primerNombre(s.employees?.nombre);
  const env = await avisar(sb, s.telefono, saludo, texto, `tu reporte de hoy de ${obra} ya está listo para que lo confirmes`, 'lectura');
  await sb.from('reporte_solicitudes').update({
    lectura_enviada_at: marca,
    ...(env.ok ? { estado: 'por_confirmar' } : {}),
  }).eq('id', s.id);
  return env.ok ? { ok: true } : { ok: false, error: env.error };
}
