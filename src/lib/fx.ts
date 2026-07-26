// Tipo de cambio USD → MXN, por año.
//
// Para un año CERRADO usamos el promedio ponderado real de compra de dólares del año
// (pesos pagados ÷ dólares comprados), calculado desde los movimientos bancarios.
// Es el costo real de adquisición del dólar, no un estimado.
//
// 2025: 19.57  → promedio ponderado real ($1,285,170 pagados / US$65,674 comprados).
// 2026: 18     → provisional. Recalcular con el mismo proceso cuando cierre el año.
//
// Al cerrar cada año nuevo: correr el mismo cálculo y fijar su TC aquí.

export const TC_BY_YEAR: Record<number, number> = {
  2025: 19.57,
  2026: 18,
}

// Default para años sin TC fijado (o vista "todos").
export const DEFAULT_TC = 18

// TC a usar para un año dado. Si el año no está en la tabla, cae al default.
export function tcForYear(year?: number | null): number {
  if (year && TC_BY_YEAR[year]) return TC_BY_YEAR[year]
  return DEFAULT_TC
}
