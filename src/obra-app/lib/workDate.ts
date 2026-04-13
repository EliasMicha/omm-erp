// Work date helpers for OMM obra-app
// All dates are computed in America/Mexico_City timezone.
// The "work day" starts at 4am CDMX — any time before 4am belongs to the previous work day.
// This matches how installers actually experience their shifts: if someone finishes a job at 2am,
// that check-out belongs to yesterday's shift, not today's.

const TZ = 'America/Mexico_City'

// Format a Date as YYYY-MM-DD in CDMX timezone (no 4am cutoff).
export function todayCDMX(date: Date = new Date()): string {
  // en-CA produces YYYY-MM-DD format directly
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(date)
}

// Get the current hour (0-23) in CDMX timezone.
export function currentHourCDMX(date: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false,
  })
  return parseInt(fmt.format(date), 10)
}

// Work date with 4am cutoff. If current CDMX hour is < 4, returns yesterday's date.
// Otherwise returns today's CDMX date.
// Used for: attendance (entrada/salida), daily assignment lookup.
export function getWorkDate(date: Date = new Date()): string {
  const hour = currentHourCDMX(date)
  if (hour < 4) {
    // Subtract 1 day and recompute in CDMX
    const prev = new Date(date.getTime() - 24 * 60 * 60 * 1000)
    return todayCDMX(prev)
  }
  return todayCDMX(date)
}

// Human-readable CDMX time (HH:MM) for display.
export function formatCDMXTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}
