// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Resolver unit tests — offline, against the authored spell corpus joined to the current seed receipt. Proves
// the bar renders EXCLUSIVELY the on-chain spells a character can reach and every cast has an object id.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'bun:test'

import { act_cast_ptb } from '@aresrpg/sdk/fight'

import { resolve_class_spells, fight_spell, project_spell_level, spell_object_id } from './fight-spells.js'
import SEED_MANIFEST from '../../../../../move/scripts/out/seed_manifest.json' with { type: 'json' }

const OBJ_ID = /^0x[0-9a-f]{64}$/

// The resolver's slug rule (on-chain name → name_key), mirrored here as the parity oracle.
const to_name_key = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

const input_object_id = (inp) =>
  inp?.UnresolvedObject?.objectId ?? inp?.Object?.SharedObject?.objectId ?? inp?.Object?.ImmOrOwnedObject?.objectId ?? null

// MISSING-ARTIFACT (#117): seed/mainnet/spells is content-pipeline output, absent by design in this public
// repo — TWO consequences. (1) senshi.json itself (guarded dynamic import below) feeds the raw-corpus
// expectation helpers (senshi_upto/senshi_sorted). (2) resolve_class_spells/fight_spell/spell_object_id
// (the module under test) resolve through fight-spells.js's get_spell_corpus(), a runtime-fetched asset-host
// blob (data/spell_corpus.js) that only a boot sequence or the set_spell_corpus_for_test() seam populates —
// neither runs here, so it stays permanently [] and every real-content assertion below is gated the same way.
const SPELLS_DIR = fileURLToPath(new URL('../../../../../../seed/mainnet/spells', import.meta.url))
const SPELLS_SEED_AVAILABLE = existsSync(SPELLS_DIR)
const SENSHI_PATH = fileURLToPath(new URL('../../../../../../seed/mainnet/spells/senshi.json', import.meta.url))
const SENSHI_CORPUS_AVAILABLE = existsSync(SENSHI_PATH)
const SENSHI_CORPUS = SENSHI_CORPUS_AVAILABLE ? (await import('../../../../../../seed/mainnet/spells/senshi.json')).default : []

// Expected name_keys read straight off the corpus (full-corpus reseed: senshi ships 6 spells ≤ L10, not the
// old 3-spell QA set) — derived, not hardcoded, so the NEXT reseed can't silently re-stale this file.
const senshi_sorted = (lvl) => SENSHI_CORPUS.filter((s) => s.unlock <= lvl).sort((a, b) => a.unlock - b.unlock)
const senshi_upto = (lvl) => senshi_sorted(lvl).map((s) => to_name_key(s.name))

describe('resolve_class_spells', () => {
  it.skipIf(!SENSHI_CORPUS_AVAILABLE)('senshi at level 10 → every seeded spell ≤ L10, sorted by unlock, each with a real object id', () => {
    const spells = resolve_class_spells('senshi', 10)
    expect(spells.map((s) => s.name_key)).toEqual(senshi_upto(10))
    expect(spells.map((s) => s.unlock_level)).toEqual(senshi_sorted(10).map((s) => s.unlock))
    for (const s of spells) {
      expect(s.object_id).toMatch(OBJ_ID)
      expect(s.levels[0].ap).toBeGreaterThan(0) // real per-spell AP now (was a fixed 4 under the old QA set)
    }
  })

  it.skipIf(!SENSHI_CORPUS_AVAILABLE)('gates by unlock_level ≤ char level (UX hint — chain is the referee)', () => {
    expect(resolve_class_spells('senshi', 4).map((s) => s.name_key)).toEqual(senshi_upto(4))
    expect(resolve_class_spells('senshi', 5).map((s) => s.name_key)).toEqual(senshi_upto(5))
    expect(resolve_class_spells('senshi', 1).map((s) => s.name_key)).toEqual(senshi_upto(1))
  })

  it.skipIf(!SENSHI_CORPUS_AVAILABLE)('is case-insensitive on class id', () => {
    expect(resolve_class_spells('SENSHI', 10)).toHaveLength(senshi_upto(10).length)
  })

  it.skipIf(!SPELLS_SEED_AVAILABLE)('every seeded class resolves ≥1 spell; unknown/nullish/below-first-unlock still resolves to [] — no stub', () => {
    // the spell-kit seed now mints a starter kit for ALL classes (yajin included) — a class-WITH-spells is the
    // norm; only an UNKNOWN class id, a nullish id, or a level below the first unlock yields the empty bar (the
    // resolver's genuine empty branch, still exercised here — the weapon slot is what keeps that deck usable).
    expect(resolve_class_spells('yajin', 200).length).toBeGreaterThan(0)
    expect(resolve_class_spells('nope', 200)).toEqual([])
    expect(resolve_class_spells(null, 200)).toEqual([])
    expect(resolve_class_spells('senshi', 0)).toEqual([])
  })
})

describe('fight_spell / spell_object_id', () => {
  it.skipIf(!SPELLS_SEED_AVAILABLE)('resolves a name_key to its row + on-chain cast target', () => {
    const s = fight_spell('oathblade')
    expect(s?.name).toBe('Oathblade')
    expect(s?.element).toBe('air') // faithful Épée Divine (retro129:145) is air — 1:1 copy law, not the old hand-pin
    expect(spell_object_id('oathblade')).toMatch(OBJ_ID)
    expect(spell_object_id('mending_word')).toBe(fight_spell('mending_word')?.object_id)
  })

  it('returns null for an unknown / nullish name_key (never throws)', () => {
    // 'charge' is now a REAL seeded senshi spell (post full-corpus reseed) — use a slug no corpus spell has.
    expect(fight_spell('not_a_real_spell_slug')).toBeNull()
    expect(fight_spell(null)).toBeNull()
    expect(spell_object_id('nope')).toBeNull()
  })
})

