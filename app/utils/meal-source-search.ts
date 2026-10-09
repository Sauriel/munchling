import type { Food, Recipe } from '../../shared/domain/types'

export function mealSourceMatches<T extends Pick<Food | Recipe, 'id' | 'nameDe' | 'nameEn'> & { brand?: string | null; ean?: string | null }>(items: T[], query: string): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return items.filter(item => {
    const text = [item.nameDe, item.nameEn, item.brand, item.ean].filter(Boolean).join(' ').toLocaleLowerCase()
    return terms.every(term => text.includes(term))
  }).sort((a, b) => a.nameDe.localeCompare(b.nameDe) || a.id - b.id)
}
