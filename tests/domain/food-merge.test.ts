import { describe,it,expect } from 'vitest'
import { mergeFixture } from '../helpers/food-merge'
import { mergeNutrients,planFoodMerge } from '../../shared/domain/food-merge'

describe('registered food merge plan', () => {
  it('shows direct and nested references and changes only direct FKs with original versions/child identity/history', () => {
    const f = mergeFixture(), before = structuredClone(f.roots), plan = planFoodMerge(f.roots,f.source.id,f.target.id)
    expect(plan.review.ingredients).toBe(1); expect(plan.review.recipes.map(r => r.direct)).toEqual([true,false]); expect(plan.review.meals.map(r => r.direct)).toEqual([true,false])
    expect(plan.operations).toHaveLength(4)
    const recipe = plan.operations.find(op => op.entityUuid === f.r.id)!, meal = plan.operations.find(op => op.entityUuid === f.direct.id)!
    expect(recipe.baseRevision).toBe(1); expect(recipe.payload.ingredients).toEqual((f.r.data!.ingredients as Record<string,unknown>[]).map(row => ({ ...row,food_id: f.target.id })))
    expect(meal.payload).toMatchObject({ ...f.direct.data,food_id: f.target.id,updated_at: expect.any(String) })
    expect(plan.operations.find(op => op.entityUuid === f.target.id)).toMatchObject({ operation: 'upsert',baseRevision: 1,payload: f.target.data })
    expect(plan.guards.some(g => g.entityUuid === f.parent.id)).toBe(true); expect(plan.guards.some(g => g.entityUuid === f.indirect.id)).toBe(true)
    expect(f.roots).toEqual(before)
  })
  it.each(mergeNutrients)('rejects even small mismatches in %s', key => {
    const f = mergeFixture(); f.target.data![key] = Number(f.target.data![key])+0.000001
    expect(() => planFoodMerge(f.roots,f.source.id,f.target.id)).toThrow('mergeNutritionMismatch')
  })
  it('rejects same, missing, unregistered and deleted identities', () => {
    const f = mergeFixture()
    expect(() => planFoodMerge(f.roots,f.source.id,f.source.id)).toThrow('mergeSameFood')
    expect(() => planFoodMerge(f.roots,'missing',f.target.id)).toThrow('reference')
    f.source.version = 0; expect(() => planFoodMerge(f.roots,f.source.id,f.target.id)).toThrow('reference')
    f.source.version = 1; f.target.data = null; expect(() => planFoodMerge(f.roots,f.source.id,f.target.id)).toThrow('reference')
  })
})
