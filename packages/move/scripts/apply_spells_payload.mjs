// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// apply_spells_payload.mjs — apply an authored SPELL-KIT payload to live MobTemplates IN PLACE via the additive
// `aresrpg::mob_template::set_spells` setter (mob_template.move — the kit twin of `set_loot`; the readback getter
// is `mob_spells`). No burn/remint — the template ids never change, so world mob-tables, zone groups and running
// fights stay valid. DRY is the default; LIVE=1 signs.
//
//   NETWORK=testnet SPELLS_PAYLOAD=/abs/path/kits.json node packages/move/scripts/apply_spells_payload.mjs
//   NETWORK=testnet SPELLS_PAYLOAD=/abs/path/kits.json LIVE=1 node packages/move/scripts/apply_spells_payload.mjs
//
// CUSTODY: this is the GAME's generic spells-payload instrument. It carries NO content: every payload arrives as
// an external file named by `SPELLS_PAYLOAD`. Content payload fires (a corpus correction, a rebalance) travel
// through the seed ceremony's own pre-built instrument — two instruments aimed at the same templates in the same
// window is double-fire risk, so this one is never pre-loaded with a kit.
//
// SIBLINGS: apply_loot_payload.mjs (loot vector) and apply_xp_payload.mjs (stat surface) — same house: release-
// derived deployment, per-batch PTBs, the no-retry runner (`ceremony_lib.run`, `derive:false` + a fixed budget),
// the coverage tooth, LOUD integrity refusals. Peers, never libs of each other (a cross-script import collides on
// shared export names); only `ceremony_lib.mjs` is shared.
//
// ── THE PAYLOAD CONTRACT (the content pipeline's side of the seam) ─────────────────────────────────
// {
//   "network": "testnet",              // OPTIONAL — asserted against NETWORK; a mismatch is a refusal
//   "note": "free-text provenance",    // OPTIONAL — echoed in the run header
//   "kits": {                          // REQUIRED — mob key → the WHOLE kit (set_spells replaces the vector)
//     "<mob key>": {
//       "id": "0x…",                   // OPTIONAL — else resolved via out/seed_manifest.json `mobs[key].id`
//       "spells": [                    // ≤ MAX_SPELLS(4) SpellLevel rows; [] deliberately CLEARS the kit
//         { "ap_cost": 3, "range_min": 1, "range_max": 4,          // ap_cost REQUIRED; everything else defaults
//           "min_char_level": 1, "modifiable_range": false, "line_launch": false, "line_of_sight": true,
//           "free_cell": false, "casts_per_turn": 255, "casts_per_target": 255, "cooldown_turns": 0,
//           "crit_rate": 0, "ends_turn_on_fail": false, "required_states": [], "forbidden_states": [],
//           "effects":      [ { "kind": 9, "stat": 9, "value": 42, "turns": 3 } ],
//           "crit_effects": [] } ] } } }
// Every default mirrors `seed_spells_phase.mjs` (the mint path) verbatim, so a kit authored for a mint encodes
// identically here. `value` is AUTHORED, never wire-encoded — see the re-encoding below.
//
// ── THE RE-ENCODING (the door's own reason) ────────────────────────────────────────────────────────
// `Effect.value` is a u64, but alter_stat (9) and alter_resist (11) author BOTH signs, so the chain rides those
// two kinds CENTERED (#904 final ruling — the same convention gear ItemStatistics and mob resistances use; both
// runtimes read the SIGN off the centered value, never off FLAG_NEGATIVE). The payload therefore carries the REAL
// authored delta (+42, −17) and this driver encodes it at the wire door through `spell_wire.mjs`'s
// `encode_effect_value` — the ONE shared home every `new_effect` PTB encoder under packages/move/scripts/ now
// imports (#1250), itself riding the ONE decode home, `packages/fight/src/fight_status_snapshot.js`
// (`encode_status_value` / `is_signed_status_kind`). There is no local shift constant here on purpose: a second
// copy of that number is how the two dialects were born. `FLAG_NEGATIVE` is DERIVED from the delta's sign
// (never an independent authored fact) — an authored flag that disagrees with the sign is corrected, so the
// sign lives exactly once. Every default mirrors `seed_spells_phase.mjs` (the mint path) byte-identically BY
// CONSTRUCTION now — both ride the same `encode_effect_value`, not two hand-kept copies of the same rule.
//
// ── THE BATCH WIDTH (arithmetic, not a vibe) ────────────────────────────────────────────────────────
// A kit is command-DENSE and, unlike loot, VARIABLE: one set_spells expands to
//   Σ_levels (effects + crit_effects + 2 makeMoveVec + 1 new_spell_level) + 1 makeMoveVec(levels) + 1 set_spells
// — from 2 commands (a kit CLEAR) to ~80 (4 levels × 12 effects). A fixed mob count therefore either wastes the
// PTB (small kits) or breaches it (20 × 62 = 1240 > Sui's 1024-command cap), so the width is a COMMAND BUDGET:
// mobs are packed greedily while the running cost stays ≤ MAX_COMMANDS_PER_PTB, with a hard mob cap on top.
// 256 commands is a 4× margin under the 1024 cap and the binding constraint is BYTES, not commands: each
// `new_effect` carries 11 pure inputs, so 256 commands ≈ ≤250 effects ≈ ~11 KB of inputs — under 10% of the
// 128 KB tx-size cap (ceremony_lib's probe measured full spell rows at ~31 cmd/row breaching at n=40; a mob kit
// is a ≤4-level slice of that shape). A single kit richer than the whole budget is a REFUSAL, never a silently
// over-cap PTB.
import { readFileSync as read_file, existsSync as exists } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { Transaction } from '@mysten/sui/transactions'

