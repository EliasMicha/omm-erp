// Vercel serverless function — extrae movimientos bancarios de estados de cuenta
// Recibe: { kind: 'pdf'|'text', payload: string (base64 o texto), banco?: string }
// Devuelve: { ok: boolean, movements?: BankMovementExtracted[], warnings?: string[], error?: string }

import type { VercelRequest, VercelResponse } from '@vercel/node'

// Permitir hasta 60s de ejecución (default de Vercel es 10s, insuficiente con retries + PDF grande)
export const config = {
  maxDuration: 120,
}

const TXT_TABULAR_PROMPT = `Eres un experto contable mexicano especializado en estados de cuenta BBVA.

Recibirás un TSV (tab-separated values) copy-pasted del portal web de BBVA con 5 columnas:
Día | Concepto / Referencia | cargo | Abono | Saldo

REGLAS DE PARSEO:
1. La PRIMERA fila es header, IGNÓRALA.
2. Cada fila restante es UN movimiento bancario.
3. Si la columna 'cargo' tiene valor → tipo = 'cargo'. Si 'Abono' tiene valor → tipo = 'abono'. Nunca ambos al mismo tiempo.
4. Normaliza la fecha de DD-MM-YYYY a YYYY-MM-DD.
5. Parsea montos removiendo comas: '1,492.44' → 1492.44. Siempre positivo.
6. Parsea el saldo también (informativo).
7. Si el usuario indica una ULTIMA_FECHA_IMPORTADA, IGNORA todos los movimientos con fecha <= a esa fecha.

EXTRACCIÓN DE METADATOS DEL CONCEPTO (auto-detección agresiva):
Para cada movimiento, analiza el campo concepto y extrae:

- beneficiario: el actor externo de la transacción. Ejemplos:
  • 'UBER RIDE/...' → 'Uber'
  • 'DLO*TDA UBER RIDES/...' → 'Uber'
  • 'STRIPE *AMAZONPRIMESUB/...' → 'Amazon Prime'
  • 'STR*SYSCOM MX/...' → 'Syscom'
  • 'CLAUDE.AI SUBSCRIPTION/...' → 'Anthropic (Claude)'
  • 'APP TELMEX/...' → 'Telmex'
  • 'BBVA SEGUROS MEXICO/...' → 'BBVA Seguros'
  • 'SAT/GUIA:...' → 'SAT'
  • 'IMSS/INF/AFORE/...' → 'IMSS/INFONAVIT'
  • 'SISTEMAS Y SERVICIOS/GUIA:...' → 'SYSCOM'
  • 'PAGO CUENTA DE TERCERO/...': extraer la referencia libre al final (ej. 'LUMIN 1106', 'Bocinas E401', 'Finiquito Carlos')
  • 'SPEI ENVIADO BANAMEX/...Finiquito Carlos Alberto' → 'Carlos Alberto' (o lo que sea la referencia)
  • 'PAGO DE NOMINA/IN ... OMM TECHNOLOGIES' → 'Nómina OMM'
  • 'TRANSF SPEI BANAMEX/...' → 'SPEI nómina'
  • 'DEPOSITO DE TERCERO/REF...BMRCASH' → 'Depósito cliente'
  • 'PAGO TARJETA DE CREDITO/...' → 'TDC BBVA'

- rfc_contraparte: si el concepto contiene 'RFC: XXX NNNNNNXXX', extraerlo normalizado SIN espacios.
  Ejemplo: 'RFC: DME 180122DU4' → 'DME180122DU4'

- proyecto_codigo: buscar /\\bE\\d{2,3}\\b/i en el concepto.
  Ejemplos: 'Bocinas E401' → 'E401', 'Material E402' → 'E402', 'Apagadores E101' → 'E101'.
  Si no hay código, null.

- proyecto_nombre: si el concepto contiene nombres de obra conocidos:
  • 'ARCOS', 'ARCOS Bosques', 'ARCOS N' → 'Arcos Bosques'
  • 'C5C', 'PIANO C5C', 'Piano Bar C5C' → 'Cero5Cien'
  • 'KALACH' → 'KALACH'
  • 'NAUKA' → 'NAUKA'
  • 'RESERVA' → 'Reserva'
  • 'CASALUCE', 'CASA LUCE' → 'Casa Luce'
  • 'Ventanas SAC', 'VENT SAC', 'SIER VENT' → 'Ventanas Sacal'
  • 'Tabachines' → 'Tabachines'
  • 'Olivos 511' → 'Olivos'
  • 'La Punta' → 'La Punta'
  • 'NULED' → 'NULED'

- categoria: inferir tipo de transacción:
  • 'PAGO DE NOMINA', 'TRANSF SPEI ... NOMINA' → 'nomina'
  • 'IMSS/INF/AFORE' → 'impuestos_nomina'
  • 'SAT/GUIA' → 'impuestos'
  • 'SISTEMAS Y SERVICIOS' → 'proveedor' (es SYSCOM, NO es SAT)
  • 'PAGO CUENTA DE TERCERO' con nombre de obra o proyecto → 'proveedor_obra'
  • 'PAGO CUENTA DE TERCERO' con 'Finiquito' → 'nomina'
  • 'PAGO CUENTA DE TERCERO' con 'Prestamo' → 'prestamo'
  • 'SPEI ENVIADO' + 'Anticipo' → 'anticipo_proveedor'
  • 'DEPOSITO DE TERCERO', 'SPEI RECIBIDO' → 'cobro_cliente'
  • 'TRASPASO ENTRE CUENTAS' → 'traspaso_interno'
  • 'UBER', 'STRIPE', 'CLAUDE.AI', 'APP TELMEX', 'BBVA SEGUROS' → 'gasto_operativo'
  • 'SERV BANCA INTERNET', 'IVA COM SERV BCA', 'ADMON RENTA', 'COMPENSACION', 'IVA REP TARJ', 'REP TARJ TIT' → 'comision_bancaria'
  • 'PAGO TARJETA DE CREDITO' → 'pago_tdc'
  • 'RECIBO NO./P0Q...' → 'servicio'
  • otro → 'otro'

- traspaso_usd_monto: si el concepto es 'TRASPASO ENTRE CUENTAS' y termina con un número seguido de 'USD'
  (ej. '5000.00USD'), extraer ese número como float. Si no, null.

- folio_spei: si hay 'FOLIO: NNNNNNN' en el concepto, extraer ese número.

- clabe_contraparte: si el SPEI tiene formato '/NNNNNNNNNN  NNN', extraer la primera CLABE (10 dígitos).

- confianza_autodetect: evalúa tu propia confianza en la auto-detección:
  • 'alta' si detectaste beneficiario + (proyecto_codigo o proyecto_nombre) + categoria distinta de 'otro'
  • 'media' si detectaste beneficiario + categoria pero sin proyecto
  • 'baja' si solo detectaste categoria o solo beneficiario genérico

RESPUESTA (JSON únicamente, sin markdown fences):
{
  "movements": [
    {
      "fecha": "2026-03-31",
      "concepto": "texto completo del concepto original",
      "beneficiario": "Anthropic (Claude)",
      "rfc_contraparte": null,
      "proyecto_codigo": null,
      "proyecto_nombre": null,
      "categoria": "gasto_operativo",
      "monto": 1492.44,
      "tipo": "cargo",
      "saldo_posterior": 104822.21,
      "traspaso_usd_monto": null,
      "folio_spei": null,
      "clabe_contraparte": null,
      "cuenta_destino_detectada": "0044088053",
      "bnet_codigo_detectado": "0119282653",
      "confianza_autodetect": "media"
    }
  ],
  "periodo": { "desde": "2026-03-02", "hasta": "2026-03-31" },
  "saldo_inicial_estimado": 385811.65,
  "saldo_final": 104822.21,
  "warnings": []
}

IMPORTANTE:
- Extrae TODOS los movimientos. No omitas ninguno.
- ORDENA mentalmente los movimientos por fecha ASCENDENTE (más antigua primero) antes de calcular saldos.
- 'saldo_inicial_estimado' es el saldo ANTES del movimiento con fecha más antigua del TXT. Para calcularlo: toma el saldo_posterior de ese primer movimiento cronológico y REVIERTE su efecto (si es cargo suma el monto, si es abono resta el monto).
- 'saldo_final' es el saldo_posterior del movimiento con fecha más reciente del TXT.
- El array 'movements' en la respuesta puede estar en cualquier orden, pero saldo_inicial_estimado y saldo_final deben corresponder a los extremos cronológicos reales.
`;

