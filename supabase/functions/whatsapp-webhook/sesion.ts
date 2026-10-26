// El bot actúa COMO la persona que escribe, con sus permisos del ERP (RLS).
//
// Antes el agente consultaba todo con la service_role key: veía y escribía lo
// que fuera, sin importar quién le hablara. Ahora, para usar las herramientas
// del MCP (las mismas que usa Claude con el conector del ERP), se saca un JWT
// de la persona y se arma un cliente con la ANON key + ese token. Lo que la
// persona no puede ver en pantalla, el bot tampoco.
//
// Cómo se saca el token sin contraseña: auth.admin.generateLink(magiclink) da
// un token de un solo uso (NO manda correo) y verifyOtp lo cambia por una
// sesión. Se guarda en memoria hasta 5 minutos antes de que caduque.
//
// ¿Quién es? agent_contacts.app_user_id → si no, por employee_id → si no, por
// el teléfono contra la ficha de empleados. Sin usuario del ERP, el bot sigue
// funcionando pero sin las herramientas del MCP.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import type { AgentContact } from './types.ts';

const URL_SB = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;

export interface SesionPersona {
  sb: any;
  token: string;
  quien: { id: string; nombre: string | null; email: string | null; empleadoId: string | null; area: string | null; nivel: string | null; token: string };
  puedeEstadoCuenta: boolean;
}

const cache = new Map<string, { s: SesionPersona; exp: number }>();
const ult10 = (p: string) => (p || '').replace(/\D/g, '').slice(-10);

async function usuarioDe(admin: any, contact: AgentContact & { app_user_id?: string | null }) {
  const campos = 'id, nombre, email, permission_area, nivel, employee_id, auth_user_id, activo, es_bot, puede_estado_cuenta';
  if (contact.app_user_id) {
    const { data } = await admin.from('app_users').select(campos).eq('id', contact.app_user_id).maybeSingle();
    if (data) return data;
  }
  let empId = contact.employee_id;
  if (!empId) {
    const t = ult10(contact.phone_e164);
    const { data: emps } = await admin.from('employees').select('id, telefono_personal, obra_app_phone, phone').eq('activo', true);
    empId = (emps || []).find((e: any) => [e.telefono_personal, e.obra_app_phone, e.phone].some((x: string) => ult10(x || '') === t))?.id || null;
  }
  if (!empId) return null;
  const { data } = await admin.from('app_users').select(campos).eq('employee_id', empId).eq('activo', true).maybeSingle();
  return data;
}

export async function sesionDe(admin: any, contact: AgentContact): Promise<SesionPersona | null> {
  const hit = cache.get(contact.id);
  if (hit && hit.exp > Date.now()) return hit.s;
  try {
    const au = await usuarioDe(admin, contact as any);
    if (!au || !au.activo || au.es_bot || !au.auth_user_id) return null;
    const { data: u } = await admin.auth.admin.getUserById(au.auth_user_id);
    const email = u?.user?.email;
    if (!email) return null;
    const { data: link, error: eLink } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (eLink || !link?.properties?.hashed_token) { console.error('generateLink:', eLink?.message); return null; }
    const anonClient = createClient(URL_SB, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: ses, error: eOtp } = await anonClient.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
    if (eOtp || !ses?.session?.access_token) { console.error('verifyOtp:', eOtp?.message); return null; }
    const token = ses.session.access_token;
    const sb = createClient(URL_SB, ANON, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const s: SesionPersona = {
      sb, token,
      quien: { id: au.id, nombre: au.nombre, email: au.email, empleadoId: au.employee_id ?? null, area: au.permission_area ?? null, nivel: au.nivel ?? null, token },
      puedeEstadoCuenta: au.puede_estado_cuenta === true || ['DG', 'Administracion'].includes(au.permission_area),
    };
    const exp = ((ses.session.expires_at ?? 0) * 1000 || Date.now() + 3600_000) - 5 * 60_000;
    cache.set(contact.id, { s, exp });
    return s;
  } catch (e) {
    console.error('sesionDe:', e);
    return null;
  }
}