import { encode_status_value, is_signed_status_kind } from '../../fight/src/fight_status_snapshot.js'
import release from '../../sdk/src/deployment/release.json' with { type: 'json' }
import {
  FLAG_DISPELLABLE,
  FLAG_NEGATIVE,
  K_ALTER_RESIST,
  K_ALTER_STAT,
  K_APPLY_DOT,
  K_DAMAGE,
  K_PLACE_GLYPH,
} from '../../sim/src/spell_effect.js'

import { getClient as get_client } from './ceremony_lib.mjs'
import { encode_effect_value } from './spell_wire.mjs'

export { FLAG_DISPELLABLE, FLAG_NEGATIVE, K_ALTER_RESIST, K_ALTER_STAT, K_APPLY_DOT, K_DAMAGE }

const script_dir = dirname(file_url_to_path(import.meta.url))
const read_json = (file_path) => JSON.parse(read_file(file_path, 'utf8'))

// ── constants ───────────────────────────────────────────────────────────────────────────────────
export const MAX_SPELLS = 4 // §17.21 — mob_template.move MAX_SPELLS (the setter mirrors mint's bound, never weaker)
export const MAX_COMMANDS_PER_PTB = 256 // the width budget — see THE BATCH WIDTH above
export const MAX_MOBS_PER_PTB = 16 // hard cap on top of the budget (a PTB of 16 kit CLEARs is still only 32 cmds)
export const GAS_BUDGET_MIST = 50_000_000 // fixed 0.05 SUI/PTB (D747 shape — the target isn't simulatable
// pre-ceremony and Sui charges ACTUAL, so a high fixed budget is safe; only a LOW one burns)
export const READ_PAGE = 50
export const MAX_U8 = 255
export const MAX_U16 = 65535
// The centered domain a signed delta must fit (the encoded value is a u16 on every other centered surface —
// gear ItemStatistics, mob resistances). Derived from the ONE dialect home, never from a local shift constant.
export const SIGNED_DELTA_MIN = -encode_status_value(K_ALTER_STAT, 0)
export const SIGNED_DELTA_MAX = MAX_U16 + SIGNED_DELTA_MIN
// The seeder's KIND_PHASE table (seed_spells_phase.mjs) — a glyph/DoT ticks at PHASE_START unless authored.
const KIND_PHASE = { [K_PLACE_GLYPH]: 1, [K_APPLY_DOT]: 1 }

