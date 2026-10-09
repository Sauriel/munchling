// Absent means household entry; malformed values must never fall back to all profiles.
export function activityProfileFromQuery(value: unknown): number | null | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}
