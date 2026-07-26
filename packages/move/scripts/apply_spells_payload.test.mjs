// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync as read_file } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { expect, test } from 'bun:test'

import release from '../../sdk/src/deployment/release.json' with { type: 'json' }

import {
  FLAG_DISPELLABLE,
  FLAG_NEGATIVE,
  K_ALTER_RESIST,
  K_ALTER_STAT,
  K_APPLY_DOT,
  K_DAMAGE,
  MAX_COMMANDS_PER_PTB,
  MAX_MOBS_PER_PTB,
  MAX_SPELLS,
  SIGNED_DELTA_MAX,
  SIGNED_DELTA_MIN,
  build_batches,
  coverage_check,
  deployment_from_release,
  desired_kits,
  diff_mob_spells,
  encode_effect,
  encode_kit,
  encode_spell_level,
  kits_equal,
  read_template_spells,
  resolve_mode,
  set_spells_command_count,
} from './apply_spells_payload.mjs'

const script_dir = dirname(file_url_to_path(import.meta.url))
const id = (n) => `0x${String(n).padStart(64, '0')}`
const STAT_RAW_DAMAGE = 9 // spell_effect.move:178
const STAT_AGILITY = 3 // spell_effect.move:169

// ── ① THE RE-ENCODING: authored signed delta → the chain's CENTERED dialect (#904) ─────────────────
// The one dialect home is packages/fight/src/fight_status_snapshot.js (encode_status_value /
// is_signed_status_kind). These cases are the LIVE captures the dialect doc cites, re-derived forward.

test('an authored +42 RAW DAMAGE alter_stat encodes to the CENTERED wire value (32768 + 42)', () => {
  const e = encode_effect({ kind: K_ALTER_STAT, stat: STAT_RAW_DAMAGE, value: 42, turns: 3 })
  expect(e.value).toBe(32810)
  expect(e.flags).toBe(0) // a positive delta never carries FLAG_NEGATIVE
  expect(e.stat).toBe(STAT_RAW_DAMAGE)
  expect(e.turns).toBe(3)
})

test('an authored −17 agility alter_stat re-derives the live Bonelet row: value 32751, flags 8', () => {
  // Captured live 2026-07-26 (testnet MobTemplate 0xb80ade53…d444): −17 agility → value "32751", flags 8.
  const e = encode_effect({ kind: K_ALTER_STAT, stat: STAT_AGILITY, value: -17 })
  expect(e.value).toBe(32751)
  expect(e.flags).toBe(FLAG_NEGATIVE)
})

test('FLAG_NEGATIVE is DERIVED from the sign — an authored flag disagreeing with the delta is corrected', () => {
  // authored positive but flagged negative → the flag is stripped (the sign lives ONCE, in the value)
  expect(encode_effect({ kind: K_ALTER_STAT, stat: 0, value: 25, flags: FLAG_NEGATIVE }).flags).toBe(0)
  // authored negative but unflagged → the flag is set, other flag bits survive
  const debuff = encode_effect({ kind: K_ALTER_RESIST, value: -12, flags: FLAG_DISPELLABLE })
  expect(debuff.value).toBe(32756)
  expect(debuff.flags).toBe(FLAG_DISPELLABLE | FLAG_NEGATIVE)
})

test('a NON-signed kind passes its magnitude through verbatim — never centered', () => {
  expect(encode_effect({ kind: K_DAMAGE, element: 1, value: 42 }).value).toBe(42)
  expect(encode_effect({ kind: K_APPLY_DOT, element: 2, value: 7, turns: 3 }).value).toBe(7)
})

test('a negative value on a NON-signed kind is a REFUSAL (it has no wire encoding)', () => {
  expect(() => encode_effect({ kind: K_DAMAGE, value: -5 })).toThrow(/signed/i)
})