const is_id = (value) => /^0x[0-9a-f]{64}$/i.test(value ?? '')
const lc_id = (value) => String(value ?? '').toLowerCase()

// ── pure helpers (exported, side-effect-free — fixture-tested) ────────────────────────────────────

/** A non-negative safe int within `max` (u8/u16/u64 domains) or throw — the caller buckets the row as invalid. */
export function to_int(value, what, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0 || number > max)
    throw new Error(`${what} ${JSON.stringify(value)} is not an integer in [0, ${max}]`)
  return number
}

const to_bool = (value, fallback = false) => (value == null ? fallback : value === true || value === 'true')

/**
 * One AUTHORED effect → the chain-dialect Effect (the exact 11 fields `new_effect` takes, in its argument
 * order). Signed kinds (9/11) ride CENTERED — encoded through the ONE dialect home — and their FLAG_NEGATIVE is
 * DERIVED from the delta's sign; every other kind carries a plain magnitude and its flags verbatim.
 */
export function encode_effect(effect) {
  const kind = to_int(effect?.kind, 'kind', MAX_U8)
  const delta = Number(effect?.value ?? 0)
  if (!Number.isSafeInteger(delta)) throw new Error(`effect value ${JSON.stringify(effect?.value)} is not an integer`)
  const signed = is_signed_status_kind(kind)
  if (!signed && delta < 0)
    throw new Error(`kind ${kind} is not a signed kind — a negative value (${delta}) has no wire encoding`)
  if (signed && (delta < SIGNED_DELTA_MIN || delta > SIGNED_DELTA_MAX))
    throw new Error(`signed delta ${delta} outside the centered domain [${SIGNED_DELTA_MIN}, ${SIGNED_DELTA_MAX}]`)
  const authored_flags = to_int(effect?.flags ?? 0, 'flags', MAX_U8)
  // the sign lives ONCE — in the value; the flag is re-derived, so an authored disagreement is corrected
  const { value, flags } = encode_effect_value(kind, delta, authored_flags)
  return {
    kind,
    element: to_int(effect?.element ?? 255, 'element', MAX_U8),
    value,
    area_shape: to_int(effect?.area_shape ?? 0, 'area_shape', MAX_U8),
    area_size: to_int(effect?.area_size ?? 0, 'area_size'),
    target_filter: to_int(effect?.target_filter ?? 0, 'target_filter', MAX_U8),
    chance: to_int(effect?.chance ?? 100, 'chance', MAX_U8),
    turns: to_int(effect?.turns ?? 0, 'turns', MAX_U8),
    stat: to_int(effect?.stat ?? 0, 'stat', MAX_U8),
    flags,
    phase: to_int(effect?.phase ?? KIND_PHASE[kind] ?? 0, 'phase', MAX_U8),
  }
}

/** One AUTHORED spell level → the canonical `new_spell_level` shape (defaults mirror the mint path verbatim). */
export function encode_spell_level(level) {
  if (level?.ap_cost == null) throw new Error('spell level missing ap_cost')
  return {
    min_char_level: to_int(level.min_char_level ?? 1, 'min_char_level', MAX_U16),
    ap_cost: to_int(level.ap_cost, 'ap_cost'),
    range_min: to_int(level.range_min ?? 0, 'range_min'),
    range_max: to_int(level.range_max ?? 0, 'range_max'),
    modifiable_range: to_bool(level.modifiable_range),
    line_launch: to_bool(level.line_launch),
    line_of_sight: to_bool(level.line_of_sight, true),
    free_cell: to_bool(level.free_cell),
    casts_per_turn: to_int(level.casts_per_turn ?? MAX_U8, 'casts_per_turn', MAX_U8),
    casts_per_target: to_int(level.casts_per_target ?? MAX_U8, 'casts_per_target', MAX_U8),
    cooldown_turns: to_int(level.cooldown_turns ?? 0, 'cooldown_turns', MAX_U8),
    crit_rate: to_int(level.crit_rate ?? 0, 'crit_rate'),
    ends_turn_on_fail: to_bool(level.ends_turn_on_fail),
    required_states: (level.required_states ?? []).map((state) => to_int(state, 'required_state', MAX_U16)),
    forbidden_states: (level.forbidden_states ?? []).map((state) => to_int(state, 'forbidden_state', MAX_U16)),
    effects: (level.effects ?? []).map(encode_effect),
    crit_effects: (level.crit_effects ?? []).map(encode_effect),
  }
}

