import type { Profile } from './types'

// Fixed dictionary-style rules, independent of OS locale/SQL collation:
// accents/umlauts like their base letters, ß like ss, case ignored.
const key = (name: string) => name.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/ß/g, 'ss')
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
export function compareProfiles(a: Pick<Profile, 'name' | 'uuid' | 'id'>, b: Pick<Profile, 'name' | 'uuid' | 'id'>) {
  const byName = compare(key(a.name), key(b.name))
  if (byName) return byName
  if (a.uuid && b.uuid) return compare(a.uuid, b.uuid)
  if (a.uuid) return -1
  if (b.uuid) return 1
  return a.id - b.id
}
export function sortProfiles<T extends Pick<Profile, 'name' | 'uuid' | 'id'>>(profiles: readonly T[]): T[] {
  return [...profiles].sort(compareProfiles)
}