test('a signed delta outside the centered u16 domain is a REFUSAL, never a wrapped value', () => {
  expect(() => encode_effect({ kind: K_ALTER_STAT, value: SIGNED_DELTA_MIN - 1 })).toThrow(/delta/i)
  expect(() => encode_effect({ kind: K_ALTER_STAT, value: SIGNED_DELTA_MAX + 1 })).toThrow(/delta/i)
  expect(encode_effect({ kind: K_ALTER_STAT, value: SIGNED_DELTA_MIN }).value).toBe(0)
  expect(encode_effect({ kind: K_ALTER_STAT, value: SIGNED_DELTA_MAX }).value).toBe(65535)
})

test('the driver holds NO local 32768 constant — the centering has exactly one home', () => {
  const source = read_file(join(script_dir, 'apply_spells_payload.mjs'), 'utf8')
  const code = source
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n')
  expect(code).not.toMatch(/32_?768/)
  expect(source).toMatch(/encode_status_value/)
})

// ── ② THE KIT VECTOR SHAPE (mint's exact input, defaults mirrored from seed_spells_phase) ──────────

test('encode_spell_level mirrors the seeder defaults (LOS on, 255 cast limits, chance 100, element 255)', () => {
  const level = encode_spell_level({ ap_cost: 3, range_min: 1, range_max: 4, effects: [{ kind: K_DAMAGE, value: 12 }] })
  expect(level).toMatchObject({
    min_char_level: 1,
    ap_cost: 3,
    range_min: 1,
    range_max: 4,
    modifiable_range: false,
    line_launch: false,
    line_of_sight: true,
    free_cell: false,
    casts_per_turn: 255,
    casts_per_target: 255,
    cooldown_turns: 0,
    crit_rate: 0,
    ends_turn_on_fail: false,
    required_states: [],
    forbidden_states: [],
  })
  expect(level.effects[0]).toMatchObject({ kind: K_DAMAGE, element: 255, value: 12, chance: 100, phase: 0 })
  expect(level.crit_effects).toEqual([])
})

test('a glyph/DoT effect defaults to PHASE_START — the seeder KIND_PHASE table, verbatim', () => {
  expect(encode_effect({ kind: K_APPLY_DOT, value: 5, turns: 2 }).phase).toBe(1)
  expect(encode_effect({ kind: 20, value: 0, turns: 2 }).phase).toBe(1)
  expect(encode_effect({ kind: K_DAMAGE, value: 5 }).phase).toBe(0)
})

test('a kit over MAX_SPELLS is a REFUSAL — the setter mirrors mint’s bound, never weaker', () => {
  const level = { ap_cost: 3, effects: [{ kind: K_DAMAGE, value: 1 }] }
  expect(encode_kit(Array(MAX_SPELLS).fill(level))).toHaveLength(MAX_SPELLS)
  expect(() => encode_kit(Array(MAX_SPELLS + 1).fill(level))).toThrow(/MAX_SPELLS|4/)
  expect(encode_kit([])).toEqual([]) // an empty kit CLEARS the vector — a legal, deliberate write
})

// ── ③ THE READBACK ORACLE: chain json → the same canonical kit the payload encodes to ──────────────

const chain_level = (over = {}) => ({
  min_char_level: '1',
  ap_cost: '3',
  range_min: '1',
  range_max: '4',
  modifiable_range: false,
  line_launch: false,
  line_of_sight: true,
  free_cell: false,
  casts_per_turn: '255',
  casts_per_target: '255',
  cooldown_turns: '0',
  crit_rate: '0',
  ends_turn_on_fail: false,
  required_states: [],
  forbidden_states: [],
  effects: [
    {
      kind: '9',
      element: '255',
      value: '32810',
      area_shape: '0',
      area_size: '0',
      target_filter: '0',
      chance: '100',
      turns: '3',
      stat: '9',
      flags: '0',
      phase: '0',
    },
  ],
  crit_effects: [],
  ...over,
})

test('read_template_spells decodes a chain kit into the SAME canonical shape the encoder emits', () => {
  const chain = read_template_spells({ spells: [chain_level()] })
  const intended = encode_kit([
    {
      ap_cost: 3,
      range_min: 1,
      range_max: 4,
      effects: [{ kind: K_ALTER_STAT, stat: STAT_RAW_DAMAGE, value: 42, turns: 3 }],
    },
  ])
  expect(kits_equal(chain, intended)).toBe(true) // the fixed point a second DRY asserts
})

