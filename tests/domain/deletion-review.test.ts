import { describe,it,expect } from 'vitest'
import { mergeFixture } from '../helpers/food-merge'
import { deletionReview,affectedRecipeIds } from '../../shared/domain/deletion-review'
import { normalizeWriteBatch } from '../../shared/domain/server-validation'
import { createUuid } from '../../shared/domain/sync'

describe('version-bound deletion review', () => {
  it('lists direct and indirect recipes and all affected booked meals without mutating the cut', () => {
    const f = mergeFixture(), before = structuredClone(f.roots), review = deletionReview(f.roots,'foods',f.source.id)
    expect(review.dependents.map(r => r.id)).toEqual([f.r.id,f.direct.id])
    expect(review.indirect.map(r => r.id)).toEqual([f.parent.id])
    expect(new Set(review.history.map(r => r.id))).toEqual(new Set([f.direct.id,f.indirect.id]))
    expect(review.guards).toContainEqual({ entity: 'recipes',entityUuid: f.parent.id,baseRevision: 1 })
    review.root.data!.name_de = 'Changed UI'; expect(f.roots).toEqual(before)
  })
  it('allows unbooked references and protects a nested recipe meal', () => {
    const f = mergeFixture(), roots = f.roots.filter(r => r.entity !== 'meal_logs')
    expect(deletionReview(roots,'foods',f.source.id).history).toEqual([])
    expect(deletionReview(f.roots,'recipes',f.r.id).history.map(r => r.id)).toEqual([f.indirect.id])
  })
  it('protects profile portions and ignores unrelated templates and tombstones', () => {
    const f = mergeFixture()
    expect(deletionReview(f.roots,'profiles',f.p.id).history).toHaveLength(2)
    const root = { entity: 'activities' as const,id: createUuid(),version: 1,deletedAt: null,data: {} }
    expect(deletionReview([...f.roots,root],'activities',root.id).history).toEqual([])
    expect(deletionReview(f.roots.map(r => r.entity === 'meal_logs' ? { ...r,deletedAt: '2026-01-01',data: null } : r),'foods',f.source.id).history).toEqual([])
  })
  it('has no recursion-depth cutoff and tolerates repeated paths', () => {
    const edges = Array.from({ length: 2500 },(_,i) => ({ recipeId: String(i),foodId: i === 0 ? 'food' : null,subRecipeId: i === 0 ? null : String(i-1) }))
    expect(affectedRecipeIds(edges,'foods','food').size).toBe(2500)
    edges.push({ recipeId: '0',foodId: null,subRecipeId: '2499' })
    expect(affectedRecipeIds(edges,'foods','food').size).toBe(2500)
  })
  it('does not add defaults to legacy immutable bodies and accepts only the opt-in true flag', () => {
    const id = createUuid(), body = { batchId: createUuid(),serverInstanceId: createUuid(),serverEpoch: createUuid(),operations: [{ operationId: createUuid(),entity: 'foods',entityUuid: id,baseRevision: 1,operation: 'delete',payload: { id } }] }
    expect(normalizeWriteBatch(body)).toEqual(body)
    expect(normalizeWriteBatch({ ...body,preserveHistory: true }).preserveHistory).toBe(true)
    for (const flag of [false,0,1,null,'true']) expect(() => normalizeWriteBatch({ ...body,preserveHistory: flag })).toThrow()
  })
})