/** An AUTHORED kit → the ≤MAX_SPELLS canonical vector `set_spells` receives. `[]` deliberately CLEARS the kit. */
export function encode_kit(spells) {
  const levels = spells ?? []
  if (!Array.isArray(levels)) throw new Error('`spells` must be an array of spell levels')
  if (levels.length > MAX_SPELLS) throw new Error(`kit of ${levels.length} exceeds MAX_SPELLS (${MAX_SPELLS})`)
  return levels.map(encode_spell_level)
}

/**
 * The payload → key → {id, kit} (the ruled set), with the two LOUD refusal buckets:
 *   unresolved  no `id` in the row and no manifest entry for the key   (LIVE blocker)
 *   invalid     the kit cannot be encoded (bad kind/value/width)       (LIVE blocker)
 * An unresolvable key is never a silent skip — it is a mob the payload names that this lineage cannot address.
 */
export function desired_kits(payload, manifest_mobs) {
  const kits = payload?.kits
  if (!kits || typeof kits !== 'object' || Array.isArray(kits))
    throw new Error('payload has no `kits` object — refusing (an empty ceremony is an authoring bug, not a no-op)')
  const desired = {}
  const invalid = []
  const unresolved = []
  for (const [key, row] of Object.entries(kits)) {
    const id = row?.id ?? manifest_mobs?.[key]?.id
    if (!is_id(id)) {
      unresolved.push({ key })
      continue
    }
    try {
      desired[key] = { id: lc_id(id), kit: encode_kit(row?.spells) }
    } catch (error) {
      invalid.push({ key, why: error.message })
    }
  }
  return { desired, invalid, unresolved }
}

/**
 * Read the spell kit off a mob-template gRPC json → the SAME canonical shape the encoder emits (so the readback
 * is a byte compare, not an interpretation). Fields are top-level with a `.fields` fallback, at every nesting
 * depth. null on absent/malformed — the caller buckets null as read_failed and refuses to touch that template
 * (never a blind overwrite of an unreadable kit).
 */
export function read_template_spells(template_json) {
  if (!template_json || typeof template_json !== 'object') return null
  const fields = template_json.fields ?? template_json
  const rows = fields.spells?.fields ?? fields.spells
  if (!Array.isArray(rows)) return null
  try {
    return rows.map((raw) => {
      const level = raw?.fields ?? raw
      if (level == null || typeof level !== 'object' || level.ap_cost == null) throw new Error('malformed spell level')
      const effects_of = (key) => {
        const list = level[key]?.fields ?? level[key]
        if (!Array.isArray(list)) throw new Error(`malformed ${key}`)
        return list.map((entry) => {
          const e = entry?.fields ?? entry
          if (e == null || typeof e !== 'object' || e.kind == null) throw new Error('malformed effect')
          return {
            kind: to_int(e.kind, 'kind', MAX_U8),
            element: to_int(e.element, 'element', MAX_U8),
            value: to_int(e.value, 'value'),
            area_shape: to_int(e.area_shape, 'area_shape', MAX_U8),
            area_size: to_int(e.area_size, 'area_size'),
            target_filter: to_int(e.target_filter, 'target_filter', MAX_U8),
            chance: to_int(e.chance, 'chance', MAX_U8),
            turns: to_int(e.turns, 'turns', MAX_U8),
            stat: to_int(e.stat, 'stat', MAX_U8),
            flags: to_int(e.flags, 'flags', MAX_U8),
            phase: to_int(e.phase, 'phase', MAX_U8),
          }
        })
      }
      const states_of = (key) => {
        const list = level[key]?.fields ?? level[key] ?? []
        return list.map((state) => to_int(state, key, MAX_U16))
      }
      return {
        min_char_level: to_int(level.min_char_level, 'min_char_level', MAX_U16),
        ap_cost: to_int(level.ap_cost, 'ap_cost'),
        range_min: to_int(level.range_min, 'range_min'),
        range_max: to_int(level.range_max, 'range_max'),
        modifiable_range: to_bool(level.modifiable_range),
        line_launch: to_bool(level.line_launch),
        line_of_sight: to_bool(level.line_of_sight),
        free_cell: to_bool(level.free_cell),
        casts_per_turn: to_int(level.casts_per_turn, 'casts_per_turn', MAX_U8),
        casts_per_target: to_int(level.casts_per_target, 'casts_per_target', MAX_U8),
        cooldown_turns: to_int(level.cooldown_turns, 'cooldown_turns', MAX_U8),
        crit_rate: to_int(level.crit_rate, 'crit_rate'),
        ends_turn_on_fail: to_bool(level.ends_turn_on_fail),
        required_states: states_of('required_states'),
        forbidden_states: states_of('forbidden_states'),
        effects: effects_of('effects'),
        crit_effects: effects_of('crit_effects'),
      }
    })
  } catch {
    return null
  }
}

