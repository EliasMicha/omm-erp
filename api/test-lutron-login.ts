// ═══════════════════════════════════════════════════════════════════════════
// /api/test-lutron-login — POC: valida que Playwright + sparticuz/chromium
// funcionan en Vercel y que MyLutron NO detecta el bot.
// ═══════════════════════════════════════════════════════════════════════════
//
// Flow del test:
//   1. Lanza Chromium headless con stealth args
//   2. Navega a https://www.mylutron.com (redirige a OAuth login)
//   3. Stage 1: llena email → click Next
//   4. Stage 2: llena password → click Login
//   5. Espera redirect a mylutron.com/Project
//   6. Toma screenshot de la home logueada
//   7. Devuelve { ok, status, screenshot_base64, timing_ms, error? }
//
// Requiere env vars en Vercel:
//   - MYLUTRON_EMAIL: tu email del portal
//   - MYLUTRON_PASS: tu password del portal
//
// Llamada de prueba:
//   curl -X POST https://omm-erp.vercel.app/api/test-lutron-login \
//        -H "Content-Type: application/json" -d "{}"

import chromium from '@sparticuz/chromium'
import { chromium as playwrightChromium } from 'playwright-core'

export const config = {
  // Vercel function: Hobby = 60s max con esta config; suficiente para login
  maxDuration: 60,
}

interface TestResult {
  ok: boolean
  status: 'success' | 'failed_at_email' | 'failed_at_password' | 'failed_at_redirect' | 'detected_as_bot' | 'unknown_error'
  current_url?: string
  page_title?: string
  screenshot_base64?: string
  timing_ms?: number
  error?: string
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed (use POST)' })
    return
  }

  const email = process.env.MYLUTRON_EMAIL
  const password = process.env.MYLUTRON_PASS
  if (!email || !password) {
    res.status(500).json({
      ok: false,
      error: 'Missing MYLUTRON_EMAIL or MYLUTRON_PASS in env vars',
    })
    return
  }

  const t0 = Date.now()
  let browser: any = null
  const result: TestResult = { ok: false, status: 'unknown_error' }

  try {
    // Lanzar Chromium con args anti-detection
    browser = await playwrightChromium.launch({
      args: [
        ...chromium.args,
        '--disable-blink-features=AutomationControlled',  // hides navigator.webdriver
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

    // Inyecta script anti-detection ANTES de cualquier navegación
    await context.addInitScript(() => {
      // navigator.webdriver = false
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      // chrome runtime existe (de browsers reales)
      // @ts-ignore
      window.chrome = { runtime: {} }
      // plugins length > 0
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
      // permissions API responde como un browser real
      const origQuery = window.navigator.permissions.query
      // @ts-ignore
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as any)
          : origQuery(parameters)
    })

    const page = await context.newPage()

    // === Stage 1: Navigate y entrar email ===
    await page.goto('https://www.mylutron.com', { waitUntil: 'networkidle', timeout: 30000 })

    // Verifica que llegamos al login multi-step
    const currentUrl = page.url()
    if (!currentUrl.includes('umslogin.lutron.com')) {
      result.status = 'failed_at_email'
      result.error = `Expected redirect to umslogin.lutron.com, got: ${currentUrl}`
      result.current_url = currentUrl
      throw new Error(result.error)
    }

    // Llenar email
    const emailInput = await page.waitForSelector('input[placeholder="Email address"]', { timeout: 10000 })
    await emailInput.fill(email)
    await page.click('button[type="submit"]')

    // === Stage 2: Esperar pantalla de password y llenarlo ===
    // Damos tiempo a la transición (puede tardar si hay federation check)
    await page.waitForLoadState('networkidle', { timeout: 15000 })
    const passwordInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 })
    if (!passwordInput) {
      result.status = 'failed_at_password'
      result.error = 'Password field not found after email submit'
      throw new Error(result.error)
    }
    await passwordInput.fill(password)
    await page.click('button[type="submit"]')

    // === Stage 3: Esperar redirect al dashboard ===
    try {
      await page.waitForURL((url: URL) => url.hostname === 'mylutron.com' && url.pathname.toLowerCase().includes('project'), {
        timeout: 30000,
      })
    } catch (e) {
      // Verifica si nos rechazaron por bot detection
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

    // === Stage 4: Screenshot del dashboard ===
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
  res.status(result.ok ? 200 : 500).json(result)
}
