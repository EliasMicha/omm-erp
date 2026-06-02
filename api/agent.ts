// ═══════════════════════════════════════════════════════════════════════════
// /api/agent — Endpoint único para todos los agentes de cotización por
// proveedor. Routing interno via query params para no consumir múltiples
// serverless functions slots (Vercel Hobby = max 12).
// ═══════════════════════════════════════════════════════════════════════════
//
// Stack: puppeteer-core + @sparticuz/chromium (oficialmente soportado en Vercel)
//
// Routing:
//   POST /api/agent?action=test_login&supplier=lutron
//      → valida que el login funciona
//   POST /api/agent?action=create_quote&supplier=lutron
//      → (TODO) ejecuta el playbook completo
//
// Env vars: MYLUTRON_EMAIL, MYLUTRON_PASS

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'

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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed (use POST)' })
    return
  }

  const action = (req.query?.action || '').toString()
  const supplier = (req.query?.supplier || '').toString().toLowerCase()

  if (!action || !supplier) {
    res.status(400).json({
      ok: false,
      error: 'Missing ?action or ?supplier param. Valid: action=test_login|create_quote, supplier=lutron|syscom|dextra',
    })
    return
  }

  try {
    if (action === 'test_login' && supplier === 'lutron') {
      const result = await testLutronLogin()
      res.status(result.ok ? 200 : 500).json(result)
      return
    }

    if (action === 'create_quote' && supplier === 'lutron') {
      res.status(501).json({ ok: false, error: 'Not implemented yet' })
      return
    }

    res.status(400).json({ ok: false, error: `Unsupported action+supplier: ${action} / ${supplier}` })
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message || String(err) })
  }
}

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
    // sparticuz/chromium config oficial para Vercel + puppeteer-core
    browser = await puppeteer.launch({
      args: chromium.args.concat([
        '--disable-blink-features=AutomationControlled',
      ]),
      defaultViewport: { width: 1412, height: 743 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless as any,
    })

    const page = await browser.newPage()

    // Anti-detection scripts antes de cualquier navegación
    await page.evaluateOnNewDocument(() => {
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

    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')

    // Stage 1: Navigate y email
    await page.goto('https://www.mylutron.com', { waitUntil: 'networkidle0', timeout: 30000 })

    const currentUrl = page.url()
    if (!currentUrl.includes('umslogin.lutron.com')) {
      result.status = 'failed_at_email'
      result.error = `Expected redirect to umslogin.lutron.com, got: ${currentUrl}`
      result.current_url = currentUrl
      throw new Error(result.error)
    }

    await page.waitForSelector('input[placeholder="Email address"]', { timeout: 10000 })
    await page.type('input[placeholder="Email address"]', email, { delay: 50 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ])

    // Stage 2: Password
    await page.waitForSelector('input[type="password"]', { timeout: 10000 })
    await page.type('input[type="password"]', password, { delay: 50 })
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => null),
      page.click('button[type="submit"]'),
    ])

    // Stage 3: Wait for redirect to mylutron.com/Project
    try {
      await page.waitForFunction(
        () => window.location.hostname === 'mylutron.com' && /project/i.test(window.location.pathname),
        { timeout: 30000 }
      )
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
    await page.waitForNetworkIdle({ timeout: 15000 }).catch(() => null)
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 70 })
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