/** Byte-identity of two canonical kits (both built by the constructors above — same key order, same types). */
export function kits_equal(current, desired) {
  if (!Array.isArray(current) || !Array.isArray(desired)) return false
  return JSON.stringify(current) === JSON.stringify(desired)
}

/** The REAL PTB command count one `set_spells` call expands to — the width arithmetic, executable. */
export function set_spells_command_count(kit) {
  const levels = (kit ?? []).reduce(
    (sum, level) => sum + level.effects.length + level.crit_effects.length + 3, // + 2 makeMoveVec + new_spell_level
    0,
  )
  return levels + 2 // + makeMoveVec(levels) + set_spells
}

/**
 * The pure diff both the DRY report and the LIVE plan consume — the ruled set is the PAYLOAD (this driver is
 * generic: nothing else declares intent). Buckets mirror the siblings:
 *   changed      kit differs from chain → {key, id, desired, current}   (the work set)
 *   unchanged    byte-identical                                         (rerun ⇒ idempotent; the FIXED POINT)
 *   read_failed  unreadable kit on chain                                (LIVE blocker)
 * Keys are taken SORTED so `limit` (a canary) trims deterministically.
 */
export function diff_mob_spells({ desired_by_key, chain_by_id, limit = null }) {
  const all_keys = Object.keys(desired_by_key ?? {}).sort()
  const keys = limit == null ? all_keys : all_keys.slice(0, Math.max(0, limit))
  const changed = []
  const unchanged = []
  const read_failed = []
  for (const key of keys) {
    const { id, kit } = desired_by_key[key]
    const current = chain_by_id?.[id]
    if (current == null) {
      read_failed.push({ key, id, why: 'spell kit unreadable on chain' })
      continue
    }
    if (kits_equal(current, kit)) {
      unchanged.push({ key, id })
      continue
    }
    changed.push({ key, id, desired: kit, current })
  }
  return { total: keys.length, changed, unchanged, read_failed }
}

/**
 * Chunk the changed set into PTBs under the COMMAND BUDGET (and the hard mob cap). Greedy: a mob joins the open
 * batch while the running cost fits, else it opens the next one. A single kit over the whole budget is a REFUSAL.
 */
export function build_batches(changed, budget = MAX_COMMANDS_PER_PTB, max_mobs = MAX_MOBS_PER_PTB) {
  const batches = []
  let open = null
  let cost = 0
  for (const { key, id, desired } of changed ?? []) {
    const call_cost = set_spells_command_count(desired)
    if (call_cost > budget)
      throw new Error(`${key} expands to ${call_cost} commands — over the ${budget}-command PTB budget (split the kit or raise the budget)`)
    if (!open || cost + call_cost > budget || open.calls.length >= max_mobs) {
      open = { label: `mob_spells:${batches.length + 1}`, calls: [] }
      cost = 0
      batches.push(open)
    }
    open.calls.push({ key, id, desired })
    cost += call_cost
  }
  return batches
}

