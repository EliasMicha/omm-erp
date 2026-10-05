// Cliente para WhatsApp Cloud API (Meta)
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const WA_API_VERSION = 'v21.0';

type WhatsAppCredentials = { token: string; phoneNumberId: string };
let cachedCredentials: { value: WhatsAppCredentials; loadedAt: number } | null = null;

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function decryptStoredToken(row: any): Promise<string> {
  const encryptionSecret = Deno.env.get('WHATSAPP_TOKEN_ENCRYPTION_KEY') || '';
  if (encryptionSecret.length < 32) {
    throw new Error('WHATSAPP_TOKEN_ENCRYPTION_KEY no configurada para el agente');
  }
  const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(encryptionSecret));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const ciphertext = decodeBase64(row.access_token_ciphertext);
  const tag = decodeBase64(row.access_token_tag);
  const encrypted = new Uint8Array(ciphertext.length + tag.length);
  encrypted.set(ciphertext);
  encrypted.set(tag, ciphertext.length);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(row.access_token_iv), tagLength: 128 },
    key,
    encrypted,
  );
  return new TextDecoder().decode(plaintext);
}

async function getWhatsAppCredentials(): Promise<WhatsAppCredentials> {
  if (cachedCredentials && Date.now() - cachedCredentials.loadedAt < 5 * 60_000) {
    return cachedCredentials.value;
  }

  // Keep the old secrets as a development fallback, but use the encrypted
  // Embedded Signup connection in normal operation.
  const legacyToken = Deno.env.get('WHATSAPP_TOKEN');
  const legacyPhoneId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) {
    if (legacyToken && legacyPhoneId) return { token: legacyToken, phoneNumberId: legacyPhoneId };
    throw new Error('No hay credenciales de WhatsApp disponibles');
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/whatsapp_connections?id=eq.omm&select=phone_number_id,access_token_ciphertext,access_token_iv,access_token_tag`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  if (!response.ok) throw new Error(`No se pudo leer la conexión de WhatsApp (${response.status})`);
  const rows = await response.json();
  const row = rows?.[0];
  if (!row?.phone_number_id || !row?.access_token_ciphertext) {
    if (legacyToken && legacyPhoneId) return { token: legacyToken, phoneNumberId: legacyPhoneId };
    throw new Error('WhatsApp todavía no está conectado mediante Embedded Signup');
  }

  const value = { token: await decryptStoredToken(row), phoneNumberId: String(row.phone_number_id) };
  cachedCredentials = { value, loadedAt: Date.now() };
  return value;
}

async function waRequest(path: string, body: unknown) {
  const { token, phoneNumberId } = await getWhatsAppCredentials();
  const res = await fetch(`https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${err}`);
  }
  return res.json();
}

export async function sendText(to: string, text: string) {
  // WhatsApp limita a ~4096 chars. Cortamos por seguridad.
  const body = text.length > 4000 ? text.slice(0, 3990) + '…' : text;
  return waRequest('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body, preview_url: false },
  });
}

export async function sendDocument(to: string, mediaId: string, filename: string, caption?: string) {
  return waRequest('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'document',
    document: { id: mediaId, filename, caption },
  });
}

export async function sendImage(to: string, mediaId: string, caption?: string) {
  return waRequest('/messages', {
    messaging_product: 'whatsapp',
    to,
    type: 'image',
    image: { id: mediaId, caption },
  });
}

export async function markAsRead(waMessageId: string) {
  return waRequest('/messages', {
    messaging_product: 'whatsapp',
    status: 'read',
    message_id: waMessageId,
  });
}

// Descarga media (audio, imagen, documento) que el usuario mandó
export async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const { token } = await getWhatsAppCredentials();
  // Paso 1: pedir URL temporal
  const metaRes = await fetch(`https://graph.facebook.com/${WA_API_VERSION}/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!metaRes.ok) throw new Error(`WA media meta error: ${await metaRes.text()}`);
  const meta = await metaRes.json();

  // Paso 2: descargar el archivo
  const fileRes = await fetch(meta.url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!fileRes.ok) throw new Error(`WA media download error: ${await fileRes.text()}`);
  const buf = await fileRes.arrayBuffer();
  return { bytes: new Uint8Array(buf), mimeType: meta.mime_type };
}

// Sube un archivo a WhatsApp para poder enviarlo después
export async function uploadMedia(bytes: Uint8Array, mimeType: string, filename: string): Promise<string> {
  const { token, phoneNumberId } = await getWhatsAppCredentials();
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([bytes], { type: mimeType }), filename);
  form.append('type', mimeType);

  const res = await fetch(`https://graph.facebook.com/${WA_API_VERSION}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) throw new Error(`WA upload error: ${await res.text()}`);
  const data = await res.json();
  return data.id as string;
}

// Verificación del webhook (handshake inicial de Meta)
export function verifyWebhook(mode: string | null, token: string | null, challenge: string | null): string | null {
  const expected = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
  if (mode === 'subscribe' && token === expected && challenge) {
    return challenge;
  }
  return null;
}

// Verifica firma HMAC de Meta (seguridad)
export async function verifySignature(body: string, signatureHeader: string | null): Promise<boolean> {
  if (!signatureHeader) return false;
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') || Deno.env.get('META_APP_SECRET');
  if (!appSecret) return false;

  const expectedPrefix = 'sha256=';
  if (!signatureHeader.startsWith(expectedPrefix)) return false;
  const receivedHex = signatureHeader.slice(expectedPrefix.length);

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const computedHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Comparación en tiempo constante
  if (computedHex.length !== receivedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ receivedHex.charCodeAt(i);
  }
  return diff === 0;
}