describe('lossless chain spell projection', () => {
  it('preserves target_filter/flags and pairs repeated critical kinds by occurrence', () => {
    const projected = project_spell_level({
      min_char_level: 1,
      ap_cost: 4,
      range_min: 1,
      range_max: 3,
      // THE WIRE SHAPE (#951): a corpus row's magnitude is `value` / `value_max`. These rows used to carry
      // hand-written `damageMin`/`damageMax` fields the published corpus has never had — which is how the
      // missing value/value_max → damageMin/damageMax mapping stayed green while every tooltip rendered an
      // em dash. Captured bytes now gate that mapping (spell_tooltip_numbers.test.js).
      effects: [
        { kind: 0, value: 5, value_max: 14, turns: 2, target_filter: 1, flags: 4, chance: 100 },
        { kind: 0, value: 7, target_filter: 2, flags: 8, chance: 100 },
      ],
      crit_effects: [
        { kind: 0, value: 15, value_max: 24, target_filter: 16, flags: 1, chance: 100 },
        { kind: 0, value: 13, target_filter: 32, flags: 2, chance: 100 },
      ],
    })

    expect(projected.effects[0]).toMatchObject({
      kind: 'DAMAGE',
      kind_id: 0,
      target_filter: 1,
      flags: 4,
      damageMin: 5,
      damageMax: 14,
      turns: 2,
      crit_base: 15,
      crit_effect: {
        kind: 'DAMAGE',
        kind_id: 0,
        target_filter: 16,
        flags: 1,
        base: 15,
        damageMin: 15,
        damageMax: 24,
      },
    })
    // an equal-bound row (no value_max) collapses to one number rather than losing its magnitude
    expect(projected.effects[1]).toMatchObject({
      kind: 'DAMAGE',
      kind_id: 0,
      target_filter: 2,
      flags: 8,
      damageMin: 7,
      damageMax: 7,
      crit_base: 13,
      crit_effect: { kind: 'DAMAGE', kind_id: 0, target_filter: 32, flags: 2, base: 13, damageMin: 13, damageMax: 13 },
    })
  })
})

// ── B7 STALE-CAST GUARD — the cast target MUST be the LIVE seed_manifest id ────────────────────────────────
// B7 regression (lineage-6): a FRESH publish re-mints every SpellTemplate under a NEW type origin, so a stale
// an object_id copied into a client artifact points at the OLD-lineage object — act_cast then dry-runs
// CommandArgumentError TypeMismatch on arg 2 (spell: &SpellTemplate) and NO cast ever commits (fights
// unwinnable). The OBJ_ID regex above passes a stale-but-well-formed id; only equality to the seed_manifest
// SSOT catches the drift. The resolver now performs this receipt/corpus join directly at module load.
describe('lineage parity — every cast target equals the seed_manifest SSOT', () => {
  it.skipIf(!SPELLS_SEED_AVAILABLE)('EVERY live-corpus spell object_id equals its seed_manifest.json entry (240 kit spells)', () => {
    // The manifest is a lineage LEDGER: it also keeps the ORPHANED pre-kit rows (harmless — the app only
    // reads the live corpus), so parity binds every entry the resolver actually serves, and the served
    // set must be the full 240-spell kit.
    const manifest_spells = SEED_MANIFEST.spells ?? {}
    // Orphan detection is ID-aware: an orphaned pre-kit row may share a DISPLAY name with a live kit
    // spell (Cauterize / Vanish / …), so its name_key resolves — to the NEW id. A LIVE entry is one
    // whose id the resolver actually serves; every such entry must round-trip exactly, count 240.
    const served = new Set()
    for (const cls of ['senshi', 'yajin', 'ikari', 'mori', 'tokei', 'shugo', 'yogen', 'rojin', 'shusen', 'tomoda', 'asobi', 'iyashi'])
      for (const s of resolve_class_spells(cls, 200)) served.add(s.object_id)
    let live = 0
    for (const entry of Object.values(manifest_spells)) {
      if (!served.has(entry.id)) continue // orphaned pre-kit lineage row (its id is never served)
      expect(spell_object_id(to_name_key(entry.name))).toBe(entry.id)
      live += 1
    }
    expect(live).toBe(240)
  })
})

describe('act_cast composes with the RESOLVED id in arg 2 (the exact arg that TypeMismatched)', () => {
  it.skipIf(!SPELLS_SEED_AVAILABLE)('senshi Warcleave → actions::act_cast, 6 args, arg[2] = the live-lineage SpellTemplate id', () => {
    const spell_id = spell_object_id('warcleave')
    expect(spell_id).toBe(SEED_MANIFEST.spells['senshi:1:senshi_warcleave'].id) // the witness's cast, seed-manifest truth

    const tx = act_cast_ptb({ network: 'testnet' })({
      fight_id: `0x${'1'.repeat(64)}`,
      character_id: `0x${'2'.repeat(64)}`,
      spell_template_id: spell_id,
      target_cell: 205,
    })

    const data = tx.getData()
    expect(data.commands).toHaveLength(1)
    const call = data.commands[0].MoveCall
    expect(`${call.module}::${call.function}`).toBe('actions::act_cast')
    expect(call.arguments).toHaveLength(6) // fight, character_id, spell, target_cell, ENGINE_VERSION, clock

    const spell_arg = call.arguments[2] // arg 2 — the &SpellTemplate that TypeMismatched pre-fix
    expect(spell_arg.$kind).toBe('Input')
    expect(BigInt(input_object_id(data.inputs[spell_arg.Input]))).toBe(BigInt(spell_id))
  })
})
