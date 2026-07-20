// SEED-LEG #0 — the MVP-12 spell seed (#57 size-split de-inline). 12 `spell_registry::add_spell` PTBs, the
// 1:1 TRANSLATION of the `#[test_only]` builders in sources/spell/spell_registry.move (the in-repo SSOT the
// test suite still seeds from — reviewed line-by-line against it; any drift here is a defect).
//
// ZERO MAGIC NUMBERS: every enum-ish argument (element / kind / shape / target-filter / phase / flag / stat /
// point-kind) is fetched IN-PTB from the published foundation package's own getter functions and fed as a
// result handle — the numbers literally come from the chain's source of truth, so this script cannot encode a
// stale constant. Only the BALANCE numbers (AP, ranges, damages, crit rates, cooldowns, min_char_level) are
// inlined — transcribed verbatim from the SSOT builders.
//
// SIGNER: `add_spell` is AdminCap-gated (admin.verify) — the ADMINCAP HOLDER signs (post-publish).
// Idempotent: a re-run hits ESpellExists (302) on landed ids → logged + skipped, resume-safe.
//
// Env:
//   PRIVATE_KEY  — the AdminCap holder's exported key (runs locally, never committed)
//   CORE_PKG     — the fresh core `aresrpg` package id
//   FOUNDATION_PKG — the fresh `aresrpg_foundation` package id
//   SPELL_REGISTRY — the shared SpellRegistry object id (core init)
//   ADMIN_CAP    — the AdminCap holder's object id
//   VERSION      — the shared Version object id
//
//   CORE_PKG=0x… FOUNDATION_PKG=0x… SPELL_REGISTRY=0x… ADMIN_CAP=0x… VERSION=0x… \
//   PRIVATE_KEY=… bun run packages/move/scripts/seed_spells.js
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'

import { keypair, sui_client } from './client.js'

const CORE = process.env.CORE_PKG
const FND = process.env.FOUNDATION_PKG
const REGISTRY = process.env.SPELL_REGISTRY
const ADMIN_CAP = process.env.ADMIN_CAP
const VERSION = process.env.VERSION
if (!CORE || !FND || !REGISTRY || !ADMIN_CAP || !VERSION)
  throw new Error('missing env: CORE_PKG / FOUNDATION_PKG / SPELL_REGISTRY / ADMIN_CAP / VERSION')

const EFFECT_T = `${FND}::spell_effect::Effect`
const LEVEL_T = `${FND}::spell_effect::SpellLevel`

async function run(label, build) {
  const tx = new Transaction()
  tx.moveCall({ target: `${CORE}::header::aresrpg` })
  build(tx)
  const res = await sui_client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  })
  await sui_client.waitForTransaction({ digest: res.digest })
  const status = res.effects?.status
  if (status?.status !== 'success') {
    // ESpellExists = 302 → already landed (resume) — skip, never fail the leg.
    if (String(status?.error ?? '').includes('302')) {
      console.log(`~ ${label} already landed (ESpellExists) — skipped`)
      return
    }
    throw new Error(`${label} FAILED (${res.digest}): ${JSON.stringify(status)}`)
  }
  console.log(`✓ ${label} ${res.digest}`)
}

/** Per-PTB memoized getter handles — each foundation getter is called at most once per tx. */
function getters(tx) {
  const cache = new Map()
  const call = (mod, fn) => {
    const key = `${mod}::${fn}`
    if (!cache.has(key)) cache.set(key, tx.moveCall({ target: `${FND}::${mod}::${fn}` }))
    return cache.get(key)
  }
  return {
    el_fire: () => call('spell', 'el_fire'),
    el_water: () => call('spell', 'el_water'),
    el_earth: () => call('spell', 'el_earth'),
    el_air: () => call('spell', 'el_air'),
    el_none: () => call('spell', 'el_none'),
    k_teleport: () => call('spell_effect', 'k_teleport'),
    k_invisibility: () => call('spell_effect', 'k_invisibility'),
    k_reduce_damage: () => call('spell_effect', 'k_reduce_damage'),
    k_alter_resist: () => call('spell_effect', 'k_alter_resist'),
    shape_point: () => call('spell_effect', 'shape_point'),
    tf_none: () => call('spell_effect', 'tf_none'),
    tf_not_enemy: () => call('spell_effect', 'tf_not_enemy'),
    phase_on_enter: () => call('spell_effect', 'phase_on_enter'),
    flag_percent: () => call('spell_effect', 'flag_percent'),
    stat_raw_damage: () => call('spell_effect', 'stat_raw_damage'),
    point_mp: () => call('spell_effect', 'point_mp'),
  }
}

