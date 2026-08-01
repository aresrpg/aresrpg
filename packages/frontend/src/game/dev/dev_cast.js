// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY cast hook — lets HEADLESS qa land a REAL spell cast when arm→target board clicks won't register
// (Playwright can't drive the 3D raycast). It drives the IDENTICAL path a spell-card-drop + End-Turn produces:
// draft the cast on the target cell (use_dungeon_turn.set_cast_target — the same gold-ring readback the board
// draws), then fire the SAME single commit_turn on_end_turn builds for a cast-only turn:
//   dungeon_store.commit_turn([{ kind: 1 /* cast */, target: <encoded cell>, spell_template_id: '0x…' }])
// staging the spell's on-chain SpellTemplate object id exactly like the real UI (the store routes it to act_cast).
// → the AUTHORITY resolves it: real damage on the target + AP spend + (once the turn advances) the mob replay,
// all off the real sync — NOT a painted VFX. (__ARES_DEV_PLAY_VFX only paints a float with no state change,
// which is why it can't gate D16/D19/the live float — this can.) Returns a small result object so qa can assert.
//
// ONE SEAM, BOTH SURFACES (#1025). `commit_turn` is store state, so the authority behind it is whatever the
// surface seeded: the chain in the world, the local sim chain on /simulator (simulator/fight_shim.js). Every
// read below therefore goes through the fight PROJECTION both surfaces share, never a world-only chain slice.
//
// import.meta.env.DEV-gated by the callers (GameWorldHud, simulator/dev_seams.js) — this whole module
// tree-shakes out of prod, and packages/frontend/scripts/assert_clean_bundle.mjs fails any build that carries it.

import { encode } from '@aresrpg/fight/los'
import { context } from '../store.js'
import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { fight_view } from '@aresrpg/fight/project'
import { fight_spell, resolve_class_spells } from '../screens/hud/fight-spells.js'
import { use_dungeon_turn } from '../screens/dungeon-turn.js'

const CAST_KIND = 1 // dungeon_turn.move apply_cast (0 = move, 1 = cast) — the on-chain action tag
const STATUS_ACTIVE = 1

/** The living fighter standing on {x,y} in a fight view, or null. The ONE target read both surfaces share. */
const living_at = (view, x, y) =>
  [...(view?.fighters?.values() ?? [])].find((f) => !f.dead && f.cell?.x === x && f.cell?.y === y) ?? null

/**
 * The corpus row a dealt card names (#1025). Every surface deals `name_key`s — the bar's one vocabulary
 * (#1034) — and `fight_spell` resolves them through the corpus' own index. Falls back to the caster's class
 * primary when the index misses — level-blind here, the authority enforces `min_char_level`.
 * @param {string | null} hand_id @param {any[]} castable the caster's class rows @returns {any | null}
 */
const cast_row = (hand_id, castable) => (hand_id && fight_spell(hand_id)) || castable[0] || null

/**
 * window.__ARES_DEV_CAST(spell_idx, target_cell) — draft + commit a REAL cast at {x,y} on the active turn.
 * @param {number} spell_idx hand-card index — the cast stages THAT card's SpellTemplate object id (falls back
 *   to the class primary when the index misses), and arms it so the VFX/hand match a real click.
 * @param {{ x: number, y: number }} target_cell the LIVING target's arena cell (fight-los grid coords).
 * @returns {Promise<{
 *   ok: boolean, error?: string,
 *   ap_before?: number, ap_after?: number,
 *   target_hp_before?: number, target_hp_after?: number, target_killed?: boolean,
 * }>}
 */