/** THE COVERAGE TOOTH (seat rider 2026-07-20). ANY ruled key that never reached a batch — or zero planned
 * against nonzero ruled — is the "rows vanished invisibly" class: ok=false so the caller REFUSES loudly. */
export function coverage_check({ ruled, planned }) {
  const planned_set = new Set(planned)
  const uncovered = ruled.filter((key) => !planned_set.has(key))
  const covered_pct = ruled.length === 0 ? 100 : Math.round(((ruled.length - uncovered.length) / ruled.length) * 100)
  return {
    ruled_count: ruled.length,
    planned_count: planned.length,
    covered_pct,
    uncovered,
    ok: uncovered.length === 0 && !(ruled.length > 0 && planned.length === 0),
  }
}

export function resolve_mode(environment) {
  if (environment.LIVE != null && environment.LIVE !== '1') throw new Error('LIVE must be exactly 1 when set')
  return { live: environment.LIVE === '1' }
}

/** Release-derived call targets. `set_spells` resolves through aresrpg's LATEST; the levels/effects are built at
 * foundation's LATEST (`new_effect` / `new_spell_level` live there). The Effect/SpellLevel TYPE TAGS for
 * makeMoveVec use the foundation ORIGIN — types canonicalize to their defining (first-published) package, never
 * the upgraded one (the same split apply_loot_payload makes for MobLootEntry). */
export function deployment_from_release(release_config, network) {
  const network_release = release_config.networks?.[network]
  const ares = network_release?.packages?.aresrpg
  const foundation = network_release?.packages?.foundation
  const deployment = {
    call_package: ares?.latest ?? ares?.origin,
    foundation_package: foundation?.latest ?? foundation?.origin,
    foundation_type_package: foundation?.origin,
    admin: ares?.admin,
    version: network_release?.shared?.VERSION?.id,
    network,
  }
  for (const [field, value] of Object.entries(deployment))
    if (field !== 'network' && !is_id(value))
      throw new Error(`release.json has invalid ${field} id (network=${network})`)
  return deployment
}

// ── impure edges ──────────────────────────────────────────────────────────────────────────────────

/** Batched gRPC read of the spell kit for a list of template ids (client INJECTED). id → kit|null. */
export async function fetch_chain_spells(client, ids, page_size = READ_PAGE) {
  const state = {}
  for (let index = 0; index < ids.length; index += page_size) {
    const page = ids.slice(index, index + page_size)
    const { objects } = await client.getObjects({ objectIds: page, include: { json: true } })
    objects.forEach((object, page_index) => {
      state[page[page_index]] = object instanceof Error ? null : read_template_spells(object?.json ?? null)
    })
  }
  return state
}

/** One set_spells command: build each Effect and SpellLevel at foundation LATEST, collect into typed MoveVecs
 * (foundation ORIGIN type tags), then set the kit on the shared template. An empty kit = a MoveVec of zero
 * elements (a deliberate CLEAR). */