const u8 = (tx, v) => tx.pure.u8(v)
const u16 = (tx, v) => tx.pure.u16(v)
const u64 = (tx, v) => tx.pure.u64(v)
const boolean = (tx, v) => tx.pure.bool(v)
const empty_u16_vec = tx => tx.pure(bcs.vector(bcs.u16()).serialize([]))

// ── effect builders — MIRROR spell_registry.move's #[test_only] helpers, argument for argument ──────────────

// teleport_fx(): new_effect(k_teleport, el_none, 0, shape_point, 0, tf_none, 100, 0, 0, 0, phase_on_enter)
const teleport_fx = (tx, g) =>
  tx.moveCall({
    target: `${FND}::spell_effect::new_effect`,
    arguments: [
      g.k_teleport(), g.el_none(), u64(tx, 0), g.shape_point(), u64(tx, 0),
      g.tf_none(), u8(tx, 100), u8(tx, 0), u8(tx, 0), u8(tx, 0), g.phase_on_enter(),
    ],
  })

// invis_fx(turns): new_effect(k_invisibility, el_none, 0, shape_point, 0, tf_not_enemy, 100, turns, 0, 0, phase_on_enter)
const invis_fx = (tx, g, turns) =>
  tx.moveCall({
    target: `${FND}::spell_effect::new_effect`,
    arguments: [
      g.k_invisibility(), g.el_none(), u64(tx, 0), g.shape_point(), u64(tx, 0),
      g.tf_not_enemy(), u8(tx, 100), u8(tx, turns), u8(tx, 0), u8(tx, 0), g.phase_on_enter(),
    ],
  })

// reduce_fx(element, flat, turns): new_effect(k_reduce_damage, element, flat, shape_point, 0, tf_not_enemy, 100, turns, 0, 0, phase_on_enter)
const reduce_fx = (tx, g, element, flat, turns) =>
  tx.moveCall({
    target: `${FND}::spell_effect::new_effect`,
    arguments: [
      g.k_reduce_damage(), element, u64(tx, flat), g.shape_point(), u64(tx, 0),
      g.tf_not_enemy(), u8(tx, 100), u8(tx, turns), u8(tx, 0), u8(tx, 0), g.phase_on_enter(),
    ],
  })

// resist_fx(element, pct, turns): new_effect(k_alter_resist, element, pct, shape_point, 0, tf_not_enemy, 100, turns, 0, flag_percent, phase_on_enter)
const resist_fx = (tx, g, element, pct, turns) =>
  tx.moveCall({
    target: `${FND}::spell_effect::new_effect`,
    arguments: [
      g.k_alter_resist(), element, u64(tx, pct), g.shape_point(), u64(tx, 0),
      g.tf_not_enemy(), u8(tx, 100), u8(tx, turns), u8(tx, 0), g.flag_percent(), g.phase_on_enter(),
    ],
  })

// spell_effect convenience constructors (already public, called directly like the Move helpers do)
const damage = (tx, element, base) =>
  tx.moveCall({ target: `${FND}::spell_effect::damage`, arguments: [element, u64(tx, base)] })
const push = (tx, n) => tx.moveCall({ target: `${FND}::spell_effect::push`, arguments: [u64(tx, n)] })
const give_points = (tx, g, n) =>
  tx.moveCall({ target: `${FND}::spell_effect::give_points`, arguments: [g.point_mp(), u64(tx, n)] })
const place_trap = (tx, g) =>
  tx.moveCall({ target: `${FND}::spell_effect::place_trap`, arguments: [g.shape_point(), u64(tx, 0)] })
const alter_stat = (tx, g, amount, negative, dispellable, turns) =>
  tx.moveCall({
    target: `${FND}::spell_effect::alter_stat`,
    arguments: [g.stat_raw_damage(), u64(tx, amount), boolean(tx, negative), boolean(tx, dispellable), u8(tx, turns)],
  })

const fx_vec = (tx, elements) => tx.makeMoveVec({ type: EFFECT_T, elements })

