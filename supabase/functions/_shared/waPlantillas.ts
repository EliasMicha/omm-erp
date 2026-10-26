// Plantillas de WhatsApp de OMM — una sola lista para whatsapp-send (que las
// manda y las crea desde el ERP) y whatsapp-reportes (que las puede crear con la
// llave del cron). Meta no acepta que el texto empiece o termine con variable.
export const TEMPLATES = [
  {
    name: 'omm_visita_programada',
    text: 'Hola {{1}}, confirmamos tu visita de servicio de OMM Technologies en {{2}} el {{3}} a las {{4}}. Te atenderá {{5}}. Si necesitas cambiar el horario, responde a este mensaje.',
    example: ['Ana', 'Casa Lomas', 'lunes 27 de octubre', '10:00', 'Juan Pérez'],
  },
  {
    name: 'omm_tecnico_en_camino',
    text: 'Hola {{1}}, {{2}} de OMM Technologies va en camino a {{3}} para tu visita de servicio. Si necesitas algo, responde a este mensaje.',
    example: ['Ana', 'Juan Pérez', 'Casa Lomas'],
  },
  {
    name: 'omm_ticket_actualizado',
    text: 'Hola {{1}}, tu reporte #{{2}} con OMM Technologies cambió de estado: {{3}}. Responde a este mensaje si tienes dudas.',
    example: ['Ana', '128', 'resuelto'],
  },
  {
    // Primer mensaje a un cliente que no ha escrito en 24 h (o nunca): Meta sólo
    // deja abrir la conversación con plantilla. {{2}} es quien escribe, {{3}} el mensaje.
    name: 'omm_mensaje_cliente',
    text: 'Hola {{1}}, {{2}} de OMM Technologies te escribe:\n\n{{3}}\n\nPuedes responder a este mensaje para continuar la conversación.',
    example: ['Ana', 'Elias', 'quería confirmar contigo la fecha de instalación'],
  },
  {
    name: 'omm_aviso_equipo',
    text: 'Hola {{1}}, tienes un aviso del ERP de OMM: {{2}}. Responde a este mensaje para atenderlo con el asistente.',
    example: ['Ricardo', 'tienes 3 tareas por vencer hoy'],
  },
];


// Crea en Meta las plantillas que falten (las que ya existen, en cualquier
// estado, se dejan). Recibe graphGet/graphPost para no amarrarse a una copia de
// whatsapp.ts.
export async function crearPlantillasFaltantes(
  graphGet: (p: string) => Promise<any>, graphPost: (p: string, b: unknown) => Promise<any>, wabaId: string,
): Promise<any[]> {
  const existing = await graphGet(`${wabaId}/message_templates?fields=name&limit=200`);
  const have = new Set((existing.data || []).map((x: any) => x.name));
  const results: any[] = [];
  for (const t of TEMPLATES) {
    if (have.has(t.name)) { results.push({ name: t.name, skipped: true }); continue; }
    try {
      const r = await graphPost(`${wabaId}/message_templates`, {
        name: t.name, language: 'es_MX', category: 'UTILITY', allow_category_change: true,
        components: [{ type: 'BODY', text: t.text, example: { body_text: [t.example] } }],
      });
      results.push({ name: t.name, ok: true, status: r.status, category: r.category });
    } catch (e) { results.push({ name: t.name, ok: false, error: String(e) }); }
  }
  return results;
}

export async function estadoPlantillas(graphGet: (p: string) => Promise<any>, wabaId: string) {
  const t = await graphGet(`${wabaId}/message_templates?fields=name,status,language,category,rejected_reason&limit=100`);
  return (t.data || []).filter((x: any) => x.name.startsWith('omm_'));
}
