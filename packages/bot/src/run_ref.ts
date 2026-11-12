// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export type RunKind = 'profession' | 'combat' | 'behavior'
export type RunRef = Readonly<{ kind: RunKind; id: string }>
type References = Readonly<{
  run_ref?: RunRef | null
  profession_run_id?: string | null
  combat_run_id?: string | null
}>
/** Legacy wire fields drain in place; there is exactly one current authority, never shadow records. */
export const run_ref_of = (record: References): RunRef | null => {
  const refs = [
    record.run_ref,
    record.profession_run_id ? { kind: 'profession' as const, id: record.profession_run_id } : null,
    record.combat_run_id ? { kind: 'combat' as const, id: record.combat_run_id } : null,
  ].filter((ref): ref is RunRef => !!ref)
  if (
    refs.some(
      (ref) => !['profession', 'combat', 'behavior'].includes(ref.kind) || typeof ref.id !== 'string' || !ref.id
    )
  )
    throw new Error('run_reference_conflict')
  if (refs.length > 1) throw new Error('run_reference_conflict')
  return refs[0] ?? null
}
export const run_key = (ref: RunRef) => `${ref.kind}:${ref.id}`
export const run_keys = (record: References) => {
  const ref = run_ref_of(record)
  return ref ? [run_key(ref)] : []
}
export const same_run = (left: References, right: References) =>
  JSON.stringify(run_ref_of(left)) === JSON.stringify(run_ref_of(right))
export const run_binding = (kind: RunKind, id: string) => {
  if (kind === 'profession') return { profession_run_id: id }
  if (kind === 'combat') return { combat_run_id: id }
  return { run_ref: { kind, id } }
}
export const cleared_run = { run_ref: null, profession_run_id: null, combat_run_id: null } as const
