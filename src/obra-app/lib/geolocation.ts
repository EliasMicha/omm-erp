// Geolocation helpers for the Obra app
// Captures GPS coordinates and computes distance to project locations

export interface Coords {
  latitude: number
  longitude: number
  accuracy?: number
}

export interface GeoResult extends Coords {
  timestamp: number
}

/**
 * Get the user's current position using the browser's Geolocation API.
 * Requests high accuracy and times out after 15 seconds.
 */
export function getCurrentPosition(): Promise<GeoResult> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Geolocalización no soportada en este dispositivo'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        })
      },
      err => {
        const msg =
          err.code === 1 ? 'Permiso de ubicación denegado. Activa la ubicación en tu navegador.' :
          err.code === 2 ? 'Ubicación no disponible. Revisa que tengas GPS activado.' :
          err.code === 3 ? 'Tiempo agotado esperando la ubicación. Intenta de nuevo.' :
          'Error desconocido al obtener ubicación.'
        reject(new Error(msg))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  })
}

/**
 * Watch the user's position. Returns the watcher ID so it can be cleared later.
 * Used for live location tracking.
 */
export function watchPosition(
  onUpdate: (coords: GeoResult) => void,
  onError?: (err: Error) => void
): number | null {
  if (!('geolocation' in navigator)) return null
  return navigator.geolocation.watchPosition(
    pos => onUpdate({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      timestamp: pos.timestamp,
    }),
    err => onError?.(new Error(err.message)),
    { enableHighAccuracy: true, maximumAge: 30000 }
  )
}

export function clearWatch(id: number) {
  if ('geolocation' in navigator) navigator.geolocation.clearWatch(id)
}

/**
 * Calculate distance in meters between two GPS coordinates using the Haversine formula.
 */
export function haversineDistance(a: Coords, b: Coords): number {
  const R = 6371000 // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLon = toRad(b.longitude - a.longitude)
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const sinDLat = Math.sin(dLat / 2)
  const sinDLon = Math.sin(dLon / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Format distance for display.
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(2)} km`
}