function set_spells_command(tx, deployment, call) {
  const effect_type = `${deployment.foundation_type_package}::spell_effect::Effect`
  const effect_vec = (effects) =>
    tx.makeMoveVec({
      type: effect_type,
      elements: effects.map((effect) =>
        tx.moveCall({
          target: `${deployment.foundation_package}::spell_effect::new_effect`,
          arguments: [
            tx.pure.u8(effect.kind),
            tx.pure.u8(effect.element),
            tx.pure.u64(BigInt(effect.value)),
            tx.pure.u8(effect.area_shape),
            tx.pure.u64(BigInt(effect.area_size)),
            tx.pure.u8(effect.target_filter),
            tx.pure.u8(effect.chance),
            tx.pure.u8(effect.turns),
            tx.pure.u8(effect.stat),
            tx.pure.u8(effect.flags),
            tx.pure.u8(effect.phase),
          ],
        }),
      ),
    })
  const levels = call.desired.map((level) =>
    tx.moveCall({
      target: `${deployment.foundation_package}::spell_effect::new_spell_level`,
      arguments: [
        tx.pure.u16(level.min_char_level),
        tx.pure.u64(BigInt(level.ap_cost)),
        tx.pure.u64(BigInt(level.range_min)),
        tx.pure.u64(BigInt(level.range_max)),
        tx.pure.bool(level.modifiable_range),
        tx.pure.bool(level.line_launch),
        tx.pure.bool(level.line_of_sight),
        tx.pure.bool(level.free_cell),
        tx.pure.u8(level.casts_per_turn),
        tx.pure.u8(level.casts_per_target),
        tx.pure.u8(level.cooldown_turns),
        tx.pure.u64(BigInt(level.crit_rate)),
        tx.pure.bool(level.ends_turn_on_fail),
        tx.pure.vector('u16', level.required_states),
        tx.pure.vector('u16', level.forbidden_states),
        effect_vec(level.effects),
        effect_vec(level.crit_effects),
      ],
    }),
  )
  const kit = tx.makeMoveVec({ type: `${deployment.foundation_type_package}::spell_effect::SpellLevel`, elements: levels })
  tx.moveCall({
    target: `${deployment.call_package}::mob_template::set_spells`,
    arguments: [tx.object(deployment.admin), tx.object(deployment.version), tx.object(call.id), kit],
  })
}

export function batch_tx(deployment, batch) {
  const tx = new Transaction()
  for (const call of batch.calls) set_spells_command(tx, deployment, call)
  return tx
}

const kit_shape = (kit) =>
  `${kit.length} level(s) / ${kit.reduce((sum, level) => sum + level.effects.length + level.crit_effects.length, 0)} effect(s)`

function sample_line(row) {
  return `  ${row.key} [${row.id.slice(0, 10)}…] ${kit_shape(row.current)} → ${kit_shape(row.desired)} · ${set_spells_command_count(row.desired)} cmds`
}

/** The readback oracle: re-read every planned template and assert its kit is byte-identical to the intended one.
 * Returns the rows that did NOT converge (empty = the fixed point a second DRY run also reads as 0 changed). */
async function readback_drift(client, planned_rows) {
  const chain = await fetch_chain_spells(client, planned_rows.map((row) => row.id))
  return planned_rows.filter((row) => !kits_equal(chain[row.id] ?? null, row.desired))
}

