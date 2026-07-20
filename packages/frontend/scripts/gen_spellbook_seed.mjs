#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// gen_spellbook_seed.mjs — GENERATE the grimoire's display SSOT from the on-chain spell seed.
//
// WHY: the SPELLS-tab grimoire must render the EXACT spells the chain was seeded with (D53) — never a
// hand-written or legacy-registry-derived table that can drift into invented mechanics. The single source of
// truth for the seed is `packages/move/scripts/seed_spells.js` (its `BOOKS` balance table, 1:1 with the Move
// `spell_registry` builders — the chain was seeded from that file). This script PARSES that `BOOKS` table and
// re-encodes each archetype's builder semantics (the same field→level mapping the Move helpers apply) into a
// flat JSON the frontend imports. Balance numbers come straight from `BOOKS`, so the grimoire cannot drift.
//
// OUTPUT: src/game/screens/hud/spellbook-seed.json — 12 spells, each with id / class / name_key / unlock_tier
// and 6 levels { min_char_level, ap, range, cooldown, crit_rate (1-in-N), effects[] }. Effects use ONLY the
// true effect taxonomy with FIXED values (no ranges): DAMAGE {element, base, crit_base}, PUSH {n}, TELEPORT,
// INVISIBILITY {turns}, GIVE_MP {n}, ALTER_STAT {stat, amount, turns}, REDUCE_DAMAGE {element, flat, turns},
// ALTER_RESIST {pct, turns, all}, PLACE_TRAP {payload: DAMAGE earth base/crit}.
//
// DETERMINISTIC: no timestamps, stable key order, trailing newline — re-running produces an identical file.
// Run: `bun run gen:spellbook` (wired in package.json).

import { readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEED_SRC = resolve(__dirname, '../../move/scripts/seed_spells.js')
const OUT = resolve(__dirname, '../src/game/screens/hud/spellbook-seed.json')
const SEED_REL = 'packages/move/scripts/seed_spells.js'

// ── parse the BOOKS balance table out of the seed script (pure data — numbers + labels only) ──────────────
// BOOKS closes with a `]` at column 0; every inner `]` is mid-line or indented, so the first `\n]` is the
// outer close. `new Function` compiles the captured literal (JS line-comments inside it are stripped at parse).
const src = readFileSync(SEED_SRC, 'utf8')
const match = src.match(/const BOOKS = (\[[\s\S]*?\n\])/)
if (!match) throw new Error(`could not locate the BOOKS table in ${SEED_REL}`)
/** @type {Array<{id:number, class_id:number, label:string, kind:string, el?:string, rows:number[][]}>} */
const BOOKS = new Function(`return ${match[1]}`)()
if (BOOKS.length !== 12) throw new Error(`expected 12 books, parsed ${BOOKS.length}`)

// class discriminant → lowercase class id (spell_registry.move: senshi 0 · yajin 1 · tomoda 2 · shugo 3).
const CLASS = ['senshi', 'yajin', 'tomoda', 'shugo']
// seed el_* getter name → the frontend's lowercase element key (el_none = neutral / non-elemental).
const EL = { el_fire: 'fire', el_water: 'water', el_earth: 'earth', el_air: 'air', el_none: 'neutral' }

const damage = (element, base, crit_base) => ({ kind: 'DAMAGE', element, base, crit_base })

// ── per-archetype level builders — MIRROR the seed_spells.js `*_lvl` helpers, field for field ────────────
// Each takes the book's 6-row array's ONE row and emits the level's { …, effects[] }. The structural constants
// (fixed AP / range / cooldown / effect turns a builder hardcodes) are transcribed from the matching helper;
// the per-level BALANCE (everything that varies row to row) is read straight from the parsed row.
const LEVEL = {
  // dmg_lvl(fire/earth/water, [min_cl, ap, rmin, rmax, base, crit, rate]) — los dmg, cd 0
  dmg: (el, [min_cl, ap, rmin, rmax, base, crit, rate]) => ({
    min_char_level: min_cl,
    ap,
    range: [rmin, rmax],
    cooldown: 0,
    crit_rate: rate,
    effects: [damage(EL[el], base, crit)],
  }),
  // shove_lvl([min_cl, ap, dmg, dmg_crit, push, push_crit, rate]) — rng 1-1, neutral dmg + pushback, cd 0.
  // PUSH surfaces the base knockback (n); the crit push variant is not a display fact.
  shove: (_el, [min_cl, ap, dmg, dmg_crit, push, _push_crit, rate]) => ({
    min_char_level: min_cl,
    ap,
    range: [1, 1],
    cooldown: 0,
    crit_rate: rate,
    effects: [damage('neutral', dmg, dmg_crit), { kind: 'PUSH', n: push }],
  }),
  // warleap_lvl([min_cl, ap, rmax]) — rng 1-rmax teleport, non-critable, cd 0
  warleap: (_el, [min_cl, ap, rmax]) => ({
    min_char_level: min_cl,
    ap,
    range: [1, rmax],
    cooldown: 0,
    crit_rate: 0,
    effects: [{ kind: 'TELEPORT' }],
  }),
  // shadowveil_lvl([min_cl, mp, cd]) — ap 2, self (rng 0-0), invis 3 turns + self MP
  shadowveil: (_el, [min_cl, mp, cd]) => ({
    min_char_level: min_cl,
    ap: 2,
    range: [0, 0],
    cooldown: cd,
    crit_rate: 0,
    effects: [
      { kind: 'INVISIBILITY', turns: 3 },
      { kind: 'GIVE_MP', n: mp },
    ],
  }),
  // snare_lvl([min_cl, rmax, base, crit]) — ap 2, rng 1-rmax, trap with an earth damage payload
  snare: (_el, [min_cl, rmax, base, crit]) => ({
    min_char_level: min_cl,
    ap: 2,
    range: [1, rmax],
    cooldown: 0,
    crit_rate: 0,
    effects: [{ kind: 'PLACE_TRAP', payload: damage('earth', base, crit) }],
  }),
  // beast_roar_lvl([min_cl, ap, rmax, raw]) — rng 1-rmax, cd 5, +raw_damage buff for 2 turns
  beast_roar: (_el, [min_cl, ap, rmax, raw]) => ({
    min_char_level: min_cl,
    ap,
    range: [1, rmax],
    cooldown: 5,
    crit_rate: 0,
    effects: [{ kind: 'ALTER_STAT', stat: 'raw_damage', amount: raw, turns: 2 }],
  }),
  // stoneward_lvl([min_cl, absorb]) — ap 2, self (rng 0-0), cd 5, absorb flat earth damage for 4 turns
  stoneward: (_el, [min_cl, absorb]) => ({
    min_char_level: min_cl,
    ap: 2,
    range: [0, 0],
    cooldown: 5,
    crit_rate: 0,
    effects: [{ kind: 'REDUCE_DAMAGE', element: 'earth', flat: absorb, turns: 4 }],
  }),
  // bulwark_lvl([min_cl, ap, pct]) — rng 0-1, cd 6, +pct resistance to ALL elements for 4 turns
  bulwark: (_el, [min_cl, ap, pct]) => ({
    min_char_level: min_cl,
    ap,
    range: [0, 1],
    cooldown: 6,
    crit_rate: 0,
    effects: [{ kind: 'ALTER_RESIST', pct, turns: 4, all: true }],
  }),
}

const spells = BOOKS.map((book) => {
  const build = LEVEL[book.kind]
  if (!build) throw new Error(`unknown archetype kind '${book.kind}' for spell id ${book.id}`)
  const levels = book.rows.map((row) => build(book.el, row))
  return {
    id: book.id,
    class: CLASS[book.class_id],
    name_key: book.label,
    unlock_tier: levels[0].min_char_level, // MVP-12: every starter unlocks at character level 1
    levels,
  }
})

const out = {
  _generated: `GENERATED by packages/frontend/scripts/gen_spellbook_seed.mjs from ${SEED_REL} — DO NOT EDIT. Run \`bun run gen:spellbook\`.`,
  spells,
}

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)
console.log(`✓ wrote ${spells.length} spells → ${resolve(OUT)}`)
