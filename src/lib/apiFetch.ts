import { SUPABASE_AUTH_STORAGE_KEY } from './supabase'

function currentAccessToken(): string | null {
  if (typeof window === 'undefined') return null

  try {
    const stored = window.localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    return typeof parsed?.access_token === 'string' ? parsed.access_token : null
  } catch {
    return null
  }
}

/** Fetch exclusivo para funciones same-origin de OMM. Nunca envía el JWT a terceros. */
export function authenticatedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, window.location.origin)
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
    throw new Error('authenticatedFetch solo permite endpoints /api/ del ERP')
  }

  const headers = new Headers(init.headers)
  const accessToken = currentAccessToken()
  if (accessToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${accessToken}`)
  }

  return window.fetch(url.pathname + url.search + url.hash, { ...init, headers })
}