async function main() {
  const mode = resolve_mode(process.env)
  const network = process.env.NETWORK ?? 'testnet'
  const payload_path = process.env.SPELLS_PAYLOAD
  if (!payload_path) throw new Error('SPELLS_PAYLOAD=<path to the authored kit payload> is required (this driver carries no content)')
  const payload = read_json(resolve(payload_path))
  if (payload.network && payload.network !== network)
    throw new Error(`payload targets network ${payload.network} but NETWORK=${network} — refusing`)
  const manifest_path = join(script_dir, 'out', 'seed_manifest.json')
  const manifest_mobs = exists(manifest_path) ? (read_json(manifest_path).mobs ?? {}) : {}
  const { desired, invalid, unresolved } = desired_kits(payload, manifest_mobs)
  const deployment = deployment_from_release(release, network)

  const ids = Object.keys(desired).sort().map((key) => desired[key].id)
  const client = get_client(network)
  const chain_by_id = await fetch_chain_spells(client, ids)
  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : null
  const diff = diff_mob_spells({ desired_by_key: desired, chain_by_id, limit })

  const batches = build_batches(diff.changed)
  const planned = batches.flatMap((batch) => batch.calls.map((call) => call.key))
  const coverage = coverage_check({ ruled: diff.changed.map((row) => row.key), planned })
  const commands = diff.changed.reduce((sum, row) => sum + set_spells_command_count(row.desired), 0)

  console.log(`=== MOB SPELL PAYLOAD | ${mode.live ? 'LIVE' : 'DRY-RUN'} | network=${network} ===`)
  console.log(`payload=${resolve(payload_path)}${payload.note ? ` · note: ${payload.note}` : ''}`)
  console.log(`package=${deployment.call_package} foundation=${deployment.foundation_package} types=${deployment.foundation_type_package}`)
  console.log(
    `census: ${diff.total} payload kits · ${diff.changed.length} changed · ${diff.unchanged.length} unchanged · ` +
      `${diff.read_failed.length} read_failed · ${unresolved.length} unresolved · ${invalid.length} invalid`,
  )
  console.log(`encoding: signed kinds (alter_stat/alter_resist) centered via the ONE dialect home · FLAG_NEGATIVE derived from the sign`)
  console.log(`batches: ${batches.length} (≤${MAX_COMMANDS_PER_PTB} cmds, ≤${MAX_MOBS_PER_PTB} mobs/PTB) · ${commands} commands total · fixed gas=${GAS_BUDGET_MIST} MIST/PTB`)
  console.log(`coverage-report: ruled=${coverage.ruled_count} planned=${coverage.planned_count} covered=${coverage.covered_pct}%`)
  console.log(`readback: ${diff.unchanged.length}/${diff.total} kits already byte-identical to the intended encoding (0 changed = the fixed point)`)
  console.log('samples (kit shape, old→new):')
  for (const row of diff.changed.slice(0, 5)) console.log(sample_line(row))

  // THE COVERAGE TOOTH + integrity blockers — LOUD refusal, never a silent zero-drift or a partial LIVE run.
  if (!coverage.ok)
    throw new Error(
      `COVERAGE GAP — ${coverage.uncovered.length} ruled row(s) not planned: ${coverage.uncovered.slice(0, 20).join(', ')}` +
        (coverage.ruled_count > 0 && coverage.planned_count === 0 ? ' (ZERO planned against nonzero ruled)' : ''),
    )
  const blockers = [...diff.read_failed, ...unresolved, ...invalid]
  if (blockers.length)
    throw new Error(
      `INTEGRITY BLOCKERS — ${diff.read_failed.length} read_failed, ${unresolved.length} unresolved, ` +
        `${invalid.length} invalid. First: ${JSON.stringify(blockers.slice(0, 5))}`,
    )

  if (!batches.length) {
    console.log('=== ALREADY CONVERGED (0 changes — the payload is the fixed point on chain) ===')
    return
  }
  if (!mode.live) {
    console.log('=== DRY-RUN COMPLETE (nothing signed) — rerun with LIVE=1, then DRY again: it must read 0 changed ===')
    return
  }

  const { getSigner, run } = await import('./ceremony_lib.mjs')
  const signer = getSigner()
  console.log(`signer ${signer.getPublicKey().toSuiAddress()} (CLI keystore)`)
  for (const batch of batches) {
    const tx = batch_tx(deployment, batch)
    tx.setGasBudget(GAS_BUDGET_MIST) // fixed budget — run(derive:false) signs with it, throws on executed failure
    await run(client, signer, batch.label, tx, { derive: false })
  }

  // THE READBACK GATE — the applied kits are re-read and compared to the intended encoding, in this same run.
  const drift = await readback_drift(client, batches.flatMap((batch) => batch.calls))
  if (drift.length)
    throw new Error(
      `READBACK DRIFT — ${drift.length} template(s) do not carry the intended kit after apply: ${drift.map((row) => row.key).slice(0, 10).join(', ')}`,
    )
  console.log(`readback: ${planned.length}/${planned.length} applied kits byte-identical to the intended encoding`)
  console.log('=== MOB SPELL PAYLOAD APPLIED ===')
}

const is_main = process.argv[1] && resolve(process.argv[1]) === file_url_to_path(import.meta.url)
if (is_main)
  main().catch((error) => {
    console.error(`\nMOB SPELL PAYLOAD STOPPED: ${error.message}`)
    console.error('No automatic retry was attempted (a digest = gas burned — the tx-retry-burn law).')
    process.exitCode = 1
  })
