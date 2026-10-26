// Puente: el bot de WhatsApp usa LAS MISMAS herramientas que el MCP del ERP.
//
// Antes el bot tenía su propio juego (query_obras, query_cobranza…) escrito
// aparte, con otras reglas: la cobranza la buscaba por obra→proyecto→hitos, que
// no es como cobra OMM (va por lead y cotización). Por eso decía "la obra no
// tiene project_id, no puedo jalar la cobranza" de un cliente que sí la tiene.
//
// Ahora importa los módulos de supabase/functions/mcp-erp y los corre con el
// cliente de la PERSONA (sesion.ts), así que RLS manda igual que en pantalla.
// Una sola implementación: lo que se arregle en el MCP se arregla aquí.
import type { ToolDefinition, ToolResult } from './types.ts';
import type { SesionPersona } from './sesion.ts';
import { DEFINICIONES, ejecutar } from '../mcp-erp/tools.ts';
import { DEFINICIONES_LEV, ejecutarLev } from '../mcp-erp/lev.ts';
import { DEFINICIONES_EQ, ejecutarEq } from '../mcp-erp/equipo.ts';
import { DEFINICIONES_NEG, ejecutarNeg } from '../mcp-erp/negocio.ts';
import { DEFINICIONES_COM, ejecutarCom } from '../mcp-erp/compras.ts';
import { DEFINICIONES_COT, ejecutarCot } from '../mcp-erp/cotizar.ts';
import { DEFINICIONES_CONTA, ejecutarConta } from '../mcp-erp/contabilidad.ts';
import { DEFINICIONES_WA, ejecutarWa } from '../mcp-erp/whatsapp.ts';

type Exec = (n: string, a: any, sb: any, q: any) => Promise<any>;
const BLOQUES: Array<[any[], Exec]> = [
  [DEFINICIONES, ejecutar as Exec], [DEFINICIONES_LEV, ejecutarLev as Exec], [DEFINICIONES_EQ, ejecutarEq as Exec],
  [DEFINICIONES_NEG, ejecutarNeg as Exec], [DEFINICIONES_COM, ejecutarCom as Exec], [DEFINICIONES_COT, ejecutarCot as Exec],
  [DEFINICIONES_CONTA, ejecutarConta as Exec], [DEFINICIONES_WA, ejecutarWa as Exec],
];

// Lo que en WhatsApp tiene una versión mejor del bot (manda el archivo en el
// chat en vez de una liga que caduca).
const FUERA = new Set(['exportar_cotizacion', 'conta_estado_de_cuenta']);

export function definicionesMcp(): ToolDefinition[] {
  const out: ToolDefinition[] = [];
  for (const [defs] of BLOQUES) for (const d of defs) {
    if (FUERA.has(d.name)) continue;
    out.push({ name: d.name, description: d.description, input_schema: d.inputSchema || d.input_schema || { type: 'object', properties: {} } });
  }
  return out;
}

export function esMcp(nombre: string): boolean {
  return !FUERA.has(nombre) && BLOQUES.some(([defs]) => defs.some((d: any) => d.name === nombre));
}

export async function ejecutarMcp(nombre: string, args: any, ses: SesionPersona): Promise<ToolResult> {
  const bloque = BLOQUES.find(([defs]) => defs.some((d: any) => d.name === nombre));
  if (!bloque) return { success: false, error: `Herramienta desconocida: ${nombre}` };
  try {
    const r = await bloque[1](nombre, args || {}, ses.sb, ses.quien);
    const txt = (r?.content || []).map((c: any) => c?.text || '').join('\n');
    let data: any = txt;
    try { data = JSON.parse(txt); } catch { /* texto plano */ }
    const soloError = data && typeof data === 'object' && !Array.isArray(data) && data.error && Object.keys(data).length <= 2;
    if (r?.isError || soloError) return { success: false, error: typeof data === 'object' ? (data.error || txt) : txt, data };
    return { success: true, data };
  } catch (e) {
    return { success: false, error: `Falló ${nombre}: ${(e as Error)?.message || e}` };
  }
}
