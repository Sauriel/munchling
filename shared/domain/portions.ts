import { assertNumber } from './validation'

export type QuantityUnit = 'grams' | 'portions'
export function quantityGrams(quantity: number, unit: QuantityUnit, portionSizeGrams?: number | null): number {
  assertNumber(quantity, 'quantity')
  if (unit === 'portions') assertNumber(portionSizeGrams, 'portionSizeGrams', true)
  const grams = quantity * (unit === 'portions' ? portionSizeGrams! : 1)
  assertNumber(grams, 'portionGrams')
  const rounded = Math.round(grams * 100) / 100
  assertNumber(rounded, 'portionGrams')
  return rounded
}
export function displayedQuantity(grams: number, unit: QuantityUnit, portionSizeGrams?: number | null): number {
  if (unit === 'grams') return grams
  assertNumber(portionSizeGrams, 'portionSizeGrams', true)
  return Number((grams / portionSizeGrams!).toFixed(6))
}
