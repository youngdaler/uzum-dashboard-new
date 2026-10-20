/**
 * Вес в БД хранится в килограммах (weight_kg, unit_weight_kg), в интерфейсе вводится в граммах.
 * Конвертация — только на границе форм/импорта.
 */
const round = (v: number, digits: number): number => {
  const f = 10 ** digits
  return Math.round((v + Number.EPSILON) * f) / f
}

export const kgToG = (kg: number): number => round(kg * 1000, 3)
export const gToKg = (g: number): number => round(g / 1000, 6)