test('a kit that differs by ONE encoded field is NOT equal (the readback never rounds off a drift)', () => {
  const chain = read_template_spells({ spells: [chain_level({ effects: [{ ...chain_level().effects[0], value: '32809' }] })] })
  const intended = encode_kit([
    { ap_cost: 3, range_min: 1, range_max: 4, effects: [{ kind: K_ALTER_STAT, stat: STAT_RAW_DAMAGE, value: 42, turns: 3 }] },
  ])
  expect(kits_equal(chain, intended)).toBe(false)
})

test('read_template_spells tolerates the `.fields` nesting and returns null on a malformed row', () => {
  expect(read_template_spells({ fields: { spells: { fields: [chain_level()] } } })).toHaveLength(1)
  expect(read_template_spells({ spells: [{ ap_cost: '3' }] })).toBeNull()
  expect(read_template_spells({})).toBeNull()
  expect(read_template_spells(null)).toBeNull()
})

// ── ④ WIDTH: the command-cost arithmetic and its chunking boundaries ────────────────────────────────

test('set_spells_command_count counts the REAL PTB commands a kit expands to', () => {
  // per level: one new_effect per effect + one per crit effect + 2 makeMoveVec + 1 new_spell_level
  // per mob : + 1 makeMoveVec(levels) + 1 set_spells
  const kit = encode_kit([
    { ap_cost: 3, effects: [{ kind: K_DAMAGE, value: 1 }, { kind: K_DAMAGE, value: 2 }], crit_effects: [{ kind: K_DAMAGE, value: 3 }] },
    { ap_cost: 4, effects: [{ kind: K_DAMAGE, value: 1 }], crit_effects: [] },
  ])
  expect(set_spells_command_count(kit)).toBe(2 + (2 + 1 + 3) + (1 + 0 + 3)) // 14
  expect(set_spells_command_count([])).toBe(2) // an empty MoveVec + the setter — a kit CLEAR still costs 2
})

test('build_batches packs mobs under the COMMAND budget, never over it', () => {
  const kit_of = (effects) => encode_kit([{ ap_cost: 3, effects: Array(effects).fill({ kind: K_DAMAGE, value: 1 }) }])
  const changed = Array.from({ length: 40 }, (_, index) => ({ key: `mob_${index}`, id: id(index + 1), desired: kit_of(10) }))
  const batches = build_batches(changed)
  const cost = (batch) => batch.calls.reduce((sum, call) => sum + set_spells_command_count(call.desired), 0)
  for (const batch of batches) expect(cost(batch)).toBeLessThanOrEqual(MAX_COMMANDS_PER_PTB)
  expect(batches.flatMap((batch) => batch.calls).length).toBe(40) // every ruled mob planned exactly once
  expect(new Set(batches.flatMap((batch) => batch.calls.map((call) => call.key))).size).toBe(40)
})

test('build_batches honors the hard per-PTB mob cap even for tiny kits', () => {
  const changed = Array.from({ length: MAX_MOBS_PER_PTB * 3 }, (_, index) => ({
    key: `k${index}`,
    id: id(index + 1),
    desired: [],
  }))
  const batches = build_batches(changed)
  expect(batches).toHaveLength(3)
  for (const batch of batches) expect(batch.calls.length).toBeLessThanOrEqual(MAX_MOBS_PER_PTB)
})

test('a SINGLE kit richer than the whole budget is a REFUSAL — never a silently over-cap PTB', () => {
  const fat = encode_kit([
    { ap_cost: 3, effects: Array(MAX_COMMANDS_PER_PTB).fill({ kind: K_DAMAGE, value: 1 }) },
  ])
  expect(() => build_batches([{ key: 'fat', id: id(1), desired: fat }])).toThrow(/budget|commands/i)
})

// ── ⑤ THE PAYLOAD CONTRACT: keys resolve through the manifest, refusals are loud ────────────────────

const payload = (kits) => ({ kits })
const manifest = { wooling: { id: id(11) }, razkin: { id: id(12) } }

