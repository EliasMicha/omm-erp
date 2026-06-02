// ═══════════════════════════════════════════════════════════════════════════
// /api/agent — Endpoint único para todos los agentes de cotización por
// proveedor. Routing interno via query params para no consumir múltiples
// serverless functions slots (Vercel Hobby = max 12).
// ═══════════════════════════════════════════════════════════════════════════
//
// Routing:
//   POST /api/agent?action=test_login&supplier=lutron
//      → valida que el login funciona con Playwright + sparticuz/chromium
//   POST /api/agent?action=create_quote&supplier=lutron
//      → (TODO) ejecuta el playbook completo: login + crear proyecto +
//        agregar items + descargar PDF
//
// Env vars requeridas:
//   - MYLUTRON_EMAIL, MYLUTRON_PASS (mientras armamos vault encriptado)
//   - AGENT_VAULT_KEY (para fases siguientes)
//
// Test rápido:
//   curl -X POST "https://omm-erp.vercel.app/api/agent?action=test_login&supplier=lutron"

import chromium from '@sparticuz/chromium'
import { chromium as playwrightChromium } from 'playwright-core'

export const config = {
  maxDuration: 60,
}

interface TestLoginResult {
  ok: boolean
  status: 'success' | 'failed_at_email' | 'failed_at_password' | 'failed_at_redirect' | 'detected_as_bot' | 'unknown_error'
  current_url?: string
  page_title?: string
  screenshot_base64?: string
  timing_ms?: number
  error?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDLER — Routing por ?action y ?supplier
// ═══════════════════════════════════════════════════════════════════════════
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed (use POST)' })
    return
  }

  const action = (req.query?.action || '').toString()
  const supplier = (req.query?.supplier || '').toString().toLowerCase()

  if (!action) {
    res.status(400).json({ ok: false, error: 'Missing ?action param. Valid: test_login, create_quote' })
    return
  }
  if (!supplier) {
    res.status(400).json({ ok: false, error: 'Missing ?supplier param. Valid: lutron, syscom, dextra' })
    return
  }

  try {
    if (action === 'test_login' && supplier === 'lutron') {
      const result = await testLutronLogin()
      res.status(result.ok ? 200 : 500).json(result)
      return
    }

    if (action === 'create_quote' && supplier === 'lutron') {
      res.status(501).json({ ok: false, error: 'Not implemented yet. Pending: complete playbook execution.' })
      return
    }

    res.status(400).json({ ok: false, error: `Unsupported action+supplier combination: ${action} / ${supplier}` })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LUTRON — Test login (Stage 1 POC del agente)
// ═══════════════════════════════════════════════════════════════════════════
async function testLutronLogin(): Promise<TestLoginResult> {
  const email = process.env.MYLUTRON_EMAIL
  const password = process.env.MYLUTRON_PASS
  if (!email || !password) {
    return {
      ok: false,
      status: 'unknown_error',
      error: 'Missing MYLUTRON_EMAIL or MYLUTRON_PASS in env vars',
    }
  }

  const t0 = Date.now()
  let browser: any = null
  const result: TestLoginResult = { ok: false, status: 'unknown_error' }

  try {
    browser = await playwrightChromium.launch({
      args: [
        ...chromium.args,
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
      executablePath: await chromium.executablePath(),
      headless: true,
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1412, height: 743 },
      locale: 'en-US',
      timezoneId: 'America/Mexico_City',
    })

    // Anti-detection scripts
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // @ts-ignore
      window.chrome = { runtime: {} }
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      const origQuery = window.navigator.permissions.query
      // @ts-ignore
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as any)
          : origQuery(parameters)
    })

    const page = await context.newPage()

    // Stage 1: Navigate y email
    await page.goto('https://www.mylutron.com', { waitUntil: 'networkidle', timeout: 30000 })

    const currentUrl = page.url()
    if (!currentUrl.includes('umslogin.lutron.com')) {
      result.status = 'failed_at_email'
      result.error = `Expected redirect to umslogin.lutron.com, got: ${currentUrl}`
      result.current_url = currentUrl
      throw new Error(result.error)
    }

    const emailInput = await page.waitForSelector('input[placeholder="Email address"]', { timeout: 10000 })
    await emailInput.fill(email)
    await page.click('button[type="submit"]')

    // Stage 2: Password
    await page.waitForLoadState('networkidle', { timeout: 15000 })
    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 })
    if (!passwordInput) {
      result.status = 'failed_at_password'
      result.error = 'Password field not found'
      throw new Error(result.error)
    }
    await passwordInput.fill(password)
    await page.click('button[type="submit"]')

    // Stage 3: OAuth callback redirect
    try {
      await page.waitForURL((url: URL) => url.hostname === 'mylutron.com' && url.pathname.toLowerCase().includes('project'), {
        timeout: 30000,
      })
    } catch (e) {
      const url = page.url()
      const bodyText = await page.evaluate(() => document.body.innerText).catch(() => '')
      if (bodyText.match(/captcha|robot|verify|blocked|denied/i)) {
        result.status = 'detected_as_bot'
        result.error = 'Page contains anti-bot terms after submit'
      } else {
        result.status = 'failed_at_redirect'
        result.error = `Did not redirect to mylutron.com/Project. Current: ${url}`
      }
      result.current_url = url
      throw new Error(result.error)
    }

    // Stage 4: Screenshot
    await page.waitForLoadState('networkidle', { timeout: 15000 })
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false })
    result.screenshot_base64 = screenshotBuffer.toString('base64')
    result.current_url = page.url()
    result.page_title = await page.title()
    result.status = 'success'
    result.ok = true
  } catch (err: any) {
    if (!result.error) result.error = err?.message || String(err)
    result.ok = false
  } finally {
    if (browser) {
      try { await browser.close() } catch {}
    }
  }

  result.timing_ms = Date.now() - t0
  return result
}