async function dev_cast(spell_idx, target_cell) {
  const store = use_dungeon.getState()
  const { dungeon, busy } = store
  const fight = fight_view()
  if (!dungeon || !fight) return { ok: false, error: 'no active dungeon fight' }
  if (busy) return { ok: false, error: 'store busy (a tx/poll is in flight) — retry' }
  if (dungeon.status !== STATUS_ACTIVE) return { ok: false, error: `dungeon not ACTIVE (status=${dungeon.status})` }

  const me = fight.my_entity_id
  if (!me) return { ok: false, error: 'no local participant (my_entity_id null)' }
  if (fight.active_entity_id !== me) return { ok: false, error: `not my turn (active=${fight.active_entity_id})` }

  const x = target_cell?.x
  const y = target_cell?.y
  if (!Number.isInteger(x) || !Number.isInteger(y)) return { ok: false, error: 'target_cell must be { x:int, y:int }' }
  const cell = encode(x, y)

  // THE TARGET COMES OFF THE PROJECTION, not `dungeon.mobs` (#1025). That slice is the WORLD's chain readback;
  // the simulator seeds no such row, so reading it made this seam world-only — and crash-y on /simulator. The
  // fight view is the one home both surfaces already project their fighters through.
  const target = living_at(fight, x, y)
  if (!target) {
    const living = [...fight.fighters.values()].filter((f) => !f.dead).map((f) => `${f.cell?.x},${f.cell?.y}`)
    return { ok: false, error: `no living fighter at cell ${x},${y} (living cells: ${living.join(' ')})` }
  }
  const target_hp_before = target.health
  // The AP the active player actually has to spend = the refilled per-turn budget the HUD/board draft against
  // (build_fighters refills the active player to the max; the raw escrow ap is the pre-refill leftover — see
  // dungeon_store #14). Reading the fight slice here matches what a real spell-click would spend from.
  const ap_before = fight.fighters.get(me)?.ap ?? null

  const my_classe =
    fight.fighters.get(me)?.class_id ??
    fight.fighters.get(me)?.classe ??
    dungeon.escrow?.find((p) => (p.character ?? p.character_id) === me)?.classe
  // ONE CORPUS ROW, BOTH SURFACES (#1025 — see `cast_row`). Arming by the row's `name_key` is what the spell
  // bar reads, so the card lights up exactly as a real grab does; staging its `object_id` is what DungeonBoard's
  // flush_commit stages. No id = no seeded spell = honest refusal.
  const spell = cast_row((fight.hand ?? [])[spell_idx] ?? null, resolve_class_spells(my_classe, Number.MAX_SAFE_INTEGER))
  if (!spell?.object_id) return { ok: false, error: `no seeded on-chain spell for classe=${my_classe} — cannot cast` }
  context.dispatch('action/fight/arm', { spell_id: spell.name_key })
  const spell_template_id = spell.object_id

  // DRAFT + COMMIT the identical path on_end_turn runs for a cast: set the cast pick (gold-ring readback on the
  // 3D board), then commit the single action. commit_turn awaits its own refresh(), so the settled on-chain
  // state is readable straight after.
  use_dungeon_turn.getState().set_cast_target(cell)
  await store.commit_turn([{ kind: CAST_KIND, target: cell, spell_template_id }])
  use_dungeon_turn.getState().clear_picks()

  const err = use_dungeon.getState().error
  if (err) return { ok: false, error: String(err) }

  // Read the settled state back through the SAME projection the target was picked from — the escrow/mobs slices
  // it used to read are the world's alone (#1025), and the view carries both facts on every surface.
  const after = fight_view()
  const target_after = after?.fighters?.get(target.id) ?? null
  return {
    ok: true,
    ap_before,
    // the leftover after the cast (the authority refills lazily on the NEXT turn, so this is budget − spend;
    // ap_before − ap_after === the cast's AP cost proves the spend landed).
    ap_after: after?.fighters?.get(me)?.ap ?? null,
    target_hp_before,
    target_hp_after: target_after?.health ?? null,
    target_killed: target_after ? !!target_after.dead : true,
  }
}

/**
 * Register the DEV-only window hook. Called once at app boot (dev builds only). Idempotent. No-op in prod —
 * the caller gates on import.meta.env.DEV so this whole module tree-shakes out of the production bundle.
 */
export function register_dev_cast() {
  if (typeof window === 'undefined') return
  ;/** @type {any} */ (window).__ARES_DEV_CAST = dev_cast
}