test('desired_kits resolves a mob KEY through the seed manifest and encodes its kit', () => {
  const { desired, invalid, unresolved } = desired_kits(
    payload({ wooling: { spells: [{ ap_cost: 3, effects: [{ kind: K_ALTER_STAT, stat: STAT_RAW_DAMAGE, value: 42 }] }] } }),
    manifest,
  )
  expect(invalid).toEqual([])
  expect(unresolved).toEqual([])
  expect(desired.wooling.id).toBe(id(11))
  expect(desired.wooling.kit[0].effects[0].value).toBe(32810)
})

test('an explicit template id in the payload row is honored (a key need not be in the manifest)', () => {
  const { desired, unresolved } = desired_kits(payload({ ghost: { id: id(99), spells: [] } }), manifest)
  expect(unresolved).toEqual([])
  expect(desired.ghost).toMatchObject({ id: id(99), kit: [] })
})

test('an unresolvable key is UNRESOLVED and an unencodable kit is INVALID — never a silent skip', () => {
  const out = desired_kits(
    payload({
      nobody: { spells: [] },
      wooling: { spells: [{ ap_cost: 3, effects: [{ kind: K_DAMAGE, value: -1 }] }] },
    }),
    manifest,
  )
  expect(out.unresolved).toEqual([{ key: 'nobody' }])
  expect(out.invalid).toHaveLength(1)
  expect(out.invalid[0].key).toBe('wooling')
  expect(out.desired).toEqual({})
})

test('a payload with no kits object is a REFUSAL (an empty ceremony is an authoring bug, not a no-op)', () => {
  expect(() => desired_kits({}, manifest)).toThrow(/kits/i)
})

// ── ⑥ THE DIFF + the coverage tooth + the mode/deployment gating (sibling parity) ───────────────────

test('diff_mob_spells buckets changed / unchanged / read_failed', () => {
  const kit = encode_kit([{ ap_cost: 3, effects: [{ kind: K_DAMAGE, value: 12 }] }])
  const chain_kit = read_template_spells({
    spells: [chain_level({ effects: [{ ...chain_level().effects[0], kind: '0', value: '12', stat: '0', turns: '0' }] })],
  })
  const desired = {
    same: { id: id(1), kit: chain_kit },
    moved: { id: id(2), kit },
    broken: { id: id(3), kit },
  }
  const diff = diff_mob_spells({
    desired_by_key: desired,
    chain_by_id: { [id(1)]: chain_kit, [id(2)]: [], [id(3)]: null },
  })
  expect(diff.unchanged.map((row) => row.key)).toEqual(['same'])
  expect(diff.changed.map((row) => row.key)).toEqual(['moved'])
  expect(diff.read_failed.map((row) => row.key)).toEqual(['broken'])
  expect(diff.total).toBe(3)
})

test('coverage_check refuses a ruled row that never reached a batch', () => {
  expect(coverage_check({ ruled: ['a', 'b'], planned: ['a', 'b'] }).ok).toBe(true)
  const gap = coverage_check({ ruled: ['a', 'b'], planned: ['a'] })
  expect(gap.ok).toBe(false)
  expect(gap.uncovered).toEqual(['b'])
  expect(coverage_check({ ruled: ['a'], planned: [] }).ok).toBe(false)
})

test('resolve_mode: DRY is the default, LIVE must be exactly 1', () => {
  expect(resolve_mode({}).live).toBe(false)
  expect(resolve_mode({ LIVE: '1' }).live).toBe(true)
  expect(() => resolve_mode({ LIVE: 'true' })).toThrow(/LIVE/)
})

test('deployment_from_release pins call targets at LATEST and the type tags at the foundation ORIGIN', () => {
  const deployment = deployment_from_release(release, 'testnet')
  const { testnet } = release.networks
  expect(deployment.call_package).toBe(testnet.packages.aresrpg.latest ?? testnet.packages.aresrpg.origin)
  expect(deployment.foundation_package).toBe(testnet.packages.foundation.latest ?? testnet.packages.foundation.origin)
  expect(deployment.foundation_type_package).toBe(testnet.packages.foundation.origin)
  expect(() => deployment_from_release(release, 'nowhere')).toThrow(/release\.json/)
})