// new_spell_level(min_char_level, ap, rmin, rmax, modifiable_range, line_launch, los, free_cell,
//                 casts_per_turn, casts_per_target, cooldown, crit_rate, ends_turn_on_fail, req_states,
//                 forb_states, effects, crit_effects)
const new_level = (tx, { min_cl, ap, rmin, rmax, mod_range, line, los, free, cpt, cpta, cd, crit_rate, fx, crit_fx }) =>
  tx.moveCall({
    target: `${FND}::spell_effect::new_spell_level`,
    arguments: [
      u16(tx, min_cl), u64(tx, ap), u64(tx, rmin), u64(tx, rmax),
      boolean(tx, mod_range), boolean(tx, line), boolean(tx, los), boolean(tx, free),
      u8(tx, cpt), u8(tx, cpta), u8(tx, cd), u64(tx, crit_rate), boolean(tx, false),
      empty_u16_vec(tx), empty_u16_vec(tx),
      fx_vec(tx, fx), fx_vec(tx, crit_fx),
    ],
  })

// ── per-archetype level builders — MIRROR the Move helpers exactly ───────────────────────────────────────────

// dmg_lvl(min_cl, element, ap, rmin, rmax, base, crit, crit_rate): (…, false,false,true,false, 255,255, 0, crit_rate, …)
const dmg_lvl = (tx, g, el, [min_cl, ap, rmin, rmax, base, crit, crit_rate]) =>
  new_level(tx, {
    min_cl, ap, rmin, rmax, mod_range: false, line: false, los: true, free: false,
    cpt: 255, cpta: 255, cd: 0, crit_rate,
    fx: [damage(tx, el, base)], crit_fx: [damage(tx, el, crit)],
  })

// shove_lvl(min_cl, ap, dmg, dmg_crit, push, push_crit, crit_rate): rng 1-1, line_launch T, los T
const shove_lvl = (tx, g, [min_cl, ap, dmg_v, dmg_crit, push_v, push_crit, crit_rate]) =>
  new_level(tx, {
    min_cl, ap, rmin: 1, rmax: 1, mod_range: false, line: true, los: true, free: false,
    cpt: 255, cpta: 255, cd: 0, crit_rate,
    fx: [damage(tx, g.el_none(), dmg_v), push(tx, push_v)],
    crit_fx: [damage(tx, g.el_none(), dmg_crit), push(tx, push_crit)],
  })

// warleap_lvl(min_cl, ap, rmax): rng 1-rmax, free_cell T, los F, non-critable
const warleap_lvl = (tx, g, [min_cl, ap, rmax]) =>
  new_level(tx, {
    min_cl, ap, rmin: 1, rmax, mod_range: false, line: false, los: false, free: true,
    cpt: 255, cpta: 255, cd: 0, crit_rate: 0,
    fx: [teleport_fx(tx, g)], crit_fx: [],
  })

// shadowveil_lvl(min_cl, mp, cd): ap 2, rng 0-0, self, invis(3) + give MP
const shadowveil_lvl = (tx, g, [min_cl, mp, cd]) =>
  new_level(tx, {
    min_cl, ap: 2, rmin: 0, rmax: 0, mod_range: false, line: false, los: false, free: false,
    cpt: 255, cpta: 255, cd, crit_rate: 0,
    fx: [invis_fx(tx, g, 3), give_points(tx, g, mp)], crit_fx: [],
  })

// snare_lvl(min_cl, rmax, cpt, base, crit): ap 2, rng 1-rmax, free_cell T, trap + earth payload sibling.
// D117 delta: casts/turn ramps 1..6 (was 255 — unlimited traps), mirroring the Move SSOT builder 1:1.
const snare_lvl = (tx, g, [min_cl, rmax, cpt, base, crit]) =>
  new_level(tx, {
    min_cl, ap: 2, rmin: 1, rmax, mod_range: false, line: false, los: false, free: true,
    cpt, cpta: 255, cd: 0, crit_rate: 0,
    fx: [place_trap(tx, g), damage(tx, g.el_earth(), base)],
    crit_fx: [damage(tx, g.el_earth(), crit)],
  })

// beast_roar_lvl(min_cl, ap, rmax, raw): rng 1-rmax, los T, cd 5, alter_stat(raw_damage, raw, false, true, 2)
const beast_roar_lvl = (tx, g, [min_cl, ap, rmax, raw]) =>
  new_level(tx, {
    min_cl, ap, rmin: 1, rmax, mod_range: false, line: false, los: true, free: false,
    cpt: 255, cpta: 255, cd: 5, crit_rate: 0,
    fx: [alter_stat(tx, g, raw, false, true, 2)], crit_fx: [],
  })

