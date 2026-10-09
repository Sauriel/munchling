import { describe, it, expect, vi } from 'vitest'
import { createTestDatabase } from '../helpers/sqlite'
import { createSyncQueue } from '../../app/utils/database/outbox'
import { runLocalMigrations } from '../../app/utils/database/migrations'
import { createSqlDatabase } from '../../app/utils/database/executor'
import { quantityGrams, displayedQuantity } from '../../shared/domain/portions'
import { serverMigrations } from '../../server/database/schema'
import { migrationChecksum } from '../../server/database/migrations'
import { validatePayload } from '../../shared/domain/server-validation'

const foodInput = { nameDe: 'Food', nameEn: 'Food', caloriesPer100g: 100, fatPer100g: 1, carbsPer100g: 10, sugarPer100g: 1, fiberPer100g: 2, proteinPer100g: 3, saltPer100g: 0.1 }

describe('optional portion sizes end to end in SQLite', () => {
  it('persists, queues and restores food/recipe portions without changing historical meals', async () => {
    const db = await createTestDatabase()
    try {
      const f = (await db.service.foods.createFood({ ...foodInput, portionSizeGrams: 125 }))!
      const r = (await db.service.recipes.createRecipe({ nameDe: 'Recipe', nameEn: 'Recipe', portionSizeGrams: 300, ingredients: [{ foodId: f.id, amountGrams: 500 }] }))!
      const p = (await db.service.profiles.createProfile({ name: 'P', dailyCaloriesTarget: 2000 }))!
      const m = (await db.service.mealLogs.createMealLog({ recipeId: r.id, profiles: [{ profileId: p.id, portionGrams: quantityGrams(1.5, 'portions', r.portionSizeGrams) }] }))!
      expect(m.totalWeightGrams).toBe(450)
      await db.service.foods.updateFood(f.id, { brand: 'Still the same portion' })
      expect((await db.service.foods.getFoodById(f.id))!.portionSizeGrams).toBe(125)
      await db.service.recipes.updateRecipe(r.id, { portionSizeGrams: 250 })
      expect((await db.service.mealLogs.getMealLogById(m.id))!.totalWeightGrams).toBe(450)
      const queue = await createSyncQueue(db.database).list()
      expect(queue.filter(o => o.entity === 'recipes').at(-1)!.payload.portion_size_grams).toBe(250)
      const backup = await db.service.backups!.exportBackup(); expect(backup.version).toBe(3)
      await db.service.backups!.restoreBackup(backup, async () => {})
      expect((await db.service.recipes.getRecipeById(r.id))!.portionSizeGrams).toBe(250)
      // v2 backups remain readable; omitted sizes become unknown, never 100g.
      const legacy = { ...backup, version: 2, schemaVersion: 2 }
      for (const row of [...legacy.data.foods, ...legacy.data.recipes]) delete row.portionSizeGrams
      await db.service.backups!.restoreBackup(legacy, async () => {})
      expect((await db.service.foods.getFoodById(f.id))!.portionSizeGrams).toBeNull()
      expect((await db.service.mealLogs.getMealLogById(m.id))!.totalWeightGrams).toBe(450)
    } finally { db.close() }
  })
  it('rejects zero/nonfinite sizes, preserves undefined and explicitly clears null', async () => {
    const db = await createTestDatabase()
    try {
      const f = (await db.service.foods.createFood({ ...foodInput, portionSizeGrams: 50 }))!
      for (const size of [0, -1, NaN, Infinity]) {
        await expect(db.service.foods.updateFood(f.id, { portionSizeGrams: size })).rejects.toThrow()
        await expect(db.service.recipes.createRecipe({ nameDe: 'R', nameEn: 'R', portionSizeGrams: size })).rejects.toThrow()
      }
      await db.service.foods.updateFood(f.id, { portionSizeGrams: null })
      expect((await db.service.foods.getFoodById(f.id))!.portionSizeGrams).toBeNull()
    } finally { db.close() }
  })
  it('migrates v4 additively, rolls back on failure and leaves pending payloads/IDs untouched', async () => {
    const db = await createTestDatabase({ version: 4 })
    try {
      await db.database.run("INSERT INTO foods(name_de,name_en,calories_per_100g,fat_per_100g,carbs_per_100g,sugar_per_100g,fiber_per_100g,protein_per_100g,salt_per_100g) VALUES ('Legacy','Legacy',100,0,0,0,0,0,0);")
      const queue = await createSyncQueue(db.database).list(), before = (await db.service.backups!.exportBackup()).data
      const execute = db.driver.execute
      const spy = vi.spyOn(db.driver, 'execute').mockImplementation((sql, tx) => execute(sql.includes('ALTER TABLE recipes ADD COLUMN portion_size_grams') ? sql + 'INSERT INTO no_such_table VALUES(1);' : sql, tx))
      await expect(runLocalMigrations(createSqlDatabase(db.driver), async () => {})).rejects.toThrow()
      spy.mockRestore()
      expect((await db.database.query<{ name: string }>('PRAGMA table_info(foods);')).some(c => c.name === 'portion_size_grams')).toBe(false)
      await runLocalMigrations(createSqlDatabase(db.driver), async () => {})
      expect((await db.service.backups!.exportBackup()).data).toEqual(before)
      expect(await createSyncQueue(db.database).list()).toEqual(queue)
      expect(queue[0]!.payload).not.toHaveProperty('portion_size_grams')
      expect(() => validatePayload('foods', queue[0]!.payload, new Set())).not.toThrow()
    } finally { db.close() }
  })
  it('converts fractional portions while keeping gram values canonical', () => {
    expect(quantityGrams(0.5, 'portions', 125)).toBe(62.5)
    expect(displayedQuantity(62.5, 'portions', 125)).toBe(0.5)
    expect(displayedQuantity(62.5, 'grams')).toBe(62.5)
    expect(() => quantityGrams(2, 'portions', null)).toThrow()
    expect(() => quantityGrams(Infinity, 'grams')).toThrow()
  })
  it('preserves both published MariaDB migration checksums', () => {
    expect(serverMigrations.slice(0, 2).map(m => migrationChecksum(m.statements))).toEqual([
      '7cef9035727b0acbb43ca1183f6ce1cb8e4fe0f32e404b5f87be44e172a64118',
      '7f1b636631d3bc8ee57a1bdc24eb400008789c26228c56d81820d0e197cfc037'
    ])
  })
})
