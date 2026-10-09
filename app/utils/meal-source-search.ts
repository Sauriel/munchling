import type { Food, Recipe } from '../../shared/domain/types'

export function mealSourceFromQuery(query: Record<string, unknown>): { type: 'food' | 'recipe'; id: number } | null {
  if (query.edit != null || (query.food != null) === (query.recipe != null)) return null
  const type = query.food != null ? 'food' : 'recipe'
  const value = query[type]
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? { type, id } : null
}

export function mealSourceMatches<T extends Pick<Food | Recipe, 'id' | 'nameDe' | 'nameEn'> & { brand?: string | null; ean?: string | null }>(items: T[], query: string): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.filter(item => {
    const text = [item.nameDe, item.nameEn, item.brand, item.ean].filter(Boolean).join(' ').toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  }).sort((a, b) => a.nameDe.localeCompare(b.nameDe) || a.id - b.id)
}