// stoneward_lvl(min_cl, absorb): ap 2, rng 0-0, cd 5, reduce_fx(earth, absorb, 4)
const stoneward_lvl = (tx, g, [min_cl, absorb]) =>
  new_level(tx, {
    min_cl, ap: 2, rmin: 0, rmax: 0, mod_range: false, line: false, los: false, free: false,
    cpt: 255, cpta: 255, cd: 5, crit_rate: 0,
    fx: [reduce_fx(tx, g, g.el_earth(), absorb, 4)], crit_fx: [],
  })

// bulwark_lvl(min_cl, ap, pct): rng 0-1, cd 6, resist_fx ×5 (fire/water/earth/air/none, pct, 4)
const bulwark_lvl = (tx, g, [min_cl, ap, pct]) =>
  new_level(tx, {
    min_cl, ap, rmin: 0, rmax: 1, mod_range: false, line: false, los: false, free: false,
    cpt: 255, cpta: 255, cd: 6, crit_rate: 0,
    fx: [
      resist_fx(tx, g, g.el_fire(), pct, 4),
      resist_fx(tx, g, g.el_water(), pct, 4),
      resist_fx(tx, g, g.el_earth(), pct, 4),
      resist_fx(tx, g, g.el_air(), pct, 4),
      resist_fx(tx, g, g.el_none(), pct, 4),
    ],
    crit_fx: [],
  })

// ── the 12 books — BALANCE TABLES transcribed VERBATIM from the SSOT *_levels() builders ────────────────────
// classes: senshi 0 · yajin 1 · tomoda 2 · shugo 3. min_char_level: L1-L5 = 1, L6 = 101.

