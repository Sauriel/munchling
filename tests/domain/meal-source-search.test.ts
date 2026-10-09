import { describe, it, expect } from 'vitest'
import { mealSourceMatches } from '../../app/utils/meal-source-search'

describe('meal source search', () => {
  const foods = [
    { id: 2, nameDe: 'Banane', nameEn: 'Banana', brand: null, ean: null },
    { id: 1, nameDe: 'Apfel', nameEn: 'Apple', brand: 'Obsthof', ean: '123456789' },
    { id: 3, nameDe: 'Apfelmus', nameEn: 'Apple sauce', brand: null, ean: null }
  ]
  it('matches German/English names, brand and EAN with all query terms', () => {
    expect(mealSourceMatches(foods, 'APPLE obsthof').map(f => f.id)).toEqual([1])
    expect(mealSourceMatches(foods, '123456').map(f => f.id)).toEqual([1])
    expect(mealSourceMatches(foods, '  banane ')).toEqual([foods[0]])
    expect(mealSourceMatches(foods, 'nothing')).toEqual([])
  })
  it('sorts stably without mutating shared lists and supports recipes', () => {
    expect(mealSourceMatches(foods, '').map(f => f.id)).toEqual([1, 3, 2])
    expect(foods.map(f => f.id)).toEqual([2, 1, 3])
    expect(mealSourceMatches([{ id: 9, nameDe: 'Suppe', nameEn: 'Soup' }], 'soup')[0]?.id).toBe(9)
  })
})
