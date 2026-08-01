// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// MOB GROUP CARD — the structured overhead card for an on-chain mob group. Split out of world_spawns.js (a
// 2026-07-10: header restructure pushed the file past the 600-LoC law → extract the card render). The card is a
// UNIT, not a player plate: a HEADER band (the group level + the time-XP aging bonus) over one row PER member.
// That multi-section structure is itself the fix for "mob nametag too similar to the player's one"
// — a player is a single bold gold pill (local_nameplate.js / remote_players.js); a mob group is this table.
//
// COMPOSITION — the level is picked at discovery time, like the presence of an archi: the chain resolves
// every member at DISCOVERY (zones.move `group_seed` → fight.move's seeded spawn
// loop), and spawn_compose.js mirrors that derivation byte-exactly — so the header shows the TRUE rolled span
// of the actual members, each row its EXACT level, and an archimob row its gold ARCHI badge. A missing seed
// (stale SDK row) falls back to the honest template band — never a fabrication.
//
// AGING MIRROR (single home, client-side): §8 groups accrue a bonus XP multiplier the longer they sit unclaimed;
// the chain snapshots it at fight-lock in `aresrpg_fight::fight::aging_bp` (packages/move/engine/sources/
// fight.move:383-389) as `min(floor((now − spawned_at_ms)/HOUR_MS) · aging_bp_per_hour, aging_cap_bp)`, with the
// live GameConfig defaults DEFAULT_AGING_BP_PER_HOUR=100 (+1%/h) and DEFAULT_AGING_CAP_BP=10_000 (+100% cap) —
// packages/move/aresrpg/sources/config.move:100-101. Settlement scales XP ×(10000+aged_bp)/10000 (settlement.move
// :106), so the displayed "+N% XP" = aged_bp/100. We mirror that exact whole-hour-floored formula here so the
// card previews what a fight started NOW would bank — it ticks up one % per whole hour of age, capped at +100%.

import i18n from '../i18n'

import { compose_group_card } from './spawn_compose.js'

const HOUR_MS = 3_600_000 // fight.move:44 HOUR_MS — whole-hour granularity (integer floor, matches the chain)
const AGING_BP_PER_HOUR = 100 // config.move:100 DEFAULT_AGING_BP_PER_HOUR (+1.00%/h)
const AGING_CAP_BP = 10_000 // config.move:101 DEFAULT_AGING_CAP_BP (+100.00% total, reached at 100h)

/**
 * The client mirror of the chain's §8 aging bonus, as a whole-percent XP boost (0..100).
 * @param {number} spawned_at_ms the group's on-chain spawn time (ms) @param {number} [now] ms epoch
 * @returns {number} the bonus percent (aged_bp / 100), floored to whole hours exactly like the chain
 */
export function aging_bonus_pct(spawned_at_ms, now = Date.now()) {
  if (!spawned_at_ms || now <= spawned_at_ms) return 0
  const hours = Math.floor((now - spawned_at_ms) / HOUR_MS)
  const bp = Math.min(hours * AGING_BP_PER_HOUR, AGING_CAP_BP)
  return bp / 100
}

/** The level text: a single `LV n` when uniform, else the span `LV lo–hi` (of the DERIVED members when the
 *  seed is known — the true rolled span; of the template band only as the seedless fallback). */
const group_level_text = (/** @type {number} */ min, /** @type {number} */ max) =>
  max > min ? `LV ${min}–${max}` : `LV ${min}`

const XP_ON = '#c8963c' // an accrued bonus pops in the design-system gold…
const XP_OFF = '#6b7280' // …a fresh group (+0%) reads muted — the mechanic is visible, honestly zero for now

/** Build/refresh the `+N% XP` badge text + tint on `span` for the current age; returns the rendered percent. */
function paint_xp(/** @type {HTMLElement} */ span, /** @type {number} */ spawned_at_ms) {
  const pct = aging_bonus_pct(spawned_at_ms)
  span.textContent = i18n.t('discovery.xp_bonus', { pct })
  span.style.color = pct > 0 ? XP_ON : XP_OFF
  return pct
}

/**
 * Render the full group card into `chip` (its border/bg/font are owned by the caller's chip style). Rebuilds
 * as a header band + one text-node row per member — never innerHTML (mob names are on-chain strings). The
 * CONTENT is composed purely upstream (spawn_compose.js `compose_group_card`); this function only paints it,
 * so a mixed pack's rows carry each unit's own species and its own distance-graded level by construction.
 * @param {HTMLElement} chip @param {{ roster: Array<{name:string, min_level:number, max_level:number,tier?:string|null}>,
 *   graded?:boolean, progress?:number, size:number, spawned_at_ms:number, group_seed?:string|null,
 *   archimob_bp?:number|null, team_bound?:number|null }} facts
 */
export function render_group_card(
  chip,
  { roster, graded, progress, size, spawned_at_ms, group_seed, archimob_bp, team_bound }
) {
  chip.textContent = ''
  const { span_lo, span_hi, rows } = compose_group_card({
    roster,
    graded,
    progress,
    size,
    group_seed,
    archimob_bp,
    team_bound,
  })

  // ── HEADER band: the group's TRUE rolled span (left) + the aging XP bonus (right), a thin gold divider
  // under it. This band + the member table below is what makes a group read as a UNIT, unlike a player pill. ──
  const header = document.createElement('div')
  header.style.cssText =
    'display:flex;gap:10px;justify-content:space-between;align-items:baseline;' +
    'padding-bottom:2px;margin-bottom:2px;border-bottom:1px solid rgba(200,150,60,.35)'
  const lvl = document.createElement('span')
  lvl.style.cssText = 'color:#f5d0a9;font-weight:600'
  lvl.textContent = `${i18n.t('discovery.group')} · ${group_level_text(span_lo, span_hi)}`
  const xp = document.createElement('span')
  xp.style.cssText = 'font-weight:600;letter-spacing:.08em'
  xp.dataset.xp = '1' // update_group_aging finds this node to tick the bonus without a full re-render
  chip.dataset.agedPct = String(paint_xp(xp, spawned_at_ms))
  header.append(lvl, xp)
  chip.appendChild(header)

  // ── member rows: one line per SEATED mob (no ×N collapse), each `species · LV n` with its EXACT rolled level;
  // an archimob row carries the gold ARCHI badge (the encyclopedia's existing marker language). A seedless row
  // prints the group's honest band instead of a fabricated number. ──
  for (const member of rows) {
    const line = document.createElement('div')
    line.style.cssText = 'color:#e8e4dc;opacity:.92;line-height:1.55'
    line.textContent = `${member.name} · ${
      member.level != null ? `LV ${member.level}` : group_level_text(span_lo, span_hi)
    }`
    if (member.archi) {
      const badge = document.createElement('span')
      badge.className = 'entity-badge entity-badge--world'
      badge.dataset.mobTier = 'archi'
      badge.textContent = i18n.t('encyclopedia.archi_badge')
      line.appendChild(badge)
    }
    chip.appendChild(line)
  }
}

/** Per-frame cheap tick of the aging badge only (the level + rows never change) — a no-op unless the whole-hour
 *  percent actually moved, so the DOM is touched at most once per hour per card. */
export function update_group_aging(/** @type {HTMLElement | null} */ chip, /** @type {number} */ spawned_at_ms) {
  if (!chip) return
  const pct = aging_bonus_pct(spawned_at_ms)
  if (chip.dataset.agedPct === String(pct)) return
  chip.dataset.agedPct = String(pct)
  const span = /** @type {HTMLElement | null} */ (chip.querySelector('[data-xp]'))
  if (span) paint_xp(span, spawned_at_ms)
}