const BOOKS = [
  // fire_strike (id 1, senshi) — dmg_lvl(min_cl, fire, ap, rmin, rmax, base, crit, rate)
  { id: 1, class_id: 0, label: 'fire_strike', kind: 'dmg', el: 'el_fire', rows: [
    [1, 4, 1, 4, 15, 22, 50], [1, 4, 1, 4, 17, 25, 50], [1, 4, 1, 5, 19, 28, 50],
    [1, 4, 1, 5, 21, 31, 50], [1, 3, 1, 6, 23, 34, 50], [101, 3, 1, 6, 25, 37, 50] ] },
  // warleap (id 2, senshi) — warleap_lvl(min_cl, ap, rmax)
  { id: 2, class_id: 0, label: 'warleap', kind: 'warleap', rows: [
    [1, 6, 2], [1, 5, 2], [1, 5, 3], [1, 5, 4], [1, 5, 5], [101, 5, 6] ] },
  // shove (id 3, senshi) — shove_lvl(min_cl, ap, dmg, dmg_crit, push, push_crit, rate)
  { id: 3, class_id: 0, label: 'shove', kind: 'shove', rows: [
    [1, 4, 2, 4, 1, 2, 50], [1, 4, 3, 4, 2, 3, 50], [1, 3, 4, 4, 2, 3, 50],
    [1, 3, 5, 6, 3, 3, 45], [1, 3, 6, 7, 3, 3, 40], [101, 2, 9, 10, 4, 4, 40] ] },
  // backstab (id 7, yajin) — dmg_lvl earth
  { id: 7, class_id: 1, label: 'backstab', kind: 'dmg', el: 'el_earth', rows: [
    [1, 4, 1, 3, 4, 6, 50], [1, 4, 1, 4, 5, 7, 50], [1, 4, 1, 4, 6, 8, 50],
    [1, 3, 1, 4, 7, 9, 50], [1, 3, 1, 4, 8, 10, 50], [101, 3, 1, 5, 13, 20, 30] ] },
  // shadowveil (id 8, yajin) — shadowveil_lvl(min_cl, mp, cd)
  { id: 8, class_id: 1, label: 'shadowveil', kind: 'shadowveil', rows: [
    [1, 1, 11], [1, 1, 10], [1, 1, 9], [1, 1, 8], [1, 1, 7], [101, 2, 6] ] },
  // cutthroat_snare (id 9, yajin) — snare_lvl(min_cl, rmax, base, crit)
  { id: 9, class_id: 1, label: 'cutthroat_snare', kind: 'snare', rows: [
    [1, 3, 1, 9, 11], [1, 4, 2, 10, 12], [1, 5, 3, 11, 13], [1, 6, 4, 12, 14], [1, 7, 5, 13, 15], [101, 8, 6, 17, 19] ] },
  // spectral_claw (id 13, tomoda) — dmg_lvl fire
  { id: 13, class_id: 2, label: 'spectral_claw', kind: 'dmg', el: 'el_fire', rows: [
    [1, 5, 1, 5, 7, 11, 50], [1, 5, 1, 6, 8, 12, 50], [1, 5, 1, 6, 9, 13, 50],
    [1, 4, 1, 6, 10, 14, 50], [1, 4, 1, 7, 12, 16, 45], [101, 4, 1, 7, 22, 24, 45] ] },
  // rending_claw (id 14, tomoda) — dmg_lvl water
  { id: 14, class_id: 2, label: 'rending_claw', kind: 'dmg', el: 'el_water', rows: [
    [1, 5, 1, 5, 9, 12, 50], [1, 5, 1, 6, 10, 13, 50], [1, 5, 1, 6, 11, 14, 50],
    [1, 5, 1, 6, 12, 15, 50], [1, 4, 1, 7, 14, 17, 50], [101, 3, 1, 8, 14, 17, 50] ] },
  // beast_roar (id 16, tomoda) — beast_roar_lvl(min_cl, ap, rmax, raw)
  { id: 16, class_id: 2, label: 'beast_roar', kind: 'beast_roar', rows: [
    [1, 3, 4, 5], [1, 3, 5, 7], [1, 3, 6, 9], [1, 3, 7, 12], [1, 2, 8, 16], [101, 1, 9, 24] ] },
  // emberbolt (id 19, shugo) — dmg_lvl fire
  { id: 19, class_id: 3, label: 'emberbolt', kind: 'dmg', el: 'el_fire', rows: [
    [1, 5, 1, 6, 6, 8, 50], [1, 5, 1, 6, 7, 9, 50], [1, 4, 1, 6, 8, 10, 50],
    [1, 4, 1, 6, 9, 11, 50], [1, 4, 1, 7, 11, 13, 50], [101, 3, 1, 8, 13, 15, 50] ] },
  // stoneward (id 20, shugo) — stoneward_lvl(min_cl, absorb)
  { id: 20, class_id: 3, label: 'stoneward', kind: 'stoneward', rows: [
    [1, 10], [1, 11], [1, 12], [1, 13], [1, 14], [101, 17] ] },
  // bulwark (id 21, shugo) — bulwark_lvl(min_cl, ap, pct)
  { id: 21, class_id: 3, label: 'bulwark', kind: 'bulwark', rows: [
    [1, 4, 15], [1, 4, 20], [1, 4, 25], [1, 4, 30], [1, 4, 38], [101, 3, 45] ] },
]

function build_level(tx, g, book, row) {
  switch (book.kind) {
    case 'dmg': {
      const [min_cl, ap, rmin, rmax, base, crit, rate] = row
      return dmg_lvl(tx, g, g[book.el](), [min_cl, ap, rmin, rmax, base, crit, rate])
    }
    case 'shove': return shove_lvl(tx, g, row)
    case 'warleap': return warleap_lvl(tx, g, row)
    case 'shadowveil': return shadowveil_lvl(tx, g, row)
    case 'snare': return snare_lvl(tx, g, row)
    case 'beast_roar': return beast_roar_lvl(tx, g, row)
    case 'stoneward': return stoneward_lvl(tx, g, row)
    case 'bulwark': return bulwark_lvl(tx, g, row)
    default: throw new Error(`unknown kind ${book.kind}`)
  }
}

for (const book of BOOKS) {
  await run(`add_spell ${book.label} (id ${book.id})`, tx => {
    const g = getters(tx)
    const levels = book.rows.map(row => build_level(tx, g, book, row))
    tx.moveCall({
      target: `${CORE}::spell_registry::add_spell`,
      arguments: [
        tx.object(ADMIN_CAP),
        tx.object(REGISTRY),
        tx.pure.u16(book.id),
        tx.pure.u8(book.class_id),
        tx.makeMoveVec({ type: LEVEL_T, elements: levels }),
        tx.object(VERSION),
      ],
    })
  })
}
console.log('MVP-12 seed complete.')