const SYSTEM_PROMPT = `Eres un experto contable mexicano especializado en estados de cuenta de BBVA, Banorte, Santander, HSBC y Banamex. Extraes movimientos con precisión forense — cada centavo debe cuadrar.

═══════════════════════════════════════════════
REGLA #0 — VERIFICACIÓN DE CUADRE (CRÍTICA)
═══════════════════════════════════════════════
Casi todos los estados de cuenta tienen al inicio o al final un resumen tipo:

  Depósitos / Abonos (+)    17    2,993,518.39
  Retiros / Cargos (-)      102   3,274,637.78

O al final:

  TOTAL IMPORTE CARGOS    3,274,637.78    TOTAL MOVIMIENTOS CARGOS    102
  TOTAL IMPORTE ABONOS    2,993,518.39    TOTAL MOVIMIENTOS ABONOS    17

**Debes extraer estos 4 valores al principio y ponerlos en "expected_totals".**
**Al final de tu extracción, haz internamente este check:**

  suma de montos tipo "cargo" extraídos === expected_total_cargos ?
  cantidad de movimientos tipo "cargo" extraídos === expected_count_cargos ?
  suma de montos tipo "abono" extraídos === expected_total_abonos ?
  cantidad de movimientos tipo "abono" extraídos === expected_count_abonos ?

Si NO cuadra, revisa nuevamente el PDF y corrige antes de devolver. Incluye el resultado del check en "totals_check" del JSON de salida (el cliente lo usa para detectar errores de extracción).

═══════════════════════════════════════════════
REGLA #1 — "MOVIMIENTOS DE PERIODOS ANTERIORES" SE EXCLUYEN
═══════════════════════════════════════════════
Al final del detalle, BBVA incluye una sección titulada:

  "Movimientos de Periodos Anteriores que se consideran en el Cálculo de Liquidación de este Periodo"

**NO extraigas estos movimientos.** Son informativos, pertenecen al mes anterior aunque se liquidaron en este. NO cuentan en los totales de "TOTAL IMPORTE CARGOS/ABONOS". Si los incluyes, el cuadre va a fallar.

═══════════════════════════════════════════════
REGLA #2 — LAS COLUMNAS DE MONTO
═══════════════════════════════════════════════

BBVA layout exacto (de izquierda a derecha):

  FECHA OPER │ FECHA LIQ │ COD. │ DESCRIPCIÓN/REFERENCIA │ CARGOS │ ABONOS │ SALDO OPERACIÓN │ SALDO LIQUIDACIÓN

  ❌ NO USES "Fecha Oper" ni "Fecha Liq" como monto. Son fechas tipo "02/MAR".
  ❌ NO USES "Cód." como monto. Son códigos de 3 chars tipo "N06", "R01", "T17", "P14".
  ❌ NO USES "Saldo Operación" ni "Saldo Liquidación" como monto. Son acumulados grandes (ej. 371,470.34 cuando el movimiento real fue 369.26).
  ✅ SOLO USA "CARGOS" y "ABONOS" como monto del movimiento.

**REGLA DE ORO: respeta rigurosamente en qué columna aparece el número, no confíes en keywords del concepto.**
Ejemplo real: "N06 PAGO CUENTA DE TERCERO 303,076.38" puede aparecer en la columna ABONOS (es una reversión/devolución). Aunque el concepto diga "PAGO", si el número está en la columna de ABONOS, el tipo es "abono".

Trucos visuales para identificar columnas en BBVA:
- Los códigos "N06", "T17", "R01", "P14", "A15", "W02", "BT3", "T20", "E62", "G30", "S39", "S40", "X01", "AA7", "C07", "Y45", "N02", "A16", "A17" son códigos de operación, NUNCA montos.
- Los saldos son números mucho más grandes (6-7 dígitos) y solo aparecen en algunas filas. Los movimientos individuales son típicamente 3-6 dígitos.

═══════════════════════════════════════════════
REGLA #3 — CONCEPTO MULTI-LÍNEA
═══════════════════════════════════════════════
En BBVA cada movimiento ocupa 1-5 líneas:
  Línea 1: "COD DESCRIPCIÓN" (ej. "N06 PAGO CUENTA DE TERCERO")
  Línea 2: "BNET {cuenta} {texto_libre} Ref. {folio}" — el texto libre suele tener el código de proyecto truncado
  Línea 3: BNET01... (número de operación interna)
  Línea 4: Banco origen/destino (ej. "00072180012633111820")
  Línea 5: Nombre del ordenante/beneficiario (ej. "OMM TECHNOLOGIES", "Luna Lopez", "SOMFY", "CARLOS ALBERTO")

**Concatena TODAS las líneas del movimiento en "concepto" separadas por espacio.** NO pierdas ninguna.

═══════════════════════════════════════════════
REGLA #4 — BENEFICIARIO
═══════════════════════════════════════════════
El nombre suele estar en la ÚLTIMA línea del concepto, en mayúsculas:
- "...OMM TECHNOLOGIES" → beneficiario="OMM TECHNOLOGIES"
- "...Luna Lopez" → beneficiario="Luna Lopez"
- "...DAFNE" → beneficiario="DAFNE"
- "...GERARDO ESQUIVEL CABRERA" → beneficiario="GERARDO ESQUIVEL CABRERA"
- "...SOMFY" → beneficiario="SOMFY"
- "...LAVORO K + C" → beneficiario="LAVORO K + C"

Para movimientos A15 (tarjeta de débito): el comercio está en la línea 1:
- "A15 UBER RIDE" → beneficiario="UBER"
- "A15 STRIPE *AMAZONPRIMESUB" → beneficiario="AMAZON PRIME"
- "A15 CLAUDE.AI SUBSCRIPTION" → beneficiario="ANTHROPIC / CLAUDE"
- "A15 APP TELMEX 2" → beneficiario="TELMEX"
- "A15 STR*SYSCOM MX" → beneficiario="SYSCOM"

Para SAT/gobierno: beneficiario="SAT", "IMSS", "INFONAVIT", "CDMX" etc.
Para "SISTEMAS Y SERVICIOS": beneficiario="SYSCOM" (es el proveedor SYSCOM, NO confundir con SAT).

═══════════════════════════════════════════════
REGLA #5 — RFC (CRÍTICO para conciliación)
═══════════════════════════════════════════════
Los RFC mexicanos tienen formato:
- Persona moral: 3 letras + 6 dígitos + 3 alfanuméricos (ej. "XYZ123456AB7")
- Persona física: 4 letras + 6 dígitos + 3 alfanuméricos (ej. "GAJO850101XX0")

**En BBVA aparecen con espacios separadores:** "RFC: DME 180122DU4", "RFC: SPM 1410037E8"
**NORMALIZA quitando espacios:** "DME180122DU4", "SPM1410037E8"

Busca cualquier cadena con ese patrón (con o sin espacios) en el concepto y ponla en "rfc_contraparte".
Si no encuentras RFC → rfc_contraparte: "" (vacío, no null)

═══════════════════════════════════════════════
REGLA #6 — CÓDIGO DE PROYECTO OMM (CRÍTICO)
═══════════════════════════════════════════════
OMM usa códigos internos con formato **letra mayúscula + 3 dígitos**: E101, E102, E401, E402, E501, C200, I301, P402, etc.

Los códigos aparecen a veces truncados porque BBVA limita a ~20 chars:
  "Accesorios E101" → E101
  "Cable E102" → E102
  "Material E402" → E402
  "Shutters E402 ant8" → E402
  "Bocinas E401" → E401
  "Finiquito shutt E1" → E1xx (no hay forma de saber los últimos 2 dígitos, deja "E1" como prefix parcial)
  "Material Sierra Ve" → (sin código)

Busca con el patrón /\\bE\\d{2,3}\\b/i y toma el primero. Pon el resultado en "proyecto_codigo" en mayúsculas.

Si no hay código pero SÍ hay un nombre de obra reconocible, ponlo en "proyecto_nombre":
  Oasis, Arcos Bosques, Arcos N, Piano, Piano Bar, C5C, CERO5CIEN, Reforma 222,
  Chapultepec Uno, Pachuca, Tepeapulco, Ventanas Sacal, Ventanas SAC, Sierra Vent,
  Sierra Ve, Casa Salame, Casa Luce, NULED, Tere Metta, KALACH, La Punta, 
  Olivos 511, ELEVIA, Tabachines

Si no hay ni código ni nombre → ambos quedan "".

═══════════════════════════════════════════════
REGLA #7 — CATEGORIZACIÓN
═══════════════════════════════════════════════
**REGLA ESPECIAL DE OMM: cualquier concepto que tenga NOMBRE DE PERSONA FÍSICA (sin "SA DE CV", sin "S.A.", sin "COMERCIAL", etc.) se categoriza como "nomina".**
Ejemplos: "Luna Lopez", "Andres Gonzales", "DAFNE", "CARLOS ALBERTO", "Luis Enrique Lopez", "GERARDO ESQUIVEL CABRERA".
Excepción: si aparece "Prestamo" o "Contadores" en el concepto → NO es nómina, usa la categoría correspondiente.

Categorías válidas:
- "nomina"        → PAGO NOMINA, R01, BT3 TRANSF SPEI NOMINA, SPEI ENVIADO a persona física
- "proveedor"     → N06 PAGO CUENTA DE TERCERO a empresas, STR*SYSCOM, Boxdeal, SOMFY
- "cobro_cliente" → T20 SPEI RECIBIDO, W02 DEPOSITO DE TERCERO, C07 DEP.CHEQUES DE OTRO BANCO, AA7 DEPOSITO EFECTIVO
- "impuestos"     → SAT, IMSS, INFONAVIT, ISN, CDMX, X01 IMSS/INF/AFORE, P14 CDMX, P14 SAT (⚠️ "SISTEMAS Y SERVICIOS" NO es SAT, es SYSCOM proveedor)
- "proveedor"     → INCLUYE "SISTEMAS Y SERVICIOS" (es SYSCOM, proveedor de material eléctrico)
- "comision"      → S39 SERV BANCA INTERNET, S40 IVA COM, G30 RECIBO NO., A16/A17 REP TARJ, Y45 COMPENSACION
- "traspaso"      → E62 TRASPASO ENTRE CUENTAS (mismo titular), T17 SPEI "Trans entre ctas"
- "prestamo"      → N02 PAGO TARJETA DE CREDITO, "Prestamo" en concepto
- "suscripcion"   → A15 con STRIPE, UBER, CLAUDE.AI, ODOO, TELMEX, SPOTIFY
- "otro"          → cualquier caso que no encaje

═══════════════════════════════════════════════
REGLA #8 — TRASPASOS USD → MXN
═══════════════════════════════════════════════
Los E62 TRASPASO ENTRE CUENTAS a cuenta USD tienen formato:
  "FOLIO: 0000000 3000.00USD Ref. 8604340.1002.01" → cargo MXN = 53,505.78
El número USD es el monto transferido; el monto en MXN es lo debitado de esta cuenta. Usa el monto MXN de la columna Cargos. Guarda el USD como nota en el concepto (no inventes un campo nuevo).

═══════════════════════════════════════════════
REGLA #9 — FECHAS
═══════════════════════════════════════════════
- Formato de salida SIEMPRE: "YYYY-MM-DD"
- FORMATO REAL del TSV pegado del portal BBVA:
- La PRIMERA columna se llama "Día" y trae la fecha COMPLETA en formato DD-MM-YYYY (ejemplo: "31-03-2026", "15-03-2026", "02-03-2026").
- Convierte directamente: "31-03-2026" → "2026-03-31". Es solo reordenar DD-MM-YYYY a YYYY-MM-DD.
- ⚠ CRITICO: USA LA FECHA EXACTA que aparece en cada renglón. NO la cambies. NO le sumes ni restes días. NO uses la fecha de hoy. NO uses la fecha de cierre del estado de cuenta. La fecha de cada movimiento es la que está en su propia primera columna.
- ⚠ CRITICO: Si en el TSV todos los renglones traen "31-03-2026", entonces TODOS los movimientos deben quedar como "2026-03-31". NO los muevas a "2026-04-01" ni a ningún otro día.
- ⚠ CRITICO: NUNCA inventes un año. El año viene literalmente en el TSV (los últimos 4 dígitos del campo Día).
- Si el formato del TSV trae "Fecha Oper" tipo "02/MAR" sin año (formato viejo), entonces sí infiere el año del encabezado del periodo (busca "Periodo DEL 01/03/2026 AL 31/03/2026" o similar). Pero el formato actual del portal BBVA ya trae el año completo en la columna "Día".
- Meses abreviados (solo si el TSV los usa): ENE=01, FEB=02, MAR=03, ABR=04, MAY=05, JUN=06, JUL=07, AGO=08, SEP=09, OCT=10, NOV=11, DIC=12.

═══════════════════════════════════════════════
REGLA #10 — FORMATO DEL MONTO
═══════════════════════════════════════════════
- SIEMPRE positivo en el JSON (el tipo cargo/abono ya indica la dirección)
- Remueve comas de miles: "1,234.56" → 1234.56
- Remueve símbolos: "$1,234.56" → 1234.56

═══════════════════════════════════════════════
FORMATO DE SALIDA (JSON ESTRICTO, sin markdown, sin backticks)
═══════════════════════════════════════════════
{
  "banco": "BBVA",
  "cuenta": "0236",
  "periodo": "2026-03-01 a 2026-03-31",
  "expected_totals": {
    "cargos_total": 3274637.78,
    "cargos_count": 102,
    "abonos_total": 2993518.39,
    "abonos_count": 17
  },
  "movements": [
    {
      "fecha": "2026-03-02",
      "concepto": "A15 UBER RIDE RFC: DME 180122DU4 14:05 AUT: 257458 Ref. 2954",
      "referencia": "257458",
      "monto": 129.95,
      "tipo": "cargo",
      "beneficiario": "UBER",
      "rfc_contraparte": "DME180122DU4",
      "proyecto_codigo": "",
      "proyecto_nombre": "",
      "categoria": "suscripcion"
    }
  ],
  "totals_check": {
    "cargos_sum_ok": true,
    "cargos_count_ok": true,
    "abonos_sum_ok": true,
    "abonos_count_ok": true,
    "notes": "si algo no cuadra, explica qué encontraste diferente"
  },
  "warnings": []
}

**Reglas finales:**
- NO inventes datos. Campos faltantes = string vacío "".
- NO pongas null, solo strings vacíos o números.
- NO omitas ningún movimiento, ni siquiera los centavos (ej. "COMPENSACION POR RETRASO 0.01").
- NO extraigas "Movimientos de Periodos Anteriores".
- Antes de devolver, verifica que las sumas cuadren con expected_totals. Si no cuadran, revisa y corrige.`

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_KEY || process.env.VITE_ANTHROPIC_KEY
  if (!apiKey) return res.status(500).json({ ok: false, error: 'ANTHROPIC_KEY no configurada en el servidor' })

  try {
    const { kind, payload, ultima_fecha_importada } = req.body as { kind: string; payload: string; ultima_fecha_importada?: string }
    if (!kind || !payload) return res.status(400).json({ ok: false, error: 'Faltan parámetros kind/payload' })

    let content: any[]
    if (kind === 'pdf') {
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: payload } },
        { type: 'text', text: SYSTEM_PROMPT },
      ]
    } else if (kind === 'txt-tabular') {
      const ultimaFechaStr = ultima_fecha_importada ? '\n\nULTIMA_FECHA_IMPORTADA: ' + ultima_fecha_importada + ' (ignora movimientos con fecha <= a esta)' : ''
      content = [{ type: 'text', text: TXT_TABULAR_PROMPT + ultimaFechaStr + '\n\nTSV A PROCESAR:\n' + payload.substring(0, 120000) }]
    } else if (kind === 'text') {
      content = [{ type: 'text', text: SYSTEM_PROMPT + '\n\nESTADO DE CUENTA:\n' + payload.substring(0, 60000) }]
    } else {
      return res.status(400).json({ ok: false, error: 'kind inválido (pdf|text|txt-tabular)' })
    }

    // Retry con backoff exponencial cuando Anthropic devuelve 529/overloaded o 5xx
    const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms))
    const MAX_RETRIES = 3
    let r: Response | null = null
    let lastErr = ''
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2025-04-14',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 16000,
          messages: [{ role: 'user', content }],
        }),
      })
      if (r.ok) break
      // 529 = overloaded, 500-504 = server errors → reintentar
      if (r.status === 529 || (r.status >= 500 && r.status < 600)) {
        lastErr = await r.text().catch(() => '')
        if (attempt < MAX_RETRIES) {
          // Backoff: 2s, 5s, 10s
          const delay = attempt === 1 ? 2000 : attempt === 2 ? 5000 : 10000
          await sleep(delay)
          continue
        }
      }
      // Otros errores (400, 401, etc) no se reintentan
      break
    }

    if (!r || !r.ok) {
      const errText = lastErr || (r ? await r.text() : 'no response')
      const isOverloaded = r?.status === 529 || errText.includes('overloaded')
      return res.status(r?.status || 500).json({
        ok: false,
        error: isOverloaded
          ? 'Claude API saturado (overloaded). Intenté 3 veces con backoff pero sigue saturado. Vuelve a intentar en 1-2 minutos.'
          : 'Claude API: ' + errText.substring(0, 500),
      })
    }

    const data = await r.json()
    const textBlocks = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const cleaned = textBlocks.replace(/```json|```/g, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return res.status(500).json({ ok: false, error: 'Claude no devolvió JSON parseable', raw: cleaned.substring(0, 500) })

    let parsed: any
    try {
      parsed = JSON.parse(jsonMatch[0])
    } catch (e: any) {
      return res.status(500).json({ ok: false, error: 'JSON inválido: ' + e.message, raw: jsonMatch[0].substring(0, 500) })
    }

    const movements: any[] = Array.isArray(parsed.movements) ? parsed.movements : []
    const expected = parsed.expected_totals || null
    const warnings: string[] = Array.isArray(parsed.warnings) ? [...parsed.warnings] : []

    // Validación server-side de totales (la fuente de verdad, no confía en el self-check de Claude)
    const sumCargos = movements.filter((m: any) => m.tipo === 'cargo').reduce((s: number, m: any) => s + (Number(m.monto) || 0), 0)
    const sumAbonos = movements.filter((m: any) => m.tipo === 'abono').reduce((s: number, m: any) => s + (Number(m.monto) || 0), 0)
    const countCargos = movements.filter((m: any) => m.tipo === 'cargo').length
    const countAbonos = movements.filter((m: any) => m.tipo === 'abono').length

    const round2 = (n: number) => Math.round(n * 100) / 100
    const totalsCheck: any = {
      sum_cargos_extraido: round2(sumCargos),
      sum_abonos_extraido: round2(sumAbonos),
      count_cargos_extraido: countCargos,
      count_abonos_extraido: countAbonos,
      expected: expected,
      cuadra: false,
    }

    if (expected) {
      const expCargosTotal = Number(expected.cargos_total) || 0
      const expAbonosTotal = Number(expected.abonos_total) || 0
      const expCargosCount = Number(expected.cargos_count) || 0
      const expAbonosCount = Number(expected.abonos_count) || 0

      const diffCargos = round2(Math.abs(sumCargos - expCargosTotal))
      const diffAbonos = round2(Math.abs(sumAbonos - expAbonosTotal))
      const cargosSumOk = diffCargos < 0.02 // tolerancia 2 centavos
      const abonosSumOk = diffAbonos < 0.02
      const cargosCountOk = countCargos === expCargosCount
      const abonosCountOk = countAbonos === expAbonosCount

      totalsCheck.diff_cargos = diffCargos
      totalsCheck.diff_abonos = diffAbonos
      totalsCheck.cargos_sum_ok = cargosSumOk
      totalsCheck.abonos_sum_ok = abonosSumOk
      totalsCheck.cargos_count_ok = cargosCountOk
      totalsCheck.abonos_count_ok = abonosCountOk
      totalsCheck.cuadra = cargosSumOk && abonosSumOk && cargosCountOk && abonosCountOk

      if (!cargosSumOk) warnings.push(`Cargos no cuadran: extraído ${round2(sumCargos)}, esperado ${expCargosTotal} (diff ${diffCargos})`)
      if (!abonosSumOk) warnings.push(`Abonos no cuadran: extraído ${round2(sumAbonos)}, esperado ${expAbonosTotal} (diff ${diffAbonos})`)
      if (!cargosCountOk) warnings.push(`Conteo cargos: extraído ${countCargos}, esperado ${expCargosCount}`)
      if (!abonosCountOk) warnings.push(`Conteo abonos: extraído ${countAbonos}, esperado ${expAbonosCount}`)
    } else if (parsed.saldo_inicial_estimado != null && parsed.saldo_final != null) {
      // Validación por delta de saldo (modo txt-tabular)
      const saldoInicial = Number(parsed.saldo_inicial_estimado) || 0
      const saldoFinal = Number(parsed.saldo_final) || 0
      const deltaEsperado = round2(saldoFinal - saldoInicial)
      const deltaCalculado = round2(sumAbonos - sumCargos)
      const diffDelta = round2(Math.abs(deltaEsperado - deltaCalculado))
      const deltaOk = diffDelta < 0.05
      totalsCheck.saldo_inicial = saldoInicial
      totalsCheck.saldo_final = saldoFinal
      totalsCheck.delta_esperado = deltaEsperado
      totalsCheck.delta_calculado = deltaCalculado
      totalsCheck.delta_diff = diffDelta
      totalsCheck.delta_ok = deltaOk
      totalsCheck.cuadra = deltaOk
      if (!deltaOk) {
        warnings.push('Cuadre por delta de saldo falló: esperado ' + deltaEsperado + ', calculado ' + deltaCalculado + ' (diff ' + diffDelta + ')')
      }
    } else {
      warnings.push('El estado de cuenta no incluía totales esperados ni saldo inicial/final, no se pudo validar cuadre')
    }

    return res.status(200).json({
      ok: true,
      movements,
      banco: parsed.banco || '',
      cuenta: parsed.cuenta || '',
      periodo: parsed.periodo || '',
      expected_totals: expected,
      totals_check: totalsCheck,
      warnings,
    })
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || 'Error interno' })
  }
}
