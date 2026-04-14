// Cliente para WhatsApp Cloud API (Meta)
// Docs: https://developers.facebook.com/docs/whatsapp/cloud-api

const WA_TOKEN = Deno.env.get('WHATSAPP_TOKEN')!;
const WA_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')!;
const WA_API_VERSION = 'v21.0';
const WA_BASE = `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}`;

async function waRequest(path: string, body: unknown) {
  const res = await fetch(`${WA_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
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
  // Paso 1: pedir URL temporal
  const metaRes = await fetch(`https://graph.facebook.com/${WA_API_VERSION}/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${WA_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`WA media meta error: ${await metaRes.text()}`);
  const meta = await metaRes.json();

  // Paso 2: descargar el archivo
  const fileRes = await fetch(meta.url, {
    headers: { 'Authorization': `Bearer ${WA_TOKEN}` },
  });
  if (!fileRes.ok) throw new Error(`WA media download error: ${await fileRes.text()}`);
  const buf = await fileRes.arrayBuffer();
  return { bytes: new Uint8Array(buf), mimeType: meta.mime_type };
}

// Sube un archivo a WhatsApp para poder enviarlo después
export async function uploadMedia(bytes: Uint8Array, mimeType: string, filename: string): Promise<string> {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([bytes], { type: mimeType }), filename);
  form.append('type', mimeType);

  const res = await fetch(`${WA_BASE}/media`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WA_TOKEN}` },
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
  const appSecret = Deno.env.get('WHATSAPP_APP_SECRET');
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
